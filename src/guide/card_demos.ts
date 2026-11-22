// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { COLORS as C, drawRobotBody } from "../lib/draw";
import { getTheme, theme, themeColor, withA, onThemeChange } from "../core/theme";

type DemoCanvas = HTMLCanvasElement & { dataset: DOMStringMap & { stageDemo?: string } };

const visible = new Set<DemoCanvas>();
let raf = 0;
let startedAt = 0;

const LESSON_IDS = new Set([
  "imitation_learning",
  "reinforcement_learning",
  "vla_lab",
  "world_model",
  "pubsub_builder",
  "service_builder",
  "tf_puzzle",
  "feedforward_controller",
  "feedforward_mission",
  "feedback_controller",
  "feedback_mission",
  "lidar_avoidance",
  "param_tuner",
  "mapping_mission",
  "localization_mission",
  "navigation",
  "image_processing",
  "edge_detection",
  "object_detection",
  "joint_teleop",
  "ik_reach",
  "pick_place",
  "action_builder",
  "behavior_tree",
]);

// Tiny preview routes and sensor rays carry meaning; keep them readable on
// pale cards while leaving background grids and soft fills unobtrusive.
function detailInk(color: string, darkAlpha: number): string {
  return withA(color, getTheme() === "light" ? Math.max(0.8, darkAlpha) : darkAlpha);
}

function grid(ctx: CanvasRenderingContext2D, w: number, h: number, lesson = false): void {
  ctx.fillStyle = theme.canvasBg;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = lesson ? withA(theme.accent2, 0.06) : withA(theme.accent, 0.055);
  ctx.lineWidth = 1;
  for (let x = 8.5; x < w; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 8.5; y < h; y += 16) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function robot(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  theta: number,
  t: number,
  scale = 0.7,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(theta);
  ctx.scale(scale, scale);
  drawRobotBody(ctx, 0, t);
  ctx.restore();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color = C.ACCENT,
): void {
  ctx.fillStyle = color;
  ctx.font = "700 8px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
}

function ring(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  t: number,
  text?: string,
): void {
  const pulse = 8 + Math.sin(t * 3) * 1.5;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(x, y, pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (text) label(ctx, text, x, y - 12, color);
}

function delivery(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 8;
  ring(ctx, 88, y, C.OK, t, "PICK");
  ring(ctx, w - 43, y, C.ACCENT, t, "DROP");
  const phase = (t % 5.2) / 5.2;
  let x: number;
  let carrying = false;
  if (phase < 0.35) x = 25 + (88 - 25) * (phase / 0.35);
  else if (phase < 0.82) {
    x = 88 + (w - 43 - 88) * ((phase - 0.35) / 0.47);
    carrying = true;
  } else x = 25;
  robot(ctx, x, y, 0, t);
  if (carrying) {
    ctx.fillStyle = C.WARN;
    ctx.fillRect(x - 3, y - 16, 6, 5);
  }
}

function follower(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w / 2,
    cy = h / 2 + 5;
  const targetX = cx + Math.cos(t * 1.2) * 105;
  const targetY = cy + Math.sin(t * 1.8) * 22;
  const a = t * 1.2 - 0.55;
  const x = cx + Math.cos(a) * 88;
  const y = cy + Math.sin(t * 1.8 - 0.5) * 19;
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = detailInk(theme.accent, 0.35);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(targetX, targetY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = C.WARN;
  ctx.beginPath();
  ctx.arc(targetX, targetY, 4, 0, Math.PI * 2);
  ctx.fill();
  robot(ctx, x, y, Math.atan2(targetY - y, targetX - x), t);
}

function lidar(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const x = 30 + ((t * 34) % (w - 60));
  const y = h / 2 + Math.sin(t * 1.5) * 18;
  ctx.fillStyle = withA(theme.accent2, 0.16);
  ctx.fillRect(102, 18, 22, 26);
  ctx.fillRect(203, 62, 28, 25);
  ctx.strokeStyle = detailInk(theme.accent2, 0.5);
  ctx.strokeRect(102, 18, 22, 26);
  ctx.strokeRect(203, 62, 28, 25);
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = detailInk(theme.accent, 0.28);
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.18;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
    ctx.stroke();
  }
  ctx.restore();
  robot(ctx, x, y, 0, t);
}

function patrol(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const guardX = w * 0.55;
  const sweep = Math.sin(t * 1.25) * 0.8;
  ctx.save();
  ctx.translate(guardX, h / 2);
  ctx.rotate(sweep);
  ctx.fillStyle = withA(theme.danger, 0.09);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.arc(0, 0, 65, -0.35, 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = detailInk(theme.danger, 0.4);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = C.DANGER;
  ctx.beginPath();
  ctx.arc(guardX, h / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  const phase = (t % 4) / 4;
  robot(ctx, 25 + phase * (w - 50), h * 0.78, 0, t);
  for (const [x, text] of [
    [80, "CAM"],
    [160, "MOTOR"],
    [250, "BRAIN"],
  ] as const) {
    ring(ctx, x, 22, C.OK, t + x, text);
  }
}

function racing(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w / 2,
    cy = h / 2 + 3,
    rx = w / 2 - 32,
    ry = h / 2 - 18;
  ctx.strokeStyle = withA(theme.accent, 0.15);
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = detailInk(theme.accent, 0.45);
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 5]);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  const a = t * 1.45;
  robot(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, a + Math.PI / 2, t);
}

function soccer(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 5;
  ctx.strokeStyle = detailInk(theme.accent, 0.24);
  ctx.strokeRect(14, 17, w - 28, h - 30);
  ctx.strokeStyle = C.OK;
  ctx.strokeRect(w - 20, y - 19, 7, 38);
  const p = (t % 3.6) / 3.6;
  const ballX = p < 0.72 ? 85 + (w - 103) * (p / 0.72) : 85;
  ctx.fillStyle = C.WARN;
  ctx.beginPath();
  ctx.arc(ballX, y, 4, 0, Math.PI * 2);
  ctx.fill();
  robot(ctx, Math.max(31, ballX - 18), y, 0, t);
  label(ctx, "GOAL", w - 17, y - 25, C.OK);
}

function treasure(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const points = [
    [55, h * 0.3],
    [135, h * 0.73],
    [220, h * 0.3],
    [w - 35, h * 0.67],
  ] as const;
  ctx.strokeStyle = detailInk(theme.accent, 0.24);
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.setLineDash([]);
  points.slice(0, 3).forEach(([x, y]) => {
    ctx.fillStyle = C.WARN;
    ctx.fillRect(x - 4, y - 3, 8, 6);
  });
  const p = ((t % 5) / 5) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(p));
  const u = p - i;
  const [x1, y1] = points[i],
    [x2, y2] = points[i + 1];
  robot(ctx, x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, Math.atan2(y2 - y1, x2 - x1), t);
}

function tag(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w / 2,
    cy = h / 2 + 4,
    rx = w / 2 - 40,
    ry = h / 2 - 23;
  const a = t * 1.35;
  for (const [lag, color] of [
    [0.6, C.DANGER],
    [1.05, C.WARN],
  ] as const) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a - lag) * rx, cy + Math.sin(a - lag) * ry, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  robot(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, a + Math.PI / 2, t);
  label(ctx, `${Math.max(0, 30 - Math.floor((t * 3) % 30))}s`, cx, 11, C.WARN);
}

function sumo(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w / 2,
    cy = h / 2 + 4,
    r = h / 2 - 14;
  ctx.strokeStyle = "#a98555";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const p = (Math.sin(t * 1.5) + 1) / 2;
  robot(ctx, cx - 32 + p * 27, cy, 0, t);
  ctx.save();
  ctx.globalAlpha = getTheme() === "light" ? 0.85 : 0.55;
  robot(ctx, cx + 32 + p * 20, cy, Math.PI, t);
  ctx.restore();
}

function battery(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 7;
  for (const x of [72, 160, 248]) {
    ctx.strokeStyle = C.OK;
    ctx.strokeRect(x - 8, y - 10, 15, 20);
    ctx.fillStyle = withA(theme.ok, 0.18);
    ctx.fillRect(x - 5, y - 7, 9, 14);
  }
  const x = 22 + ((t * 45) % (w - 44));
  robot(ctx, x, y, 0, t);
  const charge = Math.max(0, 100 - Math.floor((x / w) * 80));
  label(ctx, `BAT ${charge}%`, x, y - 18, charge < 30 ? C.DANGER : C.OK);
}

function kitchen(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w / 2,
    baseY = h - 17;
  const shoulder = -1.25 + Math.sin(t * 0.8) * 0.55;
  const elbow = 1.1 + Math.sin(t * 1.1) * 0.4;
  const x1 = cx + Math.cos(shoulder) * 35,
    y1 = baseY + Math.sin(shoulder) * 35;
  const x2 = x1 + Math.cos(shoulder + elbow) * 30,
    y2 = y1 + Math.sin(shoulder + elbow) * 30;
  ctx.strokeStyle = C.ACCENT_2;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx, baseY);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.fillStyle = C.WARN;
  ctx.fillRect(x2 - 5, y2 - 4, 10, 7);
  ctx.fillStyle = withA(theme.accent, 0.18);
  ctx.fillRect(45, 70, 34, 8);
  ctx.fillRect(w - 80, 70, 34, 8);
  ctx.strokeStyle = detailInk(theme.accent, 0.5);
  ctx.lineWidth = 1;
  ctx.strokeRect(45, 70, 34, 8);
  ctx.strokeRect(w - 80, 70, 34, 8);
}

function swarm(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const target = { x: w - 37, y: h / 2 + 5 };
  ring(ctx, target.x, target.y, C.WARN, t, "RESCUE");
  const colors = [C.ACCENT, C.ACCENT_2, C.OK];
  for (let i = 0; i < 3; i++) {
    const p = (t * 0.18 + i * 0.08) % 1;
    const x = 25 + (target.x - 25) * p;
    const y = h / 2 + 5 + (i - 1) * 19 + Math.sin(t * 2 + i) * 3;
    ctx.save();
    ctx.globalAlpha = 0.85;
    robot(ctx, x, y, 0, t + i, 0.55);
    ctx.restore();
    label(ctx, ["SCOUT", "CARRY", "RELAY"][i], x, y - 13, colors[i]);
  }
}

function baseball(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const groundY = h - 18;
  const pitchY = h / 2 + 8;
  ctx.fillStyle = themeColor("#d9ebdf", "#173f2d");
  ctx.fillRect(6, groundY - 15, w - 12, 28);
  ctx.fillStyle = themeColor("#dec2a6", "#9f704b");
  ctx.fillRect(6, groundY - 2, w - 12, 15);
  ctx.strokeStyle = detailInk(theme.fgMid, 0.65);
  ctx.beginPath();
  ctx.moveTo(6, groundY - 2);
  ctx.lineTo(w - 6, groundY - 2);
  ctx.stroke();

  const pitcherX = 42;
  const batterX = w - 42;
  robot(ctx, pitcherX, groundY - 8, 0, t, 0.62);
  robot(ctx, batterX, groundY - 8, Math.PI, t, 0.72);

  ctx.strokeStyle = detailInk(theme.accent, 0.58);
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(batterX - 26, pitchY - 24, 34, 45);
  ctx.setLineDash([]);

  const phase = (t % 3.4) / 3.4;
  const hit = phase > 0.7;
  let ballX: number;
  let ballY: number;
  if (!hit) {
    const u = phase / 0.7;
    const eased = u * u * (3 - 2 * u);
    ballX = pitcherX + 13 + (batterX - pitcherX - 25) * eased;
    ballY = pitchY - Math.sin(u * Math.PI) * 15;
  } else {
    const u = (phase - 0.7) / 0.3;
    ballX = batterX - 18 - u * (w - 76);
    ballY = pitchY - u * 58 + u * u * 28;
  }

  // Bat and tracking reticle.
  ctx.save();
  ctx.translate(batterX - 8, groundY - 17);
  ctx.rotate(hit ? Math.PI + 0.12 : -0.95);
  ctx.strokeStyle = C.WARN;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(30, 0);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = C.OK;
  ctx.beginPath();
  ctx.arc(batterX - 20, pitchY, 7, 0, Math.PI * 2);
  ctx.moveTo(batterX - 30, pitchY);
  ctx.lineTo(batterX - 24, pitchY);
  ctx.moveTo(batterX - 16, pitchY);
  ctx.lineTo(batterX - 10, pitchY);
  ctx.stroke();
  label(ctx, "PREDICT", batterX - 20, pitchY - 11, C.OK);

  ctx.shadowColor = C.WARN;
  ctx.shadowBlur = hit ? 9 : 4;
  ctx.fillStyle = theme.warn;
  ctx.beginPath();
  ctx.arc(ballX, ballY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (hit && phase < 0.78) label(ctx, "HIT!", w / 2, 14, C.WARN);
}

function tennis(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const x0 = 20,
    y0 = 16,
    cw = w - 40,
    ch = h - 28;
  ctx.fillStyle = themeColor("#d9eee8", "#176b61");
  ctx.fillRect(x0, y0, cw, ch);
  ctx.strokeStyle = detailInk(theme.ok, 0.65);
  ctx.strokeRect(x0, y0, cw, ch);
  const singlesTop = y0 + 9;
  const singlesBottom = y0 + ch - 9;
  const serviceLeft = w / 2 - 48;
  const serviceRight = w / 2 + 48;
  ctx.beginPath();
  ctx.moveTo(x0, singlesTop);
  ctx.lineTo(x0 + cw, singlesTop);
  ctx.moveTo(x0, singlesBottom);
  ctx.lineTo(x0 + cw, singlesBottom);
  ctx.moveTo(w / 2, y0);
  ctx.lineTo(w / 2, y0 + ch);
  ctx.moveTo(serviceLeft, singlesTop);
  ctx.lineTo(serviceLeft, singlesBottom);
  ctx.moveTo(serviceRight, singlesTop);
  ctx.lineTo(serviceRight, singlesBottom);
  ctx.moveTo(serviceLeft, h / 2);
  ctx.lineTo(serviceRight, h / 2);
  ctx.stroke();
  ctx.fillStyle = theme.fgMid;
  ctx.fillRect(w / 2 - 1, y0 - 3, 3, ch + 6);

  const phase = (t * 0.34) % 1;
  const goingRight = phase < 0.5;
  const u = goingRight ? phase * 2 : (phase - 0.5) * 2;
  const fromX = goingRight ? x0 + 30 : x0 + cw - 30;
  const toX = goingRight ? x0 + cw - 30 : x0 + 30;
  const ballX = fromX + (toX - fromX) * u;
  const baseY = h / 2 + Math.sin(t * 1.7) * 16;
  const ballY = baseY - Math.sin(u * Math.PI) * 24;
  const leftY = h / 2 + Math.sin((t - 0.3) * 1.7) * 16;
  const rightY = h / 2 + Math.sin((t - 0.1) * 1.7) * 16;
  robot(ctx, x0 + 25, leftY, 0, t, 0.56);
  robot(ctx, x0 + cw - 25, rightY, Math.PI, t, 0.56);

  for (const [x, y, dir, color] of [
    [x0 + 34, leftY - 3, -0.7, C.WARN],
    [x0 + cw - 34, rightY - 3, Math.PI + 0.7, C.DANGER],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(dir);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(12, 0);
    ctx.ellipse(18, 0, 6, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  ctx.shadowColor = themeColor("#3f6f11", "#d9f99d");
  ctx.shadowBlur = 7;
  ctx.fillStyle = themeColor("#3f6f11", "#d9f99d");
  ctx.beginPath();
  ctx.arc(ballX, ballY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  label(ctx, `RALLY ${Math.floor(t * 0.8) % 9}`, w / 2, 11, C.OK);
}

function box(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  color = C.ACCENT_2,
): void {
  ctx.fillStyle = theme.panel;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.fillText(title, x + w / 2, y + h / 2 + 2);
}

function packet(
  ctx: CanvasRenderingContext2D,
  x1: number,
  x2: number,
  y: number,
  t: number,
  color = C.ACCENT_2,
  reverse = false,
): void {
  ctx.strokeStyle = detailInk(theme.accent2, 0.34);
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.setLineDash([]);
  const p = (t * 0.45) % 1;
  const x = reverse ? x2 + (x1 - x2) * p : x1 + (x2 - x1) * p;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function pubsub(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 7;
  box(ctx, 18, y - 21, 73, 42, "PUBLISHER", C.ACCENT);
  box(ctx, w - 91, y - 21, 73, 42, "SUBSCRIBER");
  packet(ctx, 93, w - 93, y, t, C.OK);
  label(ctx, "/topic", w / 2, y - 10, C.OK);
}

function service(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 6;
  box(ctx, 18, y - 25, 68, 50, "CLIENT", C.ACCENT);
  box(ctx, w - 86, y - 25, 68, 50, "SERVER");
  packet(ctx, 89, w - 89, y - 9, t, C.WARN);
  packet(ctx, 89, w - 89, y + 11, t + 1.1, C.OK, true);
  label(ctx, "REQUEST →", w / 2, y - 16, C.WARN);
  label(ctx, "← RESPONSE", w / 2, y + 24, C.OK);
}

function tfFrames(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const axes = (x: number, y: number, a: number, name: string, color: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.strokeStyle = C.DANGER;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(28, 0);
    ctx.stroke();
    ctx.strokeStyle = C.OK;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -24);
    ctx.stroke();
    ctx.restore();
    label(ctx, name, x, y + 14, color);
  };
  axes(48, h - 22, 0, "map", C.ACCENT);
  axes(w / 2, h / 2 + 8, Math.sin(t) * 0.2, "base_link", C.ACCENT_2);
  axes(w - 55, 27, t * 0.35, "sensor", C.WARN);
  ctx.strokeStyle = detailInk(theme.accent2, 0.3);
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.moveTo(48, h - 22);
  ctx.lineTo(w / 2, h / 2 + 8);
  ctx.lineTo(w - 55, 27);
  ctx.stroke();
  ctx.setLineDash([]);
}

function triangleControlDemo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  closedLoop: boolean,
): void {
  const points = [
    { x: 44, y: h - 17 },
    { x: w - 44, y: h - 17 },
    { x: w / 2, y: 23 },
  ];
  ctx.strokeStyle = detailInk(theme.ok, 0.34);
  ctx.lineWidth = 5;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  ctx.lineTo(points[1].x, points[1].y);
  ctx.lineTo(points[2].x, points[2].y);
  ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;

  const phase = (t * 0.18) % 1;
  const edge = Math.min(2, Math.floor(phase * 3));
  const p = phase * 3 - edge;
  const from = points[edge];
  const to = points[(edge + 1) % 3];
  const x = from.x + (to.x - from.x) * p;
  const y = from.y + (to.y - from.y) * p;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  robot(ctx, x, y, angle, t, 0.55);

  if (closedLoop) {
    ctx.strokeStyle = withA(theme.warn, 0.7);
    ctx.beginPath();
    ctx.arc(x, y, 12 + Math.sin(t * 5) * 2, 0, Math.PI * 2);
    ctx.stroke();
    label(ctx, "/ODOM → STOP AT TARGET", w / 2, 12, C.WARN);
  } else {
    label(ctx, "VELOCITY × TIME", w / 2, 12, C.ACCENT_2);
  }
}

function feedforward(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  triangleControlDemo(ctx, w, h, t, false);
}

function feedback(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  triangleControlDemo(ctx, w, h, t, true);
}

function missionCourseDemo(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  closedLoop: boolean,
): void {
  const walls = [
    { x: w * 0.31, y: h * 0.25, width: 8, height: h * 0.57 },
    { x: w * 0.55, y: h * 0.2, width: 8, height: h * 0.58 },
    { x: w * 0.77, y: h * 0.4, width: 8, height: h * 0.5 },
  ];
  walls.forEach((wall) => {
    ctx.fillStyle = withA(theme.line, 0.78);
    ctx.strokeStyle = detailInk(themeColor("#1d4ea0", "#7aa7ff"), 0.38);
    ctx.beginPath();
    ctx.roundRect(wall.x, wall.y, wall.width, wall.height, 2);
    ctx.fill();
    ctx.stroke();
  });

  const route = [
    { x: 20, y: 21 },
    { x: w * 0.38, y: 17 },
    { x: w * 0.47, y: h - 11 },
    { x: w * 0.65, y: h - 11 },
    { x: w * 0.7, y: 17 },
    { x: w * 0.84, y: 17 },
    { x: w - 20, y: h - 18 },
  ];

  ctx.strokeStyle = detailInk(closedLoop ? theme.warn : theme.accent2, closedLoop ? 0.32 : 0.3);
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  route.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
  ctx.setLineDash([]);

  const goal = route[route.length - 1];
  ctx.fillStyle = withA(theme.ok, 0.08);
  ctx.strokeStyle = C.OK;
  ctx.beginPath();
  ctx.arc(goal.x, goal.y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  label(ctx, "GOAL", goal.x - 1, goal.y + 3, C.OK);

  const phase = (t * 0.13) % 1;
  const scaled = phase * (route.length - 1);
  const segment = Math.min(route.length - 2, Math.floor(scaled));
  const p = scaled - segment;
  const from = route[segment];
  const to = route[segment + 1];
  const x = from.x + (to.x - from.x) * p;
  const y = from.y + (to.y - from.y) * p;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  ctx.strokeStyle = closedLoop ? withA(theme.warn, 0.72) : withA(theme.accent2, 0.68);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(route[0].x, route[0].y);
  for (let i = 1; i <= segment; i++) ctx.lineTo(route[i].x, route[i].y);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.lineWidth = 1;

  robot(ctx, x, y, angle, t, 0.48);
  if (closedLoop) {
    ctx.strokeStyle = withA(theme.warn, 0.75);
    ctx.beginPath();
    ctx.arc(x, y, 9 + Math.sin(t * 6) * 2, 0, Math.PI * 2);
    ctx.stroke();
    label(ctx, `/ODOM  SEG ${segment + 1}`, w / 2, h - 4, C.WARN);
  } else {
    label(ctx, `CMD + TIME  BLOCK ${segment + 1}`, w / 2, h - 4, C.ACCENT_2);
  }
}

function feedforwardMission(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  missionCourseDemo(ctx, w, h, t, false);
}

function feedbackMission(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  missionCourseDemo(ctx, w, h, t, true);
}

function lidarLesson(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  lidar(ctx, w, h, t);
  box(ctx, w - 83, 12, 65, 25, Math.sin(t * 1.5) > 0 ? "TURN" : "FORWARD", C.ACCENT_2);
}

function parameters(ctx: CanvasRenderingContext2D, w: number, _h: number, t: number): void {
  const names = ["speed", "gain", "safe_dist"];
  names.forEach((name, i) => {
    const y = 26 + i * 27;
    const x1 = 72,
      x2 = w - 24;
    const p = 0.5 + Math.sin(t * (0.7 + i * 0.15) + i) * 0.32;
    label(ctx, name, 34, y + 2, [C.ACCENT, C.ACCENT_2, C.OK][i]);
    ctx.strokeStyle = themeColor("#39465a", "#627895");
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.lineTo(x2, y);
    ctx.stroke();
    ctx.fillStyle = [C.ACCENT, C.ACCENT_2, C.OK][i];
    ctx.beginPath();
    ctx.arc(x1 + (x2 - x1) * p, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });
}

function mapping(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cols = 14,
    rows = 5;
  const reveal = Math.floor((t * 7) % (cols * rows + 15));
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const n = row * cols + col;
      ctx.fillStyle =
        n < reveal
          ? col === 4 || (row === 3 && col > 7)
            ? themeColor("#6d42b5", withA(theme.accent2, 0.36))
            : themeColor("#ffffff", withA(theme.accent, 0.08))
          : themeColor("#8194ae", withA(theme.fg, 0.045));
      ctx.fillRect(52 + col * 16, 16 + row * 16, 14, 14);
      ctx.strokeStyle = theme.line;
      ctx.strokeRect(52 + col * 16, 16 + row * 16, 14, 14);
    }
  const x = 40 + ((t * 31) % (w - 75));
  robot(ctx, x, h - 13, 0, t, 0.55);
  ctx.strokeStyle = detailInk(theme.accent, 0.22);
  ctx.beginPath();
  ctx.arc(x, h - 13, 32, Math.PI, Math.PI * 2);
  ctx.stroke();
}

function localization(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const cx = w * 0.7,
    cy = h / 2 + 7;
  const spread = 85 * (0.25 + 0.75 * (1 - ((t * 0.2) % 1)));
  for (let i = 0; i < 34; i++) {
    const a = i * 2.4 + t;
    const r = spread * ((i % 7) / 7);
    ctx.globalAlpha = getTheme() === "light" ? 0.7 + (i % 5) * 0.06 : 0.3 + (i % 5) * 0.12;
    ctx.fillStyle = C.ACCENT_2;
    ctx.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.45, 2, 2);
  }
  ctx.globalAlpha = 1;
  robot(ctx, cx, cy, 0, t, 0.65);
  label(ctx, "PARTICLE FILTER", w / 2, 12, C.ACCENT_2);
}

function navLesson(ctx: CanvasRenderingContext2D, w: number, _h: number, t: number): void {
  const pts = [
    [28, 76],
    [92, 30],
    [170, 72],
    [240, 34],
    [w - 27, 66],
  ] as const;
  ctx.fillStyle = withA(theme.accent2, 0.2);
  ctx.fillRect(112, 12, 20, 38);
  ctx.fillRect(202, 60, 20, 34);
  ctx.strokeStyle = detailInk(theme.accent2, 0.5);
  ctx.strokeRect(112, 12, 20, 38);
  ctx.strokeRect(202, 60, 20, 34);
  ctx.strokeStyle = C.OK;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.setLineDash([]);
  const p = ((t * 0.22) % 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(p)),
    u = p - i;
  const [x1, y1] = pts[i],
    [x2, y2] = pts[i + 1];
  robot(ctx, x1 + (x2 - x1) * u, y1 + (y2 - y1) * u, Math.atan2(y2 - y1, x2 - x1), t, 0.58);
  ring(ctx, w - 27, 66, C.WARN, t, "GOAL");
}

function imageProcess(ctx: CanvasRenderingContext2D, w: number, _h: number, t: number): void {
  const panels = [18, w / 2 - 42, w - 102];
  panels.forEach((x, panel) => {
    ctx.strokeStyle = panel === 0 ? C.ACCENT : panel === 1 ? C.ACCENT_2 : C.OK;
    ctx.strokeRect(x, 24, 84, 59);
    for (let py = 0; py < 4; py++)
      for (let px = 0; px < 6; px++) {
        const value = (px * 31 + py * 43 + Math.floor(t * 15)) % 255;
        ctx.fillStyle =
          panel === 0
            ? `rgb(${value},${100 + py * 28},${220 - px * 20})`
            : panel === 1
              ? `rgb(${value},${value},${value})`
              : value > 125
                ? "#eef2f7"
                : "#11151c";
        ctx.fillRect(x + 5 + px * 12, 29 + py * 12, 10, 10);
      }
  });
  label(ctx, "RGB", panels[0] + 42, 17, C.ACCENT);
  label(ctx, "GRAY", panels[1] + 42, 17, C.ACCENT_2);
  label(ctx, "BINARY", panels[2] + 42, 17, C.OK);
}

function edges(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const split = w / 2;
  ctx.fillStyle = withA(theme.accent, 0.18);
  ctx.fillRect(38, 25, 72, 52);
  ctx.fillStyle = withA(theme.danger, 0.2);
  ctx.beginPath();
  ctx.arc(145, 54, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = C.FG;
  ctx.strokeRect(split + 38, 25, 72, 52);
  ctx.beginPath();
  ctx.arc(split + 145, 54, 24, 0, Math.PI * 2);
  ctx.stroke();
  const scan = (t * 70) % split;
  ctx.strokeStyle = C.ACCENT_2;
  ctx.beginPath();
  ctx.moveTo(scan, 12);
  ctx.lineTo(scan, h - 7);
  ctx.stroke();
  label(ctx, "IMAGE", split / 2, 14, C.ACCENT);
  label(ctx, "EDGES", split + split / 2, 14, C.ACCENT_2);
}

function objects(ctx: CanvasRenderingContext2D, _w: number, _h: number, t: number): void {
  const targets = [
    { x: 65 + Math.sin(t) * 12, y: 48, w: 34, h: 30, name: "BOX", color: C.WARN },
    { x: 180 + Math.cos(t * 0.8) * 18, y: 30, w: 42, h: 45, name: "ROBOT", color: C.ACCENT },
    { x: 266, y: 60 + Math.sin(t * 1.4) * 8, w: 30, h: 24, name: "BALL", color: C.OK },
  ];
  targets.forEach((o) => {
    ctx.strokeStyle = o.color;
    ctx.strokeRect(o.x - o.w / 2, o.y - o.h / 2, o.w, o.h);
    label(ctx, `${o.name} 0.${8 + (o.name.length % 2)}`, o.x, o.y - o.h / 2 - 5, o.color);
  });
}

function arm(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, target = false): void {
  const bx = 72,
    by = h - 14;
  const tx = target ? w - 55 + Math.sin(t) * 12 : w * 0.67;
  const ty = target ? 27 + Math.cos(t * 1.2) * 12 : 32;
  const a1 = -1.0 + Math.sin(t * 0.8) * 0.45;
  const a2 = 1.15 + Math.sin(t * 1.05) * 0.55;
  const x1 = bx + Math.cos(a1) * 54,
    y1 = by + Math.sin(a1) * 54;
  const x2 = x1 + Math.cos(a1 + a2) * 45,
    y2 = y1 + Math.sin(a1 + a2) * 45;
  ctx.strokeStyle = C.ACCENT_2;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  for (const [x, y] of [
    [bx, by],
    [x1, y1],
    [x2, y2],
  ]) {
    ctx.fillStyle = C.ACCENT;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (target) ring(ctx, tx, ty, C.WARN, t, "TARGET");
  else {
    label(ctx, `q1 ${a1.toFixed(1)}`, w - 72, 38, C.ACCENT);
    label(ctx, `q2 ${a2.toFixed(1)}`, w - 72, 57, C.ACCENT_2);
  }
}

function pickPlace(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const phase = (t % 4) / 4;
  const boxX = phase < 0.45 ? 145 : 260;
  ctx.fillStyle = C.WARN;
  ctx.fillRect(boxX - 6, h - 25, 12, 10);
  arm(ctx, w, h, t * 1.25);
  ring(ctx, 260, h - 21, C.OK, t, "PLACE");
}

function actionFlow(ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const y = h / 2 + 8;
  box(ctx, 17, y - 24, 66, 48, "CLIENT", C.ACCENT);
  box(ctx, w - 83, y - 24, 66, 48, "SERVER");
  const phase = (t % 4.5) / 4.5;
  const stages =
    phase < 0.25
      ? { text: "GOAL →", reverse: false, color: C.WARN, p: phase / 0.25 }
      : phase < 0.78
        ? { text: "← FEEDBACK", reverse: true, color: C.ACCENT_2, p: (phase - 0.25) / 0.53 }
        : { text: "← RESULT", reverse: true, color: C.OK, p: (phase - 0.78) / 0.22 };
  const x1 = 86,
    x2 = w - 86;
  const x = stages.reverse ? x2 + (x1 - x2) * stages.p : x1 + (x2 - x1) * stages.p;
  ctx.strokeStyle = detailInk(theme.accent2, 0.32);
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.fillStyle = stages.color;
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fill();
  label(ctx, stages.text, w / 2, y - 12, stages.color);
}

function behavior(ctx: CanvasRenderingContext2D, w: number, _h: number, t: number): void {
  const nodes = [
    { x: w / 2, y: 18, text: "ROOT" },
    { x: w * 0.3, y: 50, text: "CHECK" },
    { x: w * 0.7, y: 50, text: "ACT" },
    { x: w * 0.18, y: 83, text: "SCAN" },
    { x: w * 0.42, y: 83, text: "PLAN" },
    { x: w * 0.62, y: 83, text: "MOVE" },
    { x: w * 0.82, y: 83, text: "RECOVER" },
  ];
  ctx.strokeStyle = detailInk(theme.accent2, 0.28);
  [
    [0, 1],
    [0, 2],
    [1, 3],
    [1, 4],
    [2, 5],
    [2, 6],
  ].forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(nodes[a].x, nodes[a].y);
    ctx.lineTo(nodes[b].x, nodes[b].y);
    ctx.stroke();
  });
  const active = Math.floor(t * 1.4) % nodes.length;
  nodes.forEach((n, i) => {
    const color = i === active ? C.OK : C.ACCENT_2;
    ctx.fillStyle = i === active ? withA(theme.ok, 0.18) : theme.panel;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.roundRect(n.x - 25, n.y - 9, 50, 18, 4);
    ctx.fill();
    ctx.stroke();
    label(ctx, n.text, n.x, n.y + 2, color);
  });
}

function draw(canvas: DemoCanvas, t: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width,
    h = canvas.height;
  const id = canvas.dataset.stageDemo ?? "";
  const isLesson = LESSON_IDS.has(id);
  grid(ctx, w, h, isLesson);
  const demos: Record<
    string,
    (c: CanvasRenderingContext2D, width: number, height: number, time: number) => void
  > = {
    world_model: (c, width, height, time) => {
      // Concept illustration, not model output: first change only the target,
      // then only the initial velocity. The latter changes candidate forecasts.
      const y = height * 0.6;
      const experiment = Math.floor(time / 3) % 3;
      const moving = experiment === 2;
      const start = width * 0.28;
      const predictions = moving
        ? [width * 0.5, width * 0.79, width * 0.92]
        : [start, width * 0.53, width * 0.79];
      const selected = experiment === 1 ? 2 : 1;
      const target = width * (experiment === 0 ? 0.565 : 0.825);
      c.fillStyle = theme.line;
      c.fillRect(12, y + 11, width - 24, 4);
      predictions.forEach((x) => {
        c.fillStyle = withA(theme.accent2, 0.2);
        c.fillRect(x - 8, y - 8, 16, 16);
      });
      // The solid starting box has the same dimensions as every forecast box.
      c.fillStyle = C.WARN;
      c.fillRect(start - 8, y - 8, 16, 16);
      predictions.forEach((x, index) => {
        c.strokeStyle = index === selected ? C.OK : C.ACCENT_2;
        c.lineWidth = index === selected ? 2 : 1;
        c.setLineDash([3, 2]);
        c.strokeRect(x - 8, y - 8, 16, 16);
        label(c, ["NONE", "WEAK", "STRONG"][index], x, y + 23, C.ACCENT_2);
      });
      c.setLineDash([]);
      c.lineWidth = 1;
      c.strokeStyle = C.OK;
      c.beginPath();
      c.moveTo(target, y - 12);
      c.lineTo(target, y - 27);
      c.lineTo(target + 7, y - 24);
      c.lineTo(target, y - 21);
      c.stroke();
      label(c, "PICK", predictions[selected], y - 33, C.OK);
      label(c, experiment === 0 ? "NEAR TARGET" : "FAR TARGET", target, y + 35, C.OK);
      label(
        c,
        ["1. START AT REST", "2. CHANGE TARGET", "3. CHANGE INITIAL SPEED"][experiment],
        width * 0.5,
        10,
        C.ACCENT_2,
      );
      if (moving) {
        c.strokeStyle = C.WARN;
        c.beginPath();
        c.moveTo(start + 3, y - 18);
        c.lineTo(start + 25, y - 18);
        c.lineTo(start + 20, y - 22);
        c.moveTo(start + 25, y - 18);
        c.lineTo(start + 20, y - 14);
        c.stroke();
      }
      robot(c, start - 22, y, 0, time, 0.65);
    },
    vla_lab: (c, width, height, time) => {
      // Concept illustration: image + the selected word leads to an action.
      const size = Math.min((width * 0.48 - 12) / 7, (height - 35) / 5);
      const left = 9;
      const top = (height - size * 5) / 2 + 8;
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 7; col++) {
          c.fillStyle = themeColor("#e4edf8", "#142339");
          c.fillRect(left + col * size + 0.5, top + row * size + 0.5, size - 1, size - 1);
          c.strokeStyle = theme.line;
          c.lineWidth = 0.5;
          c.strokeRect(left + col * size + 0.5, top + row * size + 0.5, size - 1, size - 1);
        }
      }
      for (const [row, color, mark] of [
        [2, "#f87171", "R"],
        [4, "#60a5fa", "B"],
      ] as const) {
        c.fillStyle = color;
        c.fillRect(left + 5 * size + 1, top + row * size + 1, size - 2, size - 2);
        label(c, mark, left + 5.5 * size, top + (row + 0.5) * size + 2, "#0b1629");
      }
      label(c, "IMAGE", left + 3.5 * size, top - 4, C.ACCENT_2);
      robot(c, left + (1.5 + Math.min(3, time % 4)) * size, top + 2.5 * size, 0, time, size / 28);
      const centerY = height * 0.58;
      label(c, "+", width * 0.52, centerY + 2, C.ACCENT_2);
      c.fillStyle = themeColor("#fce8ee", "#482238");
      c.strokeStyle = theme.danger;
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(width * 0.57, centerY - 12, width * 0.19, 24, 4);
      c.fill();
      c.stroke();
      label(c, '"red"', width * 0.665, centerY + 2, theme.danger);
      label(c, "WORD", width * 0.665, centerY - 18, C.ACCENT_2);
      c.fillStyle = C.ACCENT;
      c.font = "700 19px system-ui, sans-serif";
      c.textAlign = "center";
      c.fillText("→", width * 0.88, centerY + 6);
      label(c, "ACTION", width * 0.88, centerY - 18, C.ACCENT_2);
    },
    reinforcement_learning: (c, width, height, time) => {
      // Concept illustration only: this preview does not train or evaluate a policy.
      const size = Math.min((width - 24) / 7, (height - 28) / 5);
      const left = (width - size * 7) / 2;
      const top = (height - size * 5) / 2 + 5;
      const walls = new Set([3, 10, 24, 31]);
      for (let row = 0; row < 5; row++) {
        for (let col = 0; col < 7; col++) {
          const cell = row * 7 + col;
          c.fillStyle = walls.has(cell) ? themeColor("#637892", "#33465e") : theme.panel2;
          if (cell === 20) c.fillStyle = themeColor("#cbe9df", "#145e4e");
          if (cell === 8) c.fillStyle = themeColor("#f6e3bd", "#5e4b24");
          c.fillRect(left + col * size + 1, top + row * size + 1, size - 2, size - 2);
          c.strokeStyle = theme.line;
          c.lineWidth = 0.5;
          c.strokeRect(left + col * size + 1, top + row * size + 1, size - 2, size - 2);
        }
      }
      const flagX = left + 6.35 * size;
      const flagY = top + 2.2 * size;
      c.strokeStyle = theme.ok;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(flagX, flagY);
      c.lineTo(flagX, flagY + size * 0.65);
      c.stroke();
      c.fillStyle = C.OK;
      c.beginPath();
      c.moveTo(flagX, flagY);
      c.lineTo(flagX + size * 0.45, flagY + size * 0.2);
      c.lineTo(flagX, flagY + size * 0.35);
      c.fill();
      c.fillStyle = C.WARN;
      c.font = `700 ${size * 0.7}px system-ui, sans-serif`;
      c.textAlign = "center";
      c.fillText("★", left + 1.5 * size, top + 1.75 * size);
      const route = [0, 7, 14, 15, 16, 17, 18, 19, 20];
      const progress = (time * 2) % route.length;
      const index = Math.floor(progress);
      const from = route[index];
      const to = route[Math.min(index + 1, route.length - 1)];
      const fraction = progress - index;
      const dx = (to % 7) - (from % 7);
      const dy = Math.floor(to / 7) - Math.floor(from / 7);
      robot(
        c,
        left + ((from % 7) + 0.5 + dx * fraction) * size,
        top + (Math.floor(from / 7) + 0.5 + dy * fraction) * size,
        Math.atan2(dy, dx),
        time,
        size / 32,
      );
    },
    imitation_learning: (c, width, height, time) => {
      // Concept illustration: recorded samples and an observation query.
      const y = (x: number) => height * 0.52 + Math.sin((x / width) * Math.PI * 2) * height * 0.17;
      c.beginPath();
      for (let x = 15; x < width - 15; x += 3) {
        if (x === 15) c.moveTo(x, y(x));
        else c.lineTo(x, y(x));
      }
      c.strokeStyle = themeColor("#a5b8d1", "#33465e");
      c.lineWidth = 22;
      c.stroke();
      for (let i = 0; i < 12; i++) {
        const x = 20 + (i * (width - 40)) / 12;
        c.fillStyle = C.WARN;
        c.fillRect(x - 2, y(x) - 2, 4, 4);
      }
      const x = 20 + ((time % 5) / 5) * (width - 40);
      c.fillStyle = C.OK;
      c.beginPath();
      c.arc(x, y(x), 6, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = C.OK;
      c.lineWidth = 1;
      c.beginPath();
      c.arc(x, y(x), 17, 0, Math.PI * 2);
      c.stroke();
    },
    delivery,
    follower,
    lidar_explorer: lidar,
    patrol,
    racing,
    robo_soccer: soccer,
    treasure_map: treasure,
    tag_chase: tag,
    sumo_battle: sumo,
    battery_rush: battery,
    robo_kitchen: kitchen,
    swarm_rescue: swarm,
    robo_baseball: baseball,
    robo_tennis: tennis,
    pubsub_builder: pubsub,
    service_builder: service,
    tf_puzzle: tfFrames,
    feedforward_controller: feedforward,
    feedforward_mission: feedforwardMission,
    feedback_controller: feedback,
    feedback_mission: feedbackMission,
    lidar_avoidance: lidarLesson,
    param_tuner: parameters,
    mapping_mission: mapping,
    localization_mission: localization,
    navigation: navLesson,
    image_processing: imageProcess,
    edge_detection: edges,
    object_detection: objects,
    joint_teleop: arm,
    ik_reach: (c, width, height, time) => arm(c, width, height, time, true),
    pick_place: pickPlace,
    action_builder: actionFlow,
    behavior_tree: behavior,
  };
  (demos[id] ?? delivery)(ctx, w, h, t);
  ctx.fillStyle = theme.fgDim;
  ctx.font = "700 7px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.fillText(isLesson ? "CONCEPT PREVIEW" : "PLAY PREVIEW", 7, 10);
}

function loop(now: number): void {
  const t = (now - startedAt) / 1000;
  visible.forEach((canvas) => draw(canvas, t));
  raf = visible.size ? requestAnimationFrame(loop) : 0;
}

export function setupCardDemos(root: ParentNode = document): () => void {
  const canvases = [...root.querySelectorAll<DemoCanvas>(".card-demo")];
  if (!canvases.length) return () => {};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  canvases.forEach((canvas) => draw(canvas, 0.8));
  const stopThemeUpdates = onThemeChange(() => {
    const time = reduced ? 0.8 : (performance.now() - startedAt) / 1000;
    canvases.forEach((canvas) => draw(canvas, time));
  });
  if (reduced) return stopThemeUpdates;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const canvas = entry.target as DemoCanvas;
        if (entry.isIntersecting) visible.add(canvas);
        else visible.delete(canvas);
      });
      if (visible.size && !raf) raf = requestAnimationFrame(loop);
    },
    { rootMargin: "140px 0px", threshold: 0.05 },
  );
  canvases.forEach((canvas) => observer.observe(canvas));

  startedAt = performance.now();
  return () => {
    stopThemeUpdates();
    observer.disconnect();
    canvases.forEach((canvas) => visible.delete(canvas));
    if (!visible.size && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}
