// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// lidar_explorer: LiDAR Explorer (Hard)
// Reveal a dark map with the LiDAR, visit 3 data-collection points,
// then head to the goal.
// Wall hits or running out of battery = game over.
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import {
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  clearBackground,
  COLORS,
} from "../../lib/draw";
import { teleop } from "../../lib/teleop";
import { formatPose, formatTwist } from "../../lib/hud";
import { t, tx } from "../../i18n";

const TILE = 50;
const COLS = 16;
const ROWS = 10;
const ROBOT_R = 13;
const LIN_SPEED = 130;
const ANG_SPEED = 2.4;
const N_RAYS = 96;
const SCAN_HZ = 7;
const MAX_DIST = 130;

// 16x10 maze. 1=wall, 0=passable. Connectivity is BFS-validated in init().
// prettier-ignore
const maze: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 0
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 1: open top corridor (S=(1,1))
  [1,0,1,1,1,0,1,1,1,1,0,1,1,1,0,1], // 2: walls with step-downs at 5,10,14
  [1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1], // 3: inner corridor (DATA B at 10)
  [1,0,1,0,1,1,1,0,1,1,1,1,1,0,1,1], // 4: walls with breaks at 3,7,13
  [1,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1], // 5: open layer (DATA A at 8)
  [1,0,1,0,1,1,1,1,0,1,1,1,1,0,1,1], // 6: walls with breaks at 3,8,13
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], // 7: open layer (DATA C at 5)
  [1,1,1,1,1,1,0,1,1,1,1,1,1,0,0,1], // 8: bottom with breaks at 6,13,14 (GOAL=14)
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1], // 9
];

const START = { col: 1, row: 1 };
const GOAL = { col: 14, row: 8 };

const DATA_POINTS: { col: number; row: number; id: string }[] = [
  { col: 8, row: 5, id: "A" },
  { col: 10, row: 3, id: "B" },
  { col: 5, row: 7, id: "C" },
];

export function makeLidarExplorer(): Stage {
  let g!: GameContext;
  const robot = {
    x: START.col * TILE + TILE / 2,
    y: START.row * TILE + TILE / 2,
    theta: 0,
  };
  const cmd = { lin: 0, ang: 0 };
  let elapsed = 0;
  let cleared = false;
  let bumpFlash = 0;
  let scanAcc = 0;
  let pubAcc = 0;
  let battery = 100;
  const collected = new Set<string>();

  // discovered: cumulative map for the HUD and "Mapped walls" clear statistic; not rendered
  // visibleNow: wall cells hit by the current scan; rendered and reset on every scan
  const discovered = new Set<string>();
  const visibleNow = new Set<string>();
  let lastScan: { angle: number; dist: number; hit: boolean }[] = [];

  function reset() {
    robot.x = START.col * TILE + TILE / 2;
    robot.y = START.row * TILE + TILE / 2;
    robot.theta = 0;
    cmd.lin = 0;
    cmd.ang = 0;
    elapsed = 0;
    cleared = false;
    bumpFlash = 0;
    battery = 100;
    discovered.clear();
    visibleNow.clear();
    collected.clear();
    lastScan = [];
    g.ghost.startRecording();
    g.setStatus(t("lidar_explorer.status.tip"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    // BFS connectivity check (dev-time safety net).
    const reach = bfsReachable(START);
    for (const c of [GOAL, ...DATA_POINTS]) {
      if (!reach.has(`${c.col},${c.row}`)) {
        console.warn("[Stage2] Unreachable critical cell:", c);
      }
    }
    reset();
  }

  function isWall(col: number, row: number): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    return maze[row][col] === 1;
  }

  function bfsReachable(start: { col: number; row: number }): Set<string> {
    const visited = new Set<string>();
    const queue: { col: number; row: number }[] = [start];
    visited.add(`${start.col},${start.row}`);
    while (queue.length) {
      const c = queue.shift()!;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nc = c.col + dc;
        const nr = c.row + dr;
        const key = `${nc},${nr}`;
        if (visited.has(key)) continue;
        if (isWall(nc, nr)) continue;
        visited.add(key);
        queue.push({ col: nc, row: nr });
      }
    }
    return visited;
  }

  function canMoveTo(x: number, y: number): boolean {
    const minCol = Math.max(0, Math.floor((x - ROBOT_R) / TILE));
    const maxCol = Math.min(COLS - 1, Math.floor((x + ROBOT_R) / TILE));
    const minRow = Math.max(0, Math.floor((y - ROBOT_R) / TILE));
    const maxRow = Math.min(ROWS - 1, Math.floor((y + ROBOT_R) / TILE));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!isWall(c, r)) continue;
        const wx = c * TILE;
        const wy = r * TILE;
        const cx = Math.max(wx, Math.min(x, wx + TILE));
        const cy = Math.max(wy, Math.min(y, wy + TILE));
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
      }
    }
    return true;
  }

  function rayCast(ox: number, oy: number, angle: number): number {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const step = 2;
    for (let d = 0; d < MAX_DIST; d += step) {
      const x = ox + dx * d;
      const y = oy + dy * d;
      const col = Math.floor(x / TILE);
      const row = Math.floor(y / TILE);
      if (isWall(col, row)) return d;
    }
    return MAX_DIST;
  }

  function update(dt: number) {
    elapsed += dt;
    if (cleared) return;

    const tw = teleop(g.keys, { baseLin: LIN_SPEED, baseAng: ANG_SPEED });
    cmd.lin = tw.lin;
    cmd.ang = tw.ang;

    if (cmd.lin !== 0 || cmd.ang !== 0) battery -= dt * 1.0;
    else battery -= dt * 0.2;
    battery = Math.max(0, battery);

    const nx = robot.x + cmd.lin * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.lin * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.lin !== 0) {
      bumpFlash = 1;
      cleared = true;
      g.crash(t("lidar_explorer.crash.wall"));
      return;
    }
    robot.theta += cmd.ang * dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    scanAcc += dt;
    if (scanAcc > 1 / SCAN_HZ) {
      scanAcc = 0;
      lastScan = [];
      visibleNow.clear(); // Render only cells hit by this scan.
      let minDist = MAX_DIST;
      let numHits = 0;
      for (let i = 0; i < N_RAYS; i++) {
        const a = (i / N_RAYS) * Math.PI * 2;
        const d = rayCast(robot.x, robot.y, a);
        const hit = d < MAX_DIST;
        lastScan.push({ angle: a, dist: d, hit });
        if (hit) {
          numHits++;
          if (d < minDist) minDist = d;
          const hx = robot.x + Math.cos(a) * d;
          const hy = robot.y + Math.sin(a) * d;
          const col = Math.floor(hx / TILE);
          const row = Math.floor(hy / TILE);
          if (isWall(col, row)) {
            visibleNow.add(`${col},${row}`);
            discovered.add(`${col},${row}`);
          }
        }
      }
      g.publish(
        "/scan",
        `sensor_msgs/msg/LaserScan ranges_min:${minDist.toFixed(0).padStart(3, " ")}px hits:${String(numHits).padStart(3, " ")}/${N_RAYS}`,
      );
    }

    pubAcc += dt;
    if (pubAcc > 1 / 20) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(cmd.lin / LIN_SPEED, cmd.ang));
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    // Data-collection check.
    for (const dp of DATA_POINTS) {
      if (collected.has(dp.id)) continue;
      const dx = robot.x - (dp.col * TILE + TILE / 2);
      const dy = robot.y - (dp.row * TILE + TILE / 2);
      if (dx * dx + dy * dy < (TILE * 0.45) ** 2) {
        collected.add(dp.id);
        g.sfx.pickup();
        g.shake(0.3);
        g.publish(
          "/data_collected",
          `robot_msgs/msg/DataPoint id:"${dp.id}" total:${collected.size}/3`,
        );
        if (collected.size === 3) {
          g.setStatus(t("lidar_explorer.status.all_collected"), "var(--ok)");
        } else {
          g.setStatus(
            t("lidar_explorer.status.collected", { id: dp.id, n: collected.size }),
            "var(--accent)",
          );
        }
      }
    }

    // Goal check.
    if (collected.size === 3) {
      const gx = GOAL.col * TILE + TILE / 2;
      const gy = GOAL.row * TILE + TILE / 2;
      const ddx = robot.x - gx;
      const ddy = robot.y - gy;
      if (ddx * ddx + ddy * ddy < TILE * TILE * 0.36) {
        cleared = true;
        g.setStatus(t("lidar_explorer.status.complete"), "var(--ok)");
        g.sfx.deliver();
        g.shake(0.6);
        const stars = elapsed < 60 && battery > 50 ? 3 : elapsed < 120 ? 2 : 1;
        const stats =
          `Time     <b>${elapsed.toFixed(2)} s</b><br>` +
          `Battery  <b>${battery.toFixed(0)}%</b><br>` +
          `Mapped   <b>${discovered.size}</b> walls<br>` +
          `Data     <b>${collected.size} / 3</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 700);
      }
    }

    // Battery empty = game over.
    if (battery <= 0) {
      cleared = true;
      g.crash(t("lidar_explorer.crash.battery"));
      return;
    }

    g.setHud([
      `pose:${formatPose(robot)}`,
      `cmd_vel:${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: LIN_SPEED })}`,
      `scan:        ${lastScan.length} rays / ${MAX_DIST}px @ ${SCAN_HZ}Hz`,
      `discovered:  ${discovered.size} walls`,
      `data:        ${collected.size} / 3 collected`,
      `battery:     ${battery.toFixed(1)}%`,
      `elapsed:     ${elapsed.toFixed(1)} s`,
    ]);
  }

  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);

    // Draw only cells hit by the current scan; do not leave explored areas revealed.
    for (const key of visibleNow) {
      const [c, r] = key.split(",").map(Number);
      ctx.fillStyle = "rgba(60, 78, 130, 0.32)";
      ctx.strokeStyle = "rgba(78, 96, 148, 0.4)";
      ctx.lineWidth = 1;
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
    }

    ctx.save();
    const grd = ctx.createRadialGradient(robot.x, robot.y, 10, robot.x, robot.y, MAX_DIST);
    grd.addColorStop(0, "rgba(56, 189, 248, 0.18)");
    grd.addColorStop(0.6, "rgba(56, 189, 248, 0.06)");
    grd.addColorStop(1, "rgba(56, 189, 248, 0)");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const visible = new Set<string>();
    for (const ray of lastScan) {
      if (!ray.hit) continue;
      const hx = robot.x + Math.cos(ray.angle) * ray.dist;
      const hy = robot.y + Math.sin(ray.angle) * ray.dist;
      const c = Math.floor(hx / TILE);
      const r = Math.floor(hy / TILE);
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS && isWall(c, r)) {
        visible.add(`${c},${r}`);
      }
    }
    for (const key of visible) {
      const [c, r] = key.split(",").map(Number);
      ctx.fillStyle = "rgba(120, 152, 210, 0.55)";
      ctx.strokeStyle = "#56b6e8";
      ctx.lineWidth = 1.5;
      ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
      ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
    }

    ctx.strokeStyle = "rgba(56, 189, 248, 0.10)";
    ctx.lineWidth = 1;
    for (const ray of lastScan) {
      ctx.beginPath();
      ctx.moveTo(robot.x, robot.y);
      ctx.lineTo(
        robot.x + Math.cos(ray.angle) * ray.dist,
        robot.y + Math.sin(ray.angle) * ray.dist,
      );
      ctx.stroke();
    }
    for (const ray of lastScan) {
      if (!ray.hit) continue;
      ctx.fillStyle = "#7dd3fc";
      ctx.beginPath();
      ctx.arc(
        robot.x + Math.cos(ray.angle) * ray.dist,
        robot.y + Math.sin(ray.angle) * ray.dist,
        1.6,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    for (const dp of DATA_POINTS) {
      const dpx = dp.col * TILE + TILE / 2;
      const dpy = dp.row * TILE + TILE / 2;
      const ddx = robot.x - dpx;
      const ddy = robot.y - dpy;
      const visiblePoint = ddx * ddx + ddy * ddy < (MAX_DIST * 1.1) ** 2;
      const got = collected.has(dp.id);
      if (got) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        drawDataPoint(ctx, dpx, dpy, dp.id, "#5eead4", elapsed, true);
        ctx.restore();
      } else if (visiblePoint) {
        drawDataPoint(ctx, dpx, dpy, dp.id, "#fbbf24", elapsed, false);
      }
    }

    const gx = GOAL.col * TILE + TILE / 2;
    const gy = GOAL.row * TILE + TILE / 2;
    const dgx = robot.x - gx;
    const dgy = robot.y - gy;
    const goalNear = dgx * dgx + dgy * dgy < (MAX_DIST * 1.1) ** 2;
    if (goalNear) {
      const color = collected.size === 3 ? "#5eead4" : "#6e7a9c";
      const label = collected.size === 3 ? "GOAL" : "LOCKED";
      drawZone(ctx, { x: gx, y: gy, r: 22 }, color, label, elapsed);
    }

    // Ghost replay.
    g.ghost.draw(ctx, elapsed, elapsed);

    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, elapsed);
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();

    drawProgressHUD(ctx, collected, battery);
    drawTimer(ctx, elapsed, g.getBestTime());
    if (g.ghost.hasReplay()) drawGhostBadge(ctx);
    drawHint(ctx, t("lidar_explorer.hint"));
  }

  function dispose() {
    /* nothing */
  }

  function drawGhostBadge(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // lidar_explorer already has a top-left HUD, so put this one bottom-right.
    const w = 96;
    const h = 22;
    const x = W - w - 12;
    const y = H - h - 30;
    ctx.fillStyle = "rgba(196, 181, 253, 0.18)";
    ctx.strokeStyle = "rgba(196, 181, 253, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("vs GHOST", x + 10, y + h / 2 + 1);
    ctx.beginPath();
    ctx.arc(x + w - 13, y + h / 2 + 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  return {
    id: "lidar_explorer",
    name: "LiDAR Explorer",
    lesson: "",
    lessonCmd: "ros2 topic echo /scan",
    ros2: {
      title: tx(
        "Sensor Subscribe ・LiDAR で世界を読む",
        "Sensor Subscribe — read the world via LiDAR",
      ),
      summary:
        "/scan は sensor_msgs/msg/LaserScan 型で、ranges[] にレーザー距離が並びます（本ステージは 96 方向。実機の測定点数や角度範囲は機種・設定で異なります）。" +
        "暗闇でも障害物を捉えられるのは、Subscribe したスキャン結果をリアルタイムで処理しているから。" +
        "SLAM・自己位置推定・障害物回避 すべての出発点。",
      msgTypes: ["sensor_msgs/msg/LaserScan"],
      cli: [
        "ros2 topic info /scan",
        "ros2 topic echo /scan --once",
        "ros2 topic hz /scan",
        "rviz2 # /scan を可視化",
      ],
      python: `import rclpy
from rclpy.node import Node
from sensor_msgs.msg import LaserScan

class Explorer(Node):
    def __init__(self):
        super().__init__('explorer')
        self.create_subscription(
            LaserScan, '/scan', self.cb, 10)

    def cb(self, msg: LaserScan):
        # ranges は angle_min から angle_max まで
        # angle_increment 刻みの距離配列
        valid = [r for r in msg.ranges
                 if msg.range_min < r < msg.range_max]
        if valid:
            front = msg.ranges[len(msg.ranges)//2]
            if front < 0.5:
                self.emergency_stop()`,
      realWorld: tx(
        "ROS 2 の 2D LiDAR では LaserScan、3D LiDAR では PointCloud2 がよく使われます。実際の topic 名や interface はセンサーとドライバー構成で異なります。",
        "ROS 2 systems commonly use LaserScan for 2D LiDAR and PointCloud2 for 3D LiDAR. Actual topic names and interfaces depend on the sensor and driver configuration.",
      ),
      state: {
        nodes: ["/explorer", "/lidar"],
        topics: [
          { name: "/scan", type: "sensor_msgs/msg/LaserScan", pub: ["/lidar"], sub: ["/explorer"] },
          { name: "/cmd_vel", type: "geometry_msgs/msg/Twist", pub: ["/explorer"], sub: [] },
          { name: "/odom", type: "nav_msgs/msg/Odometry", pub: ["/explorer"], sub: [] },
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

function drawDataPoint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  id: string,
  color: string,
  t: number,
  collected: boolean,
) {
  const pulse = collected ? 1 : 0.85 + 0.15 * Math.sin(t * 4);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  const r = 16 * pulse;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "bold 11px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(collected ? "✓" : id, 0, 0);
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.fillText("DATA", 0, -22);
  ctx.restore();
}

function drawProgressHUD(ctx: CanvasRenderingContext2D, collected: Set<string>, battery: number) {
  ctx.save();
  ctx.fillStyle = "rgba(8, 14, 28, 0.85)";
  ctx.strokeStyle = "rgba(56, 189, 248, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(12, 12, 200, 56, 6);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#7a89ad";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText("DATA", 22, 26);
  for (let i = 0; i < 3; i++) {
    const id = ["A", "B", "C"][i];
    const got = collected.has(id);
    const cx = 70 + i * 22;
    const cy = 23;
    ctx.fillStyle = got ? "#5eead4" : "rgba(122, 137, 173, 0.3)";
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = got ? COLORS.BG_DARK : "#7a89ad";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(id, cx, cy + 0.5);
  }

  ctx.fillStyle = "#7a89ad";
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("BATTERY", 22, 50);
  const barX = 70;
  const barY = 41;
  const barW = 130;
  const barH = 10;
  ctx.fillStyle = "rgba(122, 137, 173, 0.2)";
  ctx.fillRect(barX, barY, barW, barH);
  const pct = Math.max(0, battery) / 100;
  const battColor = battery > 50 ? "#5eead4" : battery > 20 ? "#fbbf24" : "#fb7185";
  ctx.fillStyle = battColor;
  ctx.fillRect(barX, barY, barW * pct, barH);
  ctx.strokeStyle = "rgba(56, 189, 248, 0.3)";
  ctx.strokeRect(barX, barY, barW, barH);
  ctx.fillStyle = battColor;
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.fillText(`${battery.toFixed(0)}%`, barX + barW - 4, barY + 8);
  ctx.restore();
}

export default defineStage({
  mode: "game",
  order: 3,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="lidar publishes /scan to robot subscriber">
  <defs>
    <marker id="ld-lidar_explorer-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="56" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">lidar_sensor</text>
  <text x="82" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Publisher</text>
  <rect x="264" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="56" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot_node</text>
  <text x="338" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Subscriber</text>
  <line x1="156" y1="60" x2="262" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-lidar_explorer-arrow)"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 158 60 L 258 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/scan</text>
  <text x="210" y="80" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">sensor_msgs/msg/LaserScan</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Sensor topic — /scan で世界を知る",
      en: "Sensor topics — seeing the world via /scan",
    },
    learn: {
      ja: "LiDAR は周囲の距離を測って topic /scan に publish します。ロボはこのセンサデータで暗闇を「見る」ことができます。",
      en: 'A LiDAR measures distance to surroundings and publishes them on /scan. The robot uses this sensor data to \\"see\\" through the dark.',
    },
    goal: {
      ja: "WASD で迷路を進もう。A・B・C のデータ 3 つを集めて GOAL に到達でクリア!\n壁にぶつかったり、バッテリーが切れるとやり直し。",
      en: "Drive the maze with WASD. Collect all three data points (A / B / C) and reach GOAL to clear!\nHitting a wall or running out of battery = retry.",
    },
    first: {
      ja: "WASD で動くと /scan が周囲を照らします。光の届く範囲で進路を決めましょう。",
      en: "Move with WASD — /scan lights up the area around you. Plan paths inside the visible range.",
    },
  },
  strings: {
    ja: {
      "crash.battery": "バッテリー切れ",
      "crash.wall": "壁に衝突しました",
      hint: "WASD 移動 / 壁衝突＝失敗 / バッテリー注意 / DATA 3 つ → GOAL",
      "status.all_collected": "全データ採取完了 — GOAL へ向かえ",
      "status.collected": "DATA {id} 採取 ({n}/3)",
      "status.complete": "MISSION COMPLETE",
      "status.tip": "DATA A / B / C を回収して GOAL へ — 衝突＝失敗、バッテリー注意",
    },
    en: {
      "crash.battery": "Battery depleted",
      "crash.wall": "Crashed into wall",
      hint: "WASD to move / wall hit = fail / watch battery / collect 3 DATA → GOAL",
      "status.all_collected": "All data collected — head to GOAL",
      "status.collected": "DATA {id} collected ({n}/3)",
      "status.complete": "MISSION COMPLETE",
      "status.tip": "Collect DATA A / B / C and reach GOAL — collisions fail, watch the battery",
    },
  },
  build: makeLidarExplorer,
});
