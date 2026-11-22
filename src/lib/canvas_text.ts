// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { H, W } from "../types";

function fontSize(ctx: CanvasRenderingContext2D): number {
  return Number(/([\d.]+)px/.exec(ctx.font)?.[1] ?? 12);
}

/** Word wrapping with character fallback for Japanese and long ROS identifiers. */
export function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
): string[] {
  if (width <= 0) return [];
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/u)) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line || !paragraph) lines.push(line);
  }
  return lines;
}

/** Keeps the caller's font, alignment and baseline; returns the occupied line height. */
export function drawWrappedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight = fontSize(ctx) * 1.45,
): number {
  const lines = wrapCanvasText(ctx, text, maxWidth);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

export interface CanvasLabelOptions {
  /** Bounds in the caller's current coordinate system (before any transform). */
  bounds?: { x: number; y: number; w: number; h: number };
  padding?: number;
}

/** Keep a moving label inside its scene/panel without squeezing or omitting text. */
export function drawCanvasLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  {
    bounds = { x: 0, y: 0, w: ctx.canvas?.width || W, h: ctx.canvas?.height || H },
    padding = 6,
  }: CanvasLabelOptions = {},
): void {
  const lines = wrapCanvasText(ctx, text, bounds.w - 2 * padding);
  const size = fontSize(ctx);
  const lineHeight = size * 1.45;
  const baseline = ctx.textBaseline;
  const fallbackAscent =
    baseline === "top" || baseline === "hanging"
      ? 0
      : baseline === "middle"
        ? size / 2
        : baseline === "bottom"
          ? size
          : size * 0.8;
  const measured = lines.map((line) => ctx.measureText(line));
  const ascent = Math.max(
    fallbackAscent,
    ...measured.map((m) => m.actualBoundingBoxAscent ?? fallbackAscent),
  );
  const descent = Math.max(
    size - fallbackAscent,
    ...measured.map((m) => m.actualBoundingBoxDescent ?? size - fallbackAscent),
  );
  const lastLineOffset = Math.max(0, lines.length - 1) * lineHeight;
  const top = bounds.y + padding + ascent;
  const bottom = bounds.y + bounds.h - padding - descent - lastLineOffset;
  const labelY = Math.max(top, Math.min(bottom, y));
  lines.forEach((line, i) => {
    const width = measured[i].width;
    const rightAligned =
      ctx.textAlign === "right" ||
      (ctx.textAlign === "end" && ctx.direction !== "rtl") ||
      (ctx.textAlign === "start" && ctx.direction === "rtl");
    const left = ctx.textAlign === "center" ? width / 2 : rightAligned ? width : 0;
    const minX = bounds.x + padding + left;
    const maxX = bounds.x + bounds.w - padding - (width - left);
    ctx.fillText(line, Math.max(minX, Math.min(maxX, x)), labelY + i * lineHeight);
  });
}
