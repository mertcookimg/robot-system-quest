// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { canvasAngularFromRos, normalizeAngle, rosYawFromCanvas } from "../src/lib/control_math.ts";

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
