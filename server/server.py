#!/usr/bin/env python3
"""Microduck — lightweight MuJoCo viewer backend.

Serves:
  /                        static frontend (the trainmybot/ directory)
  /api/status?variant=     JSON: sim state, fps, model, assist
  /api/frame.jpg           single JPEG frame (view=id or legacy cam=)
  /api/stream.mjpeg        multipart MJPEG live stream
  /api/command?cmd=        stand|walk|reset — drives the preview instance
  /api/view/open           create a per-preview camera session
  /api/view/move           rotate | pan | zoom | fit  (MuJoCo mouse actions)
  /api/view/update         w / h / color for an existing session
  /api/view/close          drop a session

Frame/stream query:
  view    = session id from /api/view/open (interactive camera)
  variant = standard | roller      (foot type → real MJCF, collisions, passive wheels)
  cam     = side | front | top     (legacy named cameras, used by static posters)
  w, h    = viewport size in device pixels. Frames are rendered at exactly this
            aspect (VIEWER-01) — the frontend never letterboxes or stretches.
  color   = palette key (see PALETTES); only the accent materials change.

Physics: real MuJoCo (mj_step) on the official pollen-robotics/microduck_rl
MJCF. No trained policy is bundled, so this is a Model preview: the trunk is
held by an external PD (Stabilization assist).
Model assets: see models/microduck/NOTICE.txt.

Requires: mujoco, pillow  (managed venv: ~/.workbuddy/binaries/python/envs/default)
Run:      ./start.sh   (listens on http://localhost:8766)
"""
import io
import json
import math
import secrets
import threading
import time
from collections import OrderedDict
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import mujoco
import numpy as np
from PIL import Image

from yard import Yard

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT.parent
MODELS = ROOT / "models" / "microduck"
VARIANTS = {
    "standard": MODELS / "scene_viewer_standard.xml",
    "roller": MODELS / "scene_viewer_roller.xml",
    "beni": ROOT / "models" / "beni" / "scene_viewer.xml",
    "sesame": ROOT / "models" / "sesame" / "scene_viewer.xml",
}
# Catalog posters. Hold the authored pose; do not run the Microduck balance controller.
DISPLAY_VARIANTS = {"beni", "sesame"}
PORT = 8766
MIN_W, MAX_W, MIN_H, MAX_H = 160, 1600, 120, 1200
DEFAULT_W, DEFAULT_H = 640, 480

CAMS = {
    "side":  {"azimuth": 90.0,  "elevation": -12.0},
    "front": {"azimuth": 180.0, "elevation": -10.0},
    "top":   {"azimuth": 90.0,  "elevation": -60.0},
    # Card posters: axonometric, three faces visible.
    "iso":   {"azimuth": 135.0, "elevation": -35.0},
}
# safety margin around the measured model bounds (≈10% per side) plus motion headroom
FIT_MARGIN = 1.22

ACCENT_MATERIALS = [
    "foot_left_material", "foot_right_material",
    "ankle_left_material", "ankle_right_material",
    "jaw_material", "bottom_head_shell_material",
]
PALETTES = {
    "orange":   None,  # model default
    "teal":     (0.08, 0.55, 0.56),
    "blue":     (0.22, 0.47, 0.82),
    "yellow":   (0.95, 0.74, 0.12),
    "graphite": (0.30, 0.31, 0.33),
}

MOUSE = {
    "rotate": mujoco.mjtMouse.mjMOUSE_ROTATE_V,
    "pan": mujoco.mjtMouse.mjMOUSE_MOVE_H,
    "pan_v": mujoco.mjtMouse.mjMOUSE_MOVE_V,
    "zoom": mujoco.mjtMouse.mjMOUSE_ZOOM,
}


class ViewState:
    """One frontend preview's free camera and latest JPEG."""

    def __init__(self, cam, w, h, color):
        self.cam = cam
        self.w = w
        self.h = h
        self.color = color
        self.frame = b""
        self.last = time.perf_counter()


def clamp_size(w, h):
    try:
        w, h = int(float(w)), int(float(h))
    except (TypeError, ValueError):
        w, h = DEFAULT_W, DEFAULT_H
    w = max(MIN_W, min(MAX_W, w))
    h = max(MIN_H, min(MAX_H, h))
    return w - (w % 2), h - (h % 2)


class Sim:
    """Real-time MuJoCo sim + offscreen renderer for one foot variant."""

    def __init__(self, variant):
        self.variant = variant
        self.display = variant in DISPLAY_VARIANTS
        self.xml = VARIANTS[variant]
        self.lock = threading.Lock()
        self.model = mujoco.MjModel.from_xml_path(str(self.xml))
        self.data = mujoco.MjData(self.model)
        self.key = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_KEY, "STAND")
        if self.key >= 0:
            mujoco.mj_resetDataKeyframe(self.model, self.data, self.key)
        else:
            mujoco.mj_resetData(self.model, self.data)
        mujoco.mj_forward(self.model, self.data)
        if self.display:
            self.place_on_floor()
        self.home_qpos = self.data.qpos.copy()
        self.stand_ctrl = self.data.ctrl.copy()
        self.trunk = mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_BODY, "trunk_base")
        self.home_pos = self.data.qpos[:3].copy() if self.model.nq >= 3 else np.zeros(3)
        self.home_quat = self.data.qpos[3:7].copy() if self.model.nq >= 7 else np.array([1.0, 0.0, 0.0, 0.0])
        self.bounds = self.measure_bounds()
        self.vopt = None
        if self.display:
            self.vopt = mujoco.MjvOption()
            self.vopt.sitegroup[:] = 0
            self.vopt.geomgroup[3:] = 0

        self.accent_ids = [i for i in (
            mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_MATERIAL, n) for n in ACCENT_MATERIALS) if i >= 0]
        self.accent_default = {i: self.model.mat_rgba[i].copy() for i in self.accent_ids}

        def aid(name):
            return mujoco.mj_name2id(self.model, mujoco.mjtObj.mjOBJ_ACTUATOR, name)

        self.a = {n: aid(n) for n in [
            "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
            "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
            "head_yaw",
        ]}
        self.mode = "stand"
        self.renderers = OrderedDict()  # (w, h) -> Renderer; render-thread only
        self.frames = {}                # (cam, w, h, color) -> jpeg bytes
        self.seen = {}                  # same key -> last request time
        self.views = {}                 # view_id -> ViewState
        self.viewers = 0
        self.fps = 0.0
        self._fps_frames = 0
        self._fps_t = time.perf_counter()
        self.running = True

    # ---------- physics ----------
    def apply_ctrl(self):
        if self.display:
            self.data.qpos[:] = self.home_qpos
            self.data.qvel[:] = 0
            return
        t = self.data.time
        ctrl = self.stand_ctrl.copy()
        a = self.a
        if self.mode == "walk":
            ph = 2 * np.pi * 1.1 * t
            ctrl[a["left_hip_pitch"]] += 0.30 * np.sin(ph)
            ctrl[a["left_knee"]] += 0.35 * np.sin(ph + np.pi / 2)
            ctrl[a["left_ankle"]] -= 0.25 * np.sin(ph)
            ctrl[a["right_hip_pitch"]] += 0.30 * np.sin(ph + np.pi)
            ctrl[a["right_knee"]] += 0.35 * np.sin(ph + 3 * np.pi / 2)
            ctrl[a["right_ankle"]] -= 0.25 * np.sin(ph + np.pi)
        else:
            ctrl[a["left_hip_roll"]] += 0.05 * np.sin(2 * np.pi * 0.5 * t)
            ctrl[a["right_hip_roll"]] += 0.05 * np.sin(2 * np.pi * 0.5 * t)
            ctrl[a["head_yaw"]] += 0.2 * np.sin(2 * np.pi * 0.25 * t)
        self.data.ctrl[:] = ctrl
        self.apply_assist()

    def apply_assist(self):
        """External PD on the trunk: full in stand, orientation-only in walk."""
        d = self.data
        if self.mode == "walk":
            kp_p, kd_p, kp_q, kd_q = 0.0, 0.0, 0.5, 0.1
        else:
            kp_p, kd_p, kp_q, kd_q = 30.0, 6.0, 1.2, 0.25
        qerr = np.zeros(4)
        rotvec = np.zeros(3)
        qc = d.qpos[3:7]
        mujoco.mju_mulQuat(qerr, self.home_quat, np.array([qc[0], -qc[1], -qc[2], -qc[3]]))
        mujoco.mju_quat2Vel(rotvec, qerr, 1.0)
        d.xfrc_applied[self.trunk, 0:3] = kp_p * (self.home_pos - d.qpos[:3]) - kd_p * d.qvel[0:3]
        d.xfrc_applied[self.trunk, 3:6] = kp_q * rotvec - kd_q * d.qvel[3:6]

    def reset(self):
        self.data.xfrc_applied[:] = 0
        if self.key >= 0:
            mujoco.mj_resetDataKeyframe(self.model, self.data, self.key)
        else:
            mujoco.mj_resetData(self.model, self.data)
            self.data.qpos[:] = self.home_qpos
            self.data.qvel[:] = 0
            mujoco.mj_forward(self.model, self.data)

    def place_on_floor(self):
        """Lift a floating base so the lowest geom sits on z = 0."""
        m, d = self.model, self.data
        if m.njnt < 1 or int(m.jnt_type[0]) != int(mujoco.mjtJoint.mjJNT_FREE):
            return
        lo, _hi = self.geom_aabb()
        if np.isfinite(lo[2]) and lo[2] < 0.0:
            d.qpos[2] -= lo[2]
            mujoco.mj_forward(m, d)

    def step_loop(self):
        if self.display:
            while self.running:
                time.sleep(0.05)
            return
        wall0 = time.perf_counter()
        sim0 = self.data.time
        while self.running:
            with self.lock:
                for _ in range(16):
                    self.apply_ctrl()
                    mujoco.mj_step(self.model, self.data)
                if self.data.qpos[2] < 0.075:
                    self.reset()
                    wall0 = time.perf_counter()
                    sim0 = self.data.time
            behind = (self.data.time - sim0) - (time.perf_counter() - wall0)
            time.sleep(min(behind, 0.05) if behind > 0 else 0.001)

    # ---------- rendering ----------
    def geom_aabb(self):
        """World AABB of non-floor geoms in the current pose."""
        m, d = self.model, self.data
        lo = np.full(3, np.inf)
        hi = np.full(3, -np.inf)
        signs = np.array([[sx, sy, sz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
        for g in range(m.ngeom):
            if m.geom_type[g] == mujoco.mjtGeom.mjGEOM_PLANE:
                continue
            if self.display and m.geom_group[g] >= 3:
                continue
            aabb = m.geom_aabb[g]
            corners = aabb[:3] + signs * aabb[3:]
            pts = d.geom_xpos[g] + corners @ d.geom_xmat[g].reshape(3, 3).T
            lo = np.minimum(lo, pts.min(axis=0))
            hi = np.maximum(hi, pts.max(axis=0))
        return lo, hi

    def measure_bounds(self):
        """World AABB of all robot geoms in the current pose, relative to the trunk."""
        lo, hi = self.geom_aabb()
        center = (lo + hi) / 2
        trunk = self.data.qpos[:3] if self.model.nq >= 3 else np.zeros(3)
        return {
            "center_z": float(center[2]),
            "height": float(hi[2] - lo[2]),
            "width": float(max(hi[0] - lo[0], hi[1] - lo[1])),
            "offset_xy": (center[:2] - trunk[:2]).tolist(),
            "lookat": center.tolist(),
        }

    def make_camera(self, aspect, cam_name="side"):
        spec = CAMS.get(cam_name, CAMS["side"])
        cam = mujoco.MjvCamera()
        cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        self.fit_camera(cam, aspect, spec)
        return cam

    def fit_camera(self, cam, aspect, spec=None):
        spec = spec or CAMS["side"]
        b = self.bounds
        cam.type = mujoco.mjtCamera.mjCAMERA_FREE
        if self.display:
            cam.lookat = list(b["lookat"])
        else:
            trunk = self.data.qpos[:3]
            cam.lookat = [trunk[0] + b["offset_xy"][0], trunk[1] + b["offset_xy"][1], b["center_z"]]
        half = math.tan(math.radians(self.model.vis.global_.fovy) / 2)
        dist_h = b["height"] * FIT_MARGIN / (2 * half)
        dist_w = b["width"] * FIT_MARGIN / (2 * half * max(aspect, 0.1))
        cam.distance = max(dist_h, dist_w) + b["width"] / 2
        cam.azimuth = spec["azimuth"]
        cam.elevation = spec["elevation"]

    def camera(self, cam_name, aspect):
        return self.make_camera(aspect, cam_name)

    def move_camera(self, cam, action, dx, dy):
        act = MOUSE.get(action)
        if act is None:
            return
        mujoco.mjv_moveCamera(self.model, int(act), float(dx), float(dy), cam)

    def renderer(self, w, h):
        r = self.renderers.get((w, h))
        if r is None:
            r = mujoco.Renderer(self.model, height=h, width=w)
            self.renderers[(w, h)] = r
            while len(self.renderers) > 6:
                _, old = self.renderers.popitem(last=False)
                try:
                    old.close()
                except Exception:
                    pass
        else:
            self.renderers.move_to_end((w, h))
        return r

    def set_color(self, color):
        rgb = PALETTES.get(color)
        for i in self.accent_ids:
            if rgb is None:
                self.model.mat_rgba[i] = self.accent_default[i]
            else:
                self.model.mat_rgba[i][:3] = rgb

    def render_loop(self):
        # GL contexts are thread-bound on macOS — renderers live on this thread.
        while self.running:
            now = time.perf_counter()
            for k in [k for k, ts in self.seen.items() if now - ts > 5.0]:
                self.seen.pop(k, None)
                self.frames.pop(k, None)
            with self.lock:
                stale = [vid for vid, vs in self.views.items() if now - vs.last > 8.0]
                for vid in stale:
                    self.views.pop(vid, None)
                view_items = list(self.views.items())
            for vid, vs in view_items:
                r = self.renderer(vs.w, vs.h)
                with self.lock:
                    self.set_color(vs.color)
                    if self.vopt is not None:
                        r.update_scene(self.data, vs.cam, self.vopt)
                    else:
                        r.update_scene(self.data, vs.cam)
                    rgb = r.render()
                buf = io.BytesIO()
                Image.fromarray(rgb).save(buf, format="JPEG", quality=80)
                vs.frame = buf.getvalue()
                self._fps_frames += 1
            for key in list(self.seen.keys()):
                cam_name, w, h, color = key
                r = self.renderer(w, h)
                with self.lock:
                    self.set_color(color)
                    cam = self.camera(cam_name, w / h)
                    if self.vopt is not None:
                        r.update_scene(self.data, cam, self.vopt)
                    else:
                        r.update_scene(self.data, cam)
                    rgb = r.render()
                buf = io.BytesIO()
                Image.fromarray(rgb).save(buf, format="JPEG", quality=80)
                self.frames[key] = buf.getvalue()
                self._fps_frames += 1
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
        self.seen[key] = time.perf_counter()
        jpg = self.frames.get(key)
        waited = 0.0
        while jpg is None and waited < 1.5:
            time.sleep(0.05)
            waited += 0.05
            jpg = self.frames.get(key)
        return jpg or b""

    def status(self):
        return {
            "ok": True,
            "variant": self.variant,
            "model": self.xml.name,
            "engine": "MuJoCo " + mujoco.__version__,
            "mode": "pose" if self.display else self.mode,
            "policy": None,
            "assist": "off" if self.display else ("reduced" if self.mode == "walk" else "on"),
            "actuated_joints": int(self.model.nu),
            "sim_time": round(float(self.data.time), 2),
            "fps": self.fps,
            "viewers": self.viewers,
        }


SIMS = {}
SIM_ERR = {}
SIMS_LOCK = threading.Lock()


def get_sim(variant):
    if variant == "yard":
        with SIMS_LOCK:
            if "yard" not in SIMS:
                try:
                    yard = Yard()
                    yard.start()
                    SIMS["yard"] = yard
                except Exception as e:
                    SIM_ERR["yard"] = str(e)
            return SIMS.get("yard"), SIM_ERR.get("yard")
    if variant not in VARIANTS:
        variant = "standard"
    with SIMS_LOCK:
        if variant not in SIMS and variant not in SIM_ERR:
            try:
                sim = Sim(variant)
                threading.Thread(target=sim.step_loop, daemon=True).start()
                threading.Thread(target=sim.render_loop, daemon=True).start()
                SIMS[variant] = sim
            except Exception as e:  # model missing / GL unavailable
                SIM_ERR[variant] = str(e)
    return SIMS.get(variant), SIM_ERR.get(variant)


def parse_color(q):
    color = (q.get("color") or ["orange"])[0]
    return color if color in PALETTES else "orange"


def parse_size(q):
    return clamp_size((q.get("w") or [DEFAULT_W])[0], (q.get("h") or [DEFAULT_H])[0])


def find_view(vid):
    if not vid:
        return None, None
    with SIMS_LOCK:
        sims = list(SIMS.values())
    for sim in sims:
        with sim.lock:
            vs = sim.views.get(vid)
        if vs:
            return sim, vs
    return None, None


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(FRONTEND), **kw)

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")

    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _frame_key(self, q):
        cam = (q.get("cam") or ["side"])[0]
        if cam not in CAMS:
            cam = "side"
        w, h = parse_size(q)
        return (cam, w, h, parse_color(q))

    def _render_key(self, q, variant):
        vid = (q.get("view") or [""])[0]
        if vid:
            sim, vs = find_view(vid)
            if sim and vs:
                w, h = parse_size(q)
                color = parse_color(q)
                with sim.lock:
                    vs.w, vs.h, vs.color = w, h, color
                    vs.last = time.perf_counter()
                return sim, ("view", vid)
        sim, err = get_sim(variant)
        if not sim:
            return None, err
        return sim, self._frame_key(q)

    def do_POST(self):
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        if n > 65536:
            self._json({"ok": False, "error": "Request is too large."}, 400)
            return
        raw = self.rfile.read(n) if n else b"{}"
        try:
            payload = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            self._json({"ok": False, "error": "Expected JSON."}, 400)
            return
        if u.path not in ("/api/yard/place", "/api/yard/reset"):
            self._json({"ok": False, "error": "Unknown request."}, 404)
            return
        sim, err = get_sim("yard")
        if not sim:
            self._json({"ok": False, "error": err or "Playyard unavailable."}, 503)
            return
        if u.path == "/api/yard/reset":
            self._json(sim.submit({"op": "reset"}))
            return
        try:
            nx, ny = float(payload.get("nx")), float(payload.get("ny"))
        except (TypeError, ValueError):
            self._json({"ok": False, "error": "Click the floor."}, 400)
            return
        self._json(sim.submit({
            "op": "place",
            "view": str(payload.get("view") or ""),
            "nx": nx, "ny": ny,
            "robot": str(payload.get("robot") or ""),
            "onnx": str(payload.get("onnx") or ""),
        }))

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        variant = (q.get("variant") or ["standard"])[0]
        if u.path == "/api/status":
            sim, err = get_sim(variant)
            if sim:
                self._json(sim.status())
            else:
                self._json({"ok": False, "variant": variant, "error": err}, 503)
        elif u.path == "/api/command":
            sim, err = get_sim(variant)
            cmd = (q.get("cmd") or [""])[0]
            if sim and cmd in ("stand", "walk", "reset"):
                with sim.lock:
                    if cmd == "reset":
                        sim.reset()
                    else:
                        sim.mode = cmd
                self._json(sim.status())
            else:
                self._json({"ok": False, "error": err or "unknown command"}, 400)
        elif u.path == "/api/view/open":
            sim, err = get_sim(variant)
            if not sim:
                self._json({"ok": False, "error": err}, 503)
                return
            w, h = parse_size(q)
            color = parse_color(q)
            vid = secrets.token_hex(8)
            with sim.lock:
                cam = sim.make_camera(w / h)
                sim.views[vid] = ViewState(cam, w, h, color)
            self._json({"ok": True, "id": vid, "variant": sim.variant})
        elif u.path == "/api/view/move":
            vid = (q.get("id") or [""])[0]
            sim, vs = find_view(vid)
            if not sim:
                self._json({"ok": False, "error": "unknown view"}, 404)
                return
            action = (q.get("action") or [""])[0]
            try:
                dx, dy = float((q.get("dx") or ["0"])[0]), float((q.get("dy") or ["0"])[0])
            except ValueError:
                self._json({"ok": False, "error": "bad delta"}, 400)
                return
            with sim.lock:
                vs.last = time.perf_counter()
                if action == "fit":
                    sim.fit_camera(vs.cam, vs.w / vs.h)
                elif action in MOUSE:
                    sim.move_camera(vs.cam, action, dx, dy)
                else:
                    self._json({"ok": False, "error": "unknown action"}, 400)
                    return
            self._json({"ok": True})
        elif u.path == "/api/view/update":
            vid = (q.get("id") or [""])[0]
            sim, vs = find_view(vid)
            if not sim:
                self._json({"ok": False, "error": "unknown view"}, 404)
                return
            w, h = parse_size(q)
            color = parse_color(q)
            with sim.lock:
                vs.w, vs.h, vs.color = w, h, color
                vs.last = time.perf_counter()
            self._json({"ok": True})
        elif u.path == "/api/view/close":
            vid = (q.get("id") or [""])[0]
            sim, vs = find_view(vid)
            if sim:
                with sim.lock:
                    sim.views.pop(vid, None)
            self._json({"ok": True})
        elif u.path == "/api/frame.jpg":
            sim, key = self._render_key(q, variant)
            if not sim:
                self.send_error(503, key or "viewer unavailable")
                return
            jpg = sim.frame(key)
            if not jpg:
                self.send_error(503, "frame not ready")
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(jpg)))
            self._cors()
            self.end_headers()
            self.wfile.write(jpg)
        elif u.path == "/api/stream.mjpeg":
            sim, key = self._render_key(q, variant)
            if not sim:
                self.send_error(503, key or "viewer unavailable")
                return
            sim.viewers += 1
            try:
                self.send_response(200)
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self._cors()
                self.end_headers()
                while True:
                    jpg = sim.frame(key)
                    if not jpg:
                        time.sleep(0.1)
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n")
                    self.wfile.write(("Content-Length: %d\r\n\r\n" % len(jpg)).encode())
                    self.wfile.write(jpg + b"\r\n")
                    self.wfile.flush()
                    time.sleep(1 / 24)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                sim.viewers -= 1
        else:
            super().do_GET()


if __name__ == "__main__":
    print("Loading MuJoCo model:", VARIANTS["standard"])
    sim, err = get_sim("standard")
    if sim is None:
        print("FATAL: could not start sim:", err)
        raise SystemExit(1)
    print("Sim ready — engine:", "MuJoCo", mujoco.__version__)
    print("Serving frontend + viewer API on http://localhost:%d" % PORT)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
