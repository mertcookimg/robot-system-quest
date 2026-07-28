// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { drawRobotBody } from "../lib/draw";

let raf = 0;
let startedAt = 0;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function draw(now: number, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const W = canvas.width;
  const H = canvas.height;
  const t = (now - startedAt) / 1000;

  ctx.clearRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(W * 0.52, H * 0.55, 10, W * 0.52, H * 0.55, W * 0.55);
  glow.addColorStop(0, "rgba(125, 211, 252, 0.09)");
  glow.addColorStop(0.65, "rgba(196, 181, 253, 0.025)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Technical map grid.
  ctx.strokeStyle = "rgba(125, 211, 252, 0.075)";
  ctx.lineWidth = 1;
  for (let x = 20; x < W; x += 24) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, H);
    ctx.stroke();
  }
  for (let y = 14; y < H; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
  }

  // Route and checkpoints.
  const y = 79;
  const startX = 62;
  const goalX = W - 66;
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.lineDashOffset = -t * 14;
  ctx.strokeStyle = "rgba(125, 211, 252, 0.38)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(startX, y);
  ctx.bezierCurveTo(W * 0.3, 35, W * 0.48, 122, W * 0.62, 75);
  ctx.bezierCurveTo(W * 0.75, 35, W * 0.82, 82, goalX, y);
  ctx.stroke();
  ctx.restore();

  const nodes = [
    { x: startX, y, label: "START", color: "#7dd3fc" },
    { x: W * 0.35, y: 65, label: "SENSE", color: "#c4b5fd" },
    { x: W * 0.64, y: 70, label: "PLAN", color: "#c4b5fd" },
    { x: goalX, y, label: "GOAL", color: "#5eead4" },
  ];
  for (const node of nodes) {
    const pulse = 7 + Math.sin(t * 2.4 + node.x) * 1.5;
    ctx.strokeStyle = node.color;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(node.x, node.y, pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = node.color;
    ctx.fillRect(node.x - 2, node.y - 2, 4, 4);
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(node.label, node.x, node.y + 20);
  }

  // A few map obstacles.
  ctx.fillStyle = "rgba(196, 181, 253, 0.13)";
  ctx.strokeStyle = "rgba(196, 181, 253, 0.35)";
  for (const [x, oy, w, h] of [
    [180, 21, 54, 18],
    [395, 101, 70, 17],
    [548, 17, 44, 19],
  ] as const) {
    roundedRect(ctx, x, oy, w, h, 3);
    ctx.fill();
    ctx.stroke();
  }

  // Looping robot, eased slightly at each end.
  const phase = (t % 7) / 7;
  const travel = phase < 0.82 ? phase / 0.82 : 1 - (phase - 0.82) / 0.18;
  const eased = travel * travel * (3 - 2 * travel);
  const robotX = startX + (goalX - startX) * eased;
  const robotY = y - Math.sin(eased * Math.PI * 4) * 11;

  // Lidar sweep.
  ctx.save();
  ctx.translate(robotX, robotY);
  ctx.rotate(Math.sin(t * 1.1) * 0.06);
  const sweep = ctx.createRadialGradient(0, 0, 4, 0, 0, 48);
  sweep.addColorStop(0, "rgba(125, 211, 252, 0.22)");
  sweep.addColorStop(1, "rgba(125, 211, 252, 0)");
  ctx.fillStyle = sweep;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 48, -0.48, 0.48);
  ctx.closePath();
  ctx.fill();
  ctx.scale(1.45, 1.45);
  drawRobotBody(ctx, 0, t);
  ctx.restore();

  // Telemetry particles moving toward the robot.
  for (let i = 0; i < 9; i++) {
    const p = (t * 0.22 + i / 9) % 1;
    ctx.globalAlpha = 0.2 + p * 0.6;
    ctx.fillStyle = i % 3 === 0 ? "#c4b5fd" : "#7dd3fc";
    ctx.fillRect(20 + p * (robotX - 35), 18 + (i % 3) * 5, 2, 2);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(125, 211, 252, 0.46)";
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(`X ${robotX.toFixed(1).padStart(5, "0")}  V 0.25 m/s`, 14, H - 9);

  raf = requestAnimationFrame((next) => draw(next, canvas, ctx));
}

export function setupIntroRobot(): void {
  const canvas = document.getElementById("intro-robot-canvas") as HTMLCanvasElement | null;
  const screen = document.getElementById("intro-screen");
  const ctx = canvas?.getContext("2d");
  if (!canvas || !screen || !ctx) return;

  const sync = (): void => {
    const shouldRun = screen.classList.contains("show") && !document.hidden;
    if (shouldRun && !raf) {
      startedAt = performance.now();
      raf = requestAnimationFrame((now) => draw(now, canvas, ctx));
    } else if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  new MutationObserver(sync).observe(screen, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("visibilitychange", sync);
  sync();
}
