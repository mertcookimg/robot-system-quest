// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// battery_rush: Battery Rush — 75-second delivery score attack. The battery
// drains as you drive; dock at the charging pad before it hits 0%.
// Teaches sensor_msgs/BatteryState monitoring + auto-docking behavior.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import {
  drawGrid,
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawHint,
  fmtTwist,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { Trail } from "../../lib/trail";
import { formatPose, formatTwist } from "../../lib/hud";
import { canMoveTo as inWalls } from "../../lib/walls";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { t, tx } from "../../i18n";
import { defineStage } from "../../core/stage_def";

const PX_PER_M = 100;
const ROBOT_R = 16;
const BASE_LIN = 200;
const BASE_ANG = 2.8;
const BOOST_MULT = 1.6;
const TOTAL_TIME = 75; // score-attack length [s]
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_BATT = "/robot/battery_state";

// Battery model [% per second].
const DRAIN_IDLE = 1.5;
const DRAIN_MOVE = 4.5;
const DRAIN_BOOST = 8;
const CHARGE_RATE = 30;
const WALL_HIT_COST = 2;
const LOW_BATT = 25;
const LIMP_BATT = 15; // below this the motors limp at 60% speed

const walls = [
  { x: 240, y: 150, w: 24, h: 200 },
  { x: 480, y: 0, w: 24, h: 180 },
  { x: 480, y: 320, w: 24, h: 180 },
  { x: 620, y: 200, w: 130, h: 24 },
];
const PICKUP = { x: 80, y: 100, r: 26 };
const DOCK = { x: 80, y: 430, r: 30 };
const SPOTS = [
  { x: 720, y: 60, r: 26 },
  { x: 720, y: 440, r: 26 },
  { x: 560, y: 250, r: 26 },
  { x: 330, y: 460, r: 26 },
];
const START = { x: 200, y: 250, theta: 0 };

export function makeBatteryRush(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const cmd = { lin: 0, ang: 0 };
  const trail = new Trail({ max: 80 });
  const particles = new Particles();
  let carrying = false;
  let spotIdx = 0;
  let battery = 100;
  let charging = false;
  let lowWarned = false;
  let score = 0;
  let remaining = TOTAL_TIME;
  let cleared = false;
  let animTime = 0;
  let pubAcc = 0;
  let battAcc = 0;
  let bumpCd = 0;
  let bumpFlash = 0;

  function pickNextSpot() {
    let next = spotIdx;
    while (next === spotIdx) next = Math.floor(Math.random() * SPOTS.length);
    spotIdx = next;
  }

  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    cmd.lin = 0;
    cmd.ang = 0;
    trail.reset();
    particles.reset();
    carrying = false;
    spotIdx = Math.floor(Math.random() * SPOTS.length);
    battery = 100;
    charging = false;
    lowWarned = false;
    score = 0;
    remaining = TOTAL_TIME;
    cleared = false;
    bumpCd = 0;
    bumpFlash = 0;
    g.ghost.startRecording();
    g.setStatus(t("battery_rush.status.pickup"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }

  function finish() {
    cleared = true;
    particles.burst(robot.x, robot.y, "#7dd3fc", 30);
    g.setStatus(t("battery_rush.status.timeup"), "var(--ok)");
    const stars = score >= 6 ? 3 : score >= 4 ? 2 : 1;
    const stats =
      `Deliveries <b>${score}</b><br>` + `Battery    <b>${Math.round(battery)} %</b> left`;
    g.awardStars(stars, stats);
  }

  function update(dt: number) {
    animTime += dt;
    particles.update(dt);
    if (bumpCd > 0) bumpCd -= dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);
    if (cleared) return;

    remaining -= dt;
    if (remaining <= 0) {
      remaining = 0;
      finish();
      return;
    }

    // --- Teleop with boost; a drained pack limps.
    const boosting = g.keys.has("shift") && battery > 0;
    const limp = battery < LIMP_BATT ? 0.6 : 1;
    const tw = teleop(g.keys, { baseLin: BASE_LIN, baseAng: BASE_ANG });
    cmd.lin = tw.lin * (boosting && tw.lin > 0 ? BOOST_MULT : 1) * limp;
    cmd.ang = tw.ang;

    // --- Battery drain / charge.
    const moving = cmd.lin !== 0 || cmd.ang !== 0;
    charging = Math.hypot(robot.x - DOCK.x, robot.y - DOCK.y) < DOCK.r;
    let rate = -DRAIN_IDLE - (moving ? DRAIN_MOVE : 0) - (boosting && moving ? DRAIN_BOOST : 0);
    if (charging) rate += CHARGE_RATE;
    battery = Math.max(0, Math.min(100, battery + rate * dt));
    if (battery <= 0) {
      cleared = true;
      g.crash(t("battery_rush.crash.empty"));
      return;
    }
    if (battery < LOW_BATT && !lowWarned) {
      lowWarned = true;
      g.sfx.bump();
      g.setStatus(t("battery_rush.status.low"), "var(--danger)");
    }
    if (battery > LOW_BATT + 15) lowWarned = false;

    // --- Movement with wall sliding; hitting a wall costs battery.
    robot.theta += cmd.ang * dt;
    const nx = robot.x + cmd.lin * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.lin * Math.sin(robot.theta) * dt;
    if (inWalls(walls, nx, ny, ROBOT_R)) {
      robot.x = nx;
      robot.y = ny;
    } else if (inWalls(walls, nx, robot.y, ROBOT_R)) {
      robot.x = nx;
      hitWall();
    } else if (inWalls(walls, robot.x, ny, ROBOT_R)) {
      robot.y = ny;
      hitWall();
    } else if (cmd.lin !== 0) {
      hitWall();
    }

    trail.update(dt, robot.x, robot.y);

    // --- Mission: pickup → deliver → repeat.
    if (!carrying) {
      if (Math.hypot(robot.x - PICKUP.x, robot.y - PICKUP.y) < PICKUP.r) {
        carrying = true;
        particles.burst(PICKUP.x, PICKUP.y, "#5eead4", 24, 220);
        g.sfx.pickup();
        g.setStatus(t("battery_rush.status.deliver"), "var(--accent)");
      }
    } else {
      const spot = SPOTS[spotIdx];
      if (Math.hypot(robot.x - spot.x, robot.y - spot.y) < spot.r) {
        carrying = false;
        score++;
        particles.burst(spot.x, spot.y, "#7dd3fc", 30);
        particles.burst(spot.x, spot.y, "#fbbf24", 18);
        g.sfx.deliver();
        g.shake(0.4);
        pickNextSpot();
        g.setStatus(t("battery_rush.status.pickup"), "var(--ok)");
      }
    }

    // --- Topics.
    pubAcc += dt;
    if (pubAcc > 1 / 20) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(cmd.lin / PX_PER_M, cmd.ang));
    }
    battAcc += dt;
    if (battAcc > 1 / 2) {
      battAcc = 0;
      const pct = battery / 100;
      const volt = 9.6 + 3 * pct;
      g.publish(
        TOPIC_BATT,
        `sensor_msgs/BatteryState percentage:${pct.toFixed(2)} voltage:${volt.toFixed(1)}V` +
          (charging ? " (charging)" : ""),
      );
    }

    g.ghost.recordPose(TOTAL_TIME - remaining, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:      battery rush`,
      `score:     ${score} deliveries`,
      `battery:   ${battery.toFixed(0)} %${charging ? "  (charging)" : battery < LOW_BATT ? "  !! LOW" : ""}`,
      `mission:   ${carrying ? "deliver" : "pickup"}`,
      `pose:      ${formatPose(robot, { pxPerM: PX_PER_M })}`,
      `cmd_vel:   ${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: PX_PER_M })}`,
    ]);
  }

  function hitWall() {
    if (bumpCd > 0) return;
    bumpCd = 0.5;
    bumpFlash = 0.6;
    battery = Math.max(0, battery - WALL_HIT_COST);
    particles.burst(robot.x, robot.y, "#fb7185", 10, 160);
    g.sfx.bump();
    g.shake(0.2);
  }

  function drawDock(c: CanvasRenderingContext2D) {
    c.save();
    const pulse = charging ? 0.6 + 0.4 * Math.abs(Math.sin(animTime * 6)) : 0.5;
    c.strokeStyle = `rgba(251, 191, 36, ${pulse})`;
    c.lineWidth = charging ? 2.5 : 1.5;
    c.beginPath();
    c.arc(DOCK.x, DOCK.y, DOCK.r, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = "rgba(251, 191, 36, 0.10)";
    c.beginPath();
    c.arc(DOCK.x, DOCK.y, DOCK.r * 0.85, 0, Math.PI * 2);
    c.fill();
    // Lightning bolt.
    c.fillStyle = "#fbbf24";
    c.beginPath();
    c.moveTo(DOCK.x + 3, DOCK.y - 12);
    c.lineTo(DOCK.x - 6, DOCK.y + 2);
    c.lineTo(DOCK.x - 1, DOCK.y + 2);
    c.lineTo(DOCK.x - 3, DOCK.y + 12);
    c.lineTo(DOCK.x + 6, DOCK.y - 2);
    c.lineTo(DOCK.x + 1, DOCK.y - 2);
    c.closePath();
    c.fill();
    c.font = "600 10px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillStyle = "#fbbf24";
    c.fillText(charging ? "CHARGING" : "DOCK", DOCK.x, DOCK.y - DOCK.r - 10);
    c.restore();
  }

  function drawBatteryBar(c: CanvasRenderingContext2D) {
    const x = 12,
      y = 12,
      w = 132,
      h = 40;
    c.save();
    c.fillStyle = withA(theme.scrim, 0.85);
    c.strokeStyle = "rgba(125, 211, 252, 0.3)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x, y, w, h, 6);
    c.fill();
    c.stroke();
    // Battery outline + fill.
    const bx = x + 10,
      by = y + 8,
      bw = 74,
      bh = 12;
    c.strokeStyle = "#9aa6c8";
    c.strokeRect(bx, by, bw, bh);
    c.fillStyle = "#9aa6c8";
    c.fillRect(bx + bw, by + 3, 3, bh - 6);
    const color = battery > 50 ? COLORS.OK : battery > LOW_BATT ? COLORS.WARN : COLORS.DANGER;
    const blink = battery <= LOW_BATT && Math.sin(animTime * 8) > 0;
    c.fillStyle = blink ? "rgba(251, 113, 133, 0.35)" : color;
    c.fillRect(bx + 1, by + 1, ((bw - 2) * battery) / 100, bh - 2);
    c.fillStyle = color;
    c.font = "600 11px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(`${battery.toFixed(0)}%`, bx + bw + 10, by + bh / 2);
    // Score line.
    c.fillStyle = COLORS.ACCENT;
    c.font = "600 10px ui-monospace, monospace";
    c.fillText(`SCORE ${score}`, bx, y + 32);
    c.restore();
  }

  function drawClock(c: CanvasRenderingContext2D) {
    const w = 110,
      h = 26,
      x = W - w - 12,
      y = 12;
    const danger = remaining < 15;
    c.save();
    c.fillStyle = withA(theme.scrim, 0.85);
    c.strokeStyle = danger ? "rgba(251, 113, 133, 0.6)" : "rgba(125, 211, 252, 0.3)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x, y, w, h, 6);
    c.fill();
    c.stroke();
    c.fillStyle = danger ? COLORS.DANGER : COLORS.ACCENT;
    c.font = "600 12px ui-monospace, monospace";
    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillText(`${remaining.toFixed(1)}s`, x + w - 10, y + h / 2);
    c.fillStyle = COLORS.FG_DIM;
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("LEFT", x + 10, y + h / 2 + 1);
    c.restore();
  }

  function drawTargetArrow(c: CanvasRenderingContext2D) {
    const target = carrying ? SPOTS[spotIdx] : battery < LOW_BATT ? DOCK : PICKUP;
    const a = Math.atan2(target.y - robot.y, target.x - robot.x);
    const d = Math.hypot(target.x - robot.x, target.y - robot.y);
    if (d < 60) return;
    c.save();
    c.translate(robot.x + Math.cos(a) * 32, robot.y + Math.sin(a) * 32);
    c.rotate(a);
    c.globalAlpha = 0.55 + 0.25 * Math.sin(animTime * 5);
    c.fillStyle = carrying ? "#7dd3fc" : battery < LOW_BATT ? "#fbbf24" : "#5eead4";
    c.beginPath();
    c.moveTo(0, -5);
    c.lineTo(9, 0);
    c.lineTo(0, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    const vg = c.createRadialGradient(W / 2, H / 2, 100, W / 2, H / 2, 600);
    vg.addColorStop(0, "rgba(125, 211, 252, 0.04)");
    vg.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    drawGrid(c);

    for (const wall of walls) {
      c.fillStyle = "rgba(35, 44, 77, 0.75)";
      c.strokeStyle = "rgba(110, 122, 156, 0.5)";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      c.fill();
      c.stroke();
    }

    drawDock(c);
    if (!carrying) drawZone(c, PICKUP, "#5eead4", "PICKUP", animTime);
    else drawZone(c, SPOTS[spotIdx], "#7dd3fc", "DELIVER", animTime);

    trail.draw(c, 0.55);
    particles.draw(c);
    g.ghost.draw(c, TOTAL_TIME - remaining, animTime);

    drawTargetArrow(c);

    // Robot (+ package while carrying).
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, animTime);
    if (carrying) {
      c.rotate(-robot.theta);
      c.fillStyle = "#fbbf24";
      c.strokeStyle = "#d97706";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(-9, -29, 18, 12, 2);
      c.fill();
      c.stroke();
      c.fillStyle = "#7c4a03";
      c.font = "600 7px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText("PKG", 0, -21);
      c.rotate(robot.theta);
    }
    c.rotate(-robot.theta);
    drawRobotLabel(c);
    c.restore();

    // Low-battery red vignette.
    if (battery < LOW_BATT && !cleared) {
      const a = 0.1 + 0.08 * Math.abs(Math.sin(animTime * 4));
      const rg = c.createRadialGradient(W / 2, H / 2, 200, W / 2, H / 2, 520);
      rg.addColorStop(0, "rgba(251, 113, 133, 0)");
      rg.addColorStop(1, `rgba(251, 113, 133, ${a})`);
      c.fillStyle = rg;
      c.fillRect(0, 0, W, H);
    }

    drawBatteryBar(c);
    drawClock(c);
    drawHint(c, t("battery_rush.hint"));
  }

  function dispose() {
    /* nothing */
  }

  return {
    id: "battery_rush",
    name: "Battery Rush",
    lesson: "",
    lessonCmd: "ros2 topic echo /robot/battery_state",
    ros2: defineRos2Concept({
      title: tx(
        "BatteryState ・電池残量を監視して自動充電",
        "BatteryState — monitor the pack and auto-dock",
      ),
      summary:
        "実ロボットは sensor_msgs/BatteryState を /battery_state に publish し続けます。" +
        "監視ノードが残量低下を検知したら充電ドックへ向かわせる — お掃除ロボの帰巣と同じ仕組み。" +
        "「動くほど減る・ぶつかると減る・ドックで回復」を体で覚えるステージです。",
      msgTypes: ["sensor_msgs/msg/BatteryState", "geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic echo /robot/battery_state",
        "ros2 topic hz /robot/battery_state",
        "ros2 interface show sensor_msgs/msg/BatteryState",
      ],
      python: `import rclpy
from rclpy.node import Node
from sensor_msgs.msg import BatteryState

LOW = 0.25  # 25%

class BatteryMonitor(Node):
    def __init__(self):
        super().__init__('battery_monitor')
        self.create_subscription(
            BatteryState, '/robot/battery_state', self.on_batt, 10)
        self.warned = False

    def on_batt(self, msg: BatteryState):
        if msg.percentage < LOW and not self.warned:
            self.warned = True
            self.get_logger().warn(
                f'battery {msg.percentage:.0%} — go dock!')
            # ここで Nav2 に「ドックへ移動」ゴールを送るのが実運用
        elif msg.percentage > LOW + 0.15:
            self.warned = False`,
      realWorld: tx(
        "ルンバの帰巣も Nav2 の docking behavior も原理は同じ。/battery_state を監視して閾値を切ったら充電ステーションへの navigation ゴールを投げます。",
        "A Roomba returning to base and Nav2's docking behavior work the same way: watch /battery_state and, below a threshold, send a navigation goal to the charging station.",
      ),
      state: state({
        nodes: ["/robot_node", "/battery_monitor", "/teleop"],
        topics: [
          topic("/robot/manual_control/cmd_vel", "geometry_msgs/msg/Twist", {
            pub: ["/teleop"],
            sub: ["/robot_node"],
          }),
          topic("/robot/battery_state", "sensor_msgs/msg/BatteryState", {
            pub: ["/robot_node"],
            sub: ["/battery_monitor"],
          }),
          topic("/robot/odom", "nav_msgs/msg/Odometry", { pub: ["/robot_node"] }),
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
  order: 10,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="robot publishes battery state, monitor node triggers docking below 25 percent">
  <defs>
    <marker id="ld-batt-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="140" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="78" y="52" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot_node</text>
  <text x="78" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">battery sensor</text>
  <rect x="272" y="26" width="140" height="68" rx="8" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="342" y="48" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">battery_monitor</text>
  <text x="342" y="66" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">&lt; 25% ?</text>
  <text x="342" y="84" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9">→ go to DOCK ⚡</text>
  <line x1="148" y1="60" x2="270" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-batt-arrow)"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 150 60 L 266 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/battery_state</text>
  <text x="210" y="80" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">sensor_msgs/BatteryState</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "BatteryState — 電池を監視しながら配達スコアアタック",
      en: "BatteryState — a delivery score attack on battery power",
    },
    learn: {
      ja: "実ロボは /battery_state (sensor_msgs/BatteryState) で残量を publish し続け、監視ノードが低下を検知したら充電ドックへ向かいます。HUD のバッテリー % はこのトピックの中身です。",
      en: "Real robots keep publishing /battery_state (sensor_msgs/BatteryState); a monitor node sends them to the dock when it drops. The battery % in the HUD is exactly that topic.",
    },
    goal: {
      ja: "75秒間でできるだけ多く配達しよう (6件で ★3)。移動・ブースト・壁ヒットで電池が減り、0% で故障 = ゲームオーバー。⚡ドックに乗ると急速充電!",
      en: "Deliver as many packages as you can in 75 seconds (6 = ★3). Driving, boosting and wall hits drain the pack; 0% = breakdown. Park on the ⚡ dock to fast-charge!",
    },
    first: {
      ja: "まず緑の PICKUP へ。荷物を持ったら矢印の先の DELIVER リングへ運ぼう。残量 25% を切ったら欲張らずにドックへ!",
      en: "Head to the green PICKUP ring first, then follow the arrow to the DELIVER ring. Below 25%, stop being greedy and go dock!",
    },
  },
  strings: {
    ja: {
      "status.pickup": "緑のリングで荷物をピックアップ",
      "status.deliver": "矢印の先のリングへ配達せよ",
      "status.low": "バッテリー残量低下! ⚡ドックで充電せよ",
      "status.timeup": "TIME UP! おつかれさま",
      "crash.empty": "バッテリー切れ — 25%を切ったら充電ドックへ",
      hint: "WASD 移動 / Shift・LB/RB ブースト(電池消費大) / ⚡ドックで充電 / R リスタート",
    },
    en: {
      "status.pickup": "Pick up a package at the green ring",
      "status.deliver": "Deliver it to the ring the arrow points at",
      "status.low": "Battery low! Recharge at the ⚡ dock",
      "status.timeup": "TIME UP! Nice run",
      "crash.empty": "Battery dead — dock and recharge below 25%",
      hint: "WASD move / Shift・LB/RB boost (drains fast) / recharge at ⚡ dock / R restart",
    },
  },
  build: makeBatteryRush,
});
