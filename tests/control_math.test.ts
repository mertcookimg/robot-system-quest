// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import {
  canvasAngularFromRos,
  createHeadingTracker,
  normalizeAngle,
  rosYawFromCanvas,
} from "../src/lib/control_math.ts";

const EPS = 1e-9;

test("ROS left turn becomes counter-clockwise on a downward-Y canvas", () => {
  assert.equal(canvasAngularFromRos(0.6), -0.6);
  assert.equal(canvasAngularFromRos(-0.6), 0.6);
});

test("canvas heading is published with the ROS yaw sign", () => {
  assert.ok(Math.abs(rosYawFromCanvas(Math.PI / 2) + Math.PI / 2) < EPS);
  assert.ok(Math.abs(rosYawFromCanvas(-Math.PI / 2) - Math.PI / 2) < EPS);
});

test("angles normalize across the ±π boundary", () => {
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < EPS);
  assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) + Math.PI) < EPS);
});

test("heading tracker measures turns of 180° and more across the ±π wrap", () => {
  for (const [start, direction] of [
    [0, 1],
    [0, -1],
    [Math.PI - 0.1, 1],
    [-Math.PI + 0.1, -1],
  ]) {
    const turned = createHeadingTracker(start);
    let yaw = start;
    let total = 0;
    // 400 frames of 1° each: a 400° turn with the yaw wrapped like a simulator.
    for (let i = 0; i < 400; i++) {
      yaw = normalizeAngle(yaw + direction * (Math.PI / 180));
      total = turned(yaw);
    }
    assert.ok(Math.abs(total - direction * ((400 * Math.PI) / 180)) < 1e-6);
  }
});

test("heading tracker also follows an unwrapped, ever-growing heading", () => {
  const turned = createHeadingTracker(0);
  let total = 0;
  for (let yaw = 0; yaw <= 3 * Math.PI + 1e-9; yaw += 0.05) total = turned(yaw);
  assert.ok(total > 3 * Math.PI - 0.06);
});
