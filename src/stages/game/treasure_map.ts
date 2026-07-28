// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// treasure_map: Treasure Map (Explore + Build a Map = SLAM lite)
// Drive an unknown maze, light it up with LiDAR, and persist seen walls
// into an occupancy grid.
// Collect 3 chests and exit. Vision uses fog-of-war; known tiles persist
// in the side-panel mini-map.
import { type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { formatPose, formatTwist } from "../../lib/hud";
import { t, tx } from "../../i18n";

// ── Maze grid ────────────────────────────────────────────────
const TILE = 40;
const COLS = 14;
const ROWS = 11;
const ROBOT_R = 13;
const LIN_SPEED = 130;
const ANG_SPEED = 2.4;
const N_RAYS = 96;
const SCAN_HZ = 8;
const MAX_DIST = 145;

// World layout (left of canvas)
const WORLD_Y = 30; // top of maze area; bottom = WORLD_Y + ROWS*TILE = 470

// Mini-map layout (right side of canvas)
const MINI_X = 580;
const MINI_Y = 80;
const MINI_W = 200;
const MINI_H = 156;
const MINI_TW = MINI_W / COLS;
const MINI_TH = MINI_H / ROWS;

// 0 = open / 1 = wall
// prettier-ignore
const maze: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],  // 0
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],  // 1  ← start (1,1), T1 at (12,1)
  [1,0,1,1,0,1,1,0,1,0,1,1,0,1],  // 2
  [1,0,0,0,0,0,1,0,0,0,1,0,0,1],  // 3
  [1,1,1,1,0,1,1,0,1,1,1,0,1,1],  // 4
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],  // 5  ← T2 at (7,5)
  [1,0,1,1,1,1,1,0,1,1,1,0,1,1],  // 6
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],  // 7  ← T3 at (12,7)
  [1,0,1,1,0,1,1,1,1,1,1,0,1,1],  // 8
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],  // 9  ← exit at (12,9)
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],  // 10
];

const START = { col: 1, row: 1 };
const EXIT = { col: 12, row: 9 };

interface ChestDef {
  col: number;
  row: number;
  id: string;
}
const CHEST_DEFS: ChestDef[] = [
  { col: 12, row: 1, id: "α" },
  { col: 7, row: 5, id: "β" },
  { col: 12, row: 7, id: "γ" },
];

// seenMap: 0 = unseen, 1 = wall, 2 = open
type SeenState = 0 | 1 | 2;

export function makeMazeMapper(): Stage {
  let g!: GameContext;
  const robot = {
    x: START.col * TILE + TILE / 2,
    y: WORLD_Y + START.row * TILE + TILE / 2,
    theta: 0,
  };
  const cmd = { lin: 0, ang: 0 };
  const particles = new Particles();
  let elapsed = 0;
  let cleared = false;
  let bumpFlash = 0;
  let scanAcc = 0;
  let pubAcc = 0;
  let exitFlash = 0;

  const seenMap = new Uint8Array(COLS * ROWS); // 0/1/2
  const litMap = new Uint8Array(COLS * ROWS); // 0/1: lit by current scan
  let lastScan: { angle: number; dist: number; hit: boolean }[] = [];
  let collectedCount = 0;
  let chests: (ChestDef & { collected: boolean })[] = [];

  function reset() {
    robot.x = START.col * TILE + TILE / 2;
    robot.y = WORLD_Y + START.row * TILE + TILE / 2;
    robot.theta = 0;
    cmd.lin = 0;
    cmd.ang = 0;
    particles.reset();
    elapsed = 0;
    cleared = false;
    bumpFlash = 0;
    exitFlash = 0;
    seenMap.fill(0);
    litMap.fill(0);
    lastScan = [];
    collectedCount = 0;
    chests = CHEST_DEFS.map((c) => ({ ...c, collected: false }));
    g.ghost.startRecording();
    g.setStatus(t("treasure_map.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }
  function dispose() {}

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

  function doScan() {
    litMap.fill(0);
    lastScan = [];
    let minDist = MAX_DIST;
    let hits = 0;
    for (let i = 0; i < N_RAYS; i++) {
      const angle = (i / N_RAYS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      let dist = MAX_DIST;
      let hit = false;
      let lastIdx = -1;
      for (let d = 0; d <= MAX_DIST; d += 2) {
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
          if (seenMap[idx] === 0) {
            seenMap[idx] = (maze[row][col] === 1 ? 1 : 2) as SeenState;
          }
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
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);
    if (exitFlash > 0) exitFlash = Math.max(0, exitFlash - dt);

    const tw = teleop(g.keys, { baseLin: LIN_SPEED, baseAng: ANG_SPEED });
    cmd.lin = tw.lin;
    cmd.ang = tw.ang;

    const nx = robot.x + cmd.lin * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.lin * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.lin !== 0) {
      bumpFlash = 1;
      cleared = true;
      g.crash(t("treasure_map.crash.wall"));
      return;
    }
    robot.theta += cmd.ang * dt;

    // LiDAR scan @ SCAN_HZ
    scanAcc += dt;
    if (scanAcc > 1 / SCAN_HZ) {
      scanAcc = 0;
      doScan();
    }

    // pickup chests
    for (const ch of chests) {
      if (ch.collected) continue;
      const cx = ch.col * TILE + TILE / 2;
      const cy = WORLD_Y + ch.row * TILE + TILE / 2;
      const dx = robot.x - cx,
        dy = robot.y - cy;
      if (dx * dx + dy * dy < (TILE * 0.45) ** 2) {
        ch.collected = true;
        collectedCount++;
        particles.burst(cx, cy, "#fbbf24", 28, 260);
        g.sfx.pickup();
        g.shake(0.45);
        g.publish("/treasure/picked", `id:${ch.id} count:${collectedCount}/3`);
        if (collectedCount === 3) {
          exitFlash = 2.4;
          g.setStatus(t("treasure_map.status.exit_open"), "var(--ok)");
          g.publish("/exit/open", "geometry_msgs/msg/Pose all_treasures_collected");
        } else {
          g.setStatus(
            t("treasure_map.status.picked", { id: ch.id, n: collectedCount }),
            "var(--accent)",
          );
        }
      }
    }

    // exit reach
    if (collectedCount === 3) {
      const ex = EXIT.col * TILE + TILE / 2;
      const ey = WORLD_Y + EXIT.row * TILE + TILE / 2;
      const dx = robot.x - ex,
        dy = robot.y - ey;
      if (dx * dx + dy * dy < (TILE * 0.45) ** 2) {
        cleared = true;
        particles.burst(ex, ey, "#5eead4", 50, 320);
        g.shake(0.7);
        g.setStatus(t("treasure_map.status.complete"), "var(--ok)");
        const known = countSeen();
        const cov = known / (COLS * ROWS);
        const stars = elapsed < 75 && cov >= 0.7 ? 3 : elapsed < 110 && cov >= 0.5 ? 2 : 1;
        const stats =
          `Time     <b>${elapsed.toFixed(2)} s</b><br>` +
          `Map      <b>${(cov * 100).toFixed(0)}%</b> covered<br>` +
          `Treasure <b>${collectedCount} / 3</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 700);
        return;
      }
    }

    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(cmd.lin / LIN_SPEED, cmd.ang));
    }
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:    explore + map`,
      `pose:${formatPose(robot)}`,
      `cmd_vel:${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: LIN_SPEED })}`,
      `treasure: ${collectedCount} / 3`,
      `map:     ${((countSeen() / (COLS * ROWS)) * 100).toFixed(0)}% explored  (${countSeen()} / ${COLS * ROWS} cells)`,
      `exit:    ${collectedCount === 3 ? "OPEN ✓" : "locked (collect all 3)"}`,
    ]);
  }

  function countSeen(): number {
    let n = 0;
    for (let i = 0; i < seenMap.length; i++) if (seenMap[i] !== 0) n++;
    return n;
  }

  // ── DRAW ────────────────────────────────────────────────────
  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);

    drawWorld(ctx);
    drawChestsAndExit(ctx);
    drawLidarRays(ctx);

    // ghost
    g.ghost.draw(ctx, elapsed, elapsed);

    // robot body
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, elapsed);
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();

    // particles
    particles.draw(ctx);

    // mini-map (right panel)
    drawMiniMap(ctx);

    // right panel header / progress
    drawSidePanel(ctx);

    drawTimer(ctx, elapsed, g.getBestTime());
    drawHint(ctx, t("treasure_map.hint"));
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
          // Pitch dark.
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
          if (lit) {
            // grid hatching when lit
            ctx.strokeStyle = "rgba(125,211,252,0.07)";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          }
        }
      }
    }
  }

  function drawChestsAndExit(ctx: CanvasRenderingContext2D) {
    for (const ch of chests) {
      if (ch.collected) continue;
      const idx = ch.row * COLS + ch.col;
      if (seenMap[idx] === 0) continue; // undiscovered cells aren't even shown on the mini-map
      const lit = litMap[idx] === 1;
      const x = ch.col * TILE + TILE / 2;
      const y = WORLD_Y + ch.row * TILE + TILE / 2;
      drawChest(ctx, x, y, lit, ch.id);
    }
    if (collectedCount === 3) {
      const idx = EXIT.row * COLS + EXIT.col;
      // The exit becomes always-visible ("known") once collectedCount === 3.
      const lit = litMap[idx] === 1 || seenMap[idx] !== 0;
      const x = EXIT.col * TILE + TILE / 2;
      const y = WORLD_Y + EXIT.row * TILE + TILE / 2;
      drawExit(ctx, x, y, lit);
    } else {
      // If the exit tile is visible, show a "locked" hint.
      const idx = EXIT.row * COLS + EXIT.col;
      if (seenMap[idx] !== 0) {
        const lit = litMap[idx] === 1;
        const x = EXIT.col * TILE + TILE / 2;
        const y = WORLD_Y + EXIT.row * TILE + TILE / 2;
        drawLockedExit(ctx, x, y, lit);
      }
    }
  }

  function drawChest(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    lit: boolean,
    id: string,
  ) {
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4);
    ctx.save();
    if (lit) {
      // Glowing ring.
      ctx.fillStyle = `rgba(251, 191, 36, ${0.18 * pulse})`;
      ctx.beginPath();
      ctx.arc(x, y, 22, 0, Math.PI * 2);
      ctx.fill();
    }
    // Body.
    const alpha = lit ? 1.0 : 0.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(x - 10, y - 7, 20, 14);
    ctx.fillStyle = "#92400e";
    ctx.fillRect(x - 10, y - 1, 20, 3);
    ctx.fillStyle = "#fef3c7";
    ctx.fillRect(x - 2, y - 1, 4, 5);
    // Rim.
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 10, y - 7, 20, 14);
    if (lit) {
      ctx.fillStyle = "#fef3c7";
      ctx.font = "700 8px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(id, x, y - 12);
    }
    ctx.restore();
  }

  function drawExit(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 5);
    ctx.save();
    ctx.globalAlpha = lit ? 1 : 0.6;
    // Halo.
    ctx.fillStyle = `rgba(94, 234, 212, ${0.15 + 0.18 * pulse})`;
    ctx.beginPath();
    ctx.arc(x, y, 22 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();
    // Arrow + EXIT.
    ctx.fillStyle = "#5eead4";
    ctx.beginPath();
    ctx.moveTo(x - 8, y - 7);
    ctx.lineTo(x + 4, y - 7);
    ctx.lineTo(x + 4, y - 11);
    ctx.lineTo(x + 12, y);
    ctx.lineTo(x + 4, y + 11);
    ctx.lineTo(x + 4, y + 7);
    ctx.lineTo(x - 8, y + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0c1124";
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("EXIT", x, y + 18);
    ctx.restore();
  }

  function drawLockedExit(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
    ctx.save();
    ctx.globalAlpha = lit ? 0.85 : 0.45;
    // Lock icon.
    ctx.strokeStyle = "#fb7185";
    ctx.fillStyle = "rgba(251,113,133,0.15)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y - 3, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillRect(x - 6, y, 12, 8);
    ctx.strokeRect(x - 6, y, 12, 8);
    ctx.fillStyle = "#fb7185";
    ctx.font = "700 7px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("LOCKED", x, y + 18);
    ctx.restore();
  }

  function drawLidarRays(ctx: CanvasRenderingContext2D) {
    if (!lastScan.length) return;
    ctx.save();
    for (const ray of lastScan) {
      const ex = robot.x + Math.cos(ray.angle) * ray.dist;
      const ey = robot.y + Math.sin(ray.angle) * ray.dist;
      ctx.strokeStyle = ray.hit ? "rgba(125,211,252,0.32)" : "rgba(125,211,252,0.14)";
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
    // panel
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(MINI_X - 6, MINI_Y - 22, MINI_W + 12, MINI_H + 30);
    ctx.strokeRect(MINI_X - 6, MINI_Y - 22, MINI_W + 12, MINI_H + 30);

    // header
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("OCCUPANCY GRID", MINI_X, MINI_Y - 8);
    ctx.fillStyle = "#9aa6c8";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText("/map", MINI_X + MINI_W, MINI_Y - 8);

    // tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const seen = seenMap[idx];
        const x = MINI_X + c * MINI_TW;
        const y = MINI_Y + r * MINI_TH;
        if (seen === 0) {
          ctx.fillStyle = "#0a0e1a";
        } else if (seen === 1) {
          ctx.fillStyle = "#c4b5fd"; // known = wall (light purple)
        } else {
          ctx.fillStyle = "#1f2a4a"; // known = floor
        }
        ctx.fillRect(x, y, MINI_TW + 0.5, MINI_TH + 0.5);
      }
    }

    // chests on map (only if seen)
    for (const ch of chests) {
      const idx = ch.row * COLS + ch.col;
      if (seenMap[idx] === 0 && !ch.collected) continue;
      const cx = MINI_X + ch.col * MINI_TW + MINI_TW / 2;
      const cy = MINI_Y + ch.row * MINI_TH + MINI_TH / 2;
      ctx.fillStyle = ch.collected ? "rgba(94,234,212,0.55)" : "#fbbf24";
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // exit on minimap (only after unlocked)
    if (collectedCount === 3) {
      const cx = MINI_X + EXIT.col * MINI_TW + MINI_TW / 2;
      const cy = MINI_Y + EXIT.row * MINI_TH + MINI_TH / 2;
      ctx.fillStyle = "#5eead4";
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // robot blip
    {
      const cx = MINI_X + (robot.x / TILE) * MINI_TW;
      const cy = MINI_Y + ((robot.y - WORLD_Y) / TILE) * MINI_TH;
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();
      // facing
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(robot.theta) * 6, cy + Math.sin(robot.theta) * 6);
      ctx.stroke();
    }

    // border
    ctx.strokeStyle = "rgba(125,211,252,0.55)";
    ctx.lineWidth = 1;
    ctx.strokeRect(MINI_X, MINI_Y, MINI_W, MINI_H);
    ctx.restore();
  }

  function drawSidePanel(ctx: CanvasRenderingContext2D) {
    const px = MINI_X - 6;
    const py = MINI_Y + MINI_H + 16;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(px, py, MINI_W + 12, 156);
    ctx.strokeRect(px, py, MINI_W + 12, 156);

    // treasures
    ctx.fillStyle = "#fbbf24";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("TREASURE", px + 8, py + 18);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.fillText(`${collectedCount} / 3`, px + 8, py + 42);
    // chest icons
    for (let i = 0; i < 3; i++) {
      const ix = px + 116 + i * 28;
      const iy = py + 36;
      ctx.fillStyle = chests[i]?.collected ? "#fbbf24" : "rgba(110,122,156,0.45)";
      ctx.fillRect(ix - 8, iy - 5, 16, 10);
      ctx.fillStyle = chests[i]?.collected ? "#92400e" : "rgba(60,72,100,0.55)";
      ctx.fillRect(ix - 8, iy - 1, 16, 2);
    }

    // map coverage bar
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText("MAP COVERAGE", px + 8, py + 76);
    const cov = countSeen() / (COLS * ROWS);
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.fillRect(px + 8, py + 84, MINI_W - 4, 12);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(px + 8, py + 84, (MINI_W - 4) * cov, 12);
    ctx.strokeStyle = "rgba(125,211,252,0.5)";
    ctx.strokeRect(px + 8, py + 84, MINI_W - 4, 12);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 14px ui-monospace, monospace";
    ctx.fillText(`${(cov * 100).toFixed(0)}%`, px + 8, py + 116);

    // exit status
    const exitColor = collectedCount === 3 ? "#5eead4" : "#fb7185";
    const exitText = collectedCount === 3 ? "EXIT OPEN ✓" : "EXIT LOCKED";
    ctx.fillStyle = exitColor;
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText(exitText, px + 8, py + 142);

    ctx.restore();
  }

  return {
    id: "treasure_map",
    name: "Treasure Map",
    lesson: "",
    lessonCmd: "ros2 topic echo /map",
    ros2: {
      title: tx(
        "Mapping (SLAM lite) — /scan から /map を作る",
        "Mapping (SLAM lite) — building /map from /scan",
      ),
      summary:
        "このステージではロボットの姿勢が分かっていると仮定し、LiDAR の `/scan` を occupancy grid に反映します。実際の SLAM は、地図の更新と同時にロボットの姿勢も推定し、scan matching や loop closure でずれを抑えます。",
      msgTypes: [
        "sensor_msgs/msg/LaserScan",
        "nav_msgs/msg/OccupancyGrid",
        "geometry_msgs/msg/Twist",
      ],
      cli: [
        "ros2 topic list",
        "ros2 topic echo /scan",
        "ros2 topic echo /map --once",
        "ros2 topic hz /map",
      ],
      python: `# Mapper ノード: /scan を subscribe して占有グリッドを更新
class MapBuilder(Node):
    def __init__(self):
        super().__init__("map_builder")
        self.create_subscription(LaserScan, "/scan", self.cb_scan, 10)
        self.pub = self.create_publisher(OccupancyGrid, "/map", 10)
        self.grid = np.full((ROWS, COLS), -1, dtype=np.int8)  # -1 = unknown
    def cb_scan(self, scan):
        # scan の各 ray を robot pose と組み合わせて、ヒットしたセル → 100 (occupied),
        # 通り抜けたセル → 0 (free) に更新
        for ray in scan.ranges:
            cells = self.raycast(ray)
            for (col, row, hit) in cells:
                self.grid[row, col] = 100 if hit else 0
        self.pub.publish(occupancy_grid_msg(self.grid))`,
      realWorld: tx(
        "実機の 2D SLAM でも、LiDAR の /scan と移動情報を使って地図と姿勢を同時に推定します。このステージは、そのうち姿勢が既知の場合の occupancy grid 更新に焦点を当てた簡略モデルです。",
        "Real 2D SLAM also uses LiDAR scans and motion information to estimate both the map and robot pose. This stage is a simplified model focused on occupancy-grid updates when the pose is assumed to be known.",
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
          { name: "/treasure/picked", type: "std_msgs/msg/String", pub: ["/world"] },
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
  order: 7,
  diagram: `
<svg viewBox="0 0 420 130" role="img" aria-label="lidar rays sweep an unknown maze and the visited cells become a known occupancy grid">
  <defs>
    <radialGradient id="ld-mm-fog" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7dd3fc" stop-opacity="0.32"/>
      <stop offset="60%" stop-color="#7dd3fc" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#7dd3fc" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- Left panel: WORLD (mostly dark, with a lit cone) -->
  <rect x="6" y="10" width="186" height="110" rx="6" fill="#02050b" stroke="#232c4d" stroke-width="1"/>
  <text x="14" y="24" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">WORLD (fog of war)</text>
  <!-- known walls (lit) drawn as faint shapes outside the cone, but visible inside the cone clearly -->
  <rect x="50" y="32" width="14" height="64" fill="#1d2336" stroke="rgba(110,122,156,0.3)"/>
  <rect x="100" y="64" width="68" height="14" fill="#1d2336" stroke="rgba(110,122,156,0.3)"/>
  <!-- LiDAR cone glow -->
  <circle cx="98" cy="78" r="48" fill="url(#ld-mm-fog)"/>
  <!-- bright walls in cone -->
  <rect x="50" y="48" width="14" height="40" fill="#3a4366" stroke="rgba(110,122,156,0.7)"/>
  <rect x="118" y="68" width="42" height="10" fill="#3a4366" stroke="rgba(110,122,156,0.7)"/>
  <!-- rays -->
  <g stroke="#7dd3fc" stroke-width="0.9" opacity="0.7">
    <line x1="98" y1="78" x2="55" y2="68"/>
    <line x1="98" y1="78" x2="55" y2="58"/>
    <line x1="98" y1="78" x2="62" y2="78"/>
    <line x1="98" y1="78" x2="55" y2="92"/>
    <line x1="98" y1="78" x2="116" y2="74"/>
    <line x1="98" y1="78" x2="138" y2="68"/>
    <line x1="98" y1="78" x2="98" y2="44"/>
    <line x1="98" y1="78" x2="98" y2="118"/>
    <line x1="98" y1="78" x2="146" y2="92"/>
  </g>
  <!-- robot -->
  <rect x="89" y="70" width="18" height="16" rx="3" fill="#181f3a" stroke="#fbbf24" stroke-width="1.6"/>
  <circle cx="93" cy="78" r="1.5" fill="#fbbf24"/>
  <circle cx="103" cy="78" r="1.5" fill="#fbbf24"/>
  <!-- chest -->
  <rect x="148" y="38" width="14" height="9" fill="#fbbf24" stroke="rgba(0,0,0,0.6)" stroke-width="0.5"/>
  <rect x="148" y="42" width="14" height="2" fill="#92400e"/>
  <!-- arrow from world to map -->
  <defs>
    <marker id="ld-mm-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#5eead4"/>
    </marker>
  </defs>
  <line x1="196" y1="65" x2="222" y2="65" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-mm-arrow)"/>
  <text x="210" y="58" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9" font-weight="700">/scan</text>
  <text x="210" y="80" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">→ /map</text>
  <!-- Right panel: OCCUPANCY GRID built so far -->
  <rect x="226" y="10" width="186" height="110" rx="6" fill="#0a0e1a" stroke="#7dd3fc" stroke-width="1"/>
  <text x="234" y="24" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">OCCUPANCY GRID (/map)</text>
  <!-- Grid: simulate 14x6 cells, some known walls, some known free, some unknown -->
  <g stroke="rgba(125,211,252,0.18)" stroke-width="0.4">
    <!-- known free (dark blue) -->
    <rect x="232" y="32"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="256" y="32"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="282" y="32"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="232" y="50"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="282" y="50"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="232" y="68"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="256" y="68"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="282" y="68"  width="22" height="14" fill="#1f2a4a"/>
    <rect x="232" y="86"  width="22" height="14" fill="#1f2a4a"/>
    <!-- known walls (purple) -->
    <rect x="256" y="50"  width="22" height="14" fill="#c4b5fd"/>
    <rect x="306" y="32"  width="22" height="14" fill="#c4b5fd"/>
    <rect x="306" y="50"  width="22" height="14" fill="#c4b5fd"/>
    <rect x="256" y="86"  width="22" height="14" fill="#c4b5fd"/>
    <!-- unknown (almost black) -->
    <rect x="332" y="32"  width="76" height="68" fill="#0a0e1a"/>
    <rect x="306" y="68"  width="22" height="32" fill="#0a0e1a"/>
  </g>
  <!-- robot blip on grid -->
  <circle cx="242" cy="76" r="2.2" fill="#fbbf24"/>
  <!-- chest dot on grid -->
  <circle cx="318" cy="38" r="1.8" fill="#fbbf24"/>
  <!-- coverage label -->
  <text x="408" y="116" text-anchor="end" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">map grows as you explore</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Mapping (SLAM lite) — /scan から /map を作る",
      en: "Mapping (SLAM lite) — building /map from /scan",
    },
    learn: {
      ja: "本ステージはロボットの姿勢が分かっていると仮定し、LiDAR の /scan から nav_msgs/msg/OccupancyGrid (/map) を更新する流れを体感します。「今見えている領域」と「これまでに観測した領域」を分けて表示し、地図が更新される感覚を学びます。実際の SLAM では姿勢も同時に推定します。",
      en: 'This stage assumes the robot pose is known and focuses on updating a nav_msgs/msg/OccupancyGrid (/map) from LiDAR /scan. It separates \\"currently visible\\" from \\"already observed\\" so you can see the map grow. Real SLAM estimates the robot pose and map together.',
    },
    goal: {
      ja: "WASD で暗い迷路を進もう。ロボの LiDAR が周りを照らしてくれます。\n宝箱 (α / β / γ) を 3 つ集めてから出口へ向かえばクリア!\n壁に当たるとやり直し。",
      en: "Drive the dark maze with WASD — your LiDAR lights the way.\nCollect all 3 chests (α / β / γ), then head to the exit to clear!\nHitting a wall = retry.",
    },
    first: {
      ja: "WASD で動き出すと LiDAR (青い ray) が壁を捉え、右側の OCCUPANCY GRID にどんどん地図が書き込まれます。広く動き回るほど map coverage が上がります。",
      en: "Press WASD to move; the blue LiDAR rays catch walls and the OCCUPANCY GRID on the right fills in. The wider you roam, the higher your map coverage gets.",
    },
  },
  strings: {
    ja: {
      hint: "WASD 移動 / LiDAR で世界を地図化 / 壁衝突 = 失敗 / 宝箱 3 つ → 出口",
      "status.complete": "MAP COMPLETE — 脱出成功",
      "status.exit_open": "全宝箱を入手 — 出口が開いた!",
      "status.picked": "宝箱 {id} ゲット ({n}/3)",
      "status.start":
        "未知の迷路を LiDAR で照らしながら探索 — 宝箱 3 つ集めて出口へ (壁衝突は失敗)",
      "crash.wall": "壁に衝突 — もう一度",
    },
    en: {
      hint: "WASD to move / LiDAR builds the map / hitting a wall = fail / 3 chests → EXIT",
      "status.complete": "MAP COMPLETE — escaped",
      "status.exit_open": "All chests collected — the exit is open!",
      "status.picked": "Chest {id} picked up ({n}/3)",
      "status.start":
        "Explore the unknown maze with LiDAR — collect 3 chests then reach the exit (a wall hit fails the run)",
      "crash.wall": "Crashed into a wall — try again",
    },
  },
  build: makeMazeMapper,
});
