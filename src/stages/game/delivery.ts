// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// delivery: Delivery — warehouse pickup-and-deliver mission (walls only, no enemies).
import { W, H, type Stage, type GameContext } from "../../types";
import {
  drawGrid,
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { Trail } from "../../lib/trail";
import { formatPose, formatTwist, formatSeconds } from "../../lib/hud";
import { canMoveTo as inWalls } from "../../lib/walls";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { t, tx } from "../../i18n";
import { defineStage } from "../../core/stage_def";

const ROBOT_R = 16;
const BASE_LIN = 200;
const BASE_ANG = 2.5;
const TOPIC = "/robot/manual_control/cmd_vel";

const walls = [
  { x: 200, y: 100, w: 100, h: 80 },
  { x: 480, y: 80, w: 80, h: 120 },
  { x: 320, y: 280, w: 160, h: 60 },
  { x: 120, y: 350, w: 100, h: 80 },
  { x: 580, y: 320, w: 80, h: 100 },
];
const PICKUP = { x: 80, y: 80, r: 26 };
const DELIVERY = { x: 720, y: 440, r: 26 };
const START = { x: 400, y: 250, theta: 0 };

export function makeDelivery(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const cmd = { lin: 0, ang: 0 };
  const trail = new Trail({ max: 80 });
  const particles = new Particles();
  let mission: "idle" | "carrying" | "delivered" = "idle";
  let elapsed = 0;
  let cleared = false;
  let animTime = 0;
  let pubAcc = 0;
  let bumpFlash = 0;

  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    cmd.lin = 0;
    cmd.ang = 0;
    trail.reset();
    particles.reset();
    mission = "idle";
    elapsed = 0;
    cleared = false;
    bumpFlash = 0;
    g.ghost.startRecording();
    g.setStatus(t("delivery.status.pickup"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }

  function update(dt: number) {
    animTime += dt;
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

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
      g.crash(t("delivery.crash.wall"));
      return;
    }
    robot.theta += cmd.ang * dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    trail.update(dt, robot.x, robot.y);
    pubAcc += dt;
    if (pubAcc > 1 / 20) {
      pubAcc = 0;
      g.publish(TOPIC, fmtTwist(cmd.lin / BASE_LIN, cmd.ang));
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
    checkMission();

    g.setHud([
      `mission:   ${mission}`,
      `pose:      ${formatPose(robot)}`,
      `cmd_vel:   ${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: BASE_LIN })}`,
      `elapsed:   ${formatSeconds(elapsed, 1)}`,
    ]);
  }

  function checkMission() {
    if (mission === "idle") {
      const dx = robot.x - PICKUP.x;
      const dy = robot.y - PICKUP.y;
      if (dx * dx + dy * dy < PICKUP.r * PICKUP.r) {
        mission = "carrying";
        particles.burst(PICKUP.x, PICKUP.y, "#5eead4", 32, 240);
        g.sfx.pickup();
        g.shake(0.3);
        g.setStatus(t("delivery.status.deliver"), "var(--accent)");
      }
    } else if (mission === "carrying") {
      const dx = robot.x - DELIVERY.x;
      const dy = robot.y - DELIVERY.y;
      if (dx * dx + dy * dy < DELIVERY.r * DELIVERY.r) {
        mission = "delivered";
        cleared = true;
        particles.burst(DELIVERY.x, DELIVERY.y, "#7dd3fc", 36);
        particles.burst(DELIVERY.x, DELIVERY.y, "#fbbf24", 24);
        g.sfx.deliver();
        g.shake(0.6);
        g.setStatus(t("delivery.status.complete"), "var(--ok)");
        const stars = elapsed < 25 ? 3 : elapsed < 45 ? 2 : 1;
        const stats =
          `Time      <b>${elapsed.toFixed(2)} s</b><br>` + `Distance  <b>${trail.length}</b> nodes`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 800);
      }
    }
  }

  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);

    const vg = ctx.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 600);
    vg.addColorStop(0, "rgba(125, 211, 252, 0.04)");
    vg.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    drawGrid(ctx);

    for (const wall of walls) {
      ctx.fillStyle = "rgba(35, 44, 77, 0.75)";
      ctx.strokeStyle = "rgba(110, 122, 156, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      ctx.fill();
      ctx.stroke();
    }

    if (mission === "idle") drawZone(ctx, PICKUP, "#5eead4", "PICKUP", animTime);
    if (mission === "carrying") drawZone(ctx, DELIVERY, "#7dd3fc", "DELIVER", animTime);

    trail.draw(ctx, 0.55);
    particles.draw(ctx);

    // Ghost replay.
    g.ghost.draw(ctx, elapsed, animTime);

    // Robot.
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, animTime);
    if (mission === "carrying") {
      ctx.rotate(-robot.theta);
      ctx.fillStyle = "#fbbf24";
      ctx.strokeStyle = "#d97706";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(-9, -29, 18, 12, 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#7c4a03";
      ctx.font = "600 7px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("PKG", 0, -21);
      ctx.rotate(robot.theta);
    }
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();

    drawTimer(ctx, elapsed, g.getBestTime());
    if (g.ghost.hasReplay()) drawGhostBadge(ctx);
    drawHint(ctx, t("delivery.hint"));
  }

  function drawGhostBadge(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = "rgba(196, 181, 253, 0.18)";
    ctx.strokeStyle = "rgba(196, 181, 253, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(12, 12, 96, 22, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("vs GHOST", 22, 23);
    ctx.beginPath();
    ctx.arc(95, 23, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function dispose() {
    /* nothing */
  }

  return {
    id: "delivery",
    name: "Delivery",
    lesson: "",
    lessonCmd: "ros2 topic echo /cmd_vel",
    ros2: defineRos2Concept({
      title: tx("Publisher ・トピックでロボを動かす", "Publisher — drive the robot via a topic"),
      summary:
        "WASD のキー入力が geometry_msgs/msg/Twist に変換され、/cmd_vel トピックに publish されます。" +
        "ROS2 は「ノードがトピックでメッセージを送り合う」ことが基本。これは最も基礎の Pub-Sub。",
      msgTypes: ["geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic list",
        "ros2 topic info /robot/manual_control/cmd_vel",
        "ros2 topic echo /robot/manual_control/cmd_vel",
        'ros2 topic pub --once /cmd_vel geometry_msgs/msg/Twist \\\n  "{linear: {x: 0.3}, angular: {z: 0.0}}"',
      ],
      python: `import rclpy
from rclpy.node import Node
from geometry_msgs.msg import Twist

class Teleop(Node):
    def __init__(self):
        super().__init__('teleop')
        self.pub = self.create_publisher(Twist, '/cmd_vel', 10)

    def send(self, lin: float, ang: float):
        msg = Twist()
        msg.linear.x = lin   # forward speed [m/s]
        msg.angular.z = ang  # angular velocity [rad/s]
        self.pub.publish(msg)`,
      realWorld: tx(
        "実機では、base controller が起動し、topic 名・型・安全条件が合っているときに /cmd_vel の指令が走行へ反映されます。操作前に周囲と非常停止手段を確認してください。",
        "On a physical robot, /cmd_vel commands affect motion only when the base controller is active and the topic, type, and safety conditions match. Check the surroundings and emergency-stop method before operation.",
      ),
      state: state({
        nodes: ["/robot_node", "/teleop"],
        topics: [
          topic("/robot/manual_control/cmd_vel", "geometry_msgs/msg/Twist", {
            pub: ["/teleop"],
            sub: ["/robot_node"],
          }),
          topic("/robot/odom", "nav_msgs/msg/Odometry", { pub: ["/robot_node"] }),
          topic("/robot/pose", "geometry_msgs/msg/PoseStamped", { pub: ["/robot_node"] }),
        ],
      }),
    }),
    init,
    update,
    draw,
    reset,
    dispose,
  };
}

export default defineStage({
  mode: "game",
  order: 1,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="WASD publisher to robot subscriber via /cmd_vel">
  <defs>
    <marker id="ld-delivery-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="56" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">teleop_node</text>
  <text x="82" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">WASD → Publisher</text>
  <rect x="264" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="56" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot</text>
  <text x="338" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Subscriber</text>
  <line x1="156" y1="60" x2="262" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-delivery-arrow)"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 158 60 L 258 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/cmd_vel</text>
  <text x="210" y="80" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">geometry_msgs/msg/Twist</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Publisher 入門 — /cmd_vel を発行する",
      en: "Publisher basics — publishing /cmd_vel",
    },
    learn: {
      ja: "キー入力を topic /cmd_vel に publish すると、購読しているロボットが動きます。これが ROS2 の Publisher の役割です。",
      en: "Your key presses are published to the topic /cmd_vel; a subscribing robot reads them and moves. This is exactly what a ROS2 Publisher does.",
    },
    goal: {
      ja: "WASD でロボを動かそう。まず 緑の◯ でパッケージを拾い、青の◯ まで運んだらクリア!\n壁に当たるとやり直しになります。",
      en: "Drive the robot with WASD. Pick up the package at the green ring, then deliver it to the blue ring to clear!\nHitting a wall = retry.",
    },
    first: {
      ja: "WASD（またはパッドの左スティック）でロボを動かして緑のリングへ向かいましょう。",
      en: "Use WASD (or the left stick on a pad) to drive the robot to the green ring.",
    },
  },
  strings: {
    ja: {
      "status.pickup": "緑のリングまで移動してパッケージをピックアップ",
      "status.deliver": "青のリングまでパッケージを配達せよ",
      "status.complete": "DELIVERY COMPLETE",
      "crash.wall": "壁に衝突",
      hint: "WASD 移動 / 壁 = 失敗 / R リスタート",
    },
    en: {
      "status.pickup": "Drive to the green ring to pick up the package",
      "status.deliver": "Deliver the package to the blue ring",
      "status.complete": "DELIVERY COMPLETE",
      "crash.wall": "Crashed into wall",
      hint: "WASD to move / walls = fail / R to restart",
    },
  },
  build: makeDelivery,
});
