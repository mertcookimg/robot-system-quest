// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// follower: Follower — tail a leader robot via Subscribe + TF lookup.
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import {
  drawGrid,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { Trail } from "../../lib/trail";
import { canMoveTo as inWalls } from "../../lib/walls";
import { formatPose, formatTwist } from "../../lib/hud";
import { t, tx } from "../../i18n";

const ROBOT_R = 16;
const BASE_LIN = 200;
const BASE_ANG = 2.5;
const TOPIC_TARGET = "/target/pose";
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const REQUIRED_TIME = 8;
const MIN_DIST = 55;
const MAX_DIST = 130;
const START = { x: 110, y: 250, theta: 0 };

const walls = [
  { x: 280, y: 80, w: 60, h: 130 },
  { x: 460, y: 290, w: 60, h: 130 },
  { x: 200, y: 360, w: 100, h: 14 },
  { x: 540, y: 130, w: 100, h: 14 },
];

export function makeFollower(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const cmd = { lin: 0, ang: 0 };
  const particles = new Particles();
  const trail = new Trail({ max: 80 });
  let leader = { x: 0, y: 0 };
  let leaderTheta = 0;
  let elapsed = 0;
  let inZoneTime = 0;
  let cleared = false;
  let bumpFlash = 0;
  let pubAcc = 0;
  // Leader trajectory (Lissajous-like, deterministic).
  function leaderAt(t: number) {
    const cx = W / 2;
    const cy = H / 2;
    const x = cx + 220 * Math.sin(t * 0.6);
    const y = cy + 110 * Math.sin(t * 0.95 + 0.4);
    return { x, y };
  }

  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    cmd.lin = 0;
    cmd.ang = 0;
    particles.reset();
    trail.reset();
    elapsed = 0;
    inZoneTime = 0;
    cleared = false;
    bumpFlash = 0;
    pubAcc = 0;
    leader = leaderAt(0);
    leaderTheta = 0;
    g.ghost.startRecording();
    g.setStatus(t("follower.status.tip"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

    // Update leader pose along its predetermined trajectory.
    leader = leaderAt(elapsed);
    const next = leaderAt(elapsed + 0.05);
    leaderTheta = Math.atan2(next.y - leader.y, next.x - leader.x);

    const tw = teleop(g.keys, { baseLin: BASE_LIN, baseAng: BASE_ANG });
    cmd.lin = tw.lin;
    cmd.ang = tw.ang;

    const nx = robot.x + cmd.lin * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.lin * Math.sin(robot.theta) * dt;
    if (inWalls(walls, nx, ny, ROBOT_R)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.lin !== 0) {
      bumpFlash = 1;
      cleared = true;
      g.crash(t("follower.crash.wall"));
      return;
    }
    robot.theta += cmd.ang * dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    // Trail.
    trail.update(dt, robot.x, robot.y);
    // Distance / zone check.
    const dx = leader.x - robot.x;
    const dy = leader.y - robot.y;
    const dist = Math.hypot(dx, dy);
    const inZone = dist >= MIN_DIST && dist <= MAX_DIST;
    if (inZone) {
      inZoneTime += dt;
      if (Math.random() < 0.18) {
        particles.push({
          x: robot.x + (Math.random() - 0.5) * 26,
          y: robot.y + (Math.random() - 0.5) * 26,
          vx: (Math.random() - 0.5) * 50,
          vy: -Math.random() * 60 - 20,
          life: 0.4 + Math.random() * 0.3,
          age: 0,
          color: COLORS.OK,
          size: 1.5 + Math.random() * 1.5,
        });
      }
    }

    // Topic publish
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish(
        TOPIC_TARGET,
        `x=${leader.x.toFixed(0)} y=${leader.y.toFixed(0)} d=${dist.toFixed(0)}`,
      );
      g.publish(TOPIC_CMD, fmtTwist(cmd.lin / BASE_LIN, cmd.ang));
    }

    // Win
    if (inZoneTime >= REQUIRED_TIME) {
      cleared = true;
      particles.burst(robot.x, robot.y, COLORS.OK, 30);
      particles.burst(leader.x, leader.y, "#fbbf24", 24);
      g.shake(0.6);
      g.setStatus(t("follower.status.complete"), "var(--ok)");
      const stars = elapsed < 12 ? 3 : elapsed < 16 ? 2 : 1;
      const stats =
        `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
        `In-zone   <b>${inZoneTime.toFixed(2)} s / ${REQUIRED_TIME} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
      return;
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setStatus(
      inZone
        ? t("follower.status.following", { t: inZoneTime.toFixed(1), req: REQUIRED_TIME })
        : t("follower.status.outzone", { d: dist.toFixed(0) }),
      inZone ? "var(--ok)" : "var(--warn)",
    );

    g.setHud([
      `pose:      ${formatPose(robot)}`,
      `cmd_vel:   ${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: BASE_LIN })}`,
      `target:    x=${leader.x.toFixed(0)}  y=${leader.y.toFixed(0)}`,
      `dist:      ${dist.toFixed(0)} px  ${inZone ? "✓ in-zone" : "× out-of-zone"}`,
      `in_zone_t: ${inZoneTime.toFixed(2)} / ${REQUIRED_TIME} s`,
    ]);
  }

  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);
    drawGrid(ctx);

    // Walls
    for (const wall of walls) {
      ctx.fillStyle = "rgba(35, 44, 77, 0.75)";
      ctx.strokeStyle = "rgba(110, 122, 156, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Distance / zone
    const dx = leader.x - robot.x;
    const dy = leader.y - robot.y;
    const dist = Math.hypot(dx, dy);
    const inZone = dist >= MIN_DIST && dist <= MAX_DIST;
    const ringColor = inZone ? COLORS.OK : COLORS.WARN;

    // Annular fill of the follow zone.
    ctx.save();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = ringColor;
    ctx.beginPath();
    ctx.arc(leader.x, leader.y, MAX_DIST, 0, Math.PI * 2);
    ctx.arc(leader.x, leader.y, MIN_DIST, 0, Math.PI * 2, true);
    ctx.fill("evenodd");
    ctx.restore();

    // Inner and outer rings of the zone.
    ctx.save();
    ctx.strokeStyle = ringColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(leader.x, leader.y, MIN_DIST, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(leader.x, leader.y, MAX_DIST, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Trail
    trail.draw(ctx, 0.55);
    // Connector line between robot and leader.
    ctx.save();
    ctx.strokeStyle = ringColor;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.moveTo(robot.x, robot.y);
    ctx.lineTo(leader.x, leader.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Particles.
    particles.draw(ctx);

    // Ghost replay.
    g.ghost.draw(ctx, elapsed, elapsed);

    // Leader (blue pixel buddy).
    ctx.save();
    ctx.translate(leader.x, leader.y);
    ctx.rotate(leaderTheta);
    drawLeader(ctx, elapsed);
    ctx.restore();

    // Robot.
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, elapsed);
    drawRobotLabel(ctx);
    ctx.restore();

    // Progress bar.
    drawProgress(ctx, inZoneTime / REQUIRED_TIME, inZone);

    drawTimer(ctx, elapsed, g.getBestTime());
    drawHint(ctx, t("follower.hint"));
  }

  function drawLeader(ctx: CanvasRenderingContext2D, t: number) {
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    // Pulse aura (drawn behind so it sits below the body).
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.save();
    ctx.rotate(-leaderTheta);
    ctx.globalAlpha = 0.18 * pulse;
    ctx.strokeStyle = "#7dd3fc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 16 + pulse * 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(125, 211, 252, 0.85)";
    ctx.font = "700 7px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("LEADER", 0, -16);
    ctx.restore();

    // Breathing.
    const bob = Math.round(Math.sin(t * 1.6));
    ctx.save();
    ctx.translate(0, bob);

    // Silhouette outline via 4-direction shift.
    const sil = (color: string, dx = 0, dy = 0) => {
      const row = (y: number, halfW: number) => px(-halfW + dx, y + dy, halfW * 2 + 1, 1, color);
      row(-10, 6);
      row(-9, 8);
      row(-8, 9);
      for (let y = -7; y <= 7; y++) row(y, 10);
      row(8, 9);
      row(9, 8);
      row(10, 6);
    };
    sil("#0c4a6e", 0, -1);
    sil("#0c4a6e", 0, 1);
    sil("#0c4a6e", -1, 0);
    sil("#0c4a6e", 1, 0);
    sil("#7dd3fc");
    // Bottom-edge shadow.
    px(-9, 7, 19, 1, "#0c4a6e");

    // Eyes — navy, to match this robot's blue palette.
    px(2, -3, 2, 2, "#0c4a6e");
    px(2, 1, 2, 2, "#0c4a6e");
    px(3, -3, 1, 1, "#ffffff");
    px(3, 1, 1, 1, "#ffffff");
    // Forward dot.
    px(10, -1, 1, 3, "#fcd34d");

    ctx.restore();
  }

  function drawProgress(ctx: CanvasRenderingContext2D, frac: number, inZone: boolean) {
    const w = 220;
    const h = 6;
    const x = W / 2 - w / 2;
    const y = 22;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#0a0e1f";
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = inZone ? COLORS.OK : "rgba(94, 234, 212, 0.4)";
    ctx.fillRect(x, y, w * Math.min(1, frac), h);
    ctx.font = "600 9px ui-monospace, monospace";
    ctx.fillStyle = COLORS.FG_DIM;
    ctx.textAlign = "center";
    ctx.fillText(`FOLLOW PROGRESS  ${(frac * 100).toFixed(0)}%`, W / 2, y - 5);
  }

  function dispose() {
    /* nothing */
  }

  return {
    id: "follower",
    name: "Follower",
    lesson: "",
    lessonCmd: "ros2 topic echo /target/pose",
    ros2: {
      title: tx("Subscriber ・他ノードの情報で動く", "Subscriber — act on data from other nodes"),
      summary:
        "リーダーロボがブロードキャストする /target/pose を Subscribe し、" +
        "受信した PoseStamped と自分のポーズの差分から cmd_vel を計算します。" +
        "コールバック駆動の制御は、SLAM やナビゲーションでも全く同じ構造。",
      msgTypes: ["geometry_msgs/msg/PoseStamped", "geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic echo /target/pose",
        "ros2 topic hz /target/pose",
        "ros2 node info /follower",
      ],
      python: `import rclpy
from rclpy.node import Node
from geometry_msgs.msg import PoseStamped, Twist
import math

class Follower(Node):
    def __init__(self):
        super().__init__('follower')
        self.create_subscription(
            PoseStamped, '/target/pose', self.cb, 10)
        self.pub = self.create_publisher(Twist, '/cmd_vel', 10)

    def cb(self, msg: PoseStamped):
        # リーダー位置との距離・角度差から追従指令を生成
        dx = msg.pose.position.x - self.x
        dy = msg.pose.position.y - self.y
        dist = math.hypot(dx, dy)
        target_dist = 0.9  # 目標追従距離 [m]
        ...`,
      realWorld: tx(
        "実機では他ロボの /amcl_pose や /tf を Subscribe して 隊列走行 を実装する典型パターン。",
        "On real robots, this is the canonical pattern for convoy driving — subscribing to another robot's /amcl_pose or /tf.",
      ),
      state: {
        nodes: ["/follower", "/leader"],
        topics: [
          {
            name: "/target/pose",
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/leader"],
            sub: ["/follower"],
          },
          {
            name: "/robot/manual_control/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/follower"],
            sub: [],
          },
          { name: "/tf", type: "tf2_msgs/msg/TFMessage", pub: ["/leader", "/follower"], sub: [] },
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
  mode: "game",
  order: 2,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="leader publishes target pose, follower subscribes">
  <defs>
    <marker id="ld-follower-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="56" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">leader</text>
  <text x="82" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Publisher</text>
  <rect x="264" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="56" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">follower</text>
  <text x="338" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Subscriber</text>
  <line x1="156" y1="60" x2="262" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-follower-arrow)"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 158 60 L 258 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/target/pose</text>
  <text x="210" y="80" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">geometry_msgs/msg/Pose</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Subscriber 入門 — /target/pose を購読する",
      en: "Subscriber basics — reading /target/pose",
    },
    learn: {
      ja: "リーダーの位置は topic /target/pose で配信されています。Subscriber は topic を購読してそのデータに合わせて行動します。",
      en: "The leader's pose is published on the topic /target/pose. A Subscriber reads the topic and uses the data to decide how to act.",
    },
    goal: {
      ja: "WASD で動いて、青いリーダーロボの後ろをついていこう。\n近すぎず・遠すぎず (55〜130px) を一定時間キープすればクリア!",
      en: "Drive with WASD and tail the blue leader robot.\nStay in the sweet spot (55–130 px) long enough and you clear!",
    },
    first: {
      ja: "WASD でリーダーを追いかけ、近づきすぎず離れすぎない距離を保ちましょう。",
      en: "Use WASD to chase the leader, keeping a comfortable distance — not too close, not too far.",
    },
  },
  strings: {
    ja: {
      "crash.wall": "壁に衝突",
      hint: "WASD で青いリーダーを 55–130 px で追走 / R リスタート",
      "status.complete": "FOLLOW COMPLETE",
      "status.following": "追従中 — {t}s / {req}s",
      "status.outzone": "範囲外 ({d} px)",
      "status.tip": "青いリーダーを 55–130 px の距離でキープせよ",
    },
    en: {
      "crash.wall": "Crashed into wall",
      hint: "WASD to follow blue leader at 55–130 px / R to restart",
      "status.complete": "FOLLOW COMPLETE",
      "status.following": "following — {t}s / {req}s",
      "status.outzone": "out of zone ({d} px)",
      "status.tip": "Keep distance 55–130 px from the blue leader",
    },
  },
  build: makeFollower,
});
