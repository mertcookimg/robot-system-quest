// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// param_tuner: Param Tuner
// A fixed waypoint-following controller drives a slalom course; the user
// tunes its ROS 2 parameters (max_speed / turn_gain / accel) — even while
// it is running, just like `ros2 param set` reconfigures a live node.
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import {
  drawGrid,
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Trail } from "../../lib/trail";
import { Particles } from "../../lib/particles";
import { setupBlockProgram, type BlockProgramHandle } from "../../lib/block_program";
import { formatPose, formatTwist } from "../../lib/hud";
import { t, tx } from "../../i18n";

const PX_PER_M = 100;
const ROBOT_R = 14;
const CONTROL_HZ = 10; // node timer = 0.1 s, like the lectures
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_PARAM = "/parameter_events";

const START = { x: 80, y: 420, theta: 0 };
const WAYPOINTS = [
  { x: 260, y: 420 },
  { x: 420, y: 300 },
  { x: 260, y: 180 },
  { x: 480, y: 110 },
  { x: 650, y: 250 },
  { x: 700, y: 420 }, // final = GOAL
];
const WP_R = 26;
const GOAL_R = 30;

// Traffic cones: placed on the *outside* of each turn, so an overshooting
// (too fast / too weakly steered) robot clips them.
const cones = [
  { x: 350, y: 432, r: 13 },
  { x: 480, y: 262, r: 13 },
  { x: 190, y: 132, r: 13 },
  { x: 560, y: 82, r: 13 },
  { x: 722, y: 296, r: 13 },
  { x: 600, y: 400, r: 13 },
];

type Block = {
  kind: "drive_params";
  max_speed: number; // m/s
  turn_gain: number; // rad/s per rad of heading error
  accel: number; // m/s^2
};

function normAngle(a: number): number {
  return ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

export function makeParamTuner(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 400 });
  let program: Block[] = [];
  let isRunning = false;
  let elapsed = 0;
  let ctrlAcc = 0;
  let bumpFlash = 0;
  let runCount = 0;
  let cleared = false;
  let wpIdx = 0;
  let v = 0; // current forward speed [px/s]
  let ctrlV = 0; // commanded speed from the last control tick
  let ctrlW = 0; // commanded yaw rate from the last control tick
  let lastErr = 0;
  const lastParams = { max_speed: NaN, turn_gain: NaN, accel: NaN };

  let bp: BlockProgramHandle | null = null;
  let editorEl: HTMLElement | null = null;
  let statusBadgeEl: HTMLElement | null = null;

  function setStatusBadge(text: string, kind: "" | "running" | "success" | "error") {
    if (!statusBadgeEl) return;
    statusBadgeEl.textContent = text;
    statusBadgeEl.classList.remove("running", "success", "error");
    if (kind) statusBadgeEl.classList.add(kind);
  }

  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    particles.reset();
    trail.reset();
    elapsed = 0;
    ctrlAcc = 0;
    bumpFlash = 0;
    isRunning = false;
    cleared = false;
    wpIdx = 0;
    v = 0;
    ctrlV = 0;
    ctrlW = 0;
    lastErr = 0;
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("param_tuner.tip"), "");
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    if (program.length === 0 && runCount === 0) {
      program.push({ kind: "drive_params", max_speed: 0.4, turn_gain: 2.0, accel: 0.6 });
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("param_tuner.palette_hint"),
      blockKinds: [
        {
          kind: "drive_params",
          label: "drive_params",
          args: "max_speed, turn_gain, accel",
          defaults: () => ({ kind: "drive_params", max_speed: 0.4, turn_gain: 2.0, accel: 0.6 }),
          params: (b) => [
            { key: "max_speed", value: b.max_speed, step: 0.05, unit: "m/s" },
            { key: "turn_gain", value: b.turn_gain, step: 0.25, unit: "/s" },
            { key: "accel", value: b.accel, step: 0.1, unit: "m/s²" },
          ],
        },
      ],
      isRunning: () => isRunning,
      onRun: () => onRun(),
      onStop: () => onStop(),
      onClear: () => {
        onStop();
        program.length = 0;
      },
      // The controller node reads exactly one drive_params block — a second
      // one would be silently ignored, so the palette refuses to add it.
      maxBlocks: 1,
      onLimit: () => g.setStatus(t("param_tuner.single_block"), "var(--warn)"),
    });

    reset();
  }

  function dispose() {
    if (editorEl) editorEl.style.display = "none";
    bp?.dispose();
    bp = null;
  }

  function refreshProgramUI() {
    bp?.refresh();
  }

  function onRun() {
    if (program.length === 0) {
      g.setStatus(t("block.empty"), "var(--warn)");
      return;
    }
    runCount++;
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    particles.reset();
    trail.reset();
    elapsed = 0;
    bumpFlash = 0;
    cleared = false;
    wpIdx = 0;
    v = 0;
    ctrlV = 0;
    ctrlW = 0;
    isRunning = true;
    setStatusBadge("running", "running");
    g.sfx.click();
    g.setStatus(t("param_tuner.running"), "");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    v = 0;
    ctrlV = 0;
    ctrlW = 0;
    setStatusBadge("stopped", "");
    g.setStatus(t("param_tuner.stop"), "var(--warn)");
    refreshProgramUI();
  }

  function reachGoal(b: Block) {
    isRunning = false;
    cleared = true;
    setStatusBadge("success", "success");
    g.shake(0.5);
    particles.burst(robot.x, robot.y, COLORS.OK, 36);
    const stars = elapsed < 24 ? 3 : elapsed < 42 ? 2 : 1;
    const stats =
      `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
      `max_speed <b>${b.max_speed.toFixed(2)} m/s</b> · turn_gain <b>${b.turn_gain.toFixed(2)}</b>`;
    g.setTimeout(() => {
      g.sfx.clear();
      g.showClear(stars, stats);
    }, 500);
    refreshProgramUI();
  }

  function collide(x: number, y: number): boolean {
    if (x < ROBOT_R || x > W - ROBOT_R) return true;
    if (y < ROBOT_R || y > H - ROBOT_R) return true;
    for (const cone of cones) {
      const dx = x - cone.x,
        dy = y - cone.y;
      const rr = ROBOT_R + cone.r;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  // Emulates ros2 param set: on any live edit of a block param, a
  // ParameterEvent is published just like a real reconfigured node.
  function publishParamEvents(b: Block) {
    for (const key of ["max_speed", "turn_gain", "accel"] as const) {
      if (lastParams[key] !== b[key]) {
        if (!Number.isNaN(lastParams[key])) {
          g.publish(
            TOPIC_PARAM,
            `rcl_interfaces/msg/ParameterEvent node:/waypoint_driver ${key}: ${lastParams[key]} → ${b[key]}`,
          );
          g.sfx.click();
        }
        lastParams[key] = b[key];
      }
    }
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (!isRunning) {
      const b = program[0];
      g.setHud([
        `mode:      param editor`,
        `pose:      ${formatPose(robot, { pxPerM: PX_PER_M })}`,
        `max_speed: ${b ? b.max_speed.toFixed(2) : "--"} m/s`,
        `turn_gain: ${b ? b.turn_gain.toFixed(2) : "--"}`,
        `accel:     ${b ? b.accel.toFixed(2) : "--"} m/s²`,
      ]);
      g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
      return;
    }

    const b = program[0];

    // Controller runs at CONTROL_HZ, like a create_timer(0.1) node.
    // Params are read fresh each tick → live tuning takes effect instantly.
    ctrlAcc += dt;
    if (ctrlAcc > 1 / CONTROL_HZ) {
      ctrlAcc = 0;
      publishParamEvents(b);
      const wp = WAYPOINTS[wpIdx];
      const err = normAngle(Math.atan2(wp.y - robot.y, wp.x - robot.x) - robot.theta);
      lastErr = err;
      ctrlW = Math.max(-3.5, Math.min(3.5, b.turn_gain * err));
      // Corner braking: slow down while the heading error is large.
      const slow = Math.max(0.25, Math.cos(Math.min(Math.abs(err), Math.PI / 2)));
      ctrlV = b.max_speed * PX_PER_M * slow;
      g.publish(TOPIC_CMD, fmtTwist(ctrlV / PX_PER_M, ctrlW));
    }

    // Acceleration-limited speed tracking (brakes act twice as hard).
    const maxDv = b.accel * PX_PER_M * dt;
    const dv = ctrlV - v;
    v += Math.max(-maxDv * 2, Math.min(maxDv, dv));

    robot.theta += ctrlW * dt;
    const nx = robot.x + v * Math.cos(robot.theta) * dt;
    const ny = robot.y + v * Math.sin(robot.theta) * dt;
    if (collide(nx, ny)) {
      bumpFlash = 1;
      g.shake(0.4);
      particles.burst(robot.x, robot.y, "#fb7185", 22, 220);
      isRunning = false;
      v = 0;
      ctrlV = 0;
      ctrlW = 0;
      setStatusBadge("collision — reset", "error");
      g.sfx.bump();
      g.setStatus(t("param_tuner.collision"), "var(--danger)");
      robot.x = START.x;
      robot.y = START.y;
      robot.theta = START.theta;
      wpIdx = 0;
      trail.reset();
      refreshProgramUI();
      return;
    }
    robot.x = nx;
    robot.y = ny;

    trail.update(dt, robot.x, robot.y);

    // Waypoint / goal check.
    const wp = WAYPOINTS[wpIdx];
    const last = wpIdx === WAYPOINTS.length - 1;
    const reach = last ? GOAL_R : WP_R;
    if (Math.hypot(wp.x - robot.x, wp.y - robot.y) <= reach) {
      if (last) {
        reachGoal(b);
        return;
      }
      particles.burst(wp.x, wp.y, "#7dd3fc", 14, 160);
      g.sfx.pickup();
      wpIdx++;
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:      waypoint_driver`,
      `target:    wp${wpIdx + 1}/${WAYPOINTS.length}`,
      `heading_e: ${((lastErr * 180) / Math.PI).toFixed(1)} deg`,
      `cmd_vel:   ${formatTwist({ v, w: ctrlW }, { pxPerM: PX_PER_M })}`,
      `max_speed: ${b.max_speed.toFixed(2)} m/s (live)`,
      `pose:      ${formatPose(robot, { pxPerM: PX_PER_M })}`,
    ]);
  }

  function drawCone(c: CanvasRenderingContext2D, cone: { x: number; y: number; r: number }) {
    c.save();
    c.fillStyle = "rgba(217, 119, 6, 0.85)";
    c.strokeStyle = "#7c4a03";
    c.lineWidth = 1;
    c.beginPath();
    c.arc(cone.x, cone.y, cone.r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#fef3e8";
    c.beginPath();
    c.arc(cone.x, cone.y, cone.r * 0.55, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#d97706";
    c.beginPath();
    c.arc(cone.x, cone.y, cone.r * 0.25, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);

    // Planned route (dashed) through all waypoints.
    c.save();
    c.strokeStyle = "rgba(125, 211, 252, 0.22)";
    c.lineWidth = 1;
    c.setLineDash([5, 7]);
    c.beginPath();
    c.moveTo(START.x, START.y);
    for (const wp of WAYPOINTS) c.lineTo(wp.x, wp.y);
    c.stroke();
    c.setLineDash([]);
    c.restore();

    // Waypoints (current target highlighted); the last one is the GOAL.
    for (let i = 0; i < WAYPOINTS.length - 1; i++) {
      const wp = WAYPOINTS[i];
      const active = isRunning && i === wpIdx;
      const done = i < wpIdx;
      c.save();
      c.strokeStyle = done
        ? "rgba(94, 234, 212, 0.5)"
        : active
          ? "#7dd3fc"
          : "rgba(125, 211, 252, 0.4)";
      c.lineWidth = active ? 2 : 1;
      c.beginPath();
      c.arc(wp.x, wp.y, WP_R * 0.6, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = done
        ? "rgba(94, 234, 212, 0.7)"
        : active
          ? "#7dd3fc"
          : "rgba(125, 211, 252, 0.55)";
      c.font = "700 10px ui-monospace, monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(i + 1), wp.x, wp.y);
      c.restore();
    }
    const goal = WAYPOINTS[WAYPOINTS.length - 1];
    drawZone(c, { x: goal.x, y: goal.y, r: GOAL_R }, "#5eead4", "GOAL", elapsed);

    for (const cone of cones) drawCone(c, cone);

    // Start marker.
    c.save();
    c.strokeStyle = "rgba(125, 211, 252, 0.45)";
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(START.x, START.y, 18, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(125, 211, 252, 0.65)";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("START", START.x, START.y - 24);
    c.restore();

    trail.draw(c, 0.65);
    particles.draw(c);

    g.ghost.draw(c, elapsed, elapsed);

    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, elapsed);
    drawRobotLabel(c);
    c.restore();

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("param_tuner.hint"));
  }

  return {
    id: "param_tuner",
    name: "Param Tuner",
    lesson: "Parameters",
    lessonCmd: "ros2 param set /waypoint_driver max_speed 0.6",
    ros2: {
      title: tx(
        "Parameter ・ros2 param set で走りながらチューニング",
        "Parameters — live tuning with ros2 param set",
      ),
      summary:
        "ROS2 ノードは max_speed のような設定値を Parameter として持ち、" +
        "コードを書き換えずに ros2 param set で実行中に変更できます。" +
        "変更は /parameter_events に流れ、ノード側は set_parameters callback で受け取る。" +
        "実ロボの現場調整（ゲイン合わせ・速度制限）はほぼこの仕組みで行われます。",
      msgTypes: ["rcl_interfaces/msg/ParameterEvent", "geometry_msgs/msg/Twist"],
      cli: [
        "ros2 param list /waypoint_driver",
        "ros2 param get /waypoint_driver max_speed",
        "ros2 param set /waypoint_driver max_speed 0.6",
        "ros2 param dump /waypoint_driver > tuned.yaml",
        "ros2 run my_pkg waypoint_driver --ros-args --params-file tuned.yaml",
      ],
      python: `import rclpy
from rclpy.node import Node
from rcl_interfaces.msg import SetParametersResult
from geometry_msgs.msg import Twist

class WaypointDriver(Node):
    def __init__(self):
        super().__init__('waypoint_driver')
        # 1) declare: name + default value
        self.declare_parameter('max_speed', 0.4)
        self.declare_parameter('turn_gain', 2.0)
        self.pub = self.create_publisher(Twist, '/cmd_vel', 10)
        # 2) accept live changes from "ros2 param set"
        self.add_on_set_parameters_callback(self.on_params)
        self.create_timer(0.1, self.control)

    def on_params(self, params):
        for p in params:
            self.get_logger().info(f'{p.name} -> {p.value}')
        return SetParametersResult(successful=True)

    def control(self):
        v_max = self.get_parameter('max_speed').value
        gain  = self.get_parameter('turn_gain').value
        msg = Twist()
        msg.linear.x  = v_max            # toward the waypoint
        msg.angular.z = gain * 0.0       # gain * heading_error
        self.pub.publish(msg)`,
      realWorld: tx(
        "Nav2 も同じ仕組みで動いています。最高速度や膨張半径は全部 Parameter で、YAML を配って現場で ros2 param set しながら調整するのが実務の日常です。",
        "Nav2 works exactly this way: max velocity, inflation radius and more are all Parameters, distributed as YAML and tuned in the field with ros2 param set.",
      ),
      state: {
        nodes: ["/waypoint_driver", "/robot_node"],
        topics: [
          {
            name: TOPIC_CMD,
            type: "geometry_msgs/msg/Twist",
            pub: ["/waypoint_driver"],
            sub: ["/robot_node"],
          },
          {
            name: TOPIC_PARAM,
            type: "rcl_interfaces/msg/ParameterEvent",
            pub: ["/waypoint_driver"],
          },
        ],
        services: [
          {
            name: "/waypoint_driver/set_parameters",
            type: "rcl_interfaces/srv/SetParameters",
            node: "/waypoint_driver",
          },
          {
            name: "/waypoint_driver/get_parameters",
            type: "rcl_interfaces/srv/GetParameters",
            node: "/waypoint_driver",
          },
        ],
      },
    },
    init,
    update,
    draw,
    reset,
    dispose,
  };
}

export default defineStage({
  mode: "lesson",
  order: 4,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="ros2 param set reconfigures the waypoint_driver node at runtime">
  <defs>
    <marker id="ld-param-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
    <marker id="ld-param-arrow2" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="16" width="150" height="88" rx="8" fill="#0b0f1e" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="83" y="38" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="10" font-weight="700">$ ros2 param set</text>
  <text x="83" y="56" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">/waypoint_driver</text>
  <text x="83" y="74" text-anchor="middle" fill="#eef2ff" font-family="ui-monospace, monospace" font-size="9">max_speed 0.6</text>
  <rect x="240" y="16" width="172" height="88" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="326" y="36" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="11" font-weight="700">waypoint_driver</text>
  <text x="326" y="56" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">max_speed: 0.4 → 0.6</text>
  <text x="326" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">turn_gain: 2.0</text>
  <text x="326" y="92" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9">running — no rebuild!</text>
  <line x1="158" y1="48" x2="238" y2="48" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-param-arrow)"/>
  <text x="198" y="38" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="9">set_parameters</text>
  <line x1="238" y1="78" x2="158" y2="78" stroke="#5eead4" stroke-width="1.5" marker-end="url(#ld-param-arrow2)"/>
  <text x="198" y="94" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9">/parameter_events</text>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 160 48 L 234 48"/>
  </circle>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Parameter — 実行中のノードを ros2 param set で調整",
      en: "Parameters — tuning a live node with ros2 param set",
    },
    learn: {
      ja: "コードを書き換えず、実行中のノードの設定値 (Parameter) を外から変更できます。ブロックの max_speed / turn_gain / accel はそのまま ros2 param set に対応し、変更は /parameter_events に流れます。",
      en: "Parameters let you reconfigure a running node without touching its code. The block's max_speed / turn_gain / accel map directly to ros2 param set, and every change flows through /parameter_events.",
    },
    goal: {
      ja: "コーンに当てずにスラロームを走破して GOAL へ。速いほど星が増えます (24秒未満で ★3)。速すぎるとカーブで膨らんでコーンに衝突!",
      en: "Complete the slalom to GOAL without hitting a cone. Faster runs earn more stars (under 24 s = ★3) — but too fast and the robot drifts wide into a cone!",
    },
    first: {
      ja: "まずデフォルト (max_speed 0.4) のまま ▶ RUN で完走を確認。次は走らせたまま max_speed を上げてみましょう — 実行中に効くのが Parameter の醍醐味です。",
      en: "First press ▶ RUN with the defaults (max_speed 0.4) and watch it finish. Then raise max_speed while it is still driving — live reconfiguration is the whole point of Parameters.",
    },
  },
  strings: {
    ja: {
      collision: "コーンに衝突 — max_speed を下げるか turn_gain を上げて再 RUN",
      hint: "実行中でもパラメータ変更OK = ros2 param set / STOP で停止",
      palette_hint: "ros2 param set のように走行中でも値を変えられる",
      running: "waypoint_driver 実行中 — パラメータは今すぐ変更できます",
      single_block: "drive_params は 1 つだけ — 値は既存ブロックで調整して",
      stop: "停止 — パラメータを調整して再 RUN",
      tip: "max_speed / turn_gain / accel を調整して RUN — 速いほど星が増える",
    },
    en: {
      collision: "Hit a cone — lower max_speed or raise turn_gain, then RUN again",
      hint: "Edit params even while running = ros2 param set / STOP to halt",
      palette_hint: "Change values mid-run, just like ros2 param set",
      running: "waypoint_driver running — parameters can be changed right now",
      single_block: "Only one drive_params block — tune the existing one instead",
      stop: "Stopped — adjust parameters and RUN again",
      tip: "Tune max_speed / turn_gain / accel and RUN — faster runs earn more stars",
    },
  },
  build: makeParamTuner,
});
