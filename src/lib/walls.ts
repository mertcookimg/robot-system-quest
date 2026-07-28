// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Axis-aligned bounding-box obstacles + circle-vs-AABB collision. Used by
// stages whose level layout is a list of rectangular walls.

import { W, H } from "../types";

export interface Aabb {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * True if a circle of radius `r` at (x, y) does not overlap any wall and
 * stays within the canvas bounds (with the same radius padding).
 */
export function canMoveTo(walls: readonly Aabb[], x: number, y: number, r: number): boolean {
  if (x < r || x > W - r) return false;
  if (y < r || y > H - r) return false;
  for (const wall of walls) {
    const cx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
    const cy = Math.max(wall.y, Math.min(y, wall.y + wall.h));
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < r * r) return false;
  }
  return true;
}
