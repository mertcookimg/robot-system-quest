// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// feedback_mission: Feedback Mission
// Same map as feedforward_mission, but cleared via feedback control.
// Lets the player compare feedforward (cmd_vel + duration) vs feedback
// (odom + distance/angle) on the same problem.
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
import { canvasAngularFromRos, normalizeAngle, rosYawFromCanvas } from "../../lib/control_math";

const PX_PER_M = 100;
const ROBOT_R = 14;
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_ODOM = "/robot/odometry/odometry";

// Same map as feedforward_mission.
const START = { x: 80, y: 80, theta: 0 };
const GOAL = { x: 720, y: 420, r: 32 };
const walls = [
  { x: 230, y: 130, w: 24, h: 280 },
  { x: 420, y: 110, w: 24, h: 280 },
  { x: 600, y: 200, w: 24, h: 250 },
];

type Block =
  | { kind: "go_straight"; distance: number; velocity: number }
  | { kind: "turn_left"; angle: number; yawrate: number }
  | { kind: "turn_right"; angle: number; yawrate: number };

interface BlockRuntime {
  block: Block;
  start: (rx: number, ry: number, ryaw: number) => void;
  step: (rx: number, ry: number, ryaw: number) => { v: number; wRos: number; done: boolean };
}

function makeRuntime(b: Block): BlockRuntime {
  switch (b.kind) {
    case "go_straight": {
      let x0 = 0,
        y0 = 0;
      return {
        block: b,
        start: (rx, ry) => {
          x0 = rx;
          y0 = ry;
        },
        step: (rx, ry) => {
          const dist = Math.hypot(rx - x0, ry - y0) / PX_PER_M;
          if (dist < b.distance) return { v: b.velocity * PX_PER_M, wRos: 0, done: false };
          return { v: 0, wRos: 0, done: true };
        },
      };
    }
    case "turn_left": {
      let yaw0 = 0;
      return {
        block: b,
        start: (_rx, _ry, ryaw) => {
          yaw0 = ryaw;
        },
        step: (_rx, _ry, ryaw) => {
          const d = normalizeAngle(yaw0 - ryaw);
          const target = b.angle * (Math.PI / 180);
          if (d < target) return { v: 0, wRos: Math.abs(b.yawrate), done: false };
          return { v: 0, wRos: 0, done: true };
        },
      };
    }
    case "turn_right": {
      let yaw0 = 0;
      return {
        block: b,
        start: (_rx, _ry, ryaw) => {
          yaw0 = ryaw;
        },
        step: (_rx, _ry, ryaw) => {
          const d = normalizeAngle(ryaw - yaw0);
          const target = b.angle * (Math.PI / 180);
          if (d < target) return { v: 0, wRos: -Math.abs(b.yawrate), done: false };
          return { v: 0, wRos: 0, done: true };
        },
      };
    }
  }
}

export function makeFeedbackMission(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 350, interval: 0.04 });
  let program: Block[] = [];
  let runtime: BlockRuntime[] = [];
  let runIdx = -1;
  let blockT = 0;
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let bumpFlash = 0;
  let runCount = 0;
  let cleared = false;
  let lastV = 0;
  let lastW = 0;

  let editorEl: HTMLElement | null = null;
  let statusBadgeEl: HTMLElement | null = null;
  let bp: BlockProgramHandle | null = null;

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
    runIdx = -1;
    blockT = 0;
    isRunning = false;
    elapsed = 0;
    pubAcc = 0;
    bumpFlash = 0;
    cleared = false;
    lastV = 0;
    lastW = 0;
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("fb_mission.tip"), "");
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    if (program.length === 0 && runCount === 0) {
      // Default sample: gets partway, dodging walls but not reaching the GOAL.
      program.push(
        { kind: "go_straight", distance: 1.5, velocity: 0.5 },
        { kind: "turn_right", angle: 90, yawrate: 0.6 },
        { kind: "go_straight", distance: 3.0, velocity: 0.5 },
      );
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("fb_mission.palette_hint"),
      blockKinds: [
        {
          kind: "go_straight",
          label: "go_straight",
          args: "distance, velocity",
          defaults: () => ({ kind: "go_straight", distance: 1.0, velocity: 0.5 }),
          params: (b) =>
            b.kind === "go_straight"
              ? [
                  { key: "distance", value: b.distance, step: 0.1, unit: "m" },
                  { key: "velocity", value: b.velocity, step: 0.05, unit: "m/s" },
                ]
              : [],
        },
        {
          kind: "turn_left",
          label: "turn_left",
          args: "angle, yawrate",
          defaults: () => ({ kind: "turn_left", angle: 90, yawrate: 0.6 }),
          params: (b) =>
            b.kind === "turn_left"
              ? [
                  { key: "angle", value: b.angle, step: 5, unit: "°" },
                  { key: "yawrate", value: b.yawrate, step: 0.1, unit: "rad/s" },
                ]
              : [],
        },
        {
          kind: "turn_right",
          label: "turn_right",
          args: "angle, yawrate",
          defaults: () => ({ kind: "turn_right", angle: 90, yawrate: 0.6 }),
          params: (b) =>
            b.kind === "turn_right"
              ? [
                  { key: "angle", value: b.angle, step: 5, unit: "°" },
                  { key: "yawrate", value: b.yawrate, step: 0.1, unit: "rad/s" },
                ]
              : [],
        },
      ],
      isRunning: () => isRunning,
      runIdx: () => runIdx,
      onRun: () => onRun(),
      onStop: () => onStop(),
      onClear: () => {
        onStop();
        program.length = 0;
      },
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

  function canMoveTo(x: number, y: number): boolean {
    if (x < ROBOT_R || x > W - ROBOT_R) return false;
    if (y < ROBOT_R || y > H - ROBOT_R) return false;
    for (const wall of walls) {
      const cx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
      const cy = Math.max(wall.y, Math.min(y, wall.y + wall.h));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
    }
    return true;
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
    runtime = program.map(makeRuntime);
    runIdx = 0;
    blockT = 0;
    isRunning = true;
    runtime[0].start(robot.x, robot.y, robot.theta);
    setStatusBadge("running", "running");
    g.sfx.click();
    g.setStatus(t("block.running_feedback", { n: runtime.length }), "");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    lastV = 0;
    lastW = 0;
    setStatusBadge("aborted", "error");
    g.setStatus(t("block.stop_aborted"), "var(--warn)");
    refreshProgramUI();
  }

  function programFinished(success: boolean, err?: string) {
    isRunning = false;
    lastV = 0;
    lastW = 0;
    if (success) {
      cleared = true;
      setStatusBadge("success", "success");
      g.shake(0.5);
      particles.burst(robot.x, robot.y, COLORS.OK, 36);
      const blockCount = program.length;
      const stars = blockCount <= 4 ? 3 : blockCount <= 6 ? 2 : 1;
      const stats = `Blocks <b>${blockCount}</b><br>` + `Time   <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 500);
    } else {
      setStatusBadge(err ?? "error", "error");
      g.sfx.bump();
      g.setStatus(err ?? t("block.error"), "var(--danger)");
    }
    refreshProgramUI();
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (!isRunning) {
      g.setHud([
        `mode:    feedback editor`,
        `pose:    ${formatPose({ ...robot, theta: rosYawFromCanvas(robot.theta) }, { pxPerM: PX_PER_M })}`,
        `blocks:  ${program.length}`,
      ]);
      g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
      return;
    }

    const cur = runtime[runIdx];
    if (!cur) {
      programFinished(false, "no current block");
      return;
    }

    blockT += dt;
    const r = cur.step(robot.x, robot.y, robot.theta);
    lastV = r.v;
    lastW = r.wRos;

    if (r.done) {
      g.publish(TOPIC_CMD, fmtTwist(0, 0));
      runIdx++;
      if (runIdx >= runtime.length) {
        // Goal check.
        const dx = robot.x - GOAL.x;
        const dy = robot.y - GOAL.y;
        if (Math.hypot(dx, dy) <= GOAL.r) programFinished(true);
        else programFinished(false, "did not reach goal — extend program");
        return;
      }
      blockT = 0;
      runtime[runIdx].start(robot.x, robot.y, robot.theta);
      refreshProgramUI();
    } else {
      // Physics step.
      robot.theta += canvasAngularFromRos(r.wRos) * dt;
      const nx = robot.x + r.v * Math.cos(robot.theta) * dt;
      const ny = robot.y + r.v * Math.sin(robot.theta) * dt;

      // Collision → reset.
      if (!canMoveTo(nx, ny)) {
        bumpFlash = 1;
        const blockNum = runIdx + 1;
        g.shake(0.4);
        particles.burst(robot.x, robot.y, "#fb7185", 22, 220);
        programFinished(false, `collision at block ${blockNum} — reset`);
        robot.x = START.x;
        robot.y = START.y;
        robot.theta = START.theta;
        trail.reset();
        return;
      }

      robot.x = nx;
      robot.y = ny;

      trail.update(dt, robot.x, robot.y);
      pubAcc += dt;
      if (pubAcc > 1 / 10) {
        pubAcc = 0;
        g.publish(TOPIC_CMD, fmtTwist(r.v / PX_PER_M, r.wRos));
        g.publish(
          TOPIC_ODOM,
          `nav_msgs/msg/Odometry pose:(x=${(robot.x / PX_PER_M).toFixed(2)} y=${(robot.y / PX_PER_M).toFixed(2)} yaw=${rosYawFromCanvas(robot.theta).toFixed(2)})`,
        );
      }

      // Goal (any contact during execution counts).
      const gdx = robot.x - GOAL.x;
      const gdy = robot.y - GOAL.y;
      if (Math.hypot(gdx, gdy) <= GOAL.r) {
        programFinished(true);
        return;
      }
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:     feedback running`,
      `block:    [${runIdx + 1}/${runtime.length}] ${cur.block.kind}`,
      `odom:     ${formatPose({ ...robot, theta: rosYawFromCanvas(robot.theta) }, { pxPerM: PX_PER_M })}`,
      `cmd_vel:  ${formatTwist({ v: lastV, w: lastW }, { pxPerM: PX_PER_M })}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);

    // Walls.
    for (const wall of walls) {
      c.fillStyle = "rgba(35, 44, 77, 0.75)";
      c.strokeStyle = "rgba(110, 122, 156, 0.5)";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      c.fill();
      c.stroke();
    }

    drawZone(c, GOAL, "#5eead4", "GOAL", elapsed);

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

    // Trail.
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
    drawHint(c, t("fb_mission.hint"));
  }

  return {
    id: "feedback_mission",
    name: "Feedback Mission",
    lesson: "Feedback Mission",
    lessonCmd: "ros2 topic echo /robot/odometry/odometry",
    ros2: {
      title: tx(
        "Feedback Mission ・odom フィードバックで壁を避けて GOAL",
        "Feedback Mission — dodge walls and reach GOAL via odom feedback",
      ),
      summary:
        "feedforward_mission (Feedforward Mission) と全く同じマップ・障害物・GOAL を、" +
        "今度は feedforward (cmd_vel + duration) ではなく feedback (go_straight + odom) で攻略します。" +
        "このLessonでは外乱を加えず、時間ではなくOdometryで移動距離と旋回角度を測り、" +
        "それぞれの目標値へ到達した時点で指令を止めます。",
      msgTypes: ["geometry_msgs/msg/Twist", "nav_msgs/msg/Odometry"],
      cli: [
        "ros2 topic echo /robot/odometry/odometry",
        "ros2 topic echo /robot/manual_control/cmd_vel",
        "ros2 topic info /robot/odometry/odometry",
      ],
      python: `# feedback_controller と同じ robot_feedback_control.py を使う
# 例：壁を避ける経路
n = RobotFeedbackControl()
n.go_straight(2.0, velocity=0.5)
n.turn_right(90)
n.go_straight(3.0, velocity=0.5)
n.turn_left(90)
n.go_straight(4.5, velocity=0.5)
# ...壁の配置に合わせて続ける`,
      realWorld: tx(
        "このLessonには外乱がないため、Feedforward Missionと結果が似る場合があります。Odometryで停止を判断すると時間だけで止める方法より移動量の推定値を利用できますが、車輪エンコーダ由来のOdometryはスリップそのものを補正できません。実機では必要に応じてIMUやLiDARなどを融合します。",
        "This lesson adds no disturbance, so its result may resemble Feedforward Mission. Odometry-based stopping uses an estimate of motion rather than time alone, but wheel-encoder odometry cannot correct wheel slip by itself. Physical robots may fuse IMU, LiDAR, or other sensors when needed.",
      ),
      state: {
        nodes: ["/robot_feedback_control", "/robot_node"],
        topics: [
          {
            name: "/robot/manual_control/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/robot_feedback_control"],
            sub: ["/robot_node"],
          },
          {
            name: "/robot/odometry/odometry",
            type: "nav_msgs/msg/Odometry",
            pub: ["/robot_node"],
            sub: ["/robot_feedback_control"],
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
  order: 8,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="feedback closed loop on a wall map">
  <defs>
    <marker id="ld-feedback_mission-arrow-cmd" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-feedback_mission-arrow-odom" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
  </defs>
  <rect x="8" y="14" width="148" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="32" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">controller</text>
  <text x="82" y="50" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">closed loop</text>
  <line x1="22" y1="76" x2="142" y2="76" stroke="#6e7a9c" stroke-width="1" stroke-dasharray="3 2"/>
  <circle cx="22" cy="76" r="2.5" fill="#6e7a9c"/>
  <circle cx="142" cy="76" r="3" fill="#5eead4"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="2.4s" repeatCount="indefinite" path="M 22 76 L 142 76"/>
  </circle>
  <text x="82" y="98" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">go_straight / turn</text>
  <!-- mini map -->
  <rect x="184" y="14" width="228" height="92" rx="8" fill="#0c1124" stroke="#232c4d"/>
  <rect x="240" y="28" width="14" height="64" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <rect x="328" y="28" width="14" height="64" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <rect x="196" y="78" width="20" height="16" rx="2" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <circle cx="201" cy="84" r="1.5" fill="#7dd3fc"/>
  <circle cx="211" cy="84" r="1.5" fill="#7dd3fc"/>
  <path d="M 206 80 Q 230 30 248 30 L 320 30 Q 342 30 342 60 Q 342 86 396 86" fill="none" stroke="#5eead4" stroke-width="1.5" stroke-dasharray="3 2"/>
  <line x1="396" y1="88" x2="396" y2="60" stroke="#fbbf24" stroke-width="1.5"/>
  <polygon points="396,60 410,66 396,72" fill="#fb7185"/>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Feedback ミッション — 同じマップを閉ループで",
      en: "Feedback mission — same map, closed loop",
    },
    learn: {
      ja: "時間ではなく、Odometryで測った距離・角度を終了条件にします。外乱のない同じマップで、feedforwardとの情報の使い方を比べましょう。",
      en: "Use distance and angle measured from odometry as stopping conditions instead of elapsed time. Compare the information flow with feedforward on the same disturbance-free map.",
    },
    goal: {
      ja: "go_straight / turn_left / turn_right だけで壁を避け、GOAL に到達しましょう。",
      en: "Use only go_straight / turn_left / turn_right to dodge the walls and reach GOAL.",
    },
    first: {
      ja: "go_straight(distance) と turn_left(angle) を組み合わせてブロックを並べ、▶ RUN で確認しましょう。",
      en: "Combine go_straight(distance) and turn_left(angle) blocks, then press ▶ RUN to verify.",
    },
  },
  build: makeFeedbackMission,
});
