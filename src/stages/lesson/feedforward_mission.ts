// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// feedforward_mission: Feedforward Mission
// No keyboard control: arrange blocks, fill in numeric parameters, RUN.
// Same "feedforward control = scripted cmd_vel publishing" model as
// robot_ros2_lecture.
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
import { canvasAngularFromRos, rosYawFromCanvas } from "../../lib/control_math";

const PX_PER_M = 100; // 1m = 100px
const ROBOT_R = 14;
const TOPIC_CMD = "/cmd_vel";

const START = { x: 80, y: 80, theta: 0 };
const GOAL = { x: 720, y: 420, r: 32 };

// Simple zigzag course — requires one left → right turn.
const walls = [
  { x: 230, y: 130, w: 24, h: 280 },
  { x: 420, y: 110, w: 24, h: 280 },
  { x: 600, y: 200, w: 24, h: 250 },
];

// -- Block definitions --
// Only blocks that publish geometry_msgs/msg/Twist on /cmd_vel — same
// interface as the real robot.
type Block = { kind: "cmd_vel"; linear: number; angular: number; duration: number };

interface Compiled {
  block: Block;
  duration: number; // sec
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

export function makeFeedforwardMission(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 200 });
  let program: Block[] = [];
  let runtime: Compiled[] = [];
  let runIdx = -1;
  let blockT = 0;
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let cleared = false;
  let lastError = "";
  let bumpFlash = 0;
  let runCount = 0;

  let editorEl: HTMLElement | null = null;
  let statusBadgeEl: HTMLElement | null = null;
  let bp: BlockProgramHandle | null = null;

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
    cleared = false;
    lastError = "";
    bumpFlash = 0;
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("ff_mission.tip"), "");
    refreshProgramUI();
  }

  function setStatusBadge(text: string, kind: "" | "running" | "success" | "error") {
    if (!statusBadgeEl) return;
    statusBadgeEl.textContent = text;
    statusBadgeEl.classList.remove("running", "success", "error");
    if (kind) statusBadgeEl.classList.add(kind);
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    // Default sample program (set once).
    if (program.length === 0 && runCount === 0) {
      // 60°/s ≈ 1.05 rad/s. ROS angular.z: left positive, right negative.
      program.push(
        { kind: "cmd_vel", linear: 0.7, angular: 0.0, duration: 2.0 },
        { kind: "cmd_vel", linear: 0.0, angular: -1.05, duration: 1.5 },
        { kind: "cmd_vel", linear: 0.7, angular: 0.0, duration: 4.0 },
        { kind: "cmd_vel", linear: 0.0, angular: 1.05, duration: 1.5 },
        { kind: "cmd_vel", linear: 0.7, angular: 0.0, duration: 3.5 },
      );
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("ff_mission.palette_hint"),
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

  // -- Execution control --
  function onRun() {
    if (program.length === 0) {
      g.setStatus(t("block.empty"), "var(--warn)");
      return;
    }
    runCount++;
    // Reset robot.
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    particles.reset();
    trail.reset();
    elapsed = 0;
    bumpFlash = 0;
    cleared = false;
    lastError = "";

    runtime = program.map(compile);
    runIdx = 0;
    blockT = 0;
    isRunning = true;
    setStatusBadge("running", "running");
    g.sfx.click();
    g.setStatus(t("block.running_program", { n: runtime.length }), "");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    setStatusBadge("aborted", "error");
    g.setStatus(t("block.stop_aborted"), "var(--warn)");
    refreshProgramUI();
  }

  function programFinished(success: boolean, err?: string) {
    isRunning = false;
    if (success) {
      cleared = true;
      setStatusBadge("success", "success");
      g.shake(0.5);
      particles.burst(robot.x, robot.y, COLORS.OK, 36);
      const blockCount = program.length;
      const stars = blockCount <= 5 ? 3 : blockCount <= 8 ? 2 : 1;
      const stats =
        `Blocks    <b>${blockCount}</b><br>` + `Time      <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 500);
    } else {
      lastError = err ?? "error";
      setStatusBadge(err ?? "error", "error");
      g.sfx.bump();
      g.setStatus(err ?? t("block.error"), "var(--danger)");
    }
    refreshProgramUI();
  }

  // -- Collision --
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

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (!isRunning) {
      g.setHud([
        `mode:    program editor`,
        `pose:    ${formatPose({ ...robot, theta: rosYawFromCanvas(robot.theta) })}`,
        `blocks:  ${program.length}`,
        `last:    ${lastError || "-"}`,
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

    // Apply velocity to the robot.
    const lv = cur.linearV;
    const av = cur.angularV;
    // Keep commands in ROS coordinates; only the Canvas renderer needs a sign
    // conversion because its Y axis points downward.
    robot.theta += canvasAngularFromRos(av) * dt;
    const nx = robot.x + lv * Math.cos(robot.theta) * dt;
    const ny = robot.y + lv * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else {
      // Collision → show error and send the robot back to START.
      bumpFlash = 1;
      const blockNum = runIdx + 1;
      g.shake(0.4);
      particles.burst(robot.x, robot.y, "#fb7185", 22, 220);
      programFinished(false, `collision at block ${blockNum} — reset`);
      // Reset position only — keep the program editable.
      robot.x = START.x;
      robot.y = START.y;
      robot.theta = START.theta;
      trail.reset();
      return;
    }

    // -- Goal check (any time during execution; entering the zone wins).
    {
      const gdx = robot.x - GOAL.x;
      const gdy = robot.y - GOAL.y;
      if (Math.hypot(gdx, gdy) <= GOAL.r) {
        programFinished(true);
        return;
      }
    }

    // Trail.
    trail.update(dt, robot.x, robot.y);
    // /cmd_vel publish (10Hz)
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(lv / PX_PER_M, av));
    }

    // Block done.
    if (blockT >= cur.duration) {
      blockT = 0;
      runIdx++;
      if (runIdx >= runtime.length) {
        // End: goal check.
        const dx = robot.x - GOAL.x;
        const dy = robot.y - GOAL.y;
        if (Math.hypot(dx, dy) <= GOAL.r) {
          programFinished(true);
        } else {
          programFinished(false, "did not reach goal");
        }
        return;
      }
      refreshProgramUI();
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:     running`,
      `block:    [${runIdx + 1}/${runtime.length}] ${cur.block.kind}`,
      `t:        ${blockT.toFixed(2)} / ${cur.duration.toFixed(2)} s`,
      `pose:     ${formatPose({ ...robot, theta: rosYawFromCanvas(robot.theta) }, { pxPerM: PX_PER_M })}`,
      `cmd_vel:  ${formatTwist({ v: lv, w: av }, { pxPerM: PX_PER_M })}`,
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
    c.fillStyle = "rgba(125, 211, 252, 0.7)";
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
    drawHint(c, t("ff_mission.hint"));
  }

  return {
    id: "feedforward_mission",
    name: "Feedforward Mission",
    lesson: "Feedforward Mission",
    lessonCmd:
      'ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.5}, angular: {z: 0.0}}"',
    ros2: {
      title: tx(
        "Feed-forward ・計画した cmd_vel を順に publish",
        "Feed-forward — publish a planned sequence of cmd_vel",
      ),
      summary:
        "キーボードでリアルタイム操作する代わりに、" +
        "あらかじめ並べた forward / rotate / wait のブロックを" +
        "順に geometry_msgs/msg/Twist として /cmd_vel に publish します。" +
        "ROS 2 入門で扱われる、時間と速度をあらかじめ決めた open-loop control と同じ仕組み。" +
        "この方式は外乱に弱いのが弱点で、後の Subscribe や Action で改善していきます。",
      msgTypes: ["geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic echo /cmd_vel",
        'ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist \\\n  "{linear: {x: 0.5}, angular: {z: 0.0}}"',
        "ros2 topic hz /cmd_vel",
      ],
      python: `import rclpy, time
from rclpy.node import Node
from geometry_msgs.msg import Twist

class FeedforwardMission(Node):
    def __init__(self):
        super().__init__('programmer')
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
        # 終わったら 0 を送って停止
        self.pub.publish(Twist())

# 使い方（このゲームのプログラムと完全対応）:
# ※ REP-103: angular.z 正 = 反時計回り = 左旋回
# n = FeedforwardMission()
# n.cmd_vel(0.7,  0.0,  2.0)   # 直進
# n.cmd_vel(0.0, -1.05, 1.5)   # 右に 90°（時計回り）
# n.cmd_vel(0.7,  0.0,  4.0)   # 直進
# n.cmd_vel(0.0,  1.05, 1.5)   # 左に 90°（反時計回り）
# n.cmd_vel(0.7,  0.0,  3.5)   # 直進`,
      realWorld: tx(
        "講義の初期課題と同じく、時間と速度をあらかじめ決めて /cmd_vel を送る開ループ制御を扱います。実機では base controller、安全設定、床や車体の特性によって結果が変わるため、低速かつ安全な環境で確認します。",
        "Like the introductory lecture exercise, this lesson sends a preplanned sequence of timed /cmd_vel commands as open-loop control. Results on a physical robot depend on its base controller, safety configuration, floor, and mechanics, so testing should begin slowly in a safe area.",
      ),
      state: {
        nodes: ["/programmer", "/robot_node"],
        topics: [
          {
            name: "/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/programmer"],
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
  order: 6,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="feedforward sequence of cmd_vel must navigate a wall to GOAL">
  <defs>
    <marker id="ld-feedforward_mission-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <!-- timeline (controller plan) -->
  <rect x="8" y="14" width="200" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="108" y="32" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">controller</text>
  <text x="108" y="48" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">plan to dodge a wall</text>
  <rect x="22" y="62" width="38" height="16" rx="2" fill="#7dd3fc"/>
  <text x="41" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">→</text>
  <rect x="62" y="62" width="22" height="16" rx="2" fill="#fbbf24"/>
  <text x="73" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">↻</text>
  <rect x="86" y="62" width="46" height="16" rx="2" fill="#7dd3fc"/>
  <text x="109" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">→</text>
  <rect x="134" y="62" width="22" height="16" rx="2" fill="#fbbf24"/>
  <text x="145" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">↻</text>
  <rect x="158" y="62" width="32" height="16" rx="2" fill="#7dd3fc"/>
  <text x="174" y="74" text-anchor="middle" fill="#0c1124" font-family="ui-monospace, monospace" font-size="9" font-weight="700">→</text>
  <text x="108" y="96" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">cmd_vel sequence</text>
  <!-- mini map: robot, wall, goal -->
  <rect x="240" y="20" width="172" height="84" rx="6" fill="#0c1124" stroke="#232c4d"/>
  <rect x="320" y="32" width="14" height="62" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <rect x="252" y="74" width="20" height="16" rx="2" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <circle cx="257" cy="80" r="1.5" fill="#7dd3fc"/>
  <circle cx="267" cy="80" r="1.5" fill="#7dd3fc"/>
  <path d="M 262 76 Q 290 36 314 36 Q 322 36 322 50 Q 322 74 380 74" fill="none" stroke="#5eead4" stroke-width="1.5" stroke-dasharray="3 2"/>
  <line x1="382" y1="76" x2="382" y2="44" stroke="#fbbf24" stroke-width="1.5"/>
  <polygon points="382,44 398,52 382,58" fill="#fb7185"/>
  <text x="326" y="100" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">wall + GOAL</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Feedforward ミッション — 時間で壁を避ける",
      en: "Feedforward mission — dodging walls by time",
    },
    learn: {
      ja: "feedforward は時間さえ正確なら一直線で目的地に着きますが、誤差があると壁にぶつかります。開ループの限界を体感しましょう。",
      en: "With perfect timing, feedforward reaches the goal in a straight shot — but any drift hits a wall. Feel the limits of open-loop control.",
    },
    goal: {
      ja: "cmd_vel ブロックを duration の秒数で並べ、壁を避けて GOAL に到達しましょう。",
      en: "Stack cmd_vel blocks with the right durations to dodge the walls and reach GOAL.",
    },
    first: {
      ja: "linear / angular / duration を調整したブロックを並べて ▶ RUN。ズレたら R で位置リセットしてやり直しましょう。",
      en: "Tune linear / angular / duration on each block and press ▶ RUN. Press R to reset position if you drift off.",
    },
  },
  build: makeFeedforwardMission,
});
