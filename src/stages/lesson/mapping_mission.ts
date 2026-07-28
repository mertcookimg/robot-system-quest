// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// mapping_mission: Mapping Mission (Teleop SLAM)
// Sequel to LiDAR Avoidance: drive with WASD teleop and fill in the
// occupancy grid.
// Only LiDAR scan_range is tunable (via the stageOverlay slider).
// scan_hz is fixed at 8 Hz.
// Clear by covering 100% of explorable cells (reachable free + adjacent
// walls) within 120 seconds.
import { type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawHint,
  drawTimer,
  fmtTwist,
  drawRobotBody,
  drawRobotLabel,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { makeOverlayPanel } from "../../lib/overlay_panel";
import { t, tx } from "../../i18n";

// ── Maze grid ──
const TILE = 38;
const COLS = 14;
const ROWS = 10;
const ROBOT_R = 12;
const N_RAYS = 96;

const LIN_SPEED = 130;
const ANG_SPEED = 2.4;
const PX_PER_M = 100;

const WORLD_Y = 30;

// Mini-map layout
const MINI_X = 580;
const MINI_Y = 80;
const MINI_W = 200;
const MINI_H = 144;
const MINI_TW = MINI_W / COLS;
const MINI_TH = MINI_H / ROWS;

// 0 = open, 1 = wall
// prettier-ignore
const maze: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,1,0,1,1,0,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,0,1,1,1,0,1,1,1],
  [1,0,0,0,0,1,0,0,0,1,0,0,0,1],
  [1,1,1,1,0,1,1,1,0,1,1,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,1,1,0,1,1,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

const START = { col: 1, row: 1 };
const TARGET_COVERAGE = 1.0;
const TIME_LIMIT = 120;

export function makeMappingMission(): Stage {
  let g!: GameContext;
  const robot = {
    x: START.col * TILE + TILE / 2,
    y: WORLD_Y + START.row * TILE + TILE / 2,
    theta: 0,
  };
  const cmd = { v: 0, w: 0 };
  const particles = new Particles();
  let elapsed = 0;
  let bumpFlash = 0;
  let scanAcc = 0;
  let pubAcc = 0;
  let cleared = false;
  let timedOut = false;

  // Tunable parameter — written live by the stageOverlay slider.
  const params = { scan_range: 130 };
  const SCAN_HZ = 8; // fixed — not exposed because it isn't a meaningful tuning axis here

  const seenMap = new Uint8Array(COLS * ROWS);
  const litMap = new Uint8Array(COLS * ROWS);
  const explorableMask = new Uint8Array(COLS * ROWS);
  let explorableCount = 0;
  let lastScan: { angle: number; dist: number; hit: boolean }[] = [];

  let editorEl: HTMLElement | null = null;
  let overlayHandle: { dispose(): void } | null = null;

  function reset() {
    robot.x = START.col * TILE + TILE / 2;
    robot.y = WORLD_Y + START.row * TILE + TILE / 2;
    robot.theta = 0;
    cmd.v = 0;
    cmd.w = 0;
    particles.reset();
    elapsed = 0;
    bumpFlash = 0;
    scanAcc = 0;
    pubAcc = 0;
    cleared = false;
    timedOut = false;
    seenMap.fill(0);
    litMap.fill(0);
    lastScan = [];
    g.ghost.startRecording();
    g.setStatus(t("mapping_mission.tip"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    // Hide the block-editor panel.
    editorEl = document.getElementById("block-editor");
    if (editorEl) editorEl.style.display = "none";

    computeExplorableMask();
    setupOverlay();
    reset();
  }

  function dispose() {
    overlayHandle?.dispose();
    overlayHandle = null;
  }

  function setupOverlay() {
    overlayHandle = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "slider",
          label: "scan_range",
          unit: "px",
          min: 60,
          max: 220,
          step: 10,
          value: params.scan_range,
          onInput: (v) => {
            params.scan_range = v;
          },
        },
        { kind: "note", text: "WASD で走行 / R でリセット" },
      ],
      { placement: "dock" },
    );
  }

  // BFS: free cells reachable from start, plus their 4-neighbor walls,
  // form the set of cells discoverable by the LiDAR.
  function computeExplorableMask() {
    explorableMask.fill(0);
    const visited = new Uint8Array(COLS * ROWS);
    const queue: { col: number; row: number }[] = [{ col: START.col, row: START.row }];
    while (queue.length) {
      const c = queue.shift()!;
      if (c.col < 0 || c.col >= COLS || c.row < 0 || c.row >= ROWS) continue;
      const idx = c.row * COLS + c.col;
      if (visited[idx]) continue;
      if (maze[c.row][c.col] === 1) continue;
      visited[idx] = 1;
      explorableMask[idx] = 1;
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        queue.push({ col: c.col + dc, row: c.row + dr });
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (visited[r * COLS + c] === 0) continue;
        for (const [dc, dr] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nc = c + dc,
            nr = r + dr;
          if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
          if (maze[nr][nc] === 1) explorableMask[nr * COLS + nc] = 1;
        }
      }
    }
    explorableCount = 0;
    for (let i = 0; i < explorableMask.length; i++) if (explorableMask[i]) explorableCount++;
  }

  function countSeenExplorable(): number {
    let n = 0;
    for (let i = 0; i < seenMap.length; i++) {
      if (explorableMask[i] && seenMap[i] !== 0) n++;
    }
    return n;
  }

  function isWall(col: number, row: number): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    return maze[row][col] === 1;
  }
  function tileFromWorld(x: number, y: number): { col: number; row: number } {
    return { col: Math.floor(x / TILE), row: Math.floor((y - WORLD_Y) / TILE) };
  }
  function canMoveTo(x: number, y: number): boolean {
    const minCol = Math.max(0, Math.floor((x - ROBOT_R) / TILE));
    const maxCol = Math.min(COLS - 1, Math.floor((x + ROBOT_R) / TILE));
    const minRow = Math.max(0, Math.floor((y - WORLD_Y - ROBOT_R) / TILE));
    const maxRow = Math.min(ROWS - 1, Math.floor((y - WORLD_Y + ROBOT_R) / TILE));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!isWall(c, r)) continue;
        const wx = c * TILE;
        const wy = WORLD_Y + r * TILE;
        const cx = Math.max(wx, Math.min(x, wx + TILE));
        const cy = Math.max(wy, Math.min(y, wy + TILE));
        const dx = x - cx,
          dy = y - cy;
        if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
      }
    }
    return true;
  }

  function doScan(maxDist: number) {
    litMap.fill(0);
    lastScan = [];
    let minDist = maxDist,
      hits = 0;
    for (let i = 0; i < N_RAYS; i++) {
      const angle = (i / N_RAYS) * Math.PI * 2;
      const dx = Math.cos(angle),
        dy = Math.sin(angle);
      let dist = maxDist,
        hit = false,
        lastIdx = -1;
      for (let d = 0; d <= maxDist; d += 2) {
        const x = robot.x + dx * d;
        const y = robot.y + dy * d;
        const { col, row } = tileFromWorld(x, y);
        if (col < 0 || col >= COLS || row < 0 || row >= ROWS) {
          dist = d;
          hit = true;
          break;
        }
        const idx = row * COLS + col;
        if (idx !== lastIdx) {
          litMap[idx] = 1;
          if (seenMap[idx] === 0) seenMap[idx] = maze[row][col] === 1 ? 1 : 2;
          lastIdx = idx;
        }
        if (maze[row][col] === 1) {
          dist = d;
          hit = true;
          break;
        }
      }
      lastScan.push({ angle, dist, hit });
      if (hit) {
        hits++;
        if (dist < minDist) minDist = dist;
      }
    }
    let known = 0;
    for (let i = 0; i < seenMap.length; i++) if (seenMap[i] !== 0) known++;
    g.publish(
      "/scan",
      `sensor_msgs/msg/LaserScan ranges_min:${minDist.toFixed(0)}px hits:${hits}/${N_RAYS}`,
    );
    g.publish(
      "/map",
      `nav_msgs/msg/OccupancyGrid known:${known}/${COLS * ROWS} (${((known / (COLS * ROWS)) * 100).toFixed(0)}%)`,
    );
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;

    // After time runs out, freeze movement and just refresh the HUD.
    if (timedOut) {
      g.setHud(makeHud());
      return;
    }

    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    const scanRange = Math.max(40, Math.min(220, params.scan_range));
    const scanHz = SCAN_HZ;
    scanAcc += dt;
    if (scanAcc > 1 / scanHz) {
      scanAcc = 0;
      doScan(scanRange);
    }

    const tw = teleop(g.keys, { baseLin: LIN_SPEED, baseAng: ANG_SPEED });
    cmd.v = tw.lin;
    cmd.w = tw.ang;

    robot.theta += cmd.w * dt;
    const nx = robot.x + cmd.v * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.v * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.v !== 0) {
      bumpFlash = 1;
      g.sfx.bump();
    }

    // ── coverage check ──
    const seenExp = countSeenExplorable();
    const cov = explorableCount > 0 ? seenExp / explorableCount : 0;
    if (cov >= TARGET_COVERAGE) {
      cleared = true;
      cmd.v = 0;
      cmd.w = 0;
      particles.burst(robot.x, robot.y, "#5eead4", 36, 240);
      g.shake(0.5);
      g.setStatus(t("mapping_mission.status.complete"), "var(--ok)");
      const stars = elapsed < 70 ? 3 : elapsed < 100 ? 2 : 1;
      const stats =
        `Coverage <b>100%</b> (${seenExp} / ${explorableCount} cells)<br>` +
        `Time     <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
      return;
    }
    if (elapsed > TIME_LIMIT) {
      timedOut = true;
      g.setStatus(
        t("mapping_mission.status.timeout", { cov: (cov * 100).toFixed(0) }),
        "var(--danger)",
      );
      cmd.v = 0;
      cmd.w = 0;
      return;
    }

    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(cmd.v / PX_PER_M, cmd.w));
    }
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud(makeHud());
  }

  function makeHud(): string[] {
    const seenExp = countSeenExplorable();
    const cov = explorableCount > 0 ? seenExp / explorableCount : 0;
    return [
      `mode:    teleop SLAM`,
      `pose:    x=${(robot.x / PX_PER_M).toFixed(2)} m  y=${(robot.y / PX_PER_M).toFixed(2)} m  θ=${robot.theta.toFixed(2)}`,
      `cmd_vel: lin=${(cmd.v / PX_PER_M).toFixed(2)} m/s  ang=${cmd.w.toFixed(2)} rad/s`,
      `map:     ${(cov * 100).toFixed(0)}% covered  (${seenExp} / ${explorableCount} cells, target 100%)`,
      `time:    ${elapsed.toFixed(1)}s / ${TIME_LIMIT}s`,
      `lidar:   range=${params.scan_range}px  rate=${SCAN_HZ}Hz`,
    ];
  }

  // ── DRAW ──
  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);
    drawWorld(ctx);
    drawLidarRays(ctx);
    g.ghost.draw(ctx, elapsed, elapsed);
    // Standard robot sprite (same pixel-art as other LESSON stages).
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, elapsed);
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();
    particles.draw(ctx);
    drawMiniMap(ctx);
    drawSidePanel(ctx);
    drawTimer(ctx, elapsed, g.getBestTime());
    drawHint(ctx, t("mapping_mission.hint"));
  }

  function drawWorld(ctx: CanvasRenderingContext2D) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const isW = maze[r][c] === 1;
        const x = c * TILE;
        const y = WORLD_Y + r * TILE;
        const lit = litMap[idx] === 1;
        const seen = seenMap[idx] !== 0;
        if (!seen) {
          ctx.fillStyle = "#02050b";
          ctx.fillRect(x, y, TILE, TILE);
          continue;
        }
        if (isW) {
          ctx.fillStyle = lit ? "#3a4366" : "#1d2336";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = lit ? "rgba(110,122,156,0.7)" : "rgba(110,122,156,0.28)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        } else {
          ctx.fillStyle = lit ? "#0d1426" : "#070b16";
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }
  }

  function drawLidarRays(ctx: CanvasRenderingContext2D) {
    if (!lastScan.length) return;
    ctx.save();
    for (const ray of lastScan) {
      const ex = robot.x + Math.cos(ray.angle) * ray.dist;
      const ey = robot.y + Math.sin(ray.angle) * ray.dist;
      ctx.strokeStyle = ray.hit ? "rgba(125,211,252,0.32)" : "rgba(125,211,252,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(robot.x, robot.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (ray.hit) {
        ctx.fillStyle = "#7dd3fc";
        ctx.beginPath();
        ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawMiniMap(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(MINI_X - 6, MINI_Y - 22, MINI_W + 12, MINI_H + 30);
    ctx.strokeRect(MINI_X - 6, MINI_Y - 22, MINI_W + 12, MINI_H + 30);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("OCCUPANCY GRID", MINI_X, MINI_Y - 8);
    ctx.fillStyle = "#9aa6c8";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("/map", MINI_X + MINI_W, MINI_Y - 8);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const seen = seenMap[idx];
        const x = MINI_X + c * MINI_TW;
        const y = MINI_Y + r * MINI_TH;
        if (seen === 0) ctx.fillStyle = "#0a0e1a";
        else if (seen === 1) ctx.fillStyle = "#c4b5fd";
        else ctx.fillStyle = "#1f2a4a";
        ctx.fillRect(x, y, MINI_TW + 0.5, MINI_TH + 0.5);
      }
    }
    {
      const cx = MINI_X + (robot.x / TILE) * MINI_TW;
      const cy = MINI_Y + ((robot.y - WORLD_Y) / TILE) * MINI_TH;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(robot.theta) * 6, cy + Math.sin(robot.theta) * 6);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(125,211,252,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(MINI_X, MINI_Y, MINI_W, MINI_H);
    ctx.restore();
  }

  function drawSidePanel(ctx: CanvasRenderingContext2D) {
    const seenExp = countSeenExplorable();
    const cov = explorableCount > 0 ? seenExp / explorableCount : 0;
    const px = MINI_X - 6;
    const py = MINI_Y + MINI_H + 16;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(px, py, MINI_W + 12, 156);
    ctx.strokeRect(px, py, MINI_W + 12, 156);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("MAP COVERAGE", px + 8, py + 18);
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.fillRect(px + 8, py + 28, MINI_W - 4, 14);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(px + 8, py + 28, (MINI_W - 4) * cov, 14);
    ctx.strokeStyle = "rgba(125,211,252,0.5)";
    ctx.strokeRect(px + 8, py + 28, MINI_W - 4, 14);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.fillText(`${(cov * 100).toFixed(0)}%`, px + 8, py + 64);
    ctx.fillStyle = "#9aa6c8";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`target: 100% (${explorableCount} cells)`, px + 70, py + 64);
    ctx.fillStyle = "#fbbf24";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText("TIME", px + 8, py + 92);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 16px ui-monospace, monospace";
    ctx.fillText(`${elapsed.toFixed(1)} / ${TIME_LIMIT}s`, px + 8, py + 116);
    ctx.fillStyle = cleared ? "#5eead4" : timedOut ? "#fb7185" : "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    const status = cleared
      ? "✓ MAP COMPLETE"
      : timedOut
        ? "TIME UP — press R"
        : "WASD で teleop 中";
    ctx.fillText(status, px + 8, py + 144);
    ctx.restore();
  }

  return {
    id: "mapping_mission",
    name: "Mapping Mission",
    lesson: "SLAM Teleop",
    lessonCmd: "ros2 topic echo /map",
    ros2: {
      title: tx(
        "Teleop SLAM — 自分で走って /map を埋める",
        "Teleop SLAM — drive and fill /map yourself",
      ),
      summary:
        "LiDAR の /scan から occupancy grid を組み立てるのが SLAM の「マッピング」部分。本ステージではロボの pose が既知の前提で地図だけを作る（自己位置推定は省略）。scan_range をスライダーで調整しながら、自分で WASD teleop してロボを走らせ、未知タイルを埋めていく。本来の SLAM は、この地図作成と自己位置推定 (Localization) を同時に行う。",
      msgTypes: [
        "sensor_msgs/msg/LaserScan",
        "nav_msgs/msg/OccupancyGrid",
        "geometry_msgs/msg/Twist",
      ],
      cli: ["ros2 topic echo /scan", "ros2 topic echo /map --once", "ros2 topic hz /map"],
      python: `# Mapper ノード: /scan を subscribe して occupancy grid を更新
class MapBuilder(Node):
    def __init__(self):
        super().__init__("map_builder")
        self.declare_parameter("scan_range", 4.0)   # m
        self.create_subscription(LaserScan, "/scan", self.cb_scan, 10)
        self.pub = self.create_publisher(OccupancyGrid, "/map", 10)
        self.grid = np.full((ROWS, COLS), -1, dtype=np.int8)
    def cb_scan(self, scan):
        for ray in scan.ranges:
            for (col, row, hit) in raycast(ray, scan.angle_increment, self.pose):
                self.grid[row, col] = 100 if hit else 0
        self.pub.publish(occupancy_grid_msg(self.grid))`,
      realWorld: tx(
        "実機の SLAM ノード (slam_toolbox / cartographer) の地図構築部分は本ステージとほぼ同じ流れ: LiDAR の /scan を subscribe し、ロボ pose で世界座標に変換、occupancy grid を更新して /map に publish。ただし実機ではその pose 自体もスキャンマッチングで推定する（＝Localization）のが SLAM の肝で、本ステージはそこを既知として省いている。scan_range は実機 launch ファイルのチューニングと同じ感覚。",
        "The map-building part of real SLAM nodes (slam_toolbox / cartographer) follows nearly the same flow: subscribe to LiDAR /scan, transform rays to world coordinates using the robot pose, update an occupancy grid, and publish to /map. The catch: on a real robot that pose is itself estimated from scan matching (Localization) — the heart of SLAM — which this stage skips by treating the pose as known. scan_range here behaves like a real launch-file parameter.",
      ),
      state: {
        nodes: ["/teleop", "/lidar_node", "/map_builder"],
        topics: [
          { name: "/cmd_vel", type: "geometry_msgs/msg/Twist", pub: ["/teleop"], sub: ["/robot"] },
          {
            name: "/scan",
            type: "sensor_msgs/msg/LaserScan",
            pub: ["/lidar_node"],
            sub: ["/map_builder"],
          },
          { name: "/map", type: "nav_msgs/msg/OccupancyGrid", pub: ["/map_builder"] },
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
  order: 11,
  diagram: `
<svg viewBox="0 0 420 130" role="img" aria-label="player teleops the robot with WASD; LiDAR scans build the occupancy grid in real time">
  <defs>
    <marker id="ld-mm2-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#5eead4"/>
    </marker>
    <radialGradient id="ld-mm2-cone" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.32"/>
      <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- WASD pad (left) -->
  <g transform="translate(28, 50)">
    <rect x="-22" y="-22" width="74" height="62" rx="6" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
    <rect x="0"   y="-12" width="14" height="14" rx="2" fill="#0c1124" stroke="#7dd3fc" stroke-width="1"/>
    <text x="7" y="-2" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">W</text>
    <rect x="-16" y="6"  width="14" height="14" rx="2" fill="#0c1124" stroke="#7dd3fc" stroke-width="1"/>
    <text x="-9" y="16" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">A</text>
    <rect x="0"   y="6"  width="14" height="14" rx="2" fill="#0c1124" stroke="#7dd3fc" stroke-width="1"/>
    <text x="7" y="16" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">S</text>
    <rect x="16"  y="6"  width="14" height="14" rx="2" fill="#0c1124" stroke="#7dd3fc" stroke-width="1"/>
    <text x="23" y="16" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">D</text>
    <text x="14" y="34" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">teleop</text>
  </g>
  <!-- /cmd_vel arrow to robot -->
  <line x1="84" y1="60" x2="118" y2="60" stroke="#5eead4" stroke-width="1.6" marker-end="url(#ld-mm2-arrow)"/>
  <text x="100" y="54" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9" font-weight="700">/cmd_vel</text>
  <!-- Robot + LiDAR cone (middle) -->
  <g transform="translate(150, 60)">
    <circle cx="0" cy="0" r="34" fill="url(#ld-mm2-cone)"/>
    <!-- rays -->
    <g stroke="#7dd3fc" stroke-width="0.8" opacity="0.7">
      <line x1="0" y1="0" x2="-30" y2="-12"/>
      <line x1="0" y1="0" x2="-22" y2="-22"/>
      <line x1="0" y1="0" x2="0" y2="-32"/>
      <line x1="0" y1="0" x2="22" y2="-20"/>
      <line x1="0" y1="0" x2="32" y2="0"/>
      <line x1="0" y1="0" x2="22" y2="22"/>
      <line x1="0" y1="0" x2="0" y2="32"/>
      <line x1="0" y1="0" x2="-22" y2="22"/>
      <line x1="0" y1="0" x2="-32" y2="8"/>
    </g>
    <!-- robot body -->
    <rect x="-9" y="-7" width="18" height="14" rx="2" fill="#181f3a" stroke="#fbbf24" stroke-width="2"/>
    <circle cx="-4" cy="0" r="1.5" fill="#fbbf24"/>
    <circle cx="4"  cy="0" r="1.5" fill="#fbbf24"/>
  </g>
  <text x="150" y="106" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="9">robot + LiDAR</text>
  <!-- /scan arrow to map builder -->
  <line x1="186" y1="60" x2="220" y2="60" stroke="#5eead4" stroke-width="1.6" marker-end="url(#ld-mm2-arrow)"/>
  <text x="203" y="54" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9" font-weight="700">/scan</text>
  <!-- Occupancy grid (right) -->
  <g>
    <rect x="226" y="20" width="186" height="86" rx="6" fill="#0a0e1a" stroke="#7dd3fc" stroke-width="1"/>
    <text x="234" y="34" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">OCCUPANCY GRID (/map)</text>
    <!-- known free -->
    <g>
      <rect x="232" y="42" width="22" height="14" fill="#1f2a4a"/>
      <rect x="256" y="42" width="22" height="14" fill="#1f2a4a"/>
      <rect x="280" y="42" width="22" height="14" fill="#1f2a4a"/>
      <rect x="232" y="60" width="22" height="14" fill="#1f2a4a"/>
      <rect x="280" y="60" width="22" height="14" fill="#1f2a4a"/>
      <rect x="232" y="78" width="22" height="14" fill="#1f2a4a"/>
      <rect x="256" y="78" width="22" height="14" fill="#1f2a4a"/>
      <!-- walls -->
      <rect x="256" y="60" width="22" height="14" fill="#c4b5fd"/>
      <rect x="304" y="42" width="22" height="14" fill="#c4b5fd"/>
      <rect x="280" y="78" width="22" height="14" fill="#c4b5fd"/>
      <!-- unknown -->
      <rect x="304" y="60" width="106" height="32" fill="#0a0e1a"/>
      <rect x="328" y="42" width="84"  height="14" fill="#0a0e1a"/>
    </g>
    <!-- robot blip -->
    <circle cx="244" cy="68" r="2.2" fill="#fbbf24"/>
    <text x="408" y="103" text-anchor="end" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">map grows where you drive</text>
  </g>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Teleop SLAM — 自分で走って地図を埋める",
      en: "Teleop SLAM — drive yourself, fill the map",
    },
    learn: {
      ja: "SLAM = 自己位置推定 (Localization) と地図作成 (Mapping) を同時に行うこと。本ステージはその「地図作成」に集中し、ロボの位置は既知として LiDAR の /scan から occupancy grid (/map) を組み立てます。画面下のスライダーで scan_range (LiDAR の届く距離) を調整しながら、自分で WASD teleop してロボを走らせ、未知タイルを埋めていきましょう。",
      en: "SLAM = Simultaneous Localization And Mapping. This stage focuses on the Mapping half: with the robot's position treated as known, it builds an occupancy grid (/map) from LiDAR /scan readings. Use the slider to tune scan_range (how far the LiDAR sees), then drive with WASD — every cell the LiDAR sweeps across becomes known.",
    },
    goal: {
      ja: "scan_range をスライダーで調整した上で、WASD で全 explorable セル (到達可能な床 + その隣接壁) を 100% カバーしましょう。スター ★★★ は 70 秒以内、★★ は 100 秒以内、制限時間は 120 秒。",
      en: "Adjust scan_range with the slider, then teleop with WASD to map 100% of the explorable cells (every reachable free tile + adjacent walls). ★★★ in ≤70s, ★★ in ≤100s, time limit 120s.",
    },
    first: {
      ja: "ステージに入ったら即座にタイマーが動きます。WASD でロボを動かすと LiDAR が壁を捉え、右側の OCCUPANCY GRID にマップが書き込まれていきます。",
      en: "The timer starts immediately when the stage opens. Drive with WASD; the LiDAR rays catch walls and the OCCUPANCY GRID on the right fills in.",
    },
  },
  strings: {
    ja: {
      hint: "WASD で teleop / 下のスライダーで scan_range 調整 / 全マップ 100% でクリア",
      "status.complete": "MAP COMPLETE — 100% カバレッジ達成",
      "status.timeout": "時間切れ — coverage {cov}% (target 100%) — R でリトライ",
      tip: "WASD で走り回って LiDAR で全マップを 100% 埋めよう — 画面下のスライダーで scan_range を調整可",
    },
    en: {
      hint: "WASD to teleop / scan_range slider below / 100% coverage to clear",
      "status.complete": "MAP COMPLETE — 100% coverage",
      "status.timeout": "Time up — coverage {cov}% (target 100%) — press R to retry",
      tip: "Drive with WASD and let the LiDAR fill 100% of the map — tweak scan_range from the slider below",
    },
  },
  build: makeMappingMission,
});
