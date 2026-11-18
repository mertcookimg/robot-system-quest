// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

/** Normalize an angle to [-π, π]. */
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Track the signed heading change since `initialYaw`, unwrapped across the
 * ±π boundary. Feed the current yaw every step; the result keeps growing past
 * π, so a 180° or 360° turn can be measured (a plain normalized difference
 * never exceeds π). Steps must turn less than π each, which holds for
 * per-frame updates.
 */
export function createHeadingTracker(initialYaw: number): (yaw: number) => number {
  let last = initialYaw;
  let turned = 0;
  return (yaw) => {
    turned += normalizeAngle(yaw - last);
    last = yaw;
    return turned;
  };
}

/** Convert a canvas (clockwise-positive) angular velocity to ROS angular.z. */
export function rosAngularFromCanvas(canvasAngular: number): number {
  return -canvasAngular;
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
