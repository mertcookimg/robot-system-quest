// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Sampled motion trail with throttle + ring-buffer trim. Stages call
// `update(dt, x, y)` every frame and `draw(ctx)` from the render pass.

export interface TrailOptions {
  interval?: number; // seconds between samples (default: 0.05)
  max?: number; // max samples kept (default: 80)
  color?: string; // base rgb(a) — alpha is overridden per-segment
  width?: number; // stroke width
}

export class Trail {
  private points: { x: number; y: number }[] = [];
  private acc = 0;
  private interval: number;
  private max: number;
  private color: string;
  private width: number;

  constructor(opts: TrailOptions = {}) {
    this.interval = opts.interval ?? 0.05;
    this.max = opts.max ?? 80;
    this.color = opts.color ?? "rgba(196, 181, 253, ALPHA)";
    this.width = opts.width ?? 1.5;
  }

  reset(): void {
    this.points.length = 0;
    this.acc = 0;
  }

  update(dt: number, x: number, y: number): void {
    this.acc += dt;
    if (this.acc < this.interval) return;
    this.acc = 0;
    this.points.push({ x, y });
    if (this.points.length > this.max) this.points.shift();
  }

  draw(ctx: CanvasRenderingContext2D, alphaScale = 0.55): void {
    const n = this.points.length;
    for (let i = 1; i < n; i++) {
      const a = (i / n) * alphaScale;
      ctx.strokeStyle = this.color.replace("ALPHA", a.toFixed(3));
      ctx.lineWidth = this.width;
      ctx.beginPath();
      ctx.moveTo(this.points[i - 1].x, this.points[i - 1].y);
      ctx.lineTo(this.points[i].x, this.points[i].y);
      ctx.stroke();
    }
  }

  get length(): number {
    return this.points.length;
  }

  /** Read-only view of the sample buffer. Use when a stage needs custom rendering. */
  samples(): readonly { x: number; y: number }[] {
    return this.points;
  }
}
