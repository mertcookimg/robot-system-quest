// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getTheme, theme, withA } from "../core/theme";

import { stageColor } from "./stage_colors";

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
  ctx.strokeStyle = withA(theme.ok, getTheme() === "light" ? 0.72 : 0.38);
  ctx.lineWidth = 8;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.lineTo(c.x, c.y);
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = stageColor("rgba(7, 95, 147, 0.8)");
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const vertex of TRIANGLE_VERTICES) {
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, vertex.label === "START" ? 9 : 7, 0, Math.PI * 2);
    ctx.fillStyle = withA(theme.scrim, 0.95);
    ctx.fill();
    ctx.strokeStyle = stageColor(vertex.label === "START" ? "#925b00" : "#087764");
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = stageColor(vertex.label === "START" ? "#925b00" : "#087764");
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(vertex.label, vertex.x, vertex.y - 16);
  }

  ctx.fillStyle = theme.fgMid;
  ctx.font = "700 12px ui-monospace, monospace";
  ctx.fillText(`${TRIANGLE_SIDE_M.toFixed(1)} m`, (a.x + b.x) / 2, a.y + 25);
  ctx.fillStyle = theme.warn;
  ctx.fillText("TURN 120°", b.x + 48, b.y - 20);
  ctx.restore();
}

export interface TriangleResult {
  success: boolean;
  stars: number;
  cornerErrorPx: number;
  pathErrorPx: number;
  closureErrorPx: number;
  missingVertices: string[];
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
    const missingVertices = [...(this.minB <= 20 ? [] : ["B"]), ...(this.minC <= 20 ? [] : ["C"])];
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

    return { success, stars, cornerErrorPx, pathErrorPx, closureErrorPx, missingVertices };
  }
}

export function finishTriangleLesson(
  g: GameContext,
  result: TriangleResult,
  elapsed: number,
  blockCount: number,
): boolean {
  if (!result.success) {
    let message: string;
    if (result.missingVertices.length > 0) {
      const vertices = result.missingVertices.join("・");
      message = tx(
        `未通過の頂点: ${vertices} — ガイドに沿って各頂点の0.20 m以内を通りましょう`,
        `Missed vertices: ${result.missingVertices.join(", ")} — follow the guide within 0.20 m of each vertex`,
      );
    } else if (!Number.isFinite(result.pathErrorPx) || result.pathErrorPx > 14) {
      message = Number.isFinite(result.pathErrorPx)
        ? tx(
            `経路の平均ずれ ${(result.pathErrorPx / 100).toFixed(2)} m — 三角形の辺に沿って、0.14 m以内を目指しましょう`,
            `Average path error ${(result.pathErrorPx / 100).toFixed(2)} m — follow the triangle edges; aim for 0.14 m or less`,
          )
        : tx(
            "経路を確認できません — ガイドの3辺に沿って走行しましょう",
            "No path to evaluate — drive along all three guide edges",
          );
    } else if (!Number.isFinite(result.closureErrorPx) || result.closureErrorPx > 20) {
      message = Number.isFinite(result.closureErrorPx)
        ? tx(
            `始点からのずれ ${(result.closureErrorPx / 100).toFixed(2)} m — STARTの0.20 m以内で停止しましょう`,
            `Start-point error ${(result.closureErrorPx / 100).toFixed(2)} m — finish within 0.20 m of START`,
          )
        : tx(
            "帰還位置を確認できません — 再実行してください",
            "Cannot evaluate the finish position — run again",
          );
    } else {
      message = tx(
        "三角形の周回が未完了です — 3辺をたどり、最後にSTARTへ戻りましょう",
        "Triangle lap incomplete — follow all three edges and return to START at the end",
      );
    }
    g.setStatus(message, "var(--warn)");
    return false;
  }

  g.awardStars(
    result.stars,
    `Shape error <b>${(result.pathErrorPx / 100).toFixed(2)} m</b><br>` +
      `Closure     <b>${(result.closureErrorPx / 100).toFixed(2)} m</b><br>` +
      `Blocks      <b>${blockCount}</b><br>` +
      `Time        <b>${elapsed.toFixed(2)} s</b>`,
    undefined,
    { timeSeconds: elapsed },
  );
  return true;
}
