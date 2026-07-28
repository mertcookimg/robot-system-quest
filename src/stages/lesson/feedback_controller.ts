// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// feedback_controller: Feedback Controller
// Faithful re-implementation of robot_ros2_lecture / robot_feedback_control.py.
// Subscribes to /odom and keeps publishing cmd_vel until the traveled
// distance or yaw delta reaches the target.
//   while sqrt((x-x0)**2 + (y-y0)**2) < distance:  publish(velocity)
//   while abs(atan2(sin(yaw-yaw0), cos(yaw-yaw0))) < target_angle:  publish(yawrate)
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
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_ODOM = "/robot/odometry/odometry";

// Starts in the center like feedforward_controller and can be dragged.
const START = { ...TRIANGLE_START };

type Block =
  | { kind: "go_straight"; distance: number; velocity: number }
  | { kind: "turn_left"; angle: number; yawrate: number }
  | { kind: "turn_right"; angle: number; yawrate: number };

interface BlockRuntime {
  block: Block;
  start: (rx: number, ry: number, ryaw: number) => void;
  step: (rx: number, ry: number, ryaw: number) => { v: number; w: number; done: boolean };
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
          const dist = Math.hypot(rx - x0, ry - y0) / PX_PER_M; // [m]
          if (dist < b.distance) {
            return { v: b.velocity * PX_PER_M, w: 0, done: false };
          }
          return { v: 0, w: 0, done: true };
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
          // Normalize the angle delta via atan2 to handle wrap-around.
          const d = Math.atan2(Math.sin(ryaw - yaw0), Math.cos(ryaw - yaw0));
          const target = b.angle * (Math.PI / 180);
          if (Math.abs(d) < target) {
            return { v: 0, w: b.yawrate, done: false };
          }
          return { v: 0, w: 0, done: true };
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
          const d = Math.atan2(Math.sin(ryaw - yaw0), Math.cos(ryaw - yaw0));
          const target = b.angle * (Math.PI / 180);
          if (Math.abs(d) < target) {
            return { v: 0, w: -b.yawrate, done: false };
          }
          return { v: 0, w: 0, done: true };
        },
      };
    }
  }
}

export function makeFeedbackController(): Stage {
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
    lastV = 0;
    lastW = 0;
    triangle.reset(robot.x, robot.y);
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(
      tx(
        "オドメトリで距離と角度を測り、同じ正三角形を描きましょう",
        "Draw the same triangle by measuring distance and angle with odometry",
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

    // Initial sample matches the lecture's main().
    if (program.length === 0 && runCount === 0) {
      program.push(
        { kind: "go_straight", distance: 1.0, velocity: 0.4 },
        { kind: "turn_left", angle: 90, yawrate: 0.7 },
      );
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: tx(
        "閉ループ：/odomを見て、目標距離・目標角度に達したら止めます",
        "Closed loop: use /odom to stop at each target distance and angle",
      ),
      blockKinds: [
        {
          kind: "go_straight",
          label: "go_straight",
          args: "distance, velocity",
          defaults: () => ({ kind: "go_straight", distance: 1.0, velocity: 0.3 }),
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
          defaults: () => ({ kind: "turn_left", angle: 90, yawrate: 0.5 }),
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
          defaults: () => ({ kind: "turn_right", angle: 90, yawrate: 0.5 }),
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

    practice = setupModeToggle("be-practice", {
      onLabel: "🔄 練習モード (RT)",
      offLabel: "△ 三角形チャレンジ (RT)",
      onTitle: "軌跡と/odomを確認しながら、距離と角度を調整できます",
      offTitle: "1辺1.4mの正三角形を描き、始点へ戻るとクリアです",
      onChange: (active) => {
        g.setStatus(
          active
            ? tx(
                "練習モード：クリア判定なしで試せます",
                "Practice mode: experiment without clear scoring",
              )
            : tx(
                "三角形チャレンジ：/odomを見て始点へ戻ろう",
                "Triangle challenge: use /odom and return to start",
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
        if (isRunning) return;
        robot.x = START.x;
        robot.y = START.y;
        robot.theta = START.theta;
        trail.reset();
      },
      statusOn: t("fb_controller.move_start_on"),
      statusOff: t("fb_controller.move_start_off"),
    });
    // Keep the start pose identical to the feedforward triangle lesson.
    startDrag.dispose();
    startDrag = null;

    reset();
  }

  function dispose() {
    if (editorEl) editorEl.style.display = "none";
    practice?.dispose();
    practice = null;
    startDrag?.dispose();
    startDrag = null;
    bp?.dispose();
    bp = null;
  }

  // refreshProgramUI, paramsOf, setupPalette, and defaultBlock now live in lib/block_program.
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
    triangle.reset(robot.x, robot.y);
    runtime = program.map(makeRuntime);
    runIdx = 0;
    blockT = 0;
    isRunning = true;
    runtime[0].start(robot.x, robot.y, -robot.theta);
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

  function programDone() {
    isRunning = false;
    lastV = 0;
    lastW = 0;
    setStatusBadge("done", "success");
    refreshProgramUI();

    // Practice mode: update state only, without showing the clear screen.
    if (practice?.isActive()) {
      g.setStatus(
        tx(
          "実行完了。軌跡と/odomを見て距離・角度を調整しましょう",
          "Run complete. Inspect the path and /odom, then adjust distance and angle",
        ),
        "var(--ok)",
      );
      return;
    }

    // Mission mode: award three stars after all three block types are used.
    const result = triangle.result(robot.x, robot.y);
    cleared = finishTriangleLesson(g, result, elapsed, program.length);
    setStatusBadge(
      cleared ? "triangle complete" : "adjust and retry",
      cleared ? "success" : "error",
    );
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    // START movement mode: move START with the gamepad, WASD, or arrow keys.
    startDrag?.tick(dt, W, H);

    if (!isRunning) {
      g.setHud([
        `mode:    ${startDrag?.isMoveMode() ? "moving START (WASD / pad)" : "feedback editor"}`,
        `pose:    ${formatPose({ ...robot, theta: -robot.theta }, { pxPerM: PX_PER_M })}`,
        `blocks:  ${program.length}`,
        practice?.isActive()
          ? "task:    free odometry practice"
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

    // -- Control-law step: like the lecture, keep publishing cmd_vel
    //    until the target is reached.
    const r = cur.step(robot.x, robot.y, -robot.theta);
    lastV = r.v;
    lastW = r.w;

    if (r.done) {
      // Publish a single cmd_vel = 0 (equivalent to lecture's stop()).
      g.publish(TOPIC_CMD, fmtTwist(0, 0));
      runIdx++;
      if (runIdx >= runtime.length) {
        programDone();
        return;
      }
      blockT = 0;
      runtime[runIdx].start(robot.x, robot.y, -robot.theta);
      refreshProgramUI();
    } else {
      // Physics: theta += w*dt, x/y += v * cos/sin(theta).
      // Convert ROS yaw (counter-clockwise positive) to Canvas rotation.
      robot.theta -= r.w * dt;
      let nx = robot.x + r.v * Math.cos(robot.theta) * dt;
      let ny = robot.y + r.v * Math.sin(robot.theta) * dt;
      nx = Math.max(ROBOT_R, Math.min(W - ROBOT_R, nx));
      ny = Math.max(ROBOT_R, Math.min(H - ROBOT_R, ny));
      robot.x = nx;
      robot.y = ny;
      triangle.observe(robot.x, robot.y);

      trail.update(dt, robot.x, robot.y);
      // Publish /cmd_vel and /odom at 10 Hz.
      pubAcc += dt;
      if (pubAcc > 1 / 10) {
        pubAcc = 0;
        g.publish(TOPIC_CMD, fmtTwist(r.v / PX_PER_M, r.w));
        g.publish(
          TOPIC_ODOM,
          `nav_msgs/msg/Odometry pose:(x=${(robot.x / PX_PER_M).toFixed(2)} y=${(robot.y / PX_PER_M).toFixed(2)} yaw=${(-robot.theta).toFixed(2)})`,
        );
      }
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    // Values used for the progress readout.
    const inProgress = describeProgress(cur.block, robot, blockT);
    g.setHud([
      `mode:     feedback running`,
      `block:    [${runIdx + 1}/${runtime.length}] ${cur.block.kind}`,
      `progress: ${inProgress}`,
      `odom:     ${formatPose({ ...robot, theta: -robot.theta }, { pxPerM: PX_PER_M })}`,
      `cmd_vel:  ${formatTwist({ v: lastV, w: lastW }, { pxPerM: PX_PER_M })}`,
      `triangle: ${triangle.progress()}`,
    ]);
  }

  // One-liner progress per block.
  function describeProgress(b: Block, _r: typeof robot, _t: number): string {
    // We don't keep the latest runtime value, so just return the block kind.
    switch (b.kind) {
      case "go_straight":
        return `target ${b.distance.toFixed(2)} m  @  ${b.velocity.toFixed(2)} m/s`;
      case "turn_left":
        return `target ${b.angle}° (left)  @  ${b.yawrate.toFixed(2)} rad/s`;
      case "turn_right":
        return `target ${b.angle}° (right)  @  ${b.yawrate.toFixed(2)} rad/s`;
    }
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    if (!practice?.isActive()) drawTriangleCourse(c);

    // Start marker; lib/start_drag handles dragging, MOVE-START, and arrow rendering.
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
            "自由練習｜distance・angle・velocityを変えて/odomを観察",
            "Free practice — change distance, angle, and velocity while observing /odom",
          )
        : tx(
            "1辺 1.4 m・左に120° × 3｜時間ではなく測定値で止める",
            "1.4 m × 3 sides / turn left 120° — stop from measurement, not time",
          ),
    );
  }

  return {
    id: "feedback_controller",
    name: "Feedback Controller",
    lesson: "Feedback (odom)",
    lessonCmd: "ros2 topic echo /robot/odometry/odometry",
    ros2: {
      title: tx(
        "Feedback ・/odomで正三角形を描く",
        "Feedback — draw an equilateral triangle with /odom",
      ),
      summary:
        "Feedforward Controllerと同じ1辺1.4mの正三角形を描きます。" +
        "/odom をSubscribeし、推定移動距離が1.4m、推定回転角が120°に達するまでcmd_velを送り、" +
        "時間ではなくOdometryの推定結果を使って各辺と回転を終えます。",
      msgTypes: ["geometry_msgs/msg/Twist", "nav_msgs/msg/Odometry"],
      cli: [
        "ros2 topic echo /robot/odometry/odometry",
        "ros2 topic echo /robot/manual_control/cmd_vel",
        "ros2 topic info /robot/odometry/odometry",
      ],
      python: `import math, numpy as np, rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist
from nav_msgs.msg import Odometry
from tf_transformations import euler_from_quaternion

class RobotFeedbackControl(Node):
    def __init__(self):
        super().__init__('robot_feedback_control')
        self.cmd_vel_pub = self.create_publisher(
            Twist, '/robot/manual_control/cmd_vel', 10)
        self.create_subscription(
            Odometry, '/robot/odometry/odometry',
            self.callback_odom, 10)
        self.x = self.y = self.yaw = None
        while self.x is None:
            rclpy.spin_once(self, timeout_sec=0.1)

    def callback_odom(self, msg):
        self.x = msg.pose.pose.position.x
        self.y = msg.pose.pose.position.y
        q = msg.pose.pose.orientation
        self.yaw = euler_from_quaternion(
            (q.x, q.y, q.z, q.w))[2]

    def go_straight(self, distance, velocity=0.3):
        vel = Twist(); x0, y0 = self.x, self.y
        while np.sqrt((self.x-x0)**2 + (self.y-y0)**2) < distance:
            vel.linear.x = velocity
            self.cmd_vel_pub.publish(vel)
            rclpy.spin_once(self, timeout_sec=0.1)
        self.stop()

    def turn_left(self, angle_degree, yawrate=0.5):
        vel = Twist(); yaw0 = self.yaw
        target = math.radians(angle_degree)
        while abs(math.atan2(math.sin(self.yaw-yaw0),
                              math.cos(self.yaw-yaw0))) < target:
            vel.angular.z = yawrate
            self.cmd_vel_pub.publish(vel)
            rclpy.spin_once(self, timeout_sec=0.1)
        self.stop()

    def turn_right(self, angle_degree, yawrate=-0.5):
        # yawrate を負にするだけで右旋回
        ...

    def stop(self):
        self.cmd_vel_pub.publish(Twist())

# 1辺1.4m・外角120°の正三角形
# for _ in range(3):
#     n.go_straight(1.4)
#     n.turn_left(120)`,
      realWorld: tx(
        "実機でも odometry を読み、目標の移動距離や回転角に達したかを判定して停止できます。ただし odometry の誤差、速度制限、停止距離を考慮し、安全な低速から調整する必要があります。",
        "A physical robot can also use odometry to decide when it has reached a target distance or rotation. Odometry error, velocity limits, and stopping distance must still be considered, beginning with safe low-speed tests.",
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
  order: 7,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="feedback closed loop: cmd_vel forward, robot reports /odom back">
  <defs>
    <marker id="ld-feedback_controller-arrow-cmd" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-feedback_controller-arrow-odom" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
  </defs>
  <!-- controller with target/measurement gauge -->
  <rect x="8" y="14" width="148" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="32" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">controller</text>
  <!-- target line + moving current dot -->
  <line x1="22" y1="68" x2="142" y2="68" stroke="#6e7a9c" stroke-width="1" stroke-dasharray="3 2"/>
  <circle cx="22" cy="68" r="2.5" fill="#6e7a9c"/>
  <circle cx="142" cy="68" r="3" fill="#5eead4"/>
  <text x="14" y="62" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="8">start</text>
  <text x="148" y="62" text-anchor="end" fill="#5eead4" font-family="ui-monospace, monospace" font-size="8">target</text>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="2.4s" repeatCount="indefinite" path="M 22 68 L 142 68"/>
  </circle>
  <text x="82" y="92" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">"あと何 m?" を確認</text>
  <!-- robot with sensor "eye" -->
  <rect x="264" y="14" width="148" height="92" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="32" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot</text>
  <g transform="translate(322,52)">
    <rect x="0" y="0" width="32" height="22" rx="3" fill="none" stroke="#c4b5fd" stroke-width="1.5"/>
    <circle cx="8" cy="10" r="2" fill="#c4b5fd"/>
    <circle cx="24" cy="10" r="2" fill="#c4b5fd"/>
    <line x1="16" y1="22" x2="16" y2="28" stroke="#c4b5fd" stroke-width="1.5"/>
  </g>
  <text x="338" y="98" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">moves + reports pose</text>
  <!-- /cmd_vel forward -->
  <line x1="156" y1="46" x2="262" y2="46" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-feedback_controller-arrow-cmd)"/>
  <text x="209" y="40" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/cmd_vel</text>
  <!-- /odom back -->
  <line x1="262" y1="78" x2="156" y2="78" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-feedback_controller-arrow-odom)"/>
  <text x="209" y="98" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/odom</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Feedback Controller — 位置を測って三角形を描く",
      en: "Feedback Controller — draw a triangle from measured pose",
    },
    learn: {
      ja: "/odomから推定移動距離と推定回転角を読み、目標値に達したと推定されたら止めます。同じ正三角形でも、時間ではなくOdometryの推定結果で各辺と回転を決めます。",
      en: "Read estimated distance and rotation from /odom and stop when each target is estimated to have been reached. The triangle is identical, but the odometry estimate—not elapsed time—decides every side and turn.",
    },
    goal: {
      ja: "go_straight(1.4m)とturn_left(120°)を3回ずつ組み合わせ、三角形ガイドに沿って始点へ戻りましょう。",
      en: "Combine go_straight(1.4 m) and turn_left(120°) three times each, follow the guide, and return to the start.",
    },
    first: {
      ja: "最初の2ブロックは未完成です。ガイドの辺の長さと外角を読み取り、distanceとangleを直してから3辺分に増やしましょう。",
      en: "The first two blocks are incomplete. Read the side length and exterior angle from the guide, correct distance and angle, then expand the pair to all three sides.",
    },
  },
  build: makeFeedbackController,
});
