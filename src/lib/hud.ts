// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Helpers for formatting position, speed, and angle strings that stages used
// to construct individually before passing them to `g.setHud([...])`.
//
// Supports both pixels and meters; set pxPerM to switch to meters.

export interface Pose {
  x: number;
  y: number;
  theta: number;
}

export interface Twist {
  v: number; // Linear velocity (px/s or m/s)
  w: number; // Angular velocity (rad/s)
}

export interface FormatOptions {
  /** Pixels-to-meters conversion. When set, x/y are displayed in meters. */
  pxPerM?: number;
  /** Number of decimal places. Default: 2. */
  digits?: number;
}

function fmt(n: number, digits: number): string {
  return n.toFixed(digits);
}

/** Formats a pose string such as "x=1.20 m  y=2.30 m  θ=0.42". */
export function formatPose(p: Pose, opts: FormatOptions = {}): string {
  const d = opts.digits ?? 2;
  if (opts.pxPerM) {
    return `x=${fmt(p.x / opts.pxPerM, d)} m  y=${fmt(p.y / opts.pxPerM, d)} m  θ=${fmt(p.theta, d)}`;
  }
  return `x=${fmt(p.x, opts.digits ?? 1)}  y=${fmt(p.y, opts.digits ?? 1)}  θ=${fmt(p.theta, d)}`;
}

/** "lin=0.50 m/s  ang=1.05 rad/s" */
export function formatTwist(t: Twist, opts: FormatOptions = {}): string {
  const d = opts.digits ?? 2;
  const v = opts.pxPerM ? t.v / opts.pxPerM : t.v;
  const unit = opts.pxPerM ? "m/s" : "px/s";
  return `lin=${fmt(v, d)} ${unit}  ang=${fmt(t.w, d)} rad/s`;
}

/** Formats a simple duration in seconds, such as "12.34 s". */
export function formatSeconds(s: number, digits = 2): string {
  return `${fmt(s, digits)} s`;
}

/** Lightweight builder for multi-line Pose, Twist, blocks, and similar output. */
export class HudBuilder {
  private lines: string[] = [];
  /** Adds a left-aligned "label:    value" line. */
  add(label: string, value: string): this {
    this.lines.push(`${label}:`.padEnd(10) + value);
    return this;
  }
  /** Adds an arbitrary raw string. */
  raw(s: string): this {
    this.lines.push(s);
    return this;
  }
  build(): string[] {
    return this.lines.slice();
  }
}
