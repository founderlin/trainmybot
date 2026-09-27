/* Microduck — in-memory data layer for the front-end prototype.
 *
 * Source snapshots follow the R2 specs (plan/*.txt, 2026-09-26):
 *  - Official policies: pollen-robotics/microduck-policies @ 1b56c396825c052a4e26e95cf2b8d8298af9e9b4
 *  - Training tasks:    pollen-robotics/microduck_rl @ cb70b792312d559a4da09064d92009079671815f
 *  - Motor model:       Rhoban/bam @ 62bd8ce12154340be97e06f7f41a0ca8f116d967 bam/params/xl330/m6.json
 * Runs, loss series, evaluations, balances, rates and bills are SAMPLE DATA and
 * are labelled as such in the UI. Financial data is only read by pages-master.js.
 */
window.DB = (function () {
  "use strict";

  function mulberry(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ */
  /* Sources                                                             */
  /* ------------------------------------------------------------------ */
  var SOURCES = {
    policiesRepo: "pollen-robotics/microduck-policies",
    policiesRev: "1b56c396825c052a4e26e95cf2b8d8298af9e9b4",
    trainingRepo: "pollen-robotics/microduck_rl",
    trainingRev: "cb70b792312d559a4da09064d92009079671815f",
    bamRev: "62bd8ce12154340be97e06f7f41a0ca8f116d967"
  };
  var SHARED_MANIFEST = {
    schema_version: 2, model_api: 1, obs_len: 61, action_len: 14,
    robot: { model: "microduck", hw_rev: 1, servos: "xl330", control_hz: 50 }
  };

  var palettes = [
    { key: "orange", label: "Classic orange", hex: "#FF671F" },
    { key: "teal", label: "Teal", hex: "#148C8F" },
    { key: "blue", label: "Sky blue", hex: "#3878D1" },
    { key: "yellow", label: "Sunflower", hex: "#F2BD1F" },
    { key: "graphite", label: "Graphite", hex: "#4D4F54" }
  ];

  /* actuated joints, read from the MJCF actuator list (passive roller wheels excluded) */
  var joints = [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
    "neck_pitch", "head_pitch", "head_yaw", "head_roll",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle"
  ];
  function jointGroup(j) {
    if (j.indexOf("left_") === 0) return "Left leg";
    if (j.indexOf("right_") === 0) return "Right leg";
    return "Head";
  }

  /* Fixed GALLERY catalog. Users do not create robots or motors. */
  var platforms = {
    microduck: {
      id: "microduck", name: "Microduck",
      repo: "pollen-robotics/microduck_rl",
      summary: "Biped. Standard feet or roller skates — one robot, two foot models.",
      feet: ["standard", "roller"], viewer: true, catalog: true, preview: ""
    },
    beni: {
      id: "beni", name: "Beni",
      repo: "Mondo-Robotics/open-beni",
      summary: "Wheeled biped. Joints and motor limits follow beni_robot.py.",
      form: "Wheeled biped",
      feet: [], viewer: true, catalog: false, preview: "beni",
      joints: [
        { name: "L1", group: "Hip", selectable: true },
        { name: "R1", group: "Hip", selectable: true },
        { name: "L2", group: "Knee", selectable: true },
        { name: "R2", group: "Knee", selectable: true },
        { name: "LW", group: "Wheel", selectable: true },
        { name: "RW", group: "Wheel", selectable: true },
        { name: "head_yaw_joint", group: "Head", selectable: true },
        { name: "head_roll_joint", group: "Head", selectable: false, note: "Mechanical follow. Not a selected motor." }
      ]
    },
    sesame: {
      id: "sesame", name: "Sesame",
      repo: "dorianborian/sesame-robot",
      summary: "Mini quadruped. Eight MG90 servos, two per leg.",
      form: "Quadruped",
      feet: [], viewer: true, catalog: false, preview: "sesame",
      joints: [
        { name: "R1", group: "Hip", selectable: true },
        { name: "R2", group: "Hip", selectable: true },
        { name: "L1", group: "Hip", selectable: true },
        { name: "L2", group: "Hip", selectable: true },
        { name: "R3", group: "Knee", selectable: true },
        { name: "R4", group: "Knee", selectable: true },
        { name: "L3", group: "Knee", selectable: true },
        { name: "L4", group: "Knee", selectable: true }
      ]
    }
  };

  /* ------------------------------------------------------------------ */
  /* Motors                                                              */
  /* ------------------------------------------------------------------ */
  var M6_PARAMS = [
    { key: "kt", label: "Torque constant", value: 0.36601349688984386, unit: "N·m/A" },
    { key: "R", label: "Resistance", value: 2.8113923539223227, unit: "Ω" },
    { key: "armature", label: "Reflected inertia", value: 0.0018077432831600838, unit: "kg·m²" },
    { key: "q_offset", label: "Identification offset", value: 0.0271132870444849, unit: "rad", pending: true },
    { key: "friction_base", label: "Base friction", value: 0.004771183165566, unit: "N·m" },
    { key: "friction_stribeck", label: "Stribeck friction", value: 0.004676345799486616, unit: "N·m" },
    { key: "load_friction_motor", label: "Motor-side load friction", value: 0.2667860954283698, unit: "Model units" },
    { key: "load_friction_external", label: "External-side load friction", value: 8.515871897059342e-06, unit: "Model units" },
    { key: "load_friction_motor_stribeck", label: "Motor-side Stribeck load friction", value: 1.0722918395099123e-05, unit: "Model units" },
    { key: "load_friction_external_stribeck", label: "External-side Stribeck load friction", value: 0.08077928978935671, unit: "Model units" },
    { key: "load_friction_motor_quad", label: "Motor-side quadratic friction", value: 0.009972471242139415, unit: "Model units" },
    { key: "load_friction_external_quad", label: "External-side quadratic friction", value: 0.004902565732332559, unit: "Model units" },
    { key: "dtheta_stribeck", label: "Stribeck velocity", value: 2.890372094130307, unit: "rad/s" },
    { key: "alpha", label: "Stribeck exponent", value: 8.683259907618984, unit: "—" },
    { key: "friction_viscous", label: "Viscous friction", value: 0.005359668274599504, unit: "N·m·s/rad" }
  ];
  var PHYSICAL_FIELDS = [
    { key: "mass_g", label: "Mass", unit: "g" },
    { key: "dimensions_mm", label: "Dimensions", unit: "mm", text: true },
    { key: "gear_ratio", label: "Gear ratio", unit: "" },
    { key: "nominal_v", label: "Nominal voltage", unit: "V" },
    { key: "min_v", label: "Min rated voltage", unit: "V" },
    { key: "max_v", label: "Max rated voltage", unit: "V" },
    { key: "stall_torque", label: "Stall torque", unit: "N·m" },
    { key: "ref_v", label: "Reference voltage", unit: "V" },
    { key: "stall_current", label: "Stall current", unit: "A" },
    { key: "no_load_rpm", label: "No-load speed", unit: "rpm" },
    { key: "encoder", label: "Encoder resolution", unit: "pulse/rev" },
    { key: "temp", label: "Operating temperature", unit: "°C", text: true }
  ];

  var motors = [
    {
      id: "mot-xl330-m6", official: true, revision: 1,
      name: "DYNAMIXEL XL330 · BAM m6",
      family: "DYNAMIXEL XL330",
      manufacturer: "ROBOTIS", sku: null,
      interface: null, docUrl: "https://emanual.robotis.com/docs/en/dxl/x/xl330-m288/",
      license: "Rhoban/bam @ " + SOURCES.bamRev.slice(0, 7) + " · bam/params/xl330/m6.json",
      notes: "Exact SKU not confirmed — the xl330 identifier does not prove XL330-M288-T.",
      physical: {},
      params: M6_PARAMS.reduce(function (o, p) { o[p.key] = p.value; return o; }, {}),
      model: "m6", actuator: "xl330",
      platforms: ["microduck"],
      sim: { kp_fw: 200.0, vin_range: [6.5, 8.2], vin_drop_gain_range: [0.0, 0.2], vin_min: 6.0, delay_min_lag: 3, delay_max_lag: 6 },
      validation: "Compatible",
      copiedFrom: null
    },
    {
      id: "mot-beni-hip", official: true, revision: 1,
      name: "Beni hip motor", family: "Beni hip",
      manufacturer: null, sku: null, interface: null,
      docUrl: "https://github.com/Mondo-Robotics/open-beni",
      license: "Mondo-Robotics/open-beni · MIT · python/beni_rl/beni_robot.py",
      notes: "Training actuator for L1 and R1. Not a commercial SKU. Passive spring is not part of this motor.",
      platforms: ["beni"],
      physical: {},
      params: { stiffness: 0.5, damping: 0.02, effort_limit: 1.375, armature: 0.0001625, frictionloss: 0.02, delay_min_lag: 2, delay_max_lag: 5 },
      model: "beni-hip", actuator: "beni_pd",
      validation: "Compatible", copiedFrom: null
    },
    {
      id: "mot-beni-knee", official: true, revision: 1,
      name: "Beni knee motor", family: "Beni knee",
      manufacturer: null, sku: null, interface: null,
      docUrl: "https://github.com/Mondo-Robotics/open-beni",
      license: "Mondo-Robotics/open-beni · MIT · python/beni_rl/beni_robot.py",
      notes: "Training actuator for L2 and R2. simulation_effort_limit is 4.6 N·m. Knee spring scale is 1.0 and is separate from the motor torque limit.",
      platforms: ["beni"],
      physical: {},
      params: { stiffness: 0.5, damping: 0.02, effort_limit: 3.6, simulation_effort_limit: 4.6, spring_scale: 1.0, armature: 0.0005375, frictionloss: 0.02, delay_min_lag: 2, delay_max_lag: 5 },
      model: "beni-knee", actuator: "beni_pd",
      validation: "Compatible", copiedFrom: null
    },
    {
      id: "mot-beni-wheel", official: true, revision: 1,
      name: "Beni wheel motor", family: "Beni wheel",
      manufacturer: null, sku: null, interface: null,
      docUrl: "https://github.com/Mondo-Robotics/open-beni",
      license: "Mondo-Robotics/open-beni · MIT · python/beni_rl/beni_robot.py",
      notes: "Velocity-style motor for LW and RW. Stiffness is 0.",
      platforms: ["beni"],
      physical: {},
      params: { stiffness: 0.0, damping: 0.004, effort_limit: 0.6, armature: 0.0, frictionloss: 0.005, delay_min_lag: 2, delay_max_lag: 5 },
      model: "beni-wheel", actuator: "beni_pd",
      validation: "Compatible", copiedFrom: null
    },
    {
      id: "mot-beni-head-yaw", official: true, revision: 1,
      name: "Beni head yaw", family: "Beni head",
      manufacturer: null, sku: null, interface: null,
      docUrl: "https://github.com/Mondo-Robotics/open-beni",
      license: "Mondo-Robotics/open-beni · MIT · python/beni_rl/beni_robot.py",
      notes: "Ideal PD actuator for head_yaw_joint. head_roll_joint follows mechanically and is not this motor.",
      platforms: ["beni"],
      physical: {},
      params: { stiffness: 3.0, damping: 0.05, effort_limit: 0.1, armature: 0.0, frictionloss: 0.0, delay_min_lag: 2, delay_max_lag: 5 },
      model: "beni-head-yaw", actuator: "ideal_pd",
      validation: "Compatible", copiedFrom: null
    },
    {
      id: "mot-mg90", official: true, revision: 1,
      name: "MG90", family: "MG90",
      manufacturer: null, sku: "MG90", interface: "PWM 50 Hz",
      docUrl: "https://github.com/dorianborian/sesame-robot",
      license: "dorianborian/sesame-robot · firmware/README.md",
      notes: "Eight 180° hobby servos. Pulse width 732–2929 µs is the firmware mapping. Stall torque is not stated in the repository.",
      platforms: ["sesame"],
      physical: {},
      params: { travel_deg: 180, pulse_min_us: 732, pulse_max_us: 2929, pwm_hz: 50, count: 8 },
      model: "mg90", actuator: "hobby_servo",
      validation: "Compatible", copiedFrom: null
    }
  ];

  /* ------------------------------------------------------------------ */
  /* Official actions (10 ONNX, manifest @ policies rev)                 */
  /* ------------------------------------------------------------------ */
  var actions = [
    { id: "alpha_walking", file: "alpha_walking.onnx", name: "Walking (legacy)", category: "Locomotion", feet: "any",
      manifest: { kind: "perpetual" },
      task: "Mjlab-Velocity-Flat-MicroDuck", taskFile: "microduck_velocity_env_cfg.py",
      note: "Training reference only — not the confirmed origin of this ONNX." },
    { id: "velstand", file: "velstand.onnx", name: "Walking & standing", category: "Locomotion", feet: "any",
      manifest: { kind: "perpetual", slot: "walk", entry_pose: "standing" },
      task: "Mjlab-VelStand-Flat-MicroDuck", taskFile: "microduck_velstand_env_cfg.py",
      note: "Exported from branch protective_fall (source velstand_best.onnx, 2026-09-14). No training commit or hyperparameters published." },
    { id: "alpha_stand", file: "alpha_stand.onnx", name: "Standing (legacy)", category: "Posture", feet: "any",
      manifest: { kind: "perpetual" },
      task: null, taskFile: null, related: "Mjlab-StandUp-Flat-MicroDuck",
      note: "Official recipe not provided. Choose a related task preset." },
    { id: "roller", file: "roller.onnx", name: "Roller skating", category: "Skating", feet: "roller",
      manifest: { kind: "perpetual", mode: "roller", action_scale: 0.8 },
      task: "Mjlab-Velocity-Flat-MicroDuck-Rollers", taskFile: "microduck_velocity_rollers_env_cfg.py",
      note: "Training joint_pos_action.scale=1.0 and manifest action_scale=0.8 are different layers." },
    { id: "sitstand", file: "alpha_sitstand.onnx", name: "Sit / stand", category: "Posture", feet: "any",
      manifest: { name: "sitstand", kind: "scripted", command: { encoding: "posture_flag", slot: "twist.vx", sit: 1.0, stand: 0.0, idle: [0, 0, 0] }, ramp_s: 2.0, unwind_s: 1.0 },
      task: "Mjlab-SitStand-Flat-MicroDuck", taskFile: "microduck_sitstand_env_cfg.py" },
    { id: "ground_pick", file: "alpha_ground_pick.onnx", name: "Ground pick", category: "Manipulation", feet: "any",
      manifest: { name: "ground_pick", kind: "episodic", duration_s: 2.8, command: { encoding: "phase", slots: "twist.vx,twist.vy", period_s: 4.0, end_phase: 0.7 } },
      task: "Mjlab-GroundPick-Flat-MicroDuck", taskFile: "microduck_ground_pick_env_cfg.py",
      note: "Recipe/export timing differs: training RISE_END=0.80, exported end_phase=0.7." },
    { id: "crouch", file: "roller_crouch.onnx", name: "Roller crouch", category: "Skating", feet: "roller",
      manifest: { name: "crouch", kind: "episodic", mode: "roller", action_scale: 0.8, duration_s: 3.5, command: { encoding: "phase", slots: "twist.vx,twist.vy", period_s: 5.0, end_phase: 0.7 } },
      task: "Mjlab-RollerCrouch-Flat-MicroDuck", taskFile: "microduck_roller_crouch_env_cfg.py" },
    { id: "roulade", file: "roulade.onnx", name: "Forward roll", category: "Tricks", feet: "any",
      manifest: { kind: "episodic", duration_s: 1.0, chain: true },
      task: "Mjlab-Roulade-Flat-MicroDuck", taskFile: "microduck_roulade_env_cfg.py",
      note: "Training episode_length=5.0 s and execution duration=1.0 s are different fields." },
    { id: "kick_left", file: "ball_kick_left.onnx", name: "Left kick", category: "Tricks", feet: "any",
      manifest: { name: "kick_left", kind: "episodic", duration_s: 0.5 },
      task: "Mjlab-BallKick-Flat-MicroDuck", taskFile: "BallKick factory · kick_foot=\"left\"", adapterPending: true,
      note: "Training adapter pending — kick_foot cannot be passed yet. The right-foot task is never used in its place." },
    { id: "kick_right", file: "ball_kick_right.onnx", name: "Right kick", category: "Tricks", feet: "any",
      manifest: { name: "kick_right", kind: "episodic", duration_s: 0.5 },
      task: "Mjlab-BallKick-Flat-MicroDuck", taskFile: "BallKick factory · kick_foot=\"right\" (default)" }
  ];

  /* ------------------------------------------------------------------ */
  /* Parameter schema                                                    */
  /* ------------------------------------------------------------------ */
  function P(key, label, type, unit, def, src, o) {
    o = o || {};
    return {
      key: key, label: label, type: type, unit: unit || "", def: def, src: src,
      min: o.min, max: o.max, step: o.step, gt0: !!o.gt0, help: o.help || "", warn: o.warn || "",
      options: o.options || null, readonly: !!o.readonly, computed: o.computed || null,
      required: !!o.required, retrain: o.retrain !== false
    };
  }
  var OM = "Official manifest", TP = "Current task preset", PD = "Platform default", NP = "Not provided", SP = "Platform starter preset";

  var EXEC = {
    alpha_walking: {
      note: "The official manifest has no duration, action_scale or command ranges — those are not invented as manifest defaults. Command ranges below come from the current Velocity task preset.",
      exec: [],
      targets: [
        P("cmd.vx", "Forward command range", "range", "m/s", [-0.4, 0.4], TP, { help: "Current task preset (Mjlab-Velocity-Flat-MicroDuck). Not part of the official manifest." }),
        P("cmd.vy", "Lateral command range", "range", "m/s", [-0.3, 0.3], TP),
        P("cmd.yaw", "Yaw command range", "range", "rad/s", [-1.0, 1.0], TP)
      ]
    },
    velstand: {
      note: "Manifest: kind=perpetual, slot=walk, entry_pose=standing. A zero command stands.",
      exec: [],
      targets: [
        P("cmd.vx", "Forward command range", "range", "m/s", null, NP, { help: "Adapter-supported range. Not part of the official manifest." }),
        P("cmd.vy", "Lateral command range", "range", "m/s", null, NP),
        P("cmd.yaw", "Yaw command range", "range", "rad/s", null, NP)
      ]
    },
    alpha_stand: {
      note: "The manifest has no numeric action parameters.",
      exec: [],
      targets: [
        P("related_preset", "Related task preset", "enum", "", null, NP, {
          options: ["Mjlab-StandUp-Flat-MicroDuck (changes the objective)"],
          help: "The historical Standing ONNX is not the same as the current StandUp task."
        })
      ]
    },
    roller: {
      exec: [P("action_scale", "Action scale", "number", "", 0.8, OM, { min: 0.05, max: 2, step: 0.05, retrain: false, help: "Changing it requires re-evaluating compatibility and stability." })],
      targets: [
        P("train_action_scale", "Training joint_pos_action.scale", "number", "", 1.0, TP, { gt0: true, help: "Training layer — not the manifest action_scale." }),
        P("cmd.push", "Push command range", "range", "Model units", null, NP, { help: "Roller command slots may mean push, brake or heading error — not plain velocity." })
      ]
    },
    sitstand: {
      exec: [
        P("command.sit", "Sit command value", "number", "flag", 1.0, OM, { retrain: false, help: "posture_flag on twist.vx — a flag, not a velocity. Must match the policy/runtime contract." }),
        P("command.stand", "Stand command value", "number", "flag", 0.0, OM, { retrain: false }),
        P("command.idle", "Idle command X / Y / Z", "vec3", "", [0, 0, 0], OM, { retrain: false }),
        P("ramp_s", "Ramp time", "number", "s", 2.0, OM, { min: 0, step: 0.1, retrain: false }),
        P("unwind_s", "Unwind time", "number", "s", 1.0, OM, { min: 0, step: 0.1, retrain: false })
      ],
      targets: []
    },
    ground_pick: {
      exec: [
        P("period_s", "Command period", "number", "s", 4.0, OM, { gt0: true, step: 0.1, retrain: false }),
        P("end_phase", "End phase", "number", "", 0.7, OM, { gt0: true, max: 1, step: 0.05, retrain: false }),
        P("duration_s", "Duration (period × end phase)", "number", "s", 2.8, OM, { computed: ["period_s", "end_phase"], readonly: true })
      ],
      targets: [
        P("rise_end", "Rise end (training phase)", "number", "", 0.8, TP, { gt0: true, max: 1, warn: "Recipe/export timing differs: training 0.80 vs exported end_phase 0.7." }),
        P("mouth_target_height", "Target mouth height", "number", "m", null, NP)
      ]
    },
    crouch: {
      exec: [
        P("action_scale", "Action scale", "number", "", 0.8, OM, { min: 0.05, max: 2, step: 0.05, retrain: false }),
        P("period_s", "Command period", "number", "s", 5.0, OM, { gt0: true, step: 0.1, retrain: false }),
        P("end_phase", "End phase", "number", "", 0.7, OM, { gt0: true, max: 1, step: 0.05, retrain: false }),
        P("duration_s", "Duration (period × end phase)", "number", "s", 3.5, OM, { computed: ["period_s", "end_phase"], readonly: true })
      ],
      targets: []
    },
    roulade: {
      exec: [
        P("duration_s", "Duration", "number", "s", 1.0, OM, { gt0: true, step: 0.1, retrain: false, help: "Shorter values are not guaranteed to land safely without retraining." }),
        P("chain", "Repeat while held", "bool", "", true, OM, { retrain: false })
      ],
      targets: [
        P("target_angle", "Target roll angle", "number", "rad", null, NP),
        P("episode_length_s", "Training episode length", "number", "s", 5.0, TP, { gt0: true, help: "Training field — independent from the execution duration." })
      ]
    },
    kick_left: {
      exec: [P("duration_s", "Duration", "number", "s", 0.5, OM, { gt0: true, step: 0.05, retrain: false })],
      targets: [
        P("kick_foot", "Kicking foot", "enum", "", "Left", OM, { options: ["Left"], readonly: true }),
        P("ball_target_speed", "Ball target speed", "number", "m/s", null, NP)
      ]
    },
    kick_right: {
      exec: [P("duration_s", "Duration", "number", "s", 0.5, OM, { gt0: true, step: 0.05, retrain: false })],
      targets: [
        P("kick_foot", "Kicking foot", "enum", "", "Right", OM, { options: ["Right"], readonly: true }),
        P("ball_target_speed", "Ball target speed", "number", "m/s", null, NP)
      ]
    }
  };

  function R(term, weight, params, src) {
    return { term: term, weight: weight, src: src || SP, params: params || [] };
  }
  function RP(key, label, unit, def) { return { key: key, label: label, unit: unit, def: def }; }
  var REWARDS = {
    alpha_walking: [
      R("track_linear_velocity", 2.0, [], TP),
      R("track_angular_velocity", 2.0, [], TP),
      R("action_rate_l2", -0.1, [], TP)
    ],
    velstand: [
      R("track_linear_velocity", 2.0, [RP("std", "Tracking std", "m/s", 0.25)]),
      R("track_angular_velocity", 2.0, [RP("std", "Tracking std", "rad/s", 0.25)]),
      R("stand_still", 0.5, [RP("command_threshold", "Zero-command threshold", "m/s", 0.05)]),
      R("flat_orientation_l2", -1.0),
      R("action_rate_l2", -0.1)
    ],
    alpha_stand: [
      R("posture_pose", 1.0), R("posture_height", 1.0, [RP("target_height", "Target trunk height", "m", 0.12)]),
      R("stillness", 0.5), R("action_rate_l2", -0.05)
    ],
    roller: [
      R("track_linear_velocity", 1.5, [RP("std", "Tracking std", "m/s", 0.3)]),
      R("track_angular_velocity", 1.0),
      R("lean_forward", 0.3), R("action_rate_l2", -0.1)
    ],
    sitstand: [
      R("posture_pose", 1.5), R("posture_height", 1.0, [RP("sit_height", "Sit trunk height", "m", 0.07)]),
      R("head_pose_tracking", 0.5), R("descent_rise", 1.0), R("stillness", 0.3), R("action_rate_l2", -0.05)
    ],
    ground_pick: [
      R("mouth_height", 2.0), R("upright", 1.0), R("feet_contact", 0.5), R("phase_tracking", 1.0), R("action_rate_l2", -0.05)
    ],
    crouch: [
      R("phase_tracking", 1.0), R("posture_target", 1.0), R("forward_velocity", 0.5, [RP("target", "Target speed", "m/s", 0.2)]),
      R("lean_penalty", -0.5), R("action_smoothness", -0.05)
    ],
    roulade: [
      R("target_angle", 2.0), R("landing", 1.0), R("standup_gate", 1.0), R("action_rate_l2", -0.05), R("self_collision", -1.0)
    ],
    kick_left: [
      R("ball_velocity", 2.0, [RP("target_speed", "Target ball speed", "m/s", 1.0)]), R("support_foot_stability", 1.0),
      R("ball_direction", 0.0), R("action_rate_l2", -0.05), R("fall", -5.0)
    ],
    kick_right: [
      R("ball_velocity", 2.0, [RP("target_speed", "Target ball speed", "m/s", 1.0)]), R("support_foot_stability", 1.0),
      R("ball_direction", 0.0), R("action_rate_l2", -0.05), R("fall", -5.0)
    ]
  };
  var CURRICULUM = {
    alpha_walking: [{ term: "action_rate_l2", final: -1.0, rule: "Weight ramps from the initial value to the final value during training.", src: TP }],
    velstand: [{ term: "action_rate_l2", final: -1.0, rule: "Weight ramps from the initial value to the final value during training.", src: SP }],
    roulade: [{ term: "initial_state_mix", final: null, rule: "Initial-state mixing curriculum (stages defined by the task cfg).", src: TP }]
  };
  var TRAIN_ITERS = { alpha_walking: 50000, velstand: 40000, alpha_stand: 20000, roller: 40000, sitstand: 20000, ground_pick: 30000, crouch: 30000, roulade: 25000, kick_left: 20000, kick_right: 20000 };

  function schemaFor(actionId, source) {
    var scratch = source === "scratch";
    var e = EXEC[actionId];
    var walk = actionId === "alpha_walking" && !scratch;
    var srcOr = function (s) { return scratch ? (s === NP ? NP : SP) : s; };
    var fix = function (list) { return list.map(function (p) { var c = clone(p); c.src = srcOr(p.src); return c; }); };
    var groups = [
      { id: "exec", name: "Policy execution", note: scratch ? "From scratch — no official ONNX is referenced. Execution values start from the Platform starter preset." : (e.note || ""), params: fix(e.exec) },
      { id: "targets", name: "Task targets", params: fix(e.targets) },
      { id: "training", name: "Training", params: [
        P("target_iterations", "Target iterations", "int", "", TRAIN_ITERS[actionId], walk ? TP : (scratch ? SP : PD), { min: 1, required: true, help: "Absolute iteration count for this configuration." }),
        P("seed", "Seed", "int", "", 42, scratch ? SP : PD, { min: 0, required: true }),
        P("num_envs", "Parallel environments", "int", "", 2048, scratch ? SP : PD, { min: 1, required: true, help: "Belongs to the configuration. ARENA never lowers it silently." }),
        P("num_steps_per_env", "Rollout steps per environment", "int", "", 24, walk ? TP : (scratch ? SP : PD), { min: 1, required: true }),
        P("learning_rate", "PPO learning rate", "number", "", 1e-3, walk ? TP : (scratch ? SP : PD), { gt0: true, required: true }),
        P("num_learning_epochs", "PPO epochs", "int", "", 5, scratch ? SP : PD, { min: 1, required: true }),
        P("num_mini_batches", "PPO mini-batches", "int", "", 4, scratch ? SP : PD, { min: 1, required: true }),
        P("checkpoint_interval", "Checkpoint interval", "int", "iterations", 500, scratch ? SP : PD, { min: 1, required: true })
      ] },
      { id: "randomization", name: "Randomization", params: [
        P("rand.friction", "Ground friction range", "range", "", [0.6, 1.2], scratch ? SP : PD),
        P("rand.com", "CoM offset range", "range", "m", [-0.005, 0.005], scratch ? SP : PD),
        P("rand.vin", "Battery voltage range", "range", "V", [6.5, 8.2], TP, { warn: "Simulation parameters are not hardware voltage recommendations." }),
        P("rand.vin_drop", "Voltage drop gain range", "range", "V/N·m", [0.0, 0.2], TP),
        P("rand.delay", "Actuator delay range", "range", "sim steps", [3, 6], TP, { help: "Backend simulation steps, not milliseconds." }),
        P("rand.imu_noise", "IMU noise std", "number", "rad/s", 0.01, scratch ? SP : PD, { min: 0 })
      ] },
      { id: "evaluation", name: "Evaluation", params: [
        P("eval.protocol", "Protocol / evaluator version", "enum", "", "platform-eval v0", PD, { options: ["platform-eval v0"] }),
        P("eval.scene", "Scene revision", "text", "", "flat · r1", PD),
        P("eval.seeds", "Seeds", "text", "", "1, 2, 3, 4, 5", PD, { help: "Comma-separated integers." }),
        P("eval.episodes", "Episodes per seed", "int", "", 20, PD, { min: 1 })
      ] }
    ];
    var rewards = clone(REWARDS[actionId]).map(function (r) { if (scratch) r.src = SP; return r; });
    var curriculum = clone(CURRICULUM[actionId] || []);
    return { groups: groups, rewards: rewards, curriculum: curriculum };
  }

  function defaultsFor(schema) {
    var v = {};
    schema.groups.forEach(function (g) { g.params.forEach(function (p) { v[p.key] = clone(p.def); }); });
    schema.rewards.forEach(function (r) {
      v["rw:" + r.term] = r.weight;
      r.params.forEach(function (rp) { v["rw:" + r.term + ":" + rp.key] = rp.def; });
    });
    schema.curriculum.forEach(function (c) { v["cur:" + c.term] = c.final; });
    return v;
  }

  function isNum(x) { return typeof x === "number" && isFinite(x); }

  function validate(cfg, values, bot) {
    var action = actionById(cfg.actionId);
    var schema = schemaFor(cfg.actionId, cfg.source);
    var issues = [];
    var status = "Ready to run";
    function rank(s) { return ["Ready to run", "Needs validation", "Draft", "Missing recipe", "Incompatible"].indexOf(s); }
    function bump(s) { if (rank(s) > rank(status)) status = s; }

    schema.groups.forEach(function (g) {
      g.params.forEach(function (p) {
        var v = values[p.key];
        if (v == null || v === "") { if (p.required) { issues.push({ key: p.key, msg: p.label + " is required." }); bump("Draft"); } return; }
        if (p.type === "number" || p.type === "int") {
          if (!isNum(v)) { issues.push({ key: p.key, msg: p.label + " must be a finite number." }); bump("Draft"); return; }
          if (p.type === "int" && Math.floor(v) !== v) { issues.push({ key: p.key, msg: p.label + " must be an integer." }); bump("Draft"); }
          if (p.gt0 && !(v > 0)) { issues.push({ key: p.key, msg: p.label + " must be greater than 0." }); bump("Draft"); }
          if (p.min != null && v < p.min) { issues.push({ key: p.key, msg: p.label + " must be ≥ " + p.min + "." }); bump("Draft"); }
          if (p.max != null && v > p.max) { issues.push({ key: p.key, msg: p.label + " must be ≤ " + p.max + "." }); bump("Draft"); }
        } else if (p.type === "range") {
          if (!Array.isArray(v) || !isNum(v[0]) || !isNum(v[1])) { issues.push({ key: p.key, msg: p.label + " needs both Min and Max." }); bump("Draft"); }
          else if (v[0] > v[1]) { issues.push({ key: p.key, msg: p.label + ": Min must be ≤ Max." }); bump("Draft"); }
        } else if (p.type === "vec3") {
          if (!Array.isArray(v) || v.length !== 3 || !v.every(isNum)) { issues.push({ key: p.key, msg: p.label + " needs three finite values." }); bump("Draft"); }
        }
      });
    });
    if (values["eval.seeds"] != null && !/^\s*-?\d+(\s*,\s*-?\d+)*\s*$/.test(String(values["eval.seeds"]))) {
      issues.push({ key: "eval.seeds", msg: "Seeds must be comma-separated integers." }); bump("Draft");
    }
    Object.keys(values).forEach(function (k) {
      if (k.indexOf("rw:") === 0 && values[k] != null && !isNum(values[k])) { issues.push({ key: k, msg: k.slice(3) + " must be a finite number." }); bump("Draft"); }
    });
    if (bot && action.feet === "roller" && bot.feet !== "roller") { issues.push({ key: null, msg: "Requires roller skates." }); bump("Incompatible"); }
    if (cfg.source === "official" && !action.task && !values.related_preset) {
      issues.push({ key: "related_preset", msg: "Official recipe not provided. Choose a related task preset." }); bump("Missing recipe");
    }
    if (action.adapterPending) { issues.push({ key: null, msg: "Training adapter pending (kick_foot=left cannot be passed yet)." }); bump("Needs validation"); }
    if (bot) {
      var custom = botMotorIds(bot).map(motorById).filter(function (m) { return m && !m.official; });
      if (custom.length) { issues.push({ key: null, msg: "Custom motor needs a validated actuator adapter before training." }); bump("Needs validation"); }
    }
    return { status: status, issues: issues };
  }

  /* ------------------------------------------------------------------ */
  /* Bots & configurations (sample workspace)                            */
  /* ------------------------------------------------------------------ */
  var bots = [
    { id: "bot-microduck", platform: "microduck", name: "Microduck",
      description: "Biped. Standard feet or roller skates.",
      color: "orange", feet: "standard", motors: { all: "mot-xl330-m6", byJoint: {} },
      appearanceRev: 2, hardwareRev: 1, updated: "2026-09-25 18:20", archived: false, lastConfig: "cfg-101" },
    { id: "bot-beni", platform: "beni", name: "Beni",
      description: "Wheeled biped from Mondo-Robotics/open-beni.",
      color: "blue", feet: "wheel",
      motors: { all: "mot-beni-hip", byJoint: { L1: "mot-beni-hip", R1: "mot-beni-hip", L2: "mot-beni-knee", R2: "mot-beni-knee", LW: "mot-beni-wheel", RW: "mot-beni-wheel", head_yaw_joint: "mot-beni-head-yaw" } },
      appearanceRev: 1, hardwareRev: 1, updated: "2026-09-26 12:00", archived: false, lastConfig: null },
    { id: "bot-sesame", platform: "sesame", name: "Sesame",
      description: "Mini quadruped. Eight MG90 servos.",
      color: "yellow", feet: "quad", motors: { all: "mot-mg90", byJoint: {} },
      appearanceRev: 1, hardwareRev: 1, updated: "2026-09-26 12:00", archived: false, lastConfig: null }
  ];

  function makeConfig(id, botId, actionId, name, savedAt, overrides, extraVersions) {
    var schema = schemaFor(actionId, "official");
    var vals = defaultsFor(schema);
    Object.keys(overrides || {}).forEach(function (k) { vals[k] = overrides[k]; });
    var versions = [{ v: 1, savedAt: savedAt, values: vals, note: "Created from official template" }];
    (extraVersions || []).forEach(function (ev, i) {
      var v2 = clone(vals); Object.keys(ev.overrides).forEach(function (k) { v2[k] = ev.overrides[k]; });
      versions.push({ v: i + 2, savedAt: ev.savedAt, values: v2, note: ev.note });
    });
    return {
      id: id, botId: botId, actionId: actionId, name: name, source: "official",
      templateRev: SOURCES.policiesRev, baseline: defaultsFor(schema),
      versions: versions, draft: null, archived: false
    };
  }

  var configs = [
    makeConfig("cfg-101", "bot-microduck", "velstand", "Walking & standing — baseline", "2026-09-20 14:10",
      { target_iterations: 50000 },
      [{ savedAt: "2026-09-25 18:20", note: "Stronger stand-still reward", overrides: { target_iterations: 50000, "rw:stand_still": 0.8 } }]),
    makeConfig("cfg-102", "bot-microduck", "sitstand", "Sit / stand", "2026-09-24 09:30", { seed: 7 }),
    makeConfig("cfg-103", "bot-microduck", "ground_pick", "Ground pick", "2026-09-23 15:55", { seed: 3 }),
    makeConfig("cfg-104", "bot-microduck", "kick_left", "Left kick", "2026-09-25 11:12", {}),
    makeConfig("cfg-201", "bot-microduck", "roller", "Roller skating", "2026-09-21 16:40", {})
  ];

  /* ------------------------------------------------------------------ */
  /* Compute (technical view only — no rates here)                       */
  /* ------------------------------------------------------------------ */
  var gpus = [
    { id: "rtx4070", name: "GeForce RTX 4070", vram: 12, arch: "Ada Lovelace · CC 8.9",
      availability: "Available", verified: true, maxEnvs: 2048,
      profile: "mr-2026.09 · Python 3.12 · mjlab 1.3.0 · warp-lang 1.12.0 · torch 2.9.1" },
    { id: "rtx5060", name: "GeForce RTX 5060", vram: 8, arch: "Blackwell · CC 12.0",
      availability: "Available", verified: false, maxEnvs: null,
      profile: "No verified image for this card yet" }
  ];

  /* ------------------------------------------------------------------ */
  /* Runs (sample)                                                       */
  /* ------------------------------------------------------------------ */
  function lossSeries(seed, n, step, opts) {
    var r = mulberry(seed), pol = [], val = [];
    for (var i = 1; i <= n; i++) {
      var p = i / n;
      pol.push({ x: i * step, y: +(opts.pBase + (r() - 0.5) * opts.pNoise * (1 - 0.4 * p)).toFixed(5) });
      val.push({ x: i * step, y: +(opts.vEnd + (opts.vStart - opts.vEnd) * Math.exp(-3 * p) + (r() - 0.5) * opts.vNoise * (1 - 0.5 * p)).toFixed(5) });
    }
    return { policy: pol, value: val };
  }
  function ckpts(interval, upto, savedAtFn) {
    var list = [];
    for (var it = interval * 10; it <= upto; it += interval * 10) list.push({ iter: it, savedAt: savedAtFn(it), status: "Saved", size: "4.2 MB", reason: "Scheduled" });
    return list;
  }

  var runs = [
    {
      id: "run-0142", name: "Walking baseline", botId: "bot-microduck", configId: "cfg-101", configVersion: 1,
      gpu: "rtx4070", maxRuntimeH: 16, resume: null,
      outputs: { evalAfter: true, record: false, exportOnnx: true, keepCkpt: true },
      status: "Completed", stopReason: "Target reached", iters: 50000, target: 50000, elapsedSec: 42120,
      created: "2026-09-21 09:10", updated: "2026-09-21 21:02",
      loss: lossSeries(7, 500, 100, { pBase: -0.004, pNoise: 0.02, vStart: 0.9, vEnd: 0.06, vNoise: 0.08 }),
      events: [], checkpoints: [], postproc: "Ready", resultId: "res-001", authRef: "auth-0142",
      logs: [
        { t: "2026-09-21 09:14:02", level: "INFO", msg: "Execution request accepted · runtime profile mr-2026.09" },
        { t: "2026-09-21 09:15:40", level: "INFO", msg: "Task Mjlab-VelStand-Flat-MicroDuck loaded · seed 42 · 2048 environments" },
        { t: "2026-09-21 20:56:11", level: "INFO", msg: "Target iterations reached (50,000)" },
        { t: "2026-09-21 20:58:30", level: "INFO", msg: "Evaluation finished · platform-eval v0 · 5 seeds × 20 episodes" },
        { t: "2026-09-21 21:02:05", level: "INFO", msg: "ONNX exported (official path, normalizer included) · IO contract [1,61] → [1,14] checked" }
      ]
    },
    {
      id: "run-0147", name: "Sit / stand — seed 7", botId: "bot-microduck", configId: "cfg-102", configVersion: 1,
      gpu: "rtx4070", maxRuntimeH: 10, resume: null,
      outputs: { evalAfter: true, record: false, exportOnnx: true, keepCkpt: true },
      status: "Running", stopReason: null, iters: 8600, target: 20000, elapsedSec: 6360,
      created: "2026-09-26 10:58", updated: "2026-09-26 12:40",
      loss: lossSeries(21, 86, 100, { pBase: -0.006, pNoise: 0.025, vStart: 1.2, vEnd: 0.35, vNoise: 0.12 }),
      events: [], checkpoints: [], postproc: "Not started", resultId: null, authRef: "auth-0147",
      logs: [
        { t: "2026-09-26 11:02:04", level: "INFO", msg: "Execution request accepted · runtime profile mr-2026.09" },
        { t: "2026-09-26 11:02:31", level: "INFO", msg: "Task Mjlab-SitStand-Flat-MicroDuck loaded · seed 7 · 2048 environments" },
        { t: "2026-09-26 11:03:10", level: "INFO", msg: "Short numeric probe passed · training started" }
      ]
    },
    {
      id: "run-0145", name: "Ground pick — first attempt", botId: "bot-microduck", configId: "cfg-103", configVersion: 1,
      gpu: "rtx4070", maxRuntimeH: 12, resume: null,
      outputs: { evalAfter: true, record: false, exportOnnx: true, keepCkpt: true },
      status: "Failed", stopReason: "Numerical instability", iters: 12340, target: 30000, elapsedSec: 14880,
      created: "2026-09-23 16:35", updated: "2026-09-23 20:45",
      loss: lossSeries(31, 123, 100, { pBase: -0.003, pNoise: 0.03, vStart: 1.4, vEnd: 0.5, vNoise: 0.2 }),
      events: [{ iter: 12340, kind: "Numerical instability", msg: "Non-finite value loss at iteration 12,340." }],
      checkpoints: [], postproc: "Not started", resultId: null, authRef: "auth-0145",
      logs: [
        { t: "2026-09-23 16:40:02", level: "INFO", msg: "Execution request accepted · runtime profile mr-2026.09" },
        { t: "2026-09-23 16:41:15", level: "INFO", msg: "Task Mjlab-GroundPick-Flat-MicroDuck loaded · seed 3 · 2048 environments" },
        { t: "2026-09-23 20:44:51", level: "ERROR", msg: "Non-finite value (NaN) in value loss at iteration 12,340" },
        { t: "2026-09-23 20:44:52", level: "WARN", msg: "Safety policy: training stopped · last saved checkpoint at iteration 10,000" }
      ]
    },
    {
      id: "run-0139", name: "Rink cruise", botId: "bot-microduck", configId: "cfg-201", configVersion: 1,
      gpu: "rtx4070", maxRuntimeH: 12, resume: null,
      outputs: { evalAfter: false, record: false, exportOnnx: true, keepCkpt: false },
      status: "Stopped", stopReason: "Stopped by user", iters: 12000, target: 40000, elapsedSec: 11520,
      created: "2026-09-22 08:30", updated: "2026-09-22 12:05",
      loss: { policy: [], value: lossSeries(41, 120, 100, { pBase: 0, pNoise: 0, vStart: 1.0, vEnd: 0.3, vNoise: 0.1 }).value },
      events: [], checkpoints: [], postproc: "Ready", resultId: "res-002", authRef: "auth-0139",
      logs: [
        { t: "2026-09-22 08:34:10", level: "INFO", msg: "Execution request accepted · runtime profile mr-2026.09" },
        { t: "2026-09-22 08:35:02", level: "INFO", msg: "Task Mjlab-Velocity-Flat-MicroDuck-Rollers loaded · seed 42 · 2048 environments" },
        { t: "2026-09-22 08:35:03", level: "WARN", msg: "Runner does not report policy loss for this adapter — only value loss is available" },
        { t: "2026-09-22 11:47:40", level: "INFO", msg: "Stop requested by user" },
        { t: "2026-09-22 11:48:12", level: "INFO", msg: "Final checkpoint saved at iteration 12,000 · run stopped" },
        { t: "2026-09-22 12:05:00", level: "INFO", msg: "ONNX exported (partial training) · IO contract checked" }
      ]
    }
  ];
  runs[0].checkpoints = ckpts(500, 50000, function (it) { return it === 50000 ? "2026-09-21 20:56" : "2026-09-21"; }).slice(-6);
  runs[1].checkpoints = ckpts(500, 8600, function () { return "2026-09-26"; });
  runs[2].checkpoints = ckpts(500, 12340, function () { return "2026-09-23"; });
  runs[2].loss.value[runs[2].loss.value.length - 1].y = NaN;
  runs[3].checkpoints = [{ iter: 12000, savedAt: "2026-09-22 11:48", status: "Saved", size: "4.2 MB", reason: "Stop and save" }];

  /* ------------------------------------------------------------------ */
  /* Results (PLAYYARD)                                                   */
  /* ------------------------------------------------------------------ */
  var results = [
    {
      id: "res-001", name: "Walking baseline", botId: "bot-microduck", actionId: "velstand",
      configId: "cfg-101", configVersion: 1, sourceRun: "run-0142", gpu: "rtx4070",
      version: 1, created: "2026-09-21 21:03", visibility: "Private",
      snapshot: { color: "orange", feet: "standard", appearanceRev: 1, hardwareRev: 1 },
      training: "Target reached",
      compatibility: "Compatibility checked", simEval: "Simulation evaluated", hwValidation: "Not hardware validated",
      evaluations: [{
        id: "eval-1", version: 1, protocol: "platform-eval v0", scene: "flat · r1", seeds: "1, 2, 3, 4, 5", episodes: 20,
        checkpoint: 50000, created: "2026-09-21 20:58", sample: true,
        metrics: [
          { label: "Linear velocity tracking error", value: "0.11", unit: "m/s" },
          { label: "Fall rate", value: "2.1", unit: "%" },
          { label: "Stand-still drift (zero command)", value: "0.018", unit: "m/s" }
        ]
      }],
      files: [
        { name: "policy.onnx", type: "Policy", size: "1.8 MB", status: "Ready" },
        { name: "manifest.json", type: "Metadata", size: "2 KB", status: "Ready" },
        { name: "parameters.json", type: "Configuration", size: "7 KB", status: "Ready" },
        { name: "evaluation.json", type: "Evaluation", size: "3 KB", status: "Ready" },
        { name: "media/preview.mp4", type: "Video", size: null, status: "Not generated" },
        { name: "checkpoint_50000.pt", type: "Training checkpoint", size: "4.2 MB", status: "Ready" }
      ]
    },
    {
      id: "res-002", name: "Rink cruise (partial)", botId: "bot-microduck", actionId: "roller",
      configId: "cfg-201", configVersion: 1, sourceRun: "run-0139", gpu: "rtx4070",
      version: 1, created: "2026-09-22 12:05", visibility: "Private",
      snapshot: { color: "teal", feet: "roller", appearanceRev: 1, hardwareRev: 1 },
      training: "Partial training",
      compatibility: "Compatibility checked", simEval: "Not evaluated", hwValidation: "Not hardware validated",
      evaluations: [],
      files: [
        { name: "policy.onnx", type: "Policy", size: "1.8 MB", status: "Ready" },
        { name: "manifest.json", type: "Metadata", size: "2 KB", status: "Ready" },
        { name: "parameters.json", type: "Configuration", size: "7 KB", status: "Ready" },
        { name: "media/preview.mp4", type: "Video", size: null, status: "Not generated" }
      ]
    }
  ];

  /* ------------------------------------------------------------------ */
  /* ARENA drafts (no financial fields)                                  */
  /* ------------------------------------------------------------------ */
  var drafts = [];

  /* ------------------------------------------------------------------ */
  /* MASTER-only finance (sample)                                        */
  /* ------------------------------------------------------------------ */
  var finance = {
    timezone: "UTC+08:00",
    balance: 173.50,
    balanceUpdated: "2026-09-26 12:40",
    rates: {
      rtx4070: { rate: 12, unit: "GPU hour", version: "rate-2026-09-a" },
      rtx5060: null,
      evaluation: { rate: 1.5, unit: "evaluation run", version: "rate-2026-09-a" }
    },
    billingTerms: "Metering starts when execution resources are first allocated and ends when the request's resources are released. Queue time before the first allocation is not billed. Minimum metering unit: 1 minute.",
    topups: [
      { id: "ord-20260830-0007", date: "2026-08-30 10:12", amount: 100, currency: "CNY", credits: 100, status: "Credits added", method: "Card ·••• 4242", paidAt: "2026-08-30 10:12", creditedAt: "2026-08-30 10:13" },
      { id: "ord-20260920-0012", date: "2026-09-20 09:41", amount: 300, currency: "CNY", credits: 300, status: "Credits added", method: "Card ·••• 4242", paidAt: "2026-09-20 09:41", creditedAt: "2026-09-20 09:42" },
      { id: "ord-20260925-0003", date: "2026-09-25 22:03", amount: 50, currency: "CNY", credits: null, status: "Failed", method: "Card ·••• 1881", paidAt: null, creditedAt: null }
    ],
    bills: [
      { id: "bill-0142", runId: "run-0142", requestId: "auth-0142", service: "Training", date: "2026-09-21 09:14", status: "Settled",
        settledAt: "2026-09-22 02:00", rateVersion: "rate-2026-09-a",
        items: [
          { service: "Training", interval: "2026-09-21 09:14 – 20:56", qty: 11.70, unit: "GPU hour", rate: 12, credits: 140.40 },
          { service: "Evaluation", interval: "2026-09-21 20:56 – 20:58", qty: 1, unit: "evaluation run", rate: 1.5, credits: 1.50 }
        ],
        adjustments: [{ at: "2026-09-22 02:00", reason: "Rounding adjustment", credits: -3.40 }] },
      { id: "bill-0147", runId: "run-0147", requestId: "auth-0147", service: "Training", date: "2026-09-26 11:02", status: "Accruing",
        settledAt: null, rateVersion: "rate-2026-09-a",
        items: [{ service: "Training", interval: "2026-09-26 11:02 – now", qty: 1.77, unit: "GPU hour", rate: 12, credits: 21.24 }],
        adjustments: [] },
      { id: "bill-0145", runId: "run-0145", requestId: "auth-0145", service: "Training", date: "2026-09-23 16:40", status: "Settled",
        settledAt: "2026-09-24 02:00", rateVersion: "rate-2026-09-a",
        items: [{ service: "Training", interval: "2026-09-23 16:40 – 20:45", qty: 4.13, unit: "GPU hour", rate: 12, credits: 49.56 }],
        adjustments: [] },
      { id: "bill-0139", runId: "run-0139", requestId: "auth-0139", service: "Training", date: "2026-09-22 08:34", status: "Settled",
        settledAt: "2026-09-23 02:00", rateVersion: "rate-2026-09-a",
        items: [{ service: "Training", interval: "2026-09-22 08:34 – 11:48", qty: 3.23, unit: "GPU hour", rate: 12, credits: 38.76 }],
        adjustments: [] }
    ],
    /* AUTH-01 service authorizations */
    requests: [
      { id: "auth-0142", kind: "training", status: "Consumed", source: { type: "run", runId: "run-0142" }, limit: 200, confirmedAt: "2026-09-21 09:12" },
      { id: "auth-0147", kind: "training", status: "Consumed", source: { type: "run", runId: "run-0147" }, limit: 150, confirmedAt: "2026-09-26 11:00" },
      { id: "auth-0145", kind: "training", status: "Consumed", source: { type: "run", runId: "run-0145" }, limit: 120, confirmedAt: "2026-09-23 16:38" },
      { id: "auth-0139", kind: "training", status: "Consumed", source: { type: "run", runId: "run-0139" }, limit: 150, confirmedAt: "2026-09-22 08:32" }
    ],
    controls: { defaultLimit: 150, lowBalance: false }
  };

  var state = { nextRun: 148, nextCfg: 300, nextBot: 4, nextDraft: 1, nextReq: 1, nextRes: 3, nextMotor: 1, nextOrder: 1 };

  var viewerBase = (location.port === "8766") ? "" : "http://localhost:8766";

  /* ------------------------------------------------------------------ */
  /* Lookups & helpers                                                   */
  /* ------------------------------------------------------------------ */
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function actionById(id) { return find(actions, id); }
  function motorById(id) { return find(motors, id); }
  function platformById(id) { return platforms[id] || platforms.microduck; }
  function jointsOf(bot) {
    var p = platformById(bot && bot.platform);
    if (p.joints) return p.joints;
    return joints.map(function (j) { return { name: j, group: jointGroup(j), selectable: true }; });
  }
  function botMotorIds(bot) {
    var ids = {};
    jointsOf(bot).forEach(function (j) {
      if (j.selectable === false) return;
      var id = bot.motors.byJoint[j.name] || bot.motors.all;
      if (id) ids[id] = true;
    });
    return Object.keys(ids);
  }
  function previewVariant(bot, feet) {
    if (!bot) return "standard";
    var p = platformById(bot.platform);
    if (p.preview) return p.preview;
    var f = feet != null ? feet : bot.feet;
    return f === "roller" ? "roller" : "standard";
  }
  function motorsFor(platformId) {
    return motors.filter(function (m) { return m.platforms && m.platforms.indexOf(platformId) >= 0; });
  }
  function configVersion(cfg, v) {
    for (var i = 0; i < cfg.versions.length; i++) if (cfg.versions[i].v === v) return cfg.versions[i];
    return null;
  }
  function latestVersion(cfg) { return cfg.versions[cfg.versions.length - 1]; }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function stamp(d, withSec) {
    d = d || new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()) + (withSec ? ":" + pad(d.getSeconds()) : "");
  }

  return {
    SOURCES: SOURCES, SHARED_MANIFEST: SHARED_MANIFEST,
    palettes: palettes, joints: joints, jointGroup: jointGroup, platforms: platforms,
    platform: platformById, jointsOf: jointsOf, motorsFor: motorsFor, previewVariant: previewVariant,
    M6_PARAMS: M6_PARAMS, PHYSICAL_FIELDS: PHYSICAL_FIELDS,
    motors: motors, actions: actions, bots: bots, configs: configs,
    gpus: gpus, runs: runs, results: results, drafts: drafts,
    finance: finance, state: state, viewerBase: viewerBase,
    schemaFor: schemaFor, defaultsFor: defaultsFor, validate: validate, clone: clone, lossSeries: lossSeries,
    action: actionById, motor: motorById,
    bot: function (id) { return find(bots, id); },
    config: function (id) { return find(configs, id); },
    gpu: function (id) { return find(gpus, id); },
    run: function (id) { return find(runs, id); },
    result: function (id) { return find(results, id); },
    draft: function (id) { return find(drafts, id); },
    request: function (id) { return find(finance.requests, id); },
    bill: function (id) { return find(finance.bills, id); },
    palette: function (key) { return palettes.filter(function (p) { return p.key === key; })[0] || palettes[0]; },
    botMotorIds: botMotorIds, configVersion: configVersion, latestVersion: latestVersion,
    stamp: stamp
  };
})();
