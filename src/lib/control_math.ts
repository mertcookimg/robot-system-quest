// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

/** Normalize an angle to [-π, π]. */
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Canvas uses a downward-positive Y axis, so positive canvas rotation is
 * clockwise. ROS yaw/angular.z is counter-clockwise positive.
 */
export function rosYawFromCanvas(canvasTheta: number): number {
  return normalizeAngle(-canvasTheta);
}

export function canvasAngularFromRos(angularZ: number): number {
  return -angularZ;
}
