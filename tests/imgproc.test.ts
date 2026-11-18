// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { f1Score } from "../src/lib/imgproc.ts";

const W = 10;
const H = 10;
const EPS = 1e-9;

/** Mask with a vertical line at column x (rows 1..H-2). */
function verticalLine(x: number): Uint8Array {
  const mask = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) mask[y * W + x] = 255;
  return mask;
}

function union(...masks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(W * H);
  for (const mask of masks) for (let i = 0; i < out.length; i++) if (mask[i]) out[i] = 255;
  return out;
}

test("an exact edge scores a perfect F1", () => {
  assert.ok(Math.abs(f1Score(verticalLine(4), verticalLine(4), W, H) - 1) < EPS);
});

test("an edge found one pixel away from the target still matches", () => {
  assert.ok(Math.abs(f1Score(verticalLine(5), verticalLine(4), W, H) - 1) < EPS);
});

test("an edge two pixels away from the target does not match", () => {
  assert.equal(f1Score(verticalLine(6), verticalLine(4), W, H), 0);
});

test("detections far from the target lower precision", () => {
  // Half of the detected pixels are on the target and half are 4 px away:
  // precision = 0.5, recall = 1, F1 = 2/3.
  const detected = union(verticalLine(4), verticalLine(8));
  assert.ok(Math.abs(f1Score(detected, verticalLine(4), W, H) - 2 / 3) < EPS);
});

test("missing target edges lower recall", () => {
  // Only one of two target lines is found: precision = 1, recall = 0.5.
  const truth = union(verticalLine(2), verticalLine(7));
  assert.ok(Math.abs(f1Score(verticalLine(2), truth, W, H) - 2 / 3) < EPS);
});

test("empty detection or empty target scores zero", () => {
  const empty = new Uint8Array(W * H);
  assert.equal(f1Score(empty, verticalLine(4), W, H), 0);
  assert.equal(f1Score(verticalLine(4), empty, W, H), 0);
});
