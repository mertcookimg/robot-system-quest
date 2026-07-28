// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Common Canvas-2D drawing utilities shared by every stage.
import { W, H, type Particle } from "../types";
import { theme, withA } from "../core/theme";

const ACCENT = "#7dd3fc";
const ACCENT_2 = "#c4b5fd";
const FG_DIM = "#6e7a9c";
// Fixed near-black used as a *contrast* color (e.g. text on an accent chip).
// The canvas ground itself comes from the themeable theme.canvasBg.
const BG_DARK = "#000000";
const FG = "#eef2ff";

/** Fill the whole canvas with the active theme's backdrop color. */
export function clearBackground(ctx: CanvasRenderingContext2D, width = W, height = H) {
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, width, height);
}

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  width = W,
  height = H,
  color = "rgba(35, 44, 77, 0.5)",
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 50) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 50) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

export function drawZone(
  ctx: CanvasRenderingContext2D,
  zone: { x: number; y: number; r: number },
  color: string,
  label: string,
  animTime: number,
) {
  const pulse = 0.7 + 0.3 * Math.sin(animTime * 3);
  ctx.save();
  // Double ring.
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.4 * pulse;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, zone.r * (1.2 + 0.15 * pulse), 0, Math.PI * 2);
  ctx.stroke();
  // Center fill.
  ctx.globalAlpha = 0.12 * pulse;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, zone.r * 0.85, 0, Math.PI * 2);
  ctx.fill();
  // Center dot.
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(zone.x, zone.y, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Label.
  ctx.font = "600 10px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color;
  ctx.fillText(label, zone.x, zone.y - zone.r - 10);
  ctx.restore();
}

export function drawRobotBody(ctx: CanvasRenderingContext2D, bumpFlash = 0, animTime = 0) {
  const hurt = bumpFlash > 0;

  // Limited palette: only 5 colors.
  const OUT = hurt ? "#5e1f3e" : "#2d2540";
  const BODY = hurt ? "#fda4af" : "#fef3e8";
  const BODY_LO = hurt ? "#fb7185" : "#e8d5c4";
  const ACCENT = hurt ? "#fb7185" : "#7dd3fc";
  const CHEEK = hurt ? "#fb7185" : "#f7a8c4";

  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };

  // Breathing: bob the body 1px up/down. The ground shadow doesn't bob.
  const bob = Math.round(Math.sin(animTime * 1.6));

  // -- Ground shadow (single line, doesn't move).
  px(-9, 14, 19, 1, "rgba(0, 0, 0, 0.32)");

  ctx.save();
  ctx.translate(0, bob);

  // -- Body (compact pixel-rounded rectangle).
  // Outline silhouette.
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
  // 1px outline via 4-direction shift.
  sil(OUT, 0, -1);
  sil(OUT, 0, 1);
  sil(OUT, -1, 0);
  sil(OUT, 1, 0);
  // Main color.
  sil(BODY);
  // One-line shadow at the bottom edge.
  px(-9, 7, 19, 1, BODY_LO);

  // -- Side tires (left and right, kept simple).
  px(-3, -11, 6, 1, OUT);
  px(-3, 10, 6, 1, OUT);

  // -- Forward marker (cyan 1px dot on the +x side).
  px(10, -1, 1, 3, ACCENT);

  // -- Face (small, biased toward the front).
  const blinkPhase = Math.sin(animTime * 1.5);
  const blinking = blinkPhase > 0.95;

  if (blinking) {
    // Closed eyes (- -).
    px(2, -2, 2, 1, OUT);
    px(2, 2, 2, 1, OUT);
  } else {
    // Pupils (2x2).
    px(2, -3, 2, 2, OUT);
    px(2, 1, 2, 2, OUT);
    // 1px highlight.
    px(3, -3, 1, 1, "#ffffff");
    px(3, 1, 1, 1, "#ffffff");
  }

  // -- Cheeks (1x1 pink dots).
  px(6, -1, 1, 1, CHEEK);
  px(6, 1, 1, 1, CHEEK);

  // -- Smiling mouth (small 3-pixel arc).
  px(7, 0, 1, 1, OUT);
  px(8, 1, 1, 1, OUT);

  ctx.restore();
}

// === Ghost (best run replay) ===
export function drawGhost(
  ctx: CanvasRenderingContext2D,
  pose: { x: number; y: number; theta: number },
  animTime: number,
) {
  ctx.save();
  ctx.translate(pose.x, pose.y);
  ctx.rotate(pose.theta);

  // Flicker for a ghostly feel.
  const flicker = 0.6 + 0.1 * Math.sin(animTime * 8);

  // Pixel-art ghost: outline only, in light purple.
  const px = (x: number, y: number, w: number, h: number) => ctx.fillRect(x, y, w, h);

  ctx.globalAlpha = 0.85 * flicker;
  ctx.fillStyle = "#c4b5fd";
  // Silhouette outline.
  px(-6, -10, 13, 1);
  px(-6, 9, 13, 1);
  px(-8, -9, 17, 1);
  px(-8, 8, 17, 1);
  px(-9, -8, 19, 1);
  px(-9, 7, 19, 1);
  px(-10, -7, 1, 15);
  px(10, -7, 1, 15);

  // Face.
  ctx.globalAlpha = 0.9 * flicker;
  px(2, -3, 2, 2);
  px(2, 1, 2, 2);

  // GHOST label.
  ctx.globalAlpha = 0.85 * flicker;
  ctx.font = "700 6.5px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.rotate(-pose.theta);
  ctx.fillText("GHOST", 0, 18);

  ctx.restore();
}

export function drawRobotLabel(_ctx: CanvasRenderingContext2D) {
  // Retro & simple finish — the body itself communicates enough that we
  // skip a model-number label.
}

export function drawTimer(ctx: CanvasRenderingContext2D, elapsed: number, best?: number) {
  ctx.save();
  const w = 110;
  const h = best != null ? 42 : 26;
  const x = W - w - 12;
  const y = 12;

  ctx.fillStyle = withA(theme.scrim, 0.85);
  ctx.strokeStyle = "rgba(125, 211, 252, 0.3)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  // TIME
  ctx.fillStyle = ACCENT;
  ctx.font = "600 12px ui-monospace, monospace";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const timeY = best != null ? y + 12 : y + h / 2;
  ctx.fillText(`${elapsed.toFixed(2)}s`, x + w - 10, timeY);
  ctx.fillStyle = FG_DIM;
  ctx.font = "9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText("TIME", x + 10, timeY + 1);

  // BEST
  if (best != null) {
    const bestY = y + 30;
    ctx.fillStyle = "#fbbf24";
    ctx.font = "600 11px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${best.toFixed(2)}s`, x + w - 10, bestY);
    ctx.fillStyle = FG_DIM;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("BEST", x + 10, bestY + 1);
  }
  ctx.restore();
}

export function drawHint(ctx: CanvasRenderingContext2D, text: string) {
  ctx.save();
  ctx.fillStyle = FG_DIM;
  ctx.font = "10px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(text, 14, H - 14);
  ctx.restore();
}

export function updateParticles(particles: Particle[], dt: number) {
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94;
    p.vy *= 0.94;
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].age >= particles[i].life) particles.splice(i, 1);
  }
}

export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const t = 1 - p.age / p.life;
    ctx.globalAlpha = t;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function spawnBurst(
  particles: Particle[],
  x: number,
  y: number,
  color: string,
  count = 28,
  speed = 220,
) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const s = speed * (0.5 + Math.random() * 0.7);
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.6 + Math.random() * 0.5,
      age: 0,
      color,
      size: 2 + Math.random() * 3,
    });
  }
}

export function fmtTwist(lin: number, ang: number): string {
  const l = lin.toFixed(2).padStart(6, " ");
  const a = ang.toFixed(2).padStart(6, " ");
  return `geometry_msgs/msg/Twist linear.x:${l} angular.z:${a}`;
}

// Export the palette for factory use.
export const COLORS = {
  ACCENT,
  ACCENT_2,
  FG_DIM,
  BG_DARK,
  FG,
  OK: "#5eead4",
  WARN: "#fbbf24",
  DANGER: "#fb7185",
};
