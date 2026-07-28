// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Background "ambient" canvas: drifting stars + clear-screen confetti.
// Lives on its own canvas so it's not erased by stage redraws.

interface Star {
  x: number;
  y: number;
  r: number;
  vy: number;
  tw: number;
}
interface Conf {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  color: string;
  size: number;
  life: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
const stars: Star[] = [];
const confetti: Conf[] = [];

const CONFETTI_COLORS = ["#7dd3fc", "#a78bfa", "#5eead4", "#fcd34d", "#fb7185", "#eef2ff"];

function reseed(): void {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  stars.length = 0;
  for (let i = 0; i < 50; i++) {
    stars.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.2 + 0.3,
      vy: 0.04 + Math.random() * 0.12,
      tw: Math.random() * Math.PI * 2,
    });
  }
}

export function setupAmbient(canvasEl: HTMLCanvasElement): void {
  canvas = canvasEl;
  ctx = canvasEl.getContext("2d");
  reseed();
  window.addEventListener("resize", reseed);
}

export function spawnConfetti(count = 90): void {
  if (!canvas) return;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  for (let i = 0; i < count; i++) {
    confetti.push({
      x: cx + (Math.random() - 0.5) * 100,
      y: cy + (Math.random() - 0.5) * 60,
      vx: (Math.random() - 0.5) * 600,
      vy: -250 - Math.random() * 400,
      rot: Math.random() * Math.PI * 2,
      vrot: (Math.random() - 0.5) * 8,
      color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      size: 4 + Math.random() * 5,
      life: 4,
    });
  }
}

export function tick(dt: number): void {
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Stars
  for (const s of stars) {
    s.y += s.vy * 60 * dt;
    s.tw += dt * 1.5;
    if (s.y > canvas.height) s.y = -2;
    const a = 0.18 + 0.18 * Math.sin(s.tw);
    ctx.fillStyle = `rgba(167, 200, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Confetti
  if (confetti.length === 0) return;
  for (const c of confetti) {
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.vy += 600 * dt;
    c.vx *= 0.99;
    c.rot += c.vrot * dt;
    c.life -= dt;
  }
  for (let i = confetti.length - 1; i >= 0; i--) {
    if (confetti[i].life <= 0 || confetti[i].y > canvas.height + 20) {
      confetti.splice(i, 1);
    }
  }
  for (const c of confetti) {
    const alpha = Math.min(1, c.life);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    ctx.rotate(c.rot);
    ctx.fillStyle = c.color;
    ctx.fillRect(-c.size / 2, -c.size * 0.6, c.size, c.size * 1.2);
    ctx.restore();
  }
}
