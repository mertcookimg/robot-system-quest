// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import { WORLD_MODEL_TRAINING_INFO, WORLD_MODEL_WEIGHTS } from "./world_model_weights";

export const WORLD_ACTIONS = ["none", "weak", "strong"] as const;
export type WorldAction = (typeof WORLD_ACTIONS)[number];
export const WORLD_GOALS = ["near", "far"] as const;
export type WorldGoal = (typeof WORLD_GOALS)[number];
export const WORLD_TARGET_X: Readonly<Record<WorldGoal, number>> = Object.freeze({
  near: 0.72,
  far: 1.3,
});
export interface WorldState {
  time: number;
  x: number;
  velocity: number;
}
export interface WorldFrame extends WorldState {
  force: number;
}
export interface WorldTrajectory {
  trajectory: WorldFrame[];
  finalX: number;
  duration: number;
}
export const WORLD_DT = 0.05;
export const WORLD_HORIZON = 2;
export const WORLD_PUSH_SECONDS = 0.35;
export const WORLD_INITIAL: Readonly<WorldState> = Object.freeze({ time: 0, x: 0.25, velocity: 0 });
export const WORLD_VIEW_MIN = 0;
export const WORLD_VIEW_MAX = 2;
export const WORLD_ACTION_FORCE: Readonly<Record<WorldAction, number>> = Object.freeze({
  none: 0,
  weak: 2,
  strong: 5,
});
export const WORLD_MODEL_INFO = WORLD_MODEL_TRAINING_INFO;

/** Planned input, shared by prediction and execution; it does not inspect results. */
export function worldForceAt(action: WorldAction, time: number): number {
  return time < WORLD_PUSH_SECONDS - 1e-9 ? WORLD_ACTION_FORCE[action] : 0;
}

/** The separate simulated world: unit mass, linear and quadratic motion resistance. */
export function stepWorldPhysics(state: WorldState, force: number): WorldState {
  const acceleration =
    force - 1.2 * state.velocity - 0.45 * state.velocity * Math.abs(state.velocity);
  const velocity = state.velocity + acceleration * WORLD_DT;
  return { time: state.time + WORLD_DT, x: state.x + velocity * WORLD_DT, velocity };
}

/**
 * Frozen residual dynamics model. Its only inputs are the current state and the
 * planned force. No physics coefficients, simulator call, or result correction.
 * 3 normalized inputs -> 12 tanh units -> 2 linear state-change-rate outputs.
 */
export function predictWorldNext(state: WorldState, force: number): WorldState {
  const input = [state.x / 1.5 - 1, state.velocity / 2, force / 5];
  const hidden = new Float64Array(12);
  for (let unit = 0; unit < hidden.length; unit++) {
    const base = unit * 4;
    hidden[unit] = Math.tanh(
      WORLD_MODEL_WEIGHTS[base] * input[0] +
        WORLD_MODEL_WEIGHTS[base + 1] * input[1] +
        WORLD_MODEL_WEIGHTS[base + 2] * input[2] +
        WORLD_MODEL_WEIGHTS[base + 3],
    );
  }
  const output = [WORLD_MODEL_WEIGHTS[60], WORLD_MODEL_WEIGHTS[73]];
  for (let unit = 0; unit < hidden.length; unit++) {
    output[0] += WORLD_MODEL_WEIGHTS[48 + unit] * hidden[unit];
    output[1] += WORLD_MODEL_WEIGHTS[61 + unit] * hidden[unit];
  }
  return {
    time: state.time + WORLD_DT,
    x: state.x + output[0] * 2 * WORLD_DT,
    velocity: state.velocity + output[1] * 5 * WORLD_DT,
  };
}

function rollout(
  action: WorldAction,
  initial: WorldState,
  transition: (state: WorldState, force: number) => WorldState,
): WorldTrajectory {
  let state = { ...initial, time: 0 };
  const trajectory: WorldFrame[] = [];
  const ticks = Math.round(WORLD_HORIZON / WORLD_DT);
  for (let tick = 0; tick < ticks; tick++) {
    const force = worldForceAt(action, tick * WORLD_DT);
    trajectory.push({ ...state, force });
    state = transition(state, force);
  }
  trajectory.push({ ...state, force: 0 });
  return { trajectory, finalX: state.x, duration: WORLD_HORIZON };
}
export function predictWorldTrajectory(
  action: WorldAction,
  initial: WorldState = WORLD_INITIAL,
): WorldTrajectory {
  return rollout(action, initial, predictWorldNext);
}

/** Predict every candidate with the learned model, from one shared initial state. */
export function predictWorldCandidates(
  initial: WorldState = WORLD_INITIAL,
): Readonly<Record<WorldAction, WorldTrajectory>> {
  return Object.freeze({
    none: predictWorldTrajectory("none", initial),
    weak: predictWorldTrajectory("weak", initial),
    strong: predictWorldTrajectory("strong", initial),
  });
}

/**
 * A separate, finite-candidate open-loop planner: rank supplied predictions by
 * endpoint distance to a goal. It never consults the simulator or execution.
 * This is neither MPC (no online replanning), RL, nor a learned action policy.
 * Exact ties keep WORLD_ACTIONS order; the best candidate need not reach the goal.
 */
export function planWorldAction(
  candidates: Readonly<Record<WorldAction, WorldTrajectory>>,
  targetX: number,
): { action: WorldAction; targetX: number; predictedDistance: number } {
  let action: WorldAction = WORLD_ACTIONS[0];
  let predictedDistance = Math.abs(candidates[action].finalX - targetX);
  for (const candidate of WORLD_ACTIONS) {
    const distance = Math.abs(candidates[candidate].finalX - targetX);
    if (distance < predictedDistance) {
      action = candidate;
      predictedDistance = distance;
    }
  }
  return { action, targetX, predictedDistance };
}

export function simulateWorldTrajectory(
  action: WorldAction,
  initial: WorldState = WORLD_INITIAL,
): WorldTrajectory {
  return rollout(action, initial, stepWorldPhysics);
}
export function evaluateWorldAction(action: WorldAction, initial: WorldState = WORLD_INITIAL) {
  const prediction = predictWorldTrajectory(action, initial);
  const actual = simulateWorldTrajectory(action, initial);
  return { prediction, actual, error: Math.abs(prediction.finalX - actual.finalX) };
}
