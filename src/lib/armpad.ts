// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Thin gamepad reader for the robot-arm stages. The shell's gamepad.ts already
// synthesises the LEFT stick into w/a/s/d + arrow keys and the shoulder/LB-RT
// triggers into shift ("boost" / precision) — the arm stages get all of that
// for free via g.keys. What the shell does NOT expose is the RIGHT stick
// (axes 2/3) and per-button edge detection, so this module reads the raw pad
// directly (same pattern navpad.ts uses) and offers just those two things.
//
// Call poll() once at the top of a stage's update(), then query. No wiring in
// main.ts / loop.ts is required.

const DEAD = 0.35;

let prev: boolean[] = [];
let cur: boolean[] = [];
let axes: number[] = [];

function findPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) return p;
  return null;
}

/** Snapshot the pad for this frame. Safe to call when no pad is connected. */
export function poll(): void {
  const pad = findPad();
  prev = cur;
  if (!pad) {
    cur = [];
    axes = [];
    return;
  }
  cur = pad.buttons.map((b) => b.pressed);
  axes = pad.axes.slice();
}

function dz(v: number): number {
  if (Math.abs(v) < DEAD) return 0;
  // Rescale past the deadzone so control starts smoothly from 0.
  const s = (Math.abs(v) - DEAD) / (1 - DEAD);
  return Math.sign(v) * s;
}

/** Right-stick vertical, deadzoned to [-1,1] (up is negative, like the DOM). */
export function rightStickY(): number {
  return dz(axes[3] ?? 0);
}

/** Right-stick horizontal, deadzoned to [-1,1]. */
export function rightStickX(): number {
  return dz(axes[2] ?? 0);
}

/** True only on the frame `idx` transitions from released to pressed. */
export function buttonEdge(idx: number): boolean {
  return (cur[idx] ?? false) && !(prev[idx] ?? false);
}

/** True while button `idx` is held. */
export function buttonDown(idx: number): boolean {
  return cur[idx] ?? false;
}

/** Forget edge state (call from stage reset/dispose to avoid a stale edge). */
export function reset(): void {
  prev = [];
  cur = [];
  axes = [];
}
