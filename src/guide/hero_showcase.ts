// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { COLORS as C, drawRobotBody } from "../lib/draw";
import { theme, themeColor, withA, onThemeChange } from "../core/theme";

type Point = { x: number; y: number };

const scenes = [
  { title: "DELIVERY // NAVIGATION", log: "/cmd_vel → delivery_robot" },
  { title: "EXPLORER // LIDAR", log: "/scan → obstacle map" },
  { title: "SOCCER // COORDINATION", log: "/ball_pose → striker" },
  { title: "RESCUE // MULTI ROBOT", log: "/rescue/status → team" },
] as const;

function grid(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = withA(theme.accent, 0.055);
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 28) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = withA(theme.fgMid, 1),
  align: CanvasTextAlign = "left",
): void {
  ctx.fillStyle = color;
  ctx.font = '700 12px "Cascadia Mono", ui-monospace, monospace';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
}

function robot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  _color: string,
  t: number,
  scale = 1,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(scale * 2.1, scale * 2.1);
  drawRobotBody(ctx, 0, t);
  ctx.restore();
}

function polyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  progress: number,
  color: string,
): Point & { angle: number } {
  const scaled = progress * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(scaled));
  const p = scaled - segment;
  const from = points[segment];
  const to = points[segment + 1];
  const current = {
    x: from.x + (to.x - from.x) * p,
    y: from.y + (to.y - from.y) * p,
    angle: Math.atan2(to.y - from.y, to.x - from.x),
  };
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i <= segment; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.lineTo(current.x, current.y);
  ctx.stroke();
  ctx.lineWidth = 1;
  return current;
}

function delivery(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const shelves = [
    { x: w * 0.29, y: 48, width: 22, height: 116 },
    { x: w * 0.55, y: 105, width: 22, height: 116 },
  ];
  shelves.forEach((shelf) => {
    ctx.fillStyle = withA(theme.line, 0.6);
    ctx.strokeStyle = withA(theme.accent, 0.24);
    ctx.beginPath();
    ctx.roundRect(shelf.x, shelf.y, shelf.width, shelf.height, 4);
    ctx.fill();
    ctx.stroke();
  });
  const route = [
    { x: 65, y: 78 },
    { x: w * 0.22, y: 78 },
    { x: w * 0.22, y: h * 0.76 },
    { x: w * 0.46, y: h * 0.76 },
    { x: w * 0.46, y: h * 0.26 },
    { x: w * 0.69, y: h * 0.26 },
    { x: w - 72, y: 70 },
  ];
  ctx.strokeStyle = withA(theme.accent, 0.22);
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  route.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.stroke();
  ctx.setLineDash([]);
  const p = polyline(ctx, route, (t * 0.16) % 1, withA(theme.accent, 0.72));
  robot(ctx, p.x, p.y, p.angle, C.ACCENT, t);
  ctx.fillStyle = withA(theme.ok, 0.1);
  ctx.strokeStyle = C.OK;
  ctx.beginPath();
  ctx.arc(route.at(-1)!.x, route.at(-1)!.y, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  label(ctx, "DELIVERY GOAL", route.at(-1)!.x, route.at(-1)!.y - 32, C.OK, "center");
}

function explorer(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const obstacles = [
    { x: w * 0.27, y: h * 0.28, r: 26 },
    { x: w * 0.7, y: h * 0.65, r: 34 },
    { x: w * 0.78, y: h * 0.24, r: 18 },
  ];
  obstacles.forEach((o) => {
    ctx.fillStyle = withA(theme.line, 0.65);
    ctx.strokeStyle = withA(themeColor("#1d4ea0", "#7aa7ff"), 0.34);
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  });
  // Keep clearance for the full robot body while weaving between obstacles.
  const route = [
    { x: 65, y: h - 48 },
    { x: w * 0.2, y: h * 0.63 },
    { x: w * 0.39, y: h * 0.63 },
    { x: w * 0.49, y: h - 42 },
    { x: w * 0.57, y: h - 42 },
    { x: w * 0.59, y: h * 0.39 },
    { x: w * 0.68, y: h * 0.39 },
    { x: w * 0.86, y: h * 0.43 },
    { x: w - 65, y: h * 0.68 },
    { x: w * 0.85, y: h - 32 },
    { x: w * 0.55, y: h - 30 },
    { x: w * 0.42, y: h * 0.69 },
    { x: w * 0.2, y: h * 0.63 },
    { x: 65, y: h - 48 },
  ];
  ctx.strokeStyle = withA(theme.ok, 0.2);
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  route.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
  ctx.setLineDash([]);
  const { x, y, angle } = polyline(ctx, route, (t * 0.09) % 1, withA(theme.ok, 0.62));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(t * 1.6);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.strokeStyle = withA(theme.ok, i % 3 === 0 ? 0.32 : 0.12);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 92, Math.sin(a) * 92);
    ctx.stroke();
  }
  ctx.restore();
  robot(ctx, x, y, angle, C.OK, t);
  label(ctx, "360° LASER SCAN", 24, h - 22, C.OK);
}

function soccer(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  ctx.strokeStyle = withA(theme.ok, 0.22);
  ctx.strokeRect(30, 25, w - 60, h - 50);
  ctx.beginPath();
  ctx.moveTo(w / 2, 25);
  ctx.lineTo(w / 2, h - 25);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 42, 0, Math.PI * 2);
  ctx.stroke();
  const phase = (t * 0.22) % 1;
  const bx = w * 0.54 + Math.max(0, phase - 0.58) * w * 0.82;
  const by = h * 0.5 + Math.sin(phase * Math.PI) * 24;
  const rx = w * 0.16 + Math.min(phase / 0.62, 1) * w * 0.36;
  robot(ctx, rx, h * 0.57, 0, C.ACCENT_2, t);
  ctx.fillStyle = C.WARN;
  ctx.shadowColor = C.WARN;
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.arc(bx, by, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = C.OK;
  ctx.lineWidth = 3;
  ctx.strokeRect(w - 44, h * 0.32, 15, h * 0.36);
  label(
    ctx,
    phase < 0.58 ? "TRACK BALL" : "SHOOT!",
    w / 2,
    18,
    phase < 0.58 ? C.ACCENT_2 : C.WARN,
    "center",
  );
}

function rescue(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const target = { x: w * 0.72, y: h * 0.5 };
  ctx.strokeStyle = withA(theme.danger, 0.7);
  ctx.beginPath();
  ctx.arc(target.x, target.y, 23 + Math.sin(t * 4) * 3, 0, Math.PI * 2);
  ctx.stroke();
  label(ctx, "RESCUE", target.x, target.y + 4, C.DANGER, "center");
  const starts = [
    { x: 70, y: 55 },
    { x: 55, y: h - 55 },
    { x: w * 0.38, y: h - 35 },
  ];
  const colors = [C.ACCENT, C.ACCENT_2, C.OK];
  starts.forEach((start, i) => {
    const p = (Math.sin(t * 0.7 - i * 0.55) + 1) / 2;
    const x = start.x + (target.x - start.x - (i - 1) * 42) * p;
    const y = start.y + (target.y - start.y + (i - 1) * 40) * p;
    ctx.strokeStyle = withA(colors[i], 0.2);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    robot(ctx, x, y, Math.atan2(target.y - y, target.x - x), colors[i], t + i, 0.72);
    label(ctx, `R${i + 1}`, x, y - 24, colors[i], "center");
  });
  label(ctx, "COOPERATIVE ROBOTS", 24, h - 20, C.ACCENT_2);
}

export function setupHeroShowcase(): void {
  const canvas = document.getElementById("hero-robot-canvas") as HTMLCanvasElement | null;
  const title = document.getElementById("hero-scene-title");
  const log = document.getElementById("hero-scene-log");
  const tabs = [...document.querySelectorAll<HTMLElement>(".hero-scene-tabs span")];
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let previousScene = -1;
  let raf = 0;
  let inViewport = true;
  const render = (now: number) => {
    raf = 0;
    const t = reduced ? 1.5 : now / 1000;
    const scene = reduced ? 0 : Math.floor(t / 4.8) % scenes.length;
    const local = reduced ? t : t % 4.8;
    if (scene !== previousScene) {
      previousScene = scene;
      if (title) title.textContent = scenes[scene].title;
      if (log) log.textContent = scenes[scene].log;
      tabs.forEach((tab, i) => tab.classList.toggle("active", i === scene));
    }
    grid(ctx, canvas.width, canvas.height);
    ctx.save();
    ctx.globalAlpha = reduced ? 1 : Math.min(1, local * 2, (4.8 - local) * 2);
    [delivery, explorer, soccer, rescue][scene](ctx, canvas.width, canvas.height, t);
    ctx.restore();
    if (!reduced && inViewport && !document.hidden) raf = requestAnimationFrame(render);
  };

  const resume = () => {
    if (!reduced && inViewport && !document.hidden && !raf) {
      raf = requestAnimationFrame(render);
    }
  };
  const pause = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };

  onThemeChange(() => {
    pause();
    render(performance.now());
  });

  if (reduced) {
    render(1500);
    return;
  }

  const observer = new IntersectionObserver(
    ([entry]) => {
      inViewport = entry.isIntersecting;
      if (inViewport) resume();
      else pause();
    },
    { rootMargin: "120px 0px" },
  );
  observer.observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause();
    else resume();
  });
  resume();
}
