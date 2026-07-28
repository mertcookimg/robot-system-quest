// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// feedforward_controller: Feedforward
// Free-play learning stage with no obstacles or goal. Drive the robot
// using forward / rotate / wait blocks.
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import {
  drawGrid,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  clearBackground,
} from "../../lib/draw";
import { Trail } from "../../lib/trail";
import { Particles } from "../../lib/particles";
import { setupStartDrag, type StartDragHandle } from "../../lib/start_drag";
import { setupModeToggle, type ModeToggleHandle } from "../../lib/mode_toggle";
import { setupBlockProgram, type BlockProgramHandle } from "../../lib/block_program";
import { formatPose, formatTwist } from "../../lib/hud";
import {
  TRIANGLE_SIDE_M,
  TRIANGLE_START,
  TriangleTracker,
  drawTriangleCourse,
  finishTriangleLesson,
} from "../../lib/triangle_course";
import { t, tx } from "../../i18n";

const PX_PER_M = 100;
const ROBOT_R = 14;
const TOPIC_CMD = "/cmd_vel";

// The initial position can be dragged.
const START = { ...TRIANGLE_START };

type Block = { kind: "cmd_vel"; linear: number; angular: number; duration: number };

interface Compiled {
  block: Block;
  duration: number;
  linearV: number; // px/s
  angularV: number; // rad/s
}

function compile(b: Block): Compiled {
  return {
    block: b,
    duration: Math.max(0, b.duration),
    linearV: b.linear * PX_PER_M,
    angularV: b.angular,
  };
}

export function makeFeedforwardController(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 250 });
  let program: Block[] = [];
  let runtime: Compiled[] = [];
  let runIdx = -1;
  let blockT = 0;
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let bumpFlash = 0;
  let runCount = 0;
  let cleared = false;
  let practice: ModeToggleHandle | null = null;
  let startDrag: StartDragHandle | null = null;
  let bp: BlockProgramHandle | null = null;
  const triangle = new TriangleTracker();

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
    runIdx = -1;
    blockT = 0;
    isRunning = false;
    elapsed = 0;
    pubAcc = 0;
    bumpFlash = 0;
    cleared = false;
    triangle.reset(robot.x, robot.y);
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(
      tx(
        "速度と時間だけで、ガイドと同じ正三角形を描きましょう",
        "Draw the triangle using only velocity and duration",
      ),
      "",
    );
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    // Default sample (cmd_vel only: forward → right → forward).
    if (program.length === 0 && runCount === 0) {
      program.push(
        { kind: "cmd_vel", linear: 0.5, angular: 0.0, duration: 1.0 },
        { kind: "cmd_vel", linear: 0.0, angular: 1.0, duration: 1.0 },
      );
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: tx(
        "開ループ：現在位置を見ずに linear・angular・duration を決めます",
        "Open loop: set linear, angular, and duration without reading pose",
      ),
      blockKinds: [
        {
          kind: "cmd_vel",
          label: "cmd_vel",
          args: "linear, angular, dur",
          defaults: () => ({ kind: "cmd_vel", linear: 0.5, angular: 0.0, duration: 1.0 }),
          params: (b) => [
            { key: "linear", value: b.linear, step: 0.1, unit: "m/s" },
            { key: "angular", value: b.angular, step: 0.1, unit: "rad/s" },
            { key: "duration", value: b.duration, step: 0.1, unit: "s" },
          ],
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

    practice = setupModeToggle("be-practice", {
      onLabel: "🔄 練習モード (RT)",
      offLabel: "△ 三角形チャレンジ (RT)",
      onTitle: "軌跡を確認しながら、速度と時間を何度でも調整できます",
      offTitle: "1辺1.4mの正三角形を描き、始点へ戻るとクリアです",
      onChange: (active) => {
        g.setStatus(
          active
            ? tx(
                "練習モード：クリア判定なしで試せます",
                "Practice mode: experiment without clear scoring",
              )
            : tx(
                "三角形チャレンジ：ガイドに沿って始点へ戻ろう",
                "Triangle challenge: follow the guide and return to start",
              ),
          active ? "var(--accent)" : "var(--ok)",
        );
      },
      click: () => g.sfx.click(),
    });
    startDrag = setupStartDrag(g, START, {
      robotR: ROBOT_R,
      isRunning: () => isRunning,
      onChange: () => {
        // While dragging or using MOVE-START, snap the robot to START and reset its heading.
        if (isRunning) return;
        robot.x = START.x;
        robot.y = START.y;
        robot.theta = START.theta;
        trail.reset();
      },
      statusOn: t("ff_controller.move_start_on"),
      statusOff: t("ff_controller.move_start_off"),
    });
    // The triangle comparison uses one shared, fixed start pose.
    startDrag.dispose();
    startDrag = null;

    refreshProgramUI();
    reset();
  }

  function dispose() {
    if (editorEl) editorEl.style.display = "none";
    practice?.dispose();
    practice = null;
    startDrag?.dispose();
    startDrag = null;
  }

  // refreshProgramUI and paramsOf now live in lib/block_program; bp.refresh() replaces them.
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
    triangle.reset(robot.x, robot.y);

    runtime = program.map(compile);
    runIdx = 0;
    blockT = 0;
    isRunning = true;
    setStatusBadge("running", "running");
    g.sfx.click();
    g.setStatus(t("block.running", { n: runtime.length }), "");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    setStatusBadge("aborted", "error");
    g.setStatus(t("block.stop_aborted"), "var(--warn)");
    refreshProgramUI();
  }

  function programDone() {
    isRunning = false;
    setStatusBadge("done", "success");
    refreshProgramUI();

    // Practice mode: update state only.
    if (practice?.isActive()) {
      g.setStatus(
        tx(
          "実行完了。軌跡を見て速度と時間を調整しましょう",
          "Run complete. Inspect the path, then adjust velocity and duration",
        ),
        "var(--ok)",
      );
      return;
    }

    // Mission mode: check whether forward, left-turn, and right-turn patterns were all used.
    const result = triangle.result(robot.x, robot.y);
    cleared = finishTriangleLesson(g, result, elapsed, program.length);
    setStatusBadge(
      cleared ? "triangle complete" : "adjust and retry",
      cleared ? "success" : "error",
    );
  }

  function update(dt: number) {
    particles.update(dt);
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (cleared) return;

    // START movement mode: move START with the gamepad, WASD, or arrow keys.
    startDrag?.tick(dt, W, H);

    if (!isRunning) {
      const mode = startDrag?.isMoveMode()
        ? "moving START (WASD / pad)"
        : practice?.isActive()
          ? "practice (free play)"
          : "mission (use fwd/left/right)";
      g.setHud([
        `mode:    ${mode}`,
        `pose:    ${formatPose({ ...robot, theta: -robot.theta })}`,
        `blocks:  ${program.length}`,
        practice?.isActive()
          ? "task:    free trajectory practice"
          : `target:  ${TRIANGLE_SIDE_M.toFixed(1)} m × 3 / turn 120°`,
      ]);
      g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
      return;
    }

    const cur = runtime[runIdx];
    if (!cur) {
      programDone();
      return;
    }

    blockT += dt;
    const lv = cur.linearV;
    const av = cur.angularV;
    // ROS yaw is counter-clockwise positive; Canvas y points downward.
    robot.theta -= av * dt;

    let nx = robot.x + lv * Math.cos(robot.theta) * dt;
    let ny = robot.y + lv * Math.sin(robot.theta) * dt;
    // Soft-clamp at the canvas edges (don't crash).
    nx = Math.max(ROBOT_R, Math.min(W - ROBOT_R, nx));
    ny = Math.max(ROBOT_R, Math.min(H - ROBOT_R, ny));
    robot.x = nx;
    robot.y = ny;
    triangle.observe(robot.x, robot.y);

    trail.update(dt, robot.x, robot.y);
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(lv / PX_PER_M, av));
    }

    if (blockT >= cur.duration) {
      blockT = 0;
      runIdx++;
      if (runIdx >= runtime.length) {
        programDone();
        return;
      }
      refreshProgramUI();
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:     running`,
      `block:    [${runIdx + 1}/${runtime.length}] ${cur.block.kind}`,
      `t:        ${blockT.toFixed(2)} / ${cur.duration.toFixed(2)} s`,
      `pose:     ${formatPose({ ...robot, theta: -robot.theta })}`,
      `cmd_vel:  ${formatTwist({ v: lv, w: av }, { pxPerM: PX_PER_M })}`,
      `triangle: ${triangle.progress()}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    if (!practice?.isActive()) drawTriangleCourse(c);

    // Centered start marker; lib/start_drag handles dragging, MOVE-START, and arrow rendering.
    startDrag?.draw(c);

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
    drawHint(
      c,
      practice?.isActive()
        ? tx(
            "自由練習｜linear・angular・durationを変えて軌跡を観察",
            "Free practice — change linear, angular, and duration to observe the path",
          )
        : tx(
            "1辺 1.4 m・左に120° × 3｜距離 = 速度 × 時間",
            "1.4 m × 3 sides / turn left 120° — distance = velocity × time",
          ),
    );
  }

  return {
    id: "feedforward_controller",
    name: "Feedforward Controller",
    lesson: "Feedforward",
    lessonCmd:
      'ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.5}, angular: {z: 0.0}}"',
    ros2: {
      title: tx(
        "Feedforward ・時間で正三角形を描く",
        "Feedforward — draw an equilateral triangle by time",
      ),
      summary:
        "1辺1.4mの正三角形を、現在位置を測らずに描きます。" +
        "直進距離は linear×duration、回転角は angular×duration から計算し、" +
        "あらかじめ組み立てた geometry_msgs/msg/Twist を順番に /cmd_vel へ publish します。",
      msgTypes: ["geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic echo /cmd_vel",
        'ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.5}, angular: {z: 0.0}}"',
      ],
      python: `import math, rclpy, time
from rclpy.node import Node
from geometry_msgs.msg import Twist

class Feedforward(Node):
    def __init__(self):
        super().__init__('sandbox')
        self.pub = self.create_publisher(Twist, '/cmd_vel', 10)

    def cmd_vel(self, linear, angular, duration):
        """linear[m/s], angular[rad/s] を duration 秒間 publish"""
        msg = Twist()
        msg.linear.x = linear
        msg.angular.z = angular
        end = time.time() + duration
        while time.time() < end:
            self.pub.publish(msg)
            time.sleep(0.1)
        self.pub.publish(Twist())  # stop

# 例（REP-103: angular.z 正 = 反時計回り = 左旋回）:
# n = Feedforward()
# 1辺1.4m・外角120°の正三角形
# for _ in range(3):
#     n.cmd_vel(0.5, 0.0, 2.8)
#     n.cmd_vel(0.0, 1.0, math.radians(120))`,
      realWorld: tx(
        "実機ではタイヤ径や床の摩擦によって、同じ速度と時間でも三角形が閉じないことがあります。測定せずに動かす方法のシンプルさと限界を確認できます。",
        "On a real robot, wheel size and floor friction can keep the triangle from closing even with the same speed and time. This exposes both the simplicity and limits of motion without measurement.",
      ),
      state: {
        nodes: ["/sandbox", "/robot_node"],
        topics: [
          {
            name: "/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/sandbox"],
            sub: ["/robot_node"],
          },
          { name: "/robot/odom", type: "nav_msgs/msg/Odometry", pub: ["/robot_node"], sub: [] },
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
  order: 5,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="feedforward controller publishes a planned sequence of cmd_vel">
  <defs>
    <marker id="ld-feedforward_controller-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <!-- controller box with timeline inside -->
  <rect x="8" y="14" width="200" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="108" y="32" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">controller</text>
  <text x="108" y="48" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">time-based plan (open loop)</text>
  <!-- gantt-style timeline of cmd_vel blocks -->
  <rect x="22" y="62" width="50" height="16" rx="2" fill="#7dd3fc"/>
  <text x="47" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">t=d/v</text>
  <rect x="74" y="62" width="28" height="16" rx="2" fill="#fbbf24"/>
  <text x="88" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">t=θ/ω</text>
  <rect x="104" y="62" width="80" height="16" rx="2" fill="#7dd3fc"/>
  <text x="144" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">REPEAT × 3</text>
  <text x="108" y="96" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">linear / angular / duration</text>
  <!-- robot box -->
  <rect x="280" y="36" width="132" height="48" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <g transform="translate(296,52)">
    <rect x="0" y="0" width="22" height="16" rx="3" fill="none" stroke="#c4b5fd" stroke-width="1.5"/>
    <circle cx="6" cy="7" r="1.6" fill="#c4b5fd"/>
    <circle cx="16" cy="7" r="1.6" fill="#c4b5fd"/>
  </g>
  <text x="364" y="58" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot</text>
  <text x="364" y="74" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">just follows</text>
  <!-- arrow -->
  <line x1="208" y1="60" x2="278" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-feedforward_controller-arrow)"/>
  <text x="243" y="54" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/cmd_vel</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Feedforward Controller — 時間で三角形を描く",
      en: "Feedforward Controller — draw a triangle by time",
    },
    learn: {
      ja: "現在位置を見ず、linear・angular・durationだけで動かします。1辺1.4mの正三角形には「直進→左120°」を3回組み合わせます。",
      en: "Move without reading pose, using only linear, angular, and duration. Build a 1.4 m equilateral triangle by repeating drive straight, then turn left 120°, three times.",
    },
    goal: {
      ja: "「距離＝速度×時間」と「回転角＝角速度×時間」を使い、軌跡を三角形ガイドに重ねて始点へ戻しましょう。",
      en: "Use distance = velocity × time and angle = angular velocity × time. Match the guide and return to the start.",
    },
    first: {
      ja: "最初の2ブロックは未完成です。「時間＝距離÷速度」と「時間＝回転角÷角速度」で値を直し、同じ組を3辺分に増やしましょう。",
      en: "The first two blocks are incomplete. Correct them with time = distance ÷ speed and time = angle ÷ angular speed, then expand the pair to all three sides.",
    },
  },
  build: makeFeedforwardController,
});
