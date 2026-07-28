// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Mini demo animation for the lesson modal: a small canvas
// (#lesson-demo-canvas) where the same pixel-art robot acts out the
// gameplay of the current stage. Each game stage gets its own loop
// hand-crafted to match the in-game visuals (zones, walls, enemies,
// ball, etc.). Split out of lesson_modal.ts, which owns the modal DOM.

import { drawRobotBody, clearBackground } from "../lib/draw";

let demoRaf = 0;
let demoStart = 0;
let demoSparkles: { x: number; y: number; vx: number; vy: number; life: number; color: string }[] =
  [];
let demoLastTime = 0;

function spawnSparkles(x: number, y: number, color: string, n = 12): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * 80;
    demoSparkles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.6 + Math.random() * 0.3,
      color,
    });
  }
}
function updateSparkles(ctx: CanvasRenderingContext2D, dt: number): void {
  ctx.save();
  for (const s of demoSparkles) {
    s.life -= dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += 120 * dt;
    if (s.life <= 0) continue;
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.fillStyle = s.color;
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
  }
  ctx.restore();
  demoSparkles = demoSparkles.filter((s) => s.life > 0);
}

function drawZone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  label: string,
  t: number,
): void {
  const pulse = 0.7 + 0.3 * Math.sin(t * 3);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color + "30";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 0.5 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.2 + 0.2 * pulse), 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(label, x, y - r - 4);
  ctx.restore();
}

function drawRobotAt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theta: number,
  t: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(theta);
  drawRobotBody(ctx, 0, t);
  ctx.restore();
}

// === Per-stage demos ===========================================

function demoDelivery(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cy = H / 2 + 4;
  const STARTX = 24; // robot spawn point (left edge)
  const PICK = { x: 110, y: cy, color: "#5eead4" };
  const DROP = { x: W - 60, y: cy, color: "#7dd3fc" };
  // walls (stylized) — a small obstacle in the middle
  ctx.fillStyle = "rgba(125, 211, 252, 0.18)";
  ctx.fillRect(W / 2 - 14, 24, 28, 18);
  ctx.fillRect(W / 2 - 14, H - 42, 28, 18);
  // Spawn marker (subtle dashed circle so the start is obvious)
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.arc(STARTX, cy, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(125, 211, 252, 0.55)";
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("START", STARTX, cy - 16);
  ctx.restore();
  drawZone(ctx, PICK.x, PICK.y, 12, PICK.color, "PICKUP", t);
  drawZone(ctx, DROP.x, DROP.y, 12, DROP.color, "DROP", t);
  // Loop: START → PICKUP → DROP → reset
  //   0   .. 0.30  : drive START → PICKUP (empty)
  //   0.30 .. 0.36 : pickup celebration
  //   0.36 .. 0.80 : drive PICKUP → DROP (carrying)
  //   0.80 .. 0.90 : drop celebration
  //   0.90 .. 1.00 : robot fades out, teleport to START
  const LOOP = 5.5;
  const ph = (t % LOOP) / LOOP;
  let rx = STARTX;
  let carrying = false;
  let visible = true;
  if (ph < 0.3) {
    const u = ph / 0.3;
    rx = STARTX + (PICK.x - STARTX) * u;
  } else if (ph < 0.36) {
    rx = PICK.x;
    if (demoSparkles.length === 0) spawnSparkles(PICK.x, cy, PICK.color, 8);
  } else if (ph < 0.8) {
    const u = (ph - 0.36) / 0.44;
    rx = PICK.x + (DROP.x - PICK.x) * u;
    carrying = true;
  } else if (ph < 0.9) {
    rx = DROP.x;
    if (demoSparkles.length < 6) spawnSparkles(DROP.x, cy, DROP.color, 14);
  } else {
    visible = false;
    rx = STARTX;
    demoSparkles = [];
  }
  if (visible) drawRobotAt(ctx, rx, cy, 0, t);
  // tiny package on robot when carrying
  if (carrying) {
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(rx - 3, cy - 14, 6, 5);
    ctx.strokeStyle = "#d97706";
    ctx.lineWidth = 1;
    ctx.strokeRect(rx - 3, cy - 14, 6, 5);
  }
}

function demoFollower(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  // target wanders in a figure-8
  const cx = W / 2,
    cy = H / 2 + 2;
  const targetX = cx + Math.cos(t * 0.9) * 130;
  const targetY = cy + Math.sin(t * 1.8) * 24;
  // robot follows with delay
  const robotX = cx + Math.cos((t - 0.5) * 0.9) * 110;
  const robotY = cy + Math.sin((t - 0.5) * 1.8) * 20;
  // in-zone if close
  const dx = robotX - targetX,
    dy = robotY - targetY;
  const inZone = dx * dx + dy * dy < 28 * 28;
  // zone ring around target
  ctx.save();
  ctx.strokeStyle = inZone ? "#5eead4" : "rgba(125, 211, 252, 0.45)";
  ctx.fillStyle = inZone ? "rgba(94, 234, 212, 0.12)" : "rgba(125, 211, 252, 0.06)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(targetX, targetY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = inZone ? "#5eead4" : "#7dd3fc";
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("TARGET", targetX, targetY - 28);
  // target dot
  ctx.beginPath();
  ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // robot
  const heading = Math.atan2(targetY - robotY, targetX - robotX);
  drawRobotAt(ctx, robotX, robotY, heading, t);
}

function demoLidarExplorer(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  // tiny maze cells + 3 data points + lidar fan
  // walls (top and bottom border cells)
  ctx.fillStyle = "rgba(125, 211, 252, 0.16)";
  for (let x = 0; x < W; x += 22) {
    if (Math.floor(x / 22) % 3 === 0) {
      ctx.fillRect(x + 2, 12, 18, 14);
      ctx.fillRect(x + 2, H - 26, 18, 14);
    }
  }
  // 3 data dots
  const dots = [
    { x: W * 0.25, y: H / 2 + 4, hit: false },
    { x: W * 0.55, y: H / 2 + 4, hit: false },
    { x: W * 0.85, y: H / 2 + 4, hit: false },
  ];
  const cy = H / 2 + 4;
  const LOOP = 5.4;
  const ph = (t % LOOP) / LOOP;
  // robot drives left to right, lighting dots when reached
  const rx = 30 + (W - 60) * ph;
  for (const d of dots) {
    d.hit = rx >= d.x - 4;
    ctx.save();
    ctx.fillStyle = d.hit ? "#c4b5fd" : "rgba(196, 181, 253, 0.35)";
    ctx.strokeStyle = "#c4b5fd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (d.hit && Math.abs(rx - d.x) < 2) spawnSparkles(d.x, d.y, "#c4b5fd", 6);
  }
  // LiDAR fan
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.4)";
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(rx, cy);
    ctx.lineTo(rx + Math.cos(a) * 40, cy + Math.sin(a) * 28);
    ctx.stroke();
  }
  ctx.restore();
  drawRobotAt(ctx, rx, cy, 0, t);
}

function demoPatrol(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  // 3 hack rings (top), 1 enemy with rotating cone (right-mid), escape gate (right)
  const cy = H / 2 + 4;
  const HACKS = [
    { x: 60, y: 28, hit: false, color: "#fbbf24" },
    { x: 130, y: H - 28, hit: false, color: "#fbbf24" },
    { x: 220, y: 28, hit: false, color: "#fbbf24" },
  ];
  const escapeX = W - 40;
  // Enemy patrolling
  const enemyX = W * 0.55 + Math.cos(t * 1.2) * 24;
  const enemyY = cy;
  const coneA = Math.sin(t * 0.8) * 0.6;
  // walls
  ctx.fillStyle = "rgba(125, 211, 252, 0.16)";
  ctx.fillRect(110, 56, 30, 8);
  ctx.fillRect(260, 56, 30, 8);
  // hacks
  HACKS.forEach((h, i) => {
    h.hit = t % 8 > i * 1.4 + 0.4;
    ctx.save();
    ctx.strokeStyle = h.color;
    ctx.fillStyle = h.hit ? h.color + "60" : h.color + "20";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(h.x, h.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (h.hit) {
      ctx.fillStyle = h.color;
      ctx.font = "700 7px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("✓", h.x, h.y + 2);
    }
    ctx.restore();
  });
  // enemy + vision cone
  ctx.save();
  ctx.translate(enemyX, enemyY);
  ctx.rotate(Math.PI + coneA);
  ctx.fillStyle = "rgba(251, 113, 133, 0.18)";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 38, -0.5, 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#fb7185";
  ctx.beginPath();
  ctx.arc(enemyX, enemyY, 6, 0, Math.PI * 2);
  ctx.fill();
  // escape gate
  drawZone(ctx, escapeX, cy, 12, "#5eead4", "ESCAPE", t);
  // robot path: weave between hacks then dash to escape
  const LOOP = 8;
  const ph = (t % LOOP) / LOOP;
  let rx = 40,
    ry = cy;
  if (ph < 0.7) {
    // visit hacks
    const i = Math.min(2, Math.floor(ph / 0.23));
    const u = (ph - i * 0.23) / 0.23;
    const from = i === 0 ? { x: 40, y: cy } : HACKS[i - 1];
    const to = HACKS[i];
    rx = from.x + (to.x - from.x) * u;
    ry = from.y + (to.y - from.y) * u;
  } else {
    const u = (ph - 0.7) / 0.3;
    rx = HACKS[2].x + (escapeX - HACKS[2].x) * u;
    ry = HACKS[2].y + (cy - HACKS[2].y) * u;
  }
  drawRobotAt(ctx, rx, ry, Math.atan2(0, 1), t);
}

function demoRacing(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cx = W / 2,
    cy = H / 2 + 4;
  const rx = (W - 60) / 2,
    ry = H / 2 - 18;
  // track
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.15)";
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
  // finish line
  ctx.save();
  ctx.fillStyle = "#fbbf24";
  ctx.fillRect(cx + rx - 3, cy - 8, 6, 16);
  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", cx + rx, cy - 14);
  ctx.restore();
  // racer (player) + opponent ghost
  const a1 = (t * 0.9) % (Math.PI * 2);
  const a2 = ((t - 0.6) * 0.85) % (Math.PI * 2);
  const p1x = cx + Math.cos(a1) * rx;
  const p1y = cy + Math.sin(a1) * ry;
  const p2x = cx + Math.cos(a2) * rx;
  const p2y = cy + Math.sin(a2) * ry;
  // opponent (faded)
  ctx.save();
  ctx.globalAlpha = 0.45;
  drawRobotAt(ctx, p2x, p2y, a2 + Math.PI / 2, t);
  ctx.restore();
  drawRobotAt(ctx, p1x, p1y, a1 + Math.PI / 2, t);
}

function demoRoboSoccer(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cy = H / 2 + 2;
  // field
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(20, 22, W - 40, H - 44);
  ctx.beginPath();
  ctx.moveTo(W / 2, 22);
  ctx.lineTo(W / 2, H - 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(W / 2, cy, 14, 0, Math.PI * 2);
  ctx.stroke();
  // goals
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.strokeRect(14, cy - 18, 8, 36);
  ctx.strokeStyle = "#fb7185";
  ctx.strokeRect(W - 22, cy - 18, 8, 36);
  ctx.restore();
  // ball + robot loop: kick ball into right goal
  const LOOP = 3.4;
  const ph = (t % LOOP) / LOOP;
  let bx: number,
    by = cy;
  let rx: number;
  if (ph < 0.55) {
    // robot pushes ball from center → right
    const u = ph / 0.55;
    bx = W / 2 + (W - 30 - W / 2) * u;
    rx = bx - 14;
  } else if (ph < 0.7) {
    bx = W - 18; // ball in goal
    rx = W - 38;
    if (demoSparkles.length === 0) spawnSparkles(W - 18, cy, "#fb7185", 16);
  } else {
    bx = W / 2; // reset
    rx = W / 2 - 30;
    demoSparkles = [];
  }
  // ball
  ctx.save();
  ctx.fillStyle = "#fef3e8";
  ctx.strokeStyle = "#0c1124";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  drawRobotAt(ctx, rx, cy, 0, t);
}

function demoTreasureMap(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cy = H / 2 + 4;
  const CHESTS = [
    { x: W * 0.25, y: cy - 18, got: false },
    { x: W * 0.5, y: cy + 18, got: false },
    { x: W * 0.75, y: cy - 18, got: false },
  ];
  // walls (random-looking maze cells)
  ctx.fillStyle = "rgba(125, 211, 252, 0.16)";
  ctx.fillRect(80, 26, 16, 14);
  ctx.fillRect(160, H - 38, 16, 14);
  ctx.fillRect(260, 26, 16, 14);
  // exit (rightmost)
  drawZone(ctx, W - 30, cy, 10, "#5eead4", "EXIT", t);
  // animation: visit chests sequentially in a zigzag
  const LOOP = 6;
  const ph = (t % LOOP) / LOOP;
  let target: { x: number; y: number };
  let i: number;
  if (ph < 0.75) {
    i = Math.min(2, Math.floor(ph / 0.25));
    target = CHESTS[i];
  } else {
    i = 3;
    target = { x: W - 30, y: cy };
  }
  CHESTS.forEach((c, idx) => {
    c.got = idx < i || (idx === i && ph % 0.25 > 0.18);
  });
  const u = (ph % 0.25) / 0.25;
  const from = i === 0 ? { x: 30, y: cy } : i === 3 ? CHESTS[2] : CHESTS[i - 1];
  const rx = from.x + (target.x - from.x) * u;
  const ry = from.y + (target.y - from.y) * u;
  // chests
  CHESTS.forEach((c) => {
    ctx.save();
    ctx.fillStyle = c.got ? "rgba(251, 191, 36, 0.25)" : "#fbbf24";
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1;
    ctx.fillRect(c.x - 5, c.y - 4, 10, 8);
    ctx.strokeRect(c.x - 5, c.y - 4, 10, 8);
    if (!c.got) {
      ctx.fillStyle = "#1f1408";
      ctx.font = "700 6px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("$", c.x, c.y + 2);
    } else {
      ctx.fillStyle = "#fbbf24";
      ctx.font = "700 7px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("✓", c.x, c.y + 2);
    }
    ctx.restore();
  });
  drawRobotAt(ctx, rx, ry, Math.atan2(target.y - from.y, target.x - from.x), t);
}

function demoSumoBattle(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cx = W / 2,
    cy = H / 2 + 4;
  const R = H / 2 - 16;
  // Dohyo ring with tawara edge.
  ctx.save();
  ctx.fillStyle = "rgba(30, 38, 70, 0.55)";
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#b08d57";
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Loop: approach → clash at center → rival shoved out to the right.
  const LOOP = 5;
  const ph = (t % LOOP) / LOOP;
  let px: number, ex: number;
  if (ph < 0.35) {
    const u = ph / 0.35;
    px = cx - R + 20 + (R - 34) * u; // player walks in from the left
    ex = cx + R - 20 - (R - 34) * u; // rival walks in from the right
  } else if (ph < 0.5) {
    px = cx - 14;
    ex = cx + 14; // locked together at the shikiri
    if (demoSparkles.length === 0) spawnSparkles(cx, cy, "#7dd3fc", 12);
  } else if (ph < 0.9) {
    const u = (ph - 0.5) / 0.4; // boost shove: rival crosses the tawara
    px = cx - 14 + R * 0.45 * u;
    ex = cx + 14 + (R + 6 - 14) * u;
    if (u > 0.85 && demoSparkles.length === 0) spawnSparkles(cx + R, cy, "#fbbf24", 16);
  } else {
    px = cx - R + 20;
    ex = cx + R - 20;
    demoSparkles = [];
  }
  // Rival (faded, facing left).
  ctx.save();
  ctx.globalAlpha = 0.5;
  drawRobotAt(ctx, ex, cy, Math.PI, t);
  ctx.restore();
  drawRobotAt(ctx, px, cy, 0, t);
}

function demoTagChase(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const cx = W / 2,
    cy = H / 2 + 4;
  // Arena + obstacles that break line of sight.
  ctx.save();
  ctx.strokeStyle = "rgba(125, 211, 252, 0.25)";
  ctx.lineWidth = 1;
  ctx.strokeRect(16, 20, W - 32, H - 40);
  ctx.fillStyle = "rgba(125, 211, 252, 0.16)";
  ctx.fillRect(cx - 50, cy - 26, 18, 14);
  ctx.fillRect(cx + 34, cy + 12, 18, 14);
  ctx.restore();
  // Runner loops an ellipse; two taggers trail behind at fixed phase lags.
  const rx = W / 2 - 46,
    ry = H / 2 - 34;
  const a = t * 1.1;
  const runX = cx + Math.cos(a) * rx;
  const runY = cy + Math.sin(a) * ry;
  for (const lag of [0.55, 0.95]) {
    const ta = a - lag;
    ctx.save();
    ctx.fillStyle = lag === 0.55 ? "#fb7185" : "#fbbf24";
    ctx.beginPath();
    ctx.arc(cx + Math.cos(ta) * rx, cy + Math.sin(ta) * ry, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawRobotAt(ctx, runX, runY, a + Math.PI / 2, t);
  // Survival timer countdown.
  ctx.save();
  ctx.fillStyle = "#fbbf24";
  ctx.font = "700 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`⏱ ${(30 - ((t * 4) % 30)).toFixed(0)}s`, cx, 16);
  ctx.restore();
}

function demoRoboBaseball(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const groundY = H - 30;
  const pitcherX = 58;
  const batterX = W - 58;
  const targetY = H / 2 + 8;

  ctx.fillStyle = "#173f2d";
  ctx.fillRect(0, groundY - 32, W, 48);
  ctx.fillStyle = "#9f704b";
  ctx.fillRect(0, groundY, W, H - groundY);
  ctx.strokeStyle = "rgba(255,255,255,.65)";
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(W, groundY);
  ctx.stroke();
  ctx.fillStyle = "rgba(125,211,252,.12)";
  ctx.fillRect(0, groundY - 54, W, 22);
  for (let x = 8; x < W; x += 17) {
    ctx.fillStyle = ["#7dd3fc", "#fbbf24", "#f472b6"][x % 3];
    ctx.fillRect(x, groundY - 47, 3, 3);
  }

  drawRobotAt(ctx, pitcherX, groundY - 13, 0, t);
  ctx.save();
  ctx.translate(batterX, groundY - 13);
  ctx.rotate(Math.PI);
  ctx.scale(1.15, 1.15);
  drawRobotBody(ctx, 0, t);
  ctx.restore();
  ctx.strokeStyle = "rgba(125,211,252,.62)";
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(batterX - 39, targetY - 35, 47, 68);
  ctx.setLineDash([]);

  const phase = (t % 3.6) / 3.6;
  const hit = phase >= 0.7;
  let bx: number;
  let by: number;
  if (!hit) {
    const u = phase / 0.7;
    const eased = u * u * (3 - 2 * u);
    bx = pitcherX + 18 + (batterX - pitcherX - 36) * eased;
    by = targetY - Math.sin(u * Math.PI) * 25;
    ctx.strokeStyle = "rgba(94,234,212,.42)";
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(batterX - 27, targetY);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    const u = (phase - 0.7) / 0.3;
    bx = batterX - 26 - u * (W - 112);
    by = targetY - u * 95 + u * u * 46;
  }

  ctx.save();
  ctx.translate(batterX - 13, groundY - 27);
  ctx.rotate(hit ? Math.PI + 0.1 : -0.95);
  ctx.strokeStyle = "#fbbf24";
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(48, 0);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = "#5eead4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(batterX - 27, targetY, 10, 0, Math.PI * 2);
  ctx.moveTo(batterX - 42, targetY);
  ctx.lineTo(batterX - 34, targetY);
  ctx.moveTo(batterX - 20, targetY);
  ctx.lineTo(batterX - 12, targetY);
  ctx.stroke();
  ctx.fillStyle = "#5eead4";
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText("PREDICT", batterX - 27, targetY - 16);

  ctx.shadowColor = "#fef3c7";
  ctx.shadowBlur = hit ? 12 : 6;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (hit && phase < 0.78) {
    ctx.fillStyle = "#fbbf24";
    ctx.font = "900 16px ui-monospace, monospace";
    ctx.fillText("NICE HIT!", W / 2, 26);
  }
}

function demoRoboTennis(ctx: CanvasRenderingContext2D, W: number, H: number, t: number): void {
  const court = { x: 24, y: 18, w: W - 48, h: H - 36 };
  ctx.fillStyle = "#176b61";
  ctx.fillRect(court.x, court.y, court.w, court.h);
  ctx.fillStyle = "rgba(5,46,42,.25)";
  ctx.fillRect(W / 2, court.y, court.w / 2, court.h);
  ctx.strokeStyle = "rgba(255,255,255,.82)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(court.x, court.y, court.w, court.h);
  const singlesTop = court.y + 14;
  const singlesBottom = court.y + court.h - 14;
  const serviceLeft = W / 2 - 110;
  const serviceRight = W / 2 + 110;
  ctx.beginPath();
  ctx.moveTo(court.x, singlesTop);
  ctx.lineTo(court.x + court.w, singlesTop);
  ctx.moveTo(court.x, singlesBottom);
  ctx.lineTo(court.x + court.w, singlesBottom);
  ctx.moveTo(W / 2, court.y);
  ctx.lineTo(W / 2, court.y + court.h);
  ctx.moveTo(serviceLeft, singlesTop);
  ctx.lineTo(serviceLeft, singlesBottom);
  ctx.moveTo(serviceRight, singlesTop);
  ctx.lineTo(serviceRight, singlesBottom);
  ctx.moveTo(serviceLeft, H / 2);
  ctx.lineTo(serviceRight, H / 2);
  ctx.stroke();
  ctx.fillStyle = "#dbeafe";
  ctx.fillRect(W / 2 - 2, court.y - 6, 4, court.h + 12);

  const phase = (t * 0.3) % 1;
  const right = phase < 0.5;
  const u = right ? phase * 2 : (phase - 0.5) * 2;
  const leftX = court.x + 45;
  const rightX = court.x + court.w - 45;
  const bx = (right ? leftX : rightX) + ((right ? rightX : leftX) - (right ? leftX : rightX)) * u;
  const lane = H / 2 + Math.sin(t * 1.35) * 38;
  const by = lane - Math.sin(u * Math.PI) * 45;
  const leftY = H / 2 + Math.sin((t - 0.3) * 1.35) * 35;
  const rightY = H / 2 + Math.sin((t - 0.1) * 1.35) * 35;

  drawRobotAt(ctx, leftX, leftY, 0, t);
  drawRobotAt(ctx, rightX, rightY, Math.PI, t);
  for (const [x, y, a, color] of [
    [leftX + 14, leftY - 3, -0.72, "#fbbf24"],
    [rightX - 14, rightY - 3, Math.PI + 0.72, "#f472b6"],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(18, 0);
    ctx.ellipse(27, 0, 8, 12, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.beginPath();
  ctx.ellipse(bx, lane + 5, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "#d9f99d";
  ctx.shadowBlur = 10;
  ctx.fillStyle = "#d9f99d";
  ctx.beginPath();
  ctx.arc(bx, by, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#5eead4";
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`RALLY ${1 + (Math.floor(t * 0.7) % 8)}`, W / 2, 13);
}

const STAGE_DEMO: Record<
  string,
  (ctx: CanvasRenderingContext2D, W: number, H: number, t: number) => void
> = {
  delivery: demoDelivery,
  follower: demoFollower,
  lidar_explorer: demoLidarExplorer,
  patrol: demoPatrol,
  racing: demoRacing,
  robo_soccer: demoRoboSoccer,
  treasure_map: demoTreasureMap,
  tag_chase: demoTagChase,
  sumo_battle: demoSumoBattle,
  robo_baseball: demoRoboBaseball,
  robo_tennis: demoRoboTennis,
};

function drawDemo(stageId: string, now: number): void {
  const canvas = document.getElementById("lesson-demo-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  const dt = demoLastTime ? Math.min(0.05, (now - demoLastTime) / 1000) : 0;
  demoLastTime = now;
  const elapsed = (now - demoStart) / 1000;

  // Clear with a stage-themed background
  clearBackground(ctx, W, H);
  // subtle dotted grid
  ctx.fillStyle = "rgba(125, 211, 252, 0.05)";
  for (let x = 12; x < W; x += 16) for (let y = 12; y < H; y += 16) ctx.fillRect(x, y, 1, 1);

  const fn = STAGE_DEMO[stageId];
  if (fn) {
    fn(ctx, W, H, elapsed);
  } else {
    // Fallback: simple straight-line drive
    const LANE = H / 2 + 4;
    drawZone(ctx, W - 50, LANE, 14, "#5eead4", "GOAL", elapsed);
    const ph = (elapsed % 4) / 4;
    const u = Math.min(1, ph / 0.7);
    const rx = 36 + (W - 86) * u;
    drawRobotAt(ctx, rx, LANE, 0, elapsed);
  }

  updateSparkles(ctx, dt);

  // Light "key" indicator showing it's an interactive game
  ctx.save();
  ctx.font = "700 9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(125, 211, 252, 0.35)";
  ctx.fillText("DEMO", 8, 14);
  ctx.restore();
}

export function startDemo(stageId: string): void {
  stopDemo();
  demoStart = performance.now();
  demoLastTime = 0;
  demoSparkles = [];
  const loop = (now: number) => {
    drawDemo(stageId, now);
    demoRaf = requestAnimationFrame(loop);
  };
  demoRaf = requestAnimationFrame(loop);
}

export function stopDemo(): void {
  if (demoRaf) cancelAnimationFrame(demoRaf);
  demoRaf = 0;
  demoSparkles = [];
}
