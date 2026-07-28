// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// lidar_avoidance: LiDAR Avoidance
// Faithful re-implementation of robot_ros2_lecture / robot_lidar_control.py.
// Subscribe to /scan, compute min distance in front/right/left sectors,
// and reactively switch between forward / turn-left / turn-right / stop
// based on a distance threshold.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

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
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_SCAN = "/robot/lidar/scan";

const FRONT_HALF = (15 * Math.PI) / 180; // ±15°
const N_RAYS = 90;
const MAX_RANGE_M = 4.0; // LaserScan range_max [m]
const SCAN_HZ = 10; // matches the lecture (timer = 0.1)

const START = { x: 80, y: 250, theta: 0 };
const GOAL = { x: 720, y: 250, r: 30 };

const walls = [
  // Outer perimeter.
  { x: 0, y: 0, w: W, h: 6 },
  { x: 0, y: H - 6, w: W, h: 6 },
  { x: 0, y: 0, w: 6, h: H },
  { x: W - 6, y: 0, w: 6, h: H },
  // Inner obstacles in a staggered pattern.
  { x: 220, y: 120, w: 22, h: 220 },
  { x: 380, y: 180, w: 22, h: 240 },
  { x: 540, y: 60, w: 22, h: 260 },
];

type Block = {
  kind: "lidar_avoid";
  threshold: number; // m
  fwd_speed: number; // m/s
  turn_speed: number; // rad/s
};

interface SectorMin {
  front: number;
  right: number;
  left: number;
}

export function makeLidarAvoidance(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 400 });
  let program: Block[] = [];
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let scanAcc = 0;
  let bumpFlash = 0;
  let runCount = 0;
  let cleared = false;

  // Most recent scan sample (for rendering).
  let scanHits: { angle: number; dist: number; sector: "front" | "right" | "left" }[] = [];
  let lastSector: SectorMin = { front: MAX_RANGE_M, right: MAX_RANGE_M, left: MAX_RANGE_M };
  let lastV = 0;
  let lastW = 0;

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
    pubAcc = 0;
    scanAcc = 0;
    bumpFlash = 0;
    isRunning = false;
    cleared = false;
    scanHits = [];
    lastSector = { front: MAX_RANGE_M, right: MAX_RANGE_M, left: MAX_RANGE_M };
    lastV = 0;
    lastW = 0;
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("lidar_avoidance.tip"), "");
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    if (program.length === 0 && runCount === 0) {
      program.push({ kind: "lidar_avoid", threshold: 1.0, fwd_speed: 0.2, turn_speed: 0.5 });
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("lidar_avoidance.palette_hint"),
      blockKinds: [
        {
          kind: "lidar_avoid",
          label: "lidar_avoid",
          args: "threshold, fwd_speed, turn_speed",
          defaults: () => ({
            kind: "lidar_avoid",
            threshold: 1.0,
            fwd_speed: 0.2,
            turn_speed: 0.5,
          }),
          params: (b) => [
            { key: "threshold", value: b.threshold, step: 0.1, unit: "m" },
            { key: "fwd_speed", value: b.fwd_speed, step: 0.05, unit: "m/s" },
            { key: "turn_speed", value: b.turn_speed, step: 0.1, unit: "rad/s" },
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
    isRunning = true;
    setStatusBadge("running", "running");
    g.sfx.click();
    g.setStatus(t("lidar_avoidance.running"), "");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    lastV = 0;
    lastW = 0;
    setStatusBadge("stopped", "");
    g.setStatus(t("lidar_avoidance.stop"), "var(--warn)");
    refreshProgramUI();
  }

  function reachGoal() {
    isRunning = false;
    cleared = true;
    setStatusBadge("success", "success");
    g.shake(0.5);
    particles.burst(robot.x, robot.y, COLORS.OK, 36);
    const stats =
      `Time   <b>${elapsed.toFixed(2)} s</b><br>` +
      `threshold <b>${program[0].threshold.toFixed(2)} m</b>`;
    g.setTimeout(() => {
      g.sfx.clear();
      g.showClear(3, stats);
    }, 500);
    refreshProgramUI();
  }

  // -- Collision (circle vs rectangular wall).
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

  // -- Raycast (distance in pixels to the nearest wall along a heading).
  function raycast(ox: number, oy: number, dir: number): number {
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    const step = 3;
    const maxPx = MAX_RANGE_M * PX_PER_M;
    for (let d = 0; d < maxPx; d += step) {
      const x = ox + dx * d;
      const y = oy + dy * d;
      // Canvas edge.
      if (x < 0 || x > W || y < 0 || y > H) return d;
      // Wall.
      for (const wall of walls) {
        if (x >= wall.x && x <= wall.x + wall.w && y >= wall.y && y <= wall.y + wall.h) {
          return d;
        }
      }
    }
    return maxPx;
  }

  // -- Same logic as robot_lidar_control's callback_scan + process().
  function processLidar(b: Block): { v: number; w: number; sec: SectorMin } {
    let front_min = MAX_RANGE_M;
    let right_min = MAX_RANGE_M;
    let left_min = MAX_RANGE_M;
    scanHits = [];

    for (let i = 0; i < N_RAYS; i++) {
      // Robot-relative angle α (canvas convention).
      const alpha = (i / N_RAYS) * Math.PI * 2 - Math.PI; // -π..+π
      const distPx = raycast(robot.x, robot.y, robot.theta + alpha);
      const distM = distPx / PX_PER_M;

      let sector: "front" | "right" | "left";
      if (Math.abs(alpha) <= FRONT_HALF) {
        if (distM < front_min) front_min = distM;
        sector = "front";
      } else if (alpha > FRONT_HALF) {
        // In canvas coords α>0 corresponds to visually-right.
        if (distM < right_min) right_min = distM;
        sector = "right";
      } else {
        if (distM < left_min) left_min = distM;
        sector = "left";
      }
      scanHits.push({ angle: alpha, dist: distPx, sector });
    }

    // === Control law from the lecture ===
    let v = 0,
      w = 0;
    if (front_min > b.threshold) {
      v = b.fwd_speed * PX_PER_M;
      w = 0;
    } else if (right_min < b.threshold) {
      // Obstacle on the right → turn left visually (w<0 in canvas).
      v = 0;
      w = -b.turn_speed;
    } else if (left_min < b.threshold) {
      // Obstacle on the left → turn right visually (w>0 in canvas).
      v = 0;
      w = b.turn_speed;
    } else {
      v = 0;
      w = 0;
    }

    return { v, w, sec: { front: front_min, right: right_min, left: left_min } };
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (!isRunning) {
      g.setHud([
        `mode:    lidar editor`,
        `pose:    ${formatPose(robot, { pxPerM: PX_PER_M })}`,
        `blocks:  ${program.length}`,
      ]);
      g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
      return;
    }

    const b = program[0];

    // /scan refreshes at SCAN_HZ for rendering; the control law runs
    // every frame on the latest reading.
    scanAcc += dt;
    let sec = lastSector;
    if (scanAcc > 1 / SCAN_HZ) {
      scanAcc = 0;
      const r = processLidar(b);
      lastV = r.v;
      lastW = r.w;
      sec = r.sec;
      lastSector = sec;
    }

    // Physics step using lastV/lastW — outside scan periods we keep
    // publishing the previous command.
    robot.theta += lastW * dt;
    const nx = robot.x + lastV * Math.cos(robot.theta) * dt;
    const ny = robot.y + lastV * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else {
      // Collision → reset (threshold too small or fwd_speed too high).
      bumpFlash = 1;
      g.shake(0.4);
      particles.burst(robot.x, robot.y, "#fb7185", 22, 220);
      isRunning = false;
      lastV = 0;
      lastW = 0;
      setStatusBadge("collision — reset", "error");
      g.sfx.bump();
      g.setStatus(t("lidar_avoidance.collision"), "var(--danger)");
      // Send back to START (program is preserved).
      robot.x = START.x;
      robot.y = START.y;
      robot.theta = START.theta;
      trail.reset();
      refreshProgramUI();
      return;
    }

    // Trail.
    trail.update(dt, robot.x, robot.y);
    // Publish /scan and /cmd_vel.
    pubAcc += dt;
    if (pubAcc > 1 / SCAN_HZ) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(lastV / PX_PER_M, lastW));
      g.publish(
        TOPIC_SCAN,
        `sensor_msgs/msg/LaserScan front:${sec.front.toFixed(2)}m right:${sec.right.toFixed(2)}m left:${sec.left.toFixed(2)}m`,
      );
    }

    // Goal check.
    const gdx = robot.x - GOAL.x;
    const gdy = robot.y - GOAL.y;
    if (Math.hypot(gdx, gdy) <= GOAL.r) {
      reachGoal();
      return;
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:        lidar avoidance`,
      `front_min:   ${sec.front.toFixed(2)} m  ${sec.front > b.threshold ? "✓ clear" : "× blocked"}`,
      `right_min:   ${sec.right.toFixed(2)} m  ${sec.right < b.threshold ? "× obstacle" : "—"}`,
      `left_min:    ${sec.left.toFixed(2)} m  ${sec.left < b.threshold ? "× obstacle" : "—"}`,
      `cmd_vel:     ${formatTwist({ v: lastV, w: lastW }, { pxPerM: PX_PER_M })}`,
      `pose:        ${formatPose(robot, { pxPerM: PX_PER_M })}`,
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

    // Draw LiDAR beams (only while running).
    if (isRunning && scanHits.length) {
      const b = program[0];
      const sectorColor = (s: "front" | "right" | "left", blocked: boolean) => {
        if (s === "front")
          return blocked ? "rgba(251, 113, 133, 0.55)" : "rgba(94, 234, 212, 0.35)";
        if (s === "right")
          return blocked ? "rgba(251, 191, 36, 0.55)" : "rgba(125, 211, 252, 0.18)";
        return blocked ? "rgba(196, 181, 253, 0.55)" : "rgba(125, 211, 252, 0.18)";
      };
      const blockedFront = lastSector.front <= b.threshold;
      const blockedRight = lastSector.right < b.threshold;
      const blockedLeft = lastSector.left < b.threshold;
      c.lineWidth = 1;
      for (const h of scanHits) {
        const blocked =
          h.sector === "front" ? blockedFront : h.sector === "right" ? blockedRight : blockedLeft;
        c.strokeStyle = sectorColor(h.sector, blocked);
        const dir = robot.theta + h.angle;
        c.beginPath();
        c.moveTo(robot.x, robot.y);
        c.lineTo(robot.x + Math.cos(dir) * h.dist, robot.y + Math.sin(dir) * h.dist);
        c.stroke();
      }
    }

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

    // Legend.
    drawLegend(c);

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("lidar_avoidance.hint"));
  }

  function drawLegend(c: CanvasRenderingContext2D) {
    c.save();
    const x = W - 130,
      y = H - 56;
    c.fillStyle = withA(theme.scrim, 0.78);
    c.strokeStyle = "rgba(125, 211, 252, 0.25)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x, y, 118, 44, 6);
    c.fill();
    c.stroke();
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "left";
    const item = (yy: number, color: string, label: string) => {
      c.fillStyle = color;
      c.fillRect(x + 8, yy - 4, 10, 4);
      c.fillStyle = COLORS.FG_DIM;
      c.fillText(label, x + 22, yy);
    };
    item(y + 12, "#fb7185", "front (blocked)");
    item(y + 24, "#fbbf24", "right (blocked)");
    item(y + 36, "#c4b5fd", "left  (blocked)");
    c.restore();
  }

  return {
    id: "lidar_avoidance",
    name: "LiDAR Avoidance",
    lesson: "LiDAR Reactive",
    lessonCmd: "ros2 topic echo /robot/lidar/scan",
    ros2: {
      title: tx(
        "Reactive Control ・/scan で前方が空いてれば進む",
        "Reactive Control — drive forward when /scan says the front is clear",
      ),
      summary:
        "講義用の LiDAR 障害物回避を簡略化して再現。" +
        "/scan を Subscribe して 前方 / 右 / 左 セクターの最小距離を計算し、" +
        "閾値で 前進 / 左旋回 / 右旋回 / 停止 を切替えるリアクティブ制御。" +
        "計画も目標もない、純粋に「センサ値で即決」する最も基本的な自律行動。" +
        "threshold を変えると挙動が劇的に変化（小さい→突進、大きい→慎重）。",
      msgTypes: ["sensor_msgs/msg/LaserScan", "geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic hz /robot/lidar/scan",
        "ros2 topic echo /robot/lidar/scan --once",
        "ros2 topic info /robot/lidar/scan",
      ],
      python: `import rclpy, numpy as np
from rclpy.node import Node
from rclpy.qos import QoSProfile, QoSReliabilityPolicy, QoSHistoryPolicy
from geometry_msgs.msg import Twist
from sensor_msgs.msg import LaserScan

def normalize_angle(a):
    return (a + np.pi) % (2.0 * np.pi) - np.pi

class RobotLidarControl(Node):
    def __init__(self):
        super().__init__('robot_lidar_control')
        qos = QoSProfile(history=QoSHistoryPolicy.KEEP_LAST,
                         depth=10,
                         reliability=QoSReliabilityPolicy.BEST_EFFORT)
        self.cmd_vel_pub = self.create_publisher(
            Twist, '/robot/manual_control/cmd_vel', 10)
        self.create_subscription(
            LaserScan, '/robot/lidar/scan',
            self.callback_scan, qos)
        self.front_min = self.right_min = self.left_min = None
        self.create_timer(0.1, self.process)

    def callback_scan(self, data):
        # ±15° = front, それ以外 = right / left
        front, right, left = data.range_max, data.range_max, data.range_max
        a = data.angle_min
        for r in data.ranges:
            if r == 0.0 or r < data.range_min:
                a += data.angle_increment; continue
            sa = normalize_angle(a + np.pi/2)
            if -np.deg2rad(15) <= sa <= np.deg2rad(15):
                front = min(front, r)
            elif sa < -np.deg2rad(15):
                right = min(right, r)
            else:
                left = min(left, r)
            a += data.angle_increment
        self.front_min, self.right_min, self.left_min = front, right, left

    def process(self):
        vel = Twist()
        threshold = 1.0  # m
        if self.front_min and self.front_min > threshold:
            vel.linear.x = 0.2
        elif self.right_min and self.right_min < threshold:
            vel.angular.z = 0.5      # rotate left
        elif self.left_min and self.left_min < threshold:
            vel.angular.z = -0.5     # rotate right
        self.cmd_vel_pub.publish(vel)`,
      realWorld: tx(
        "実機に移すには、LiDAR と base controller の topic・座標・速度制限に合わせる必要があります。このような反応型制御は障害物を避けられますが、袋小路や同じ動作の繰り返しに陥ることがあります。目的地まで安定して進むには、Nav2 のような経路計画との組み合わせが有効です。",
        "Moving this logic to a physical robot requires matching the LiDAR and base-controller topics, frames, and velocity limits. Reactive control can avoid obstacles, but may become trapped or repeat behaviors. Combining it with a planner such as Nav2 helps the robot reach destinations more reliably.",
      ),
      state: {
        nodes: ["/robot_lidar_control", "/robot_node"],
        topics: [
          {
            name: TOPIC_CMD,
            type: "geometry_msgs/msg/Twist",
            pub: ["/robot_lidar_control"],
            sub: ["/robot_node"],
          },
          {
            name: TOPIC_SCAN,
            type: "sensor_msgs/msg/LaserScan",
            pub: ["/robot_node"],
            sub: ["/robot_lidar_control"],
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
  order: 9,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="LiDAR fans rays around the robot, red rays hit walls, green pass through">
  <!-- background -->
  <rect x="6" y="6" width="408" height="108" rx="8" fill="rgba(8, 12, 28, 0.5)" stroke="#232c4d"/>
  <!-- walls (obstacles) -->
  <rect x="36" y="36" width="22" height="50" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <rect x="362" y="42" width="22" height="42" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <!-- threshold ring -->
  <circle cx="210" cy="60" r="62" fill="none" stroke="#fbbf24" stroke-width="1" stroke-dasharray="3 3" opacity="0.55"/>
  <text x="278" y="22" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="10">threshold</text>
  <!-- blocked rays (hit walls within threshold) -->
  <line x1="210" y1="60" x2="58" y2="55" stroke="#fb7185" stroke-width="1.5" opacity="0.85"/>
  <line x1="210" y1="60" x2="362" y2="58" stroke="#fb7185" stroke-width="1.5" opacity="0.85"/>
  <line x1="210" y1="60" x2="58" y2="80" stroke="#fb7185" stroke-width="1.4" opacity="0.7"/>
  <line x1="210" y1="60" x2="362" y2="78" stroke="#fb7185" stroke-width="1.4" opacity="0.7"/>
  <!-- clear rays -->
  <line x1="210" y1="60" x2="148" y2="14" stroke="#5eead4" stroke-width="1.2" opacity="0.6"/>
  <line x1="210" y1="60" x2="210" y2="6" stroke="#5eead4" stroke-width="1.2" opacity="0.6"/>
  <line x1="210" y1="60" x2="272" y2="14" stroke="#5eead4" stroke-width="1.2" opacity="0.6"/>
  <line x1="210" y1="60" x2="148" y2="106" stroke="#5eead4" stroke-width="1.2" opacity="0.6"/>
  <line x1="210" y1="60" x2="272" y2="106" stroke="#5eead4" stroke-width="1.2" opacity="0.6"/>
  <line x1="210" y1="60" x2="100" y2="20" stroke="#5eead4" stroke-width="1.2" opacity="0.5"/>
  <line x1="210" y1="60" x2="320" y2="20" stroke="#5eead4" stroke-width="1.2" opacity="0.5"/>
  <line x1="210" y1="60" x2="100" y2="100" stroke="#5eead4" stroke-width="1.2" opacity="0.5"/>
  <line x1="210" y1="60" x2="320" y2="100" stroke="#5eead4" stroke-width="1.2" opacity="0.5"/>
  <!-- robot icon at center -->
  <rect x="196" y="48" width="28" height="22" rx="3" fill="#181f3a" stroke="#7dd3fc" stroke-width="2"/>
  <circle cx="204" cy="58" r="2" fill="#7dd3fc"/>
  <circle cx="216" cy="58" r="2" fill="#7dd3fc"/>
  <line x1="210" y1="70" x2="210" y2="78" stroke="#7dd3fc" stroke-width="2"/>
  <!-- annotations -->
  <text x="50" y="100" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="10" font-weight="700">blocked</text>
  <text x="370" y="100" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="10" font-weight="700">blocked</text>
  <text x="210" y="103" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="11" font-weight="700">if min &lt; thr → turn</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "反応制御 — /scan で前進と旋回を切り替え",
      en: "Reactive control — switching on /scan",
    },
    learn: {
      ja: "/scan の sector の最小値が threshold より近ければ旋回、遠ければ前進。条件分岐だけのシンプルな反応制御 (reactive control) です。",
      en: "If the sector min from /scan is closer than the threshold, turn; otherwise drive forward. A pure if/else reactive controller — no planning involved.",
    },
    goal: {
      ja: "threshold / fwd_speed / turn_speed を調整し、衝突せずに GOAL へ到達しましょう。",
      en: "Tune threshold / fwd_speed / turn_speed so the robot reaches GOAL without colliding.",
    },
    first: {
      ja: "デフォルト (threshold 1.0, fwd_speed 0.2, turn_speed 0.5) のまま ▶ RUN。衝突するなら threshold を上げるか fwd_speed を下げましょう。",
      en: "Press ▶ RUN with the defaults (threshold 1.0, fwd_speed 0.2, turn_speed 0.5). If it crashes, raise threshold or lower fwd_speed.",
    },
  },
  strings: {
    ja: {
      collision: "衝突 — threshold を上げるか fwd_speed を下げて再 RUN",
      hint: "threshold を上下して反応性を調整 / STOP で停止",
      palette_hint: "/scan の sector min で反応的に避ける (反応制御)",
      running: "LiDAR avoidance 実行中 — STOP で停止",
      stop: "停止 — パラメータを調整して再 RUN",
      tip: "threshold を調整して RUN — LiDAR で障害物を避けながら GOAL へ",
    },
    en: {
      collision: "Collision — raise threshold or lower fwd_speed and RUN again",
      hint: "Adjust threshold for reactivity / STOP to halt",
      palette_hint: "Reactive avoidance using /scan sector minima",
      running: "LiDAR avoidance running — press STOP to halt",
      stop: "Stopped — adjust parameters and RUN again",
      tip: "Tune the threshold and RUN — avoid obstacles via LiDAR → GOAL",
    },
  },
  build: makeLidarAvoidance,
});
