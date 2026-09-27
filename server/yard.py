"""PLAYYARD — one MuJoCo world, many robot instances.

Each instance is a real model (Microduck, Beni, or Sesame) placed on the floor.
An instance is bound to exactly one ONNX filename. Microduck catalog files play
a preview motion on that robot's own joints. Beni and Sesame have no runnable
policy here, so they stay in the published pose. This module does not invent
actuator limits or claim the preview is network output.
"""
import io
import math
import threading
import time
from collections import OrderedDict
from pathlib import Path

from PIL import Image

import mujoco
import numpy as np

ROOT = Path(__file__).resolve().parent / "models"
MAX_INSTANCES = 8

YARD_XML = """
<mujoco model="playyard">
  <visual>
    <headlight diffuse="0.6 0.6 0.6" ambient="0.3 0.3 0.3" specular="0 0 0"/>
    <rgba haze="0.15 0.25 0.35 1"/>
    <global azimuth="135" elevation="-28" offwidth="1600" offheight="1200"/>
  </visual>
  <asset>
    <texture type="skybox" builtin="gradient" rgb1="0.3 0.5 0.7" rgb2="0 0 0" width="512" height="3072"/>
    <texture type="2d" name="groundplane" builtin="checker" mark="edge" rgb1="0.2 0.3 0.4"
      rgb2="0.1 0.2 0.3" markrgb="0.8 0.8 0.8" width="300" height="300"/>
    <material name="groundplane" texture="groundplane" texuniform="true" texrepeat="8 8" reflectance="0.2"/>
  </asset>
  <worldbody>
    <light pos="0 0 3.5" dir="0 0 -1" directional="true"/>
    <geom name="floor" type="plane" size="0 0 0.05" material="groundplane"/>
  </worldbody>
</mujoco>
"""

ROBOTS = {
    "microduck": ROOT / "microduck" / "robot_allcollisions.xml",
    "roller": ROOT / "microduck" / "robot_groundcontact_rollers.xml",
    "beni": ROOT / "beni" / "mjcf" / "beni.xml",
    "sesame": ROOT / "sesame" / "scene_viewer.xml",
}
SCENES = {
    "microduck": ROOT / "microduck" / "scene_viewer_standard.xml",
    "roller": ROOT / "microduck" / "scene_viewer_roller.xml",
}

# Official Microduck policy filenames. Roller files use the roller MJCF.
ROLLER_FILES = {"roller.onnx", "roller_crouch.onnx"}
MOTIONS = {
    "alpha_walking.onnx": "walk",
    "velstand.onnx": "walk",
    "roller.onnx": "walk",
    "alpha_stand.onnx": "stand",
    "alpha_sitstand.onnx": "sit",
    "alpha_ground_pick.onnx": "crouch",
    "roller_crouch.onnx": "crouch",
    "roulade.onnx": "roll",
    "ball_kick_left.onnx": "kick_left",
    "ball_kick_right.onnx": "kick_right",
}
ACTUATORS = [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
    "neck_pitch", "head_pitch", "head_yaw", "head_roll",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
]

MOUSE = {
    "rotate": mujoco.mjtMouse.mjMOUSE_ROTATE_V,
    "pan": mujoco.mjtMouse.mjMOUSE_MOVE_H,
    "pan_v": mujoco.mjtMouse.mjMOUSE_MOVE_V,
    "zoom": mujoco.mjtMouse.mjMOUSE_ZOOM,
}
FIT_MARGIN = 1.35


def motion_for(robot, onnx):
    if robot != "microduck":
        return "pose"
    return MOTIONS.get(onnx, "stand")


def model_key(robot, onnx):
    if robot == "microduck" and onnx in ROLLER_FILES:
        return "roller"
    if robot == "microduck":
        return "microduck"
    return robot


def _mute_planes(body):
    for geom in body.geoms:
        if geom.name == "floor" or int(geom.type) == int(mujoco.mjtGeom.mjGEOM_PLANE):
            geom.group = 4
            geom.contype = 0
            geom.conaffinity = 0
            geom.rgba = [0, 0, 0, 0]
    for child in body.bodies:
        _mute_planes(child)


def _load_child(key):
    spec = mujoco.MjSpec.from_file(str(ROBOTS[key]))
    if key == "beni":
        spec.meshdir = str(ROOT / "beni" / "meshes")
        spec.texturedir = str(ROOT / "beni" / "textures")
    elif key == "sesame":
        spec.meshdir = str(ROOT / "sesame" / "parts")
        _mute_planes(spec.worldbody)
    return spec


def _keyframe(key):
    model = mujoco.MjModel.from_xml_path(str(SCENES[key]))
    data = mujoco.MjData(model)
    kid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
    if kid >= 0:
        mujoco.mj_resetDataKeyframe(model, data, kid)
    else:
        mujoco.mj_resetData(model, data)
        mujoco.mj_forward(model, data)
    return data.qpos.copy(), data.ctrl.copy()


class Yard:
    def __init__(self):
        self.lock = threading.Lock()
        self.instances = []
        self.runtime = []
        self.jobs = []
        self._seq = 0
        self._homes = {}
        self.views = {}
        self.viewers = 0
        self.fps = 0.0
        self._fps_frames = 0
        self._fps_t = time.perf_counter()
        self.renderers = OrderedDict()
        self.frames = {}
        self.seen = {}
        self.scn = None
        self.vopt = mujoco.MjvOption()
        self.vopt.sitegroup[:] = 0
        self.vopt.geomgroup[3:] = 0
        self.running = True
        self.variant = "yard"
        self.model = None
        self.data = None
        self._rebuild([])

    def start(self):
        threading.Thread(target=self.step_loop, daemon=True).start()
        threading.Thread(target=self.render_loop, daemon=True).start()

    def home(self, key):
        if key not in self._homes and key in SCENES:
            self._homes[key] = _keyframe(key)
        return self._homes.get(key)

    def _compile(self, instances):
        spec = mujoco.MjSpec.from_string(YARD_XML)
        for inst in instances:
            child = _load_child(inst["key"])
            frame = spec.worldbody.add_frame(pos=[inst["x"], inst["y"], 0.0])
            spec.attach(child, prefix=inst["prefix"], frame=frame)
        model = spec.compile()
        data = mujoco.MjData(model)
        mujoco.mj_resetData(model, data)
        mujoco.mj_forward(model, data)
        runtime = [self._bind(model, data, inst) for inst in instances]
        mujoco.mj_forward(model, data)
        return model, data, runtime

    def _bind(self, model, data, inst):
        prefix = inst["prefix"]
        info = {"inst": inst, "free_adr": None, "dof_adr": None, "qpos_n": 0, "qvel_n": 0,
                "trunk": -1, "act": {}, "home_qpos": None, "home_ctrl": None, "root": -1}

        if inst["key"] == "sesame":
            return info

        jname = "trunk_base_freejoint" if inst["robot"] == "microduck" else "root_joint"
        bname = "trunk_base" if inst["robot"] == "microduck" else "base_link"
        jid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, prefix + jname)
        bid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY, prefix + bname)
        if jid < 0 or bid < 0:
            raise RuntimeError("Could not find the " + inst["robot"] + " base in the playyard.")
        adr = int(model.jnt_qposadr[jid])
        dof = int(model.jnt_dofadr[jid])
        info["free_adr"] = adr
        info["dof_adr"] = dof
        info["trunk"] = bid
        info["root"] = bid

        # qpos/qvel belonging to this free joint and the hinges that follow it,
        # up to the next free joint (the next instance).
        next_q = model.nq
        next_v = model.nv
        for j in range(jid + 1, model.njnt):
            if int(model.jnt_type[j]) == int(mujoco.mjtJoint.mjJNT_FREE):
                next_q = int(model.jnt_qposadr[j])
                next_v = int(model.jnt_dofadr[j])
                break
        info["qpos_n"] = next_q - adr
        info["qvel_n"] = next_v - dof

        if inst["robot"] == "microduck":
            qpos, ctrl = self.home(inst["key"])
            n = min(info["qpos_n"], len(qpos))
            data.qpos[adr:adr + n] = qpos[:n]
            # Free-joint qpos is the world pose, so the attach frame does not
            # locate the duck once this keyframe is written.
            data.qpos[adr] = inst["x"]
            data.qpos[adr + 1] = inst["y"]
            info["home_qpos"] = data.qpos[adr:adr + info["qpos_n"]].copy()
            info["home_ctrl"] = ctrl.copy()
            for i, name in enumerate(ACTUATORS):
                aid = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_ACTUATOR, prefix + name)
                if aid >= 0:
                    info["act"][name] = aid
                    if i < len(ctrl):
                        data.ctrl[aid] = ctrl[i]
        else:
            self._plant(model, data, info)
            info["home_qpos"] = data.qpos[adr:adr + info["qpos_n"]].copy()
        return info

    def _plant(self, model, data, info):
        """Lift one floating base so its visible geoms sit on z = 0."""
        adr = info["free_adr"]
        root = info["root"]
        lo = np.inf
        for g in range(model.ngeom):
            if model.geom_type[g] == mujoco.mjtGeom.mjGEOM_PLANE:
                continue
            if model.geom_group[g] >= 3:
                continue
            body = int(model.geom_bodyid[g])
            if not self._under(model, body, root):
                continue
            aabb = model.geom_aabb[g]
            corners = aabb[:3] + np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]) * aabb[3:]
            pts = data.geom_xpos[g] + corners @ data.geom_xmat[g].reshape(3, 3).T
            lo = min(lo, float(pts[:, 2].min()))
        if np.isfinite(lo) and abs(lo) > 1e-4:
            data.qpos[adr + 2] -= lo
            mujoco.mj_forward(model, data)

    def _under(self, model, body, root):
        while body != 0:
            if body == root:
                return True
            body = int(model.body_parentid[body])
        return root == 0

    def _rebuild(self, instances):
        model, data, runtime = self._compile(instances)
        self._drop_renderers()
        self.model = model
        self.data = data
        self.instances = instances
        self.runtime = runtime
        self.scn = None

    def _drop_renderers(self):
        for renderer in self.renderers.values():
            try:
                renderer.close()
            except Exception:
                pass
        self.renderers.clear()
        self.frames.clear()

    def submit(self, job):
        event = threading.Event()
        job["event"] = event
        with self.lock:
            self.jobs.append(job)
        if not event.wait(25):
            return {"ok": False, "error": "The playyard did not update."}
        return job.get("result") or {"ok": False, "error": "The playyard did not update."}

    def _drain(self):
        jobs = self.jobs
        self.jobs = []
        for job in jobs:
            try:
                if job["op"] == "reset":
                    self._rebuild([])
                    self._seq = 0
                    job["result"] = {"ok": True, "instances": []}
                elif job["op"] == "place":
                    job["result"] = self._place(job)
                else:
                    job["result"] = {"ok": False, "error": "Unknown request."}
            except Exception as exc:
                job["result"] = {"ok": False, "error": str(exc).split("\n", 1)[0][:240]}
            job["event"].set()

    def _place(self, job):
        robot = job["robot"]
        onnx = job["onnx"]
        if robot not in ("microduck", "beni", "sesame"):
            return {"ok": False, "error": "Choose Microduck, Beni, or Sesame."}
        if not onnx or len(onnx) > 180 or "/" in onnx or "\\" in onnx or not onnx.lower().endswith(".onnx"):
            return {"ok": False, "error": "Choose an .onnx file."}
        if len(self.instances) >= MAX_INSTANCES:
            return {"ok": False, "error": "The playyard holds 8 robots. Reset to clear it."}
        view = self.views.get(job["view"])
        if view is None:
            return {"ok": False, "error": "The playyard view is not open yet."}
        point = self._pick(view, job["nx"], job["ny"])
        if point is None:
            return {"ok": False, "error": "Click the floor."}
        key = model_key(robot, onnx)
        self._seq += 1
        inst = {
            "id": self._seq,
            "prefix": "r%d/" % self._seq,
            "robot": robot,
            "key": key,
            "onnx": onnx,
            "motion": motion_for(robot, onnx),
            "x": float(point[0]),
            "y": float(point[1]),
        }
        nxt = self.instances + [inst]
        try:
            self._rebuild(nxt)
        except Exception:
            self._seq -= 1
            self._rebuild(self.instances)
            raise
        if view is not None:
            az, el = view.cam.azimuth, view.cam.elevation
            self.fit_camera(view.cam, view.w / max(view.h, 1))
            view.cam.azimuth, view.cam.elevation = az, el
        return {"ok": True, "instances": self.public()}

    def _pick(self, view, nx, ny):
        if self.scn is None:
            self.scn = mujoco.MjvScene(self.model, maxgeom=8000)
        pert = mujoco.MjvPerturb()
        mujoco.mjv_updateScene(
            self.model, self.data, self.vopt, pert, view.cam,
            int(mujoco.mjtCatBit.mjCAT_ALL), self.scn)
        aspect = view.w / max(view.h, 1)
        relx = float(nx) * 2.0 - 1.0
        rely = 1.0 - float(ny) * 2.0
        sel = np.zeros(3)
        geomid = np.zeros(1, np.int32)
        flexid = np.zeros(1, np.int32)
        skinid = np.zeros(1, np.int32)
        body = mujoco.mjv_select(
            self.model, self.data, self.vopt, aspect, relx, rely, self.scn,
            sel, geomid, flexid, skinid)
        if body < 0 or not np.all(np.isfinite(sel)):
            return None
        return sel

    def public(self):
        return [{
            "id": i["id"], "robot": i["robot"], "onnx": i["onnx"],
            "motion": i["motion"], "x": round(i["x"], 3), "y": round(i["y"], 3),
        } for i in self.instances]

    # ---------- physics ----------
    def apply_controls(self):
        d = self.data
        d.xfrc_applied[:] = 0
        t = d.time
        for info in self.runtime:
            inst = info["inst"]
            if inst["motion"] == "pose":
                if info["home_qpos"] is not None:
                    adr = info["free_adr"]
                    d.qpos[adr:adr + info["qpos_n"]] = info["home_qpos"]
                    d.qvel[info["dof_adr"]:info["dof_adr"] + info["qvel_n"]] = 0
                continue
            if not info["act"] or info["home_ctrl"] is None:
                continue
            ctrl = info["home_ctrl"]
            # home_ctrl follows ACTUATORS order; write through actuator ids.
            base = np.zeros(self.model.nu)
            for i, name in enumerate(ACTUATORS):
                aid = info["act"].get(name)
                if aid is not None and i < len(ctrl):
                    base[aid] = ctrl[i]
            a = info["act"]
            kind = inst["motion"]
            if kind == "walk":
                ph = 2 * np.pi * 1.1 * t
                self._add(base, a, "left_hip_pitch", 0.30 * np.sin(ph))
                self._add(base, a, "left_knee", 0.35 * np.sin(ph + np.pi / 2))
                self._add(base, a, "left_ankle", -0.25 * np.sin(ph))
                self._add(base, a, "right_hip_pitch", 0.30 * np.sin(ph + np.pi))
                self._add(base, a, "right_knee", 0.35 * np.sin(ph + 3 * np.pi / 2))
                self._add(base, a, "right_ankle", -0.25 * np.sin(ph + np.pi))
            elif kind == "sit":
                s = 0.5 + 0.5 * np.sin(2 * np.pi * 0.25 * t)
                self._add(base, a, "left_hip_pitch", -0.45 * s)
                self._add(base, a, "right_hip_pitch", -0.45 * s)
                self._add(base, a, "left_knee", 0.85 * s)
                self._add(base, a, "right_knee", 0.85 * s)
            elif kind == "crouch":
                s = 0.65 + 0.35 * np.sin(2 * np.pi * 0.35 * t)
                self._add(base, a, "left_hip_pitch", -0.7 * s)
                self._add(base, a, "right_hip_pitch", -0.7 * s)
                self._add(base, a, "left_knee", 1.15 * s)
                self._add(base, a, "right_knee", 1.15 * s)
                self._add(base, a, "left_ankle", 0.25 * s)
                self._add(base, a, "right_ankle", 0.25 * s)
            elif kind == "roll":
                ph = 2 * np.pi * 0.8 * t
                self._add(base, a, "left_hip_pitch", 0.6 * np.sin(ph))
                self._add(base, a, "right_hip_pitch", 0.6 * np.sin(ph))
                self._add(base, a, "left_knee", 0.45 * np.sin(ph + 1))
                self._add(base, a, "right_knee", 0.45 * np.sin(ph + 1))
                self._add(base, a, "head_pitch", 0.3 * np.sin(ph))
            elif kind == "kick_left":
                swing = max(0.0, np.sin(2 * np.pi * 0.7 * t))
                self._add(base, a, "left_hip_pitch", 0.95 * swing)
                self._add(base, a, "left_knee", 0.55 * swing)
            elif kind == "kick_right":
                swing = max(0.0, np.sin(2 * np.pi * 0.7 * t))
                self._add(base, a, "right_hip_pitch", 0.95 * swing)
                self._add(base, a, "right_knee", 0.55 * swing)
            else:
                self._add(base, a, "left_hip_roll", 0.05 * np.sin(2 * np.pi * 0.5 * t))
                self._add(base, a, "right_hip_roll", 0.05 * np.sin(2 * np.pi * 0.5 * t))
                self._add(base, a, "head_yaw", 0.2 * np.sin(2 * np.pi * 0.25 * t))
            for aid in info["act"].values():
                d.ctrl[aid] = base[aid]
            self._assist(info, kind == "walk")
            if info["free_adr"] is not None and d.qpos[info["free_adr"] + 2] < 0.05:
                n = min(info["qpos_n"], len(info["home_qpos"]))
                d.qpos[info["free_adr"]:info["free_adr"] + n] = info["home_qpos"][:n]
                d.qvel[info["dof_adr"]:info["dof_adr"] + info["qvel_n"]] = 0

    def _add(self, base, act, name, value):
        aid = act.get(name)
        if aid is not None:
            base[aid] += value

    def _assist(self, info, walking):
        d = self.data
        adr = info["free_adr"]
        dof = info["dof_adr"]
        if adr is None or info["trunk"] < 0:
            return
        if walking:
            kp_p, kd_p, kp_q, kd_q = 0.0, 0.0, 0.5, 0.1
        else:
            kp_p, kd_p, kp_q, kd_q = 30.0, 6.0, 1.2, 0.25
        home_pos = info["home_qpos"][:3]
        home_quat = info["home_qpos"][3:7]
        qerr = np.zeros(4)
        rotvec = np.zeros(3)
        qc = d.qpos[adr + 3:adr + 7]
        mujoco.mju_mulQuat(qerr, home_quat, np.array([qc[0], -qc[1], -qc[2], -qc[3]]))
        mujoco.mju_quat2Vel(rotvec, qerr, 1.0)
        d.xfrc_applied[info["trunk"], 0:3] = kp_p * (home_pos - d.qpos[adr:adr + 3]) - kd_p * d.qvel[dof:dof + 3]
        d.xfrc_applied[info["trunk"], 3:6] = kp_q * rotvec - kd_q * d.qvel[dof + 3:dof + 6]

    def step_loop(self):
        while self.running:
            with self.lock:
                if self.model is not None:
                    for _ in range(8):
                        self.apply_controls()
                        mujoco.mj_step(self.model, self.data)
            time.sleep(0.004)

    # ---------- camera / render ----------
    def make_camera(self, aspect, cam_name=None):
        cam = mujoco.MjvCamera()
        self.fit_camera(cam, aspect)
        return cam

    def fit_camera(self, cam, aspect, spec=None):
        cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        lo, hi = self._bounds()
        if lo is None:
            cam.lookat = [0.0, 0.0, 0.1]
            cam.distance = 2.6
            cam.azimuth = 135.0
            cam.elevation = -42.0
            return
        center = (lo + hi) / 2
        height = max(hi[2] - lo[2], 0.2)
        width = max(hi[0] - lo[0], hi[1] - lo[1], 0.4)
        cam.lookat = center.tolist()
        half = math_tan(self.model.vis.global_.fovy)
        dist_h = height * FIT_MARGIN / (2 * half)
        dist_w = width * FIT_MARGIN / (2 * half * max(aspect, 0.1))
        cam.distance = max(dist_h, dist_w, 2.2)
        cam.azimuth = 135.0
        cam.elevation = -28.0

    def _bounds(self):
        if self.model is None:
            return None, None
        m, d = self.model, self.data
        lo = np.full(3, np.inf)
        hi = np.full(3, -np.inf)
        signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
        any_geom = False
        for g in range(m.ngeom):
            if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_PLANE or m.geom_group[g] >= 3:
                continue
            aabb = m.geom_aabb[g]
            corners = aabb[:3] + signs * aabb[3:]
            pts = d.geom_xpos[g] + corners @ d.geom_xmat[g].reshape(3, 3).T
            lo = np.minimum(lo, pts.min(axis=0))
            hi = np.maximum(hi, pts.max(axis=0))
            any_geom = True
        if not any_geom or not np.isfinite(lo).all():
            return None, None
        return lo, hi

    def move_camera(self, cam, action, dx, dy):
        act = MOUSE.get(action)
        if act is None or self.model is None:
            return
        mujoco.mjv_moveCamera(self.model, int(act), float(dx), float(dy), cam)

    def set_color(self, color):
        return

    def renderer(self, w, h):
        slot = self.renderers.get((w, h))
        if slot is None:
            slot = mujoco.Renderer(self.model, height=h, width=w)
            self.renderers[(w, h)] = slot
            while len(self.renderers) > 4:
                _, old = self.renderers.popitem(last=False)
                try:
                    old.close()
                except Exception:
                    pass
        else:
            self.renderers.move_to_end((w, h))
        return slot

    def render_loop(self):
        while self.running:
            now = time.perf_counter()
            with self.lock:
                self._drain()
                view_items = list(self.views.items())
            for _vid, vs in view_items:
                try:
                    renderer = self.renderer(vs.w, vs.h)
                    with self.lock:
                        renderer.update_scene(self.data, vs.cam, self.vopt)
                        rgb = renderer.render()
                    buf = io.BytesIO()
                    Image.fromarray(rgb).save(buf, format="JPEG", quality=80)
                    vs.frame = buf.getvalue()
                    self._fps_frames += 1
                except Exception:
                    time.sleep(0.05)
            if now - self._fps_t >= 2.0:
                self.fps = round(self._fps_frames / (now - self._fps_t), 1)
                self._fps_frames = 0
                self._fps_t = now
            time.sleep(max(0.0, 1 / 30 - (time.perf_counter() - now)))

    def frame(self, key):
        if isinstance(key, tuple) and len(key) == 2 and key[0] == "view":
            vs = self.views.get(key[1])
            if not vs:
                return b""
            vs.last = time.perf_counter()
            waited = 0.0
            while not vs.frame and waited < 1.5:
                time.sleep(0.05)
                waited += 0.05
            return vs.frame or b""
        return b""

    def status(self):
        return {
            "ok": True,
            "variant": "yard",
            "engine": "MuJoCo " + mujoco.__version__,
            "mode": "playyard",
            "assist": "off",
            "fps": self.fps,
            "viewers": self.viewers,
            "instances": self.public(),
        }


def math_tan(fovy_deg):
    return math.tan(math.radians(float(fovy_deg) / 2.0))
