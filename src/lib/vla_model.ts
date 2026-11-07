// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import { VLA_TRAINING_INFO, VLA_WEIGHTS } from "./vla_weights";

export const VLA_WIDTH = 7;
export const VLA_HEIGHT = 5;
export const VLA_IMAGE_SIZE = VLA_WIDTH * VLA_HEIGHT * 3;
export const VLA_ACTIONS = ["up", "right", "down", "left", "stop"] as const;
export const VLA_INSTRUCTIONS = ["red", "blue"] as const;
export type VlaAction = (typeof VLA_ACTIONS)[number];
export type VlaInstruction = (typeof VLA_INSTRUCTIONS)[number];
export interface VlaPosition {
  x: number;
  y: number;
}
export interface VlaScene {
  robot: VlaPosition;
  red: VlaPosition;
  blue: VlaPosition;
}
export const VLA_SCENES: readonly VlaScene[] = Object.freeze([
  Object.freeze({
    robot: Object.freeze({ x: 3, y: 2 }),
    red: Object.freeze({ x: 0, y: 0 }),
    blue: Object.freeze({ x: 6, y: 4 }),
  }),
  Object.freeze({
    robot: Object.freeze({ x: 3, y: 2 }),
    red: Object.freeze({ x: 6, y: 4 }),
    blue: Object.freeze({ x: 0, y: 0 }),
  }),
  Object.freeze({
    robot: Object.freeze({ x: 3, y: 2 }),
    red: Object.freeze({ x: 3, y: 0 }),
    blue: Object.freeze({ x: 3, y: 4 }),
  }),
]);
export const VLA_MODEL_INFO = VLA_TRAINING_INFO;
export interface VlaPrediction {
  action: VlaAction;
  /** Softmax score, not a calibrated probability of reaching the target. */
  confidence: number;
  probabilities: readonly number[];
}
export interface VlaTransition {
  scene: VlaScene;
  moved: boolean;
  atTarget: boolean;
  stopped: boolean;
}
export interface VlaRun {
  path: VlaPosition[];
  actions: VlaAction[];
  predictions: VlaPrediction[];
  success: boolean;
  steps: number;
  stopped: boolean;
}
const same = (a: VlaPosition, b: VlaPosition) => a.x === b.x && a.y === b.y;
const copyScene = (scene: VlaScene): VlaScene => ({
  robot: { ...scene.robot },
  red: { ...scene.red },
  blue: { ...scene.blue },
});
function validatePosition(position: VlaPosition): void {
  if (
    !Number.isInteger(position.x) ||
    !Number.isInteger(position.y) ||
    position.x < 0 ||
    position.x >= VLA_WIDTH ||
    position.y < 0 ||
    position.y >= VLA_HEIGHT
  )
    throw new RangeError("VLA scene positions must be inside the 7 by 5 image");
}

/** Renderer/environment only. Overlap adds separate R, G and B channels. */
export function renderVlaImage(scene: VlaScene): Float32Array {
  const image = new Float32Array(VLA_IMAGE_SIZE);
  for (const [name, channel] of [
    ["red", 0],
    ["robot", 1],
    ["blue", 2],
  ] as const) {
    const position = scene[name];
    validatePosition(position);
    image[(position.y * VLA_WIDTH + position.x) * 3 + channel] += 1;
  }
  return image;
}

/**
 * Frozen pixel-to-action inference. No scene, position, target detector, route
 * planner, teacher, or environment success signal is available to this function.
 * The instruction selects a learned block of pixel weights (cross features).
 */
export function predictVla(image: ArrayLike<number>, instruction: VlaInstruction): VlaPrediction {
  if (image.length !== VLA_IMAGE_SIZE) throw new RangeError("Expected 105 RGB image values");
  const instructionIndex = VLA_INSTRUCTIONS.indexOf(instruction);
  if (instructionIndex < 0) throw new RangeError("Supported instructions are red and blue");
  const featureCount = VLA_IMAGE_SIZE + 1;
  const block = instructionIndex * VLA_ACTIONS.length * featureCount;
  const logits = VLA_ACTIONS.map(
    (_, action) => VLA_WEIGHTS[block + action * featureCount + VLA_IMAGE_SIZE],
  );
  for (let pixel = 0; pixel < VLA_IMAGE_SIZE; pixel++) {
    const value = image[pixel];
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError("RGB values must be finite and between 0 and 1");
    if (value === 0) continue;
    for (let action = 0; action < VLA_ACTIONS.length; action++) {
      logits[action] += VLA_WEIGHTS[block + action * featureCount + pixel] * value;
    }
  }
  const highest = Math.max(...logits);
  const scores = logits.map((value) => Math.exp(value - highest));
  const total = scores.reduce((sum, value) => sum + value, 0);
  const probabilities = Object.freeze(scores.map((value) => value / total));
  const actionIndex = logits.indexOf(highest);
  return {
    action: VLA_ACTIONS[actionIndex],
    confidence: probabilities[actionIndex],
    probabilities,
  };
}

/** Ground-truth positions are used by the simulator and grading, never inference. */
export function stepVla(
  scene: VlaScene,
  action: VlaAction,
  instruction: VlaInstruction,
): VlaTransition {
  const next = copyScene(scene);
  const delta = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0], stop: [0, 0] }[action];
  next.robot.x = Math.max(0, Math.min(VLA_WIDTH - 1, next.robot.x + delta[0]));
  next.robot.y = Math.max(0, Math.min(VLA_HEIGHT - 1, next.robot.y + delta[1]));
  return {
    scene: next,
    moved: !same(scene.robot, next.robot),
    atTarget: same(next.robot, next[instruction]),
    stopped: action === "stop",
  };
}

export function evaluateVla(initial: VlaScene, instruction: VlaInstruction, maxSteps = 20): VlaRun {
  let scene = copyScene(initial);
  const run: VlaRun = {
    path: [{ ...scene.robot }],
    actions: [],
    predictions: [],
    success: same(scene.robot, scene[instruction]),
    steps: 0,
    stopped: false,
  };
  while (!run.success && !run.stopped && run.steps < maxSteps) {
    const prediction = predictVla(renderVlaImage(scene), instruction);
    const transition = stepVla(scene, prediction.action, instruction);
    scene = transition.scene;
    run.predictions.push(prediction);
    run.actions.push(prediction.action);
    run.path.push({ ...scene.robot });
    run.steps++;
    run.success = transition.atTarget;
    run.stopped = transition.stopped;
  }
  return run;
}
