// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import type { GameContext } from "../types";
import { tx } from "../i18n";

export const TRIANGLE_SIDE_M = 1.4;
export const TRIANGLE_SIDE_PX = 140;
export const TRIANGLE_START = { x: 300, y: 340, theta: 0 };

export const TRIANGLE_VERTICES = [
  { x: TRIANGLE_START.x, y: TRIANGLE_START.y, label: "START" },
  { x: TRIANGLE_START.x + TRIANGLE_SIDE_PX, y: TRIANGLE_START.y, label: "B" },
  {
    x: TRIANGLE_START.x + TRIANGLE_SIDE_PX / 2,
    y: TRIANGLE_START.y - TRIANGLE_SIDE_PX * Math.sin(Math.PI / 3),
    label: "C",
  },
] as const;

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

export function drawTriangleCourse(ctx: CanvasRenderingContext2D): void {
  const [a, b, c] = TRIANGLE_VERTICES;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(94, 234, 212, 0.38)";
  ctx.lineWidth = 8;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = "rgba(125, 211, 252, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const vertex of TRIANGLE_VERTICES) {
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, vertex.label === "START" ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(7, 10, 16, 0.95)";
    ctx.fill();
    ctx.strokeStyle = vertex.label === "START" ? "#fbbf24" : "#5eead4";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = vertex.label === "START" ? "#fbbf24" : "#9ff4dd";
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(vertex.label, vertex.x, vertex.y - 16);
  }

  ctx.fillStyle = "rgba(154, 166, 200, 0.8)";
  ctx.font = "700 10px ui-monospace, monospace";
  ctx.fillText(`${TRIANGLE_SIDE_M.toFixed(1)} m`, (a.x + b.x) / 2, a.y + 25);
  ctx.fillStyle = "rgba(251, 191, 36, 0.85)";
  ctx.fillText("TURN 120°", b.x + 48, b.y - 20);
  ctx.restore();
}

export interface TriangleResult {
  success: boolean;
  stars: number;
  cornerErrorPx: number;
  pathErrorPx: number;
  closureErrorPx: number;
}

export class TriangleTracker {
  private previous = { x: TRIANGLE_START.x, y: TRIANGLE_START.y };
  private travelledPx = 0;
  private minB = Number.POSITIVE_INFINITY;
  private minC = Number.POSITIVE_INFINITY;
  private minClosure = Number.POSITIVE_INFINITY;
  private pathErrorTotal = 0;
  private pathSamples = 0;

  reset(x = TRIANGLE_START.x, y = TRIANGLE_START.y): void {
    this.previous = { x, y };
    this.travelledPx = 0;
    this.minB = Number.POSITIVE_INFINITY;
    this.minC = Number.POSITIVE_INFINITY;
    this.minClosure = Number.POSITIVE_INFINITY;
    this.pathErrorTotal = 0;
    this.pathSamples = 0;
  }

  observe(x: number, y: number): void {
    const step = Math.hypot(x - this.previous.x, y - this.previous.y);
    this.previous = { x, y };
    if (step < 0.01) return;

    this.travelledPx += step;
    const [a, b, c] = TRIANGLE_VERTICES;
    this.minB = Math.min(this.minB, Math.hypot(x - b.x, y - b.y));
    this.minC = Math.min(this.minC, Math.hypot(x - c.x, y - c.y));
    if (this.travelledPx > TRIANGLE_SIDE_PX * 2.45) {
      this.minClosure = Math.min(this.minClosure, Math.hypot(x - a.x, y - a.y));
    }

    const outlineError = Math.min(
      pointToSegmentDistance(x, y, a.x, a.y, b.x, b.y),
      pointToSegmentDistance(x, y, b.x, b.y, c.x, c.y),
      pointToSegmentDistance(x, y, c.x, c.y, a.x, a.y),
    );
    this.pathErrorTotal += outlineError;
    this.pathSamples++;
  }

  progress(): string {
    const lap = Math.min(100, (this.travelledPx / (TRIANGLE_SIDE_PX * 3)) * 100);
    return `${lap.toFixed(0)}%`;
  }

  result(x: number, y: number): TriangleResult {
    const [a] = TRIANGLE_VERTICES;
    const closureErrorPx = Math.hypot(x - a.x, y - a.y);
    const cornerErrorPx = Math.max(this.minB, this.minC, this.minClosure);
    const pathErrorPx =
      this.pathSamples > 0 ? this.pathErrorTotal / this.pathSamples : Number.POSITIVE_INFINITY;
    const success = cornerErrorPx <= 20 && pathErrorPx <= 14 && closureErrorPx <= 20;
    const stars = !success
      ? 0
      : cornerErrorPx <= 8 && pathErrorPx <= 5 && closureErrorPx <= 8
        ? 3
        : cornerErrorPx <= 14 && pathErrorPx <= 9 && closureErrorPx <= 14
          ? 2
          : 1;

    return { success, stars, cornerErrorPx, pathErrorPx, closureErrorPx };
  }
}

export function finishTriangleLesson(
  g: GameContext,
  result: TriangleResult,
  elapsed: number,
  blockCount: number,
): boolean {
  if (!result.success) {
    g.setStatus(
      tx(
        `三角形がまだ閉じていません — 始点のずれ ${(result.closureErrorPx / 100).toFixed(2)} m`,
        `The triangle is not closed yet — start-point error ${(result.closureErrorPx / 100).toFixed(2)} m`,
      ),
      "var(--warn)",
    );
    return false;
  }

  g.awardStars(
    result.stars,
    `Shape error <b>${(result.pathErrorPx / 100).toFixed(2)} m</b><br>` +
      `Closure     <b>${(result.closureErrorPx / 100).toFixed(2)} m</b><br>` +
      `Blocks      <b>${blockCount}</b><br>` +
      `Time        <b>${elapsed.toFixed(2)} s</b>`,
  );
  return true;
}
