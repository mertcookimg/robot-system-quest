// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Shared teleop input → cmd_vel computation. Stages that read WASD/arrows
// can use these to avoid duplicating the same 5-line dance.

export interface TeleopInput {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface TeleopParams {
  baseLin: number;
  baseAng: number;
}

export interface Twist {
  lin: number;
  ang: number;
}

export function readTeleop(keys: ReadonlySet<string>): TeleopInput {
  return {
    fwd: keys.has("w") || keys.has("arrowup"),
    back: keys.has("s") || keys.has("arrowdown"),
    left: keys.has("a") || keys.has("arrowleft"),
    right: keys.has("d") || keys.has("arrowright"),
  };
}

export function computeTwist(inp: TeleopInput, params: TeleopParams): Twist {
  const lin = (inp.fwd ? params.baseLin : 0) - (inp.back ? params.baseLin : 0);
  const ang = (inp.right ? params.baseAng : 0) - (inp.left ? params.baseAng : 0);
  return { lin, ang };
}

/** One-shot helper: read keys and immediately compute the twist. */
export function teleop(keys: ReadonlySet<string>, params: TeleopParams): Twist {
  return computeTwist(readTeleop(keys), params);
}
