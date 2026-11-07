// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// A small, deterministic imitation-learning experiment. Policies receive
// local sensor features, never course IDs or privileged world coordinates.
export const IMITATION_DT = 1 / 30;
export const IMITATION_SPEED = 65;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
export type Observation = [offset: number, relativeVelocity: number];
export interface Demonstration {
  observation: Observation;
  action: number;
}
export type ImitationPolicy = (observation: Observation) => number;
export interface LearnerRobot {
  x: number;
  y: number;
  vy: number;
  ticks: number;
  errorSum: number;
  outsideSeconds: number;
  departures: number;
  outside: boolean;
}
export const IMITATION_TESTS = [
  { course: 1, offset: 36 },
  { course: 2, offset: -36 },
  { course: 3, offset: 72 },
] as const;
export function laneCenter(x: number, course = 0): number {
  const p = (x - 60) / 680;
  return 250 + 76 * Math.sin(p * Math.PI * 2 + course * 0.65) + 22 * Math.sin(p * Math.PI * 4);
}
export function makeLearnerRobot(course = 0, offset = 0, start = 60): LearnerRobot {
  return {
    x: start,
    y: laneCenter(start, course) + offset,
    vy: 0,
    ticks: 0,
    errorSum: 0,
    outsideSeconds: 0,
    departures: 0,
    outside: false,
  };
}
export function observeLearner(robot: LearnerRobot, course: number): Observation {
  const tangent = (laneCenter(robot.x + 1, course) - laneCenter(robot.x - 1, course)) / 2;
  return [
    (laneCenter(robot.x, course) - robot.y) / 100,
    (robot.vy - tangent * IMITATION_SPEED) / 100,
  ];
}
export function stepLearner(robot: LearnerRobot, action: number, course: number): void {
  robot.vy += (220 * clamp(action, -1, 1) - 2.2 * robot.vy) * IMITATION_DT;
  robot.y += robot.vy * IMITATION_DT;
  if (robot.y < 118 || robot.y > 424) {
    robot.y = clamp(robot.y, 118, 424);
    robot.vy = 0;
  }
  robot.x = Math.min(740, robot.x + IMITATION_SPEED * IMITATION_DT);
  robot.ticks++;
  const error = Math.abs(laneCenter(robot.x, course) - robot.y);
  robot.errorSum += error;
  const outside = error > 44;
  if (outside && !robot.outside) robot.departures++;
  if (outside) robot.outsideSeconds += IMITATION_DT;
  robot.outside = outside;
}
export const teacherAction: ImitationPolicy = ([offset, velocity]) =>
  clamp(2.8 * offset - 1.8 * velocity, -1, 1);
export function collectTeacherDemo(offset = 0, start = 60): Demonstration[] {
  const robot = makeLearnerRobot(0, offset, start);
  const samples: Demonstration[] = [];
  while (robot.x < 740) {
    const observation = observeLearner(robot, 0);
    const action = teacherAction(observation);
    if (robot.ticks % 3 === 0) samples.push({ observation, action });
    stepLearner(robot, action, 0);
  }
  return samples;
}
export function collectRecoveryDemos(): Demonstration[] {
  return [60, 190, 320, 450, 580].flatMap((start) =>
    [-70, 70].flatMap((offset) => collectTeacherDemo(offset, start)),
  );
}
export const BC_EPOCHS = 240;
const HIDDEN = 12;
const PARAMS = HIDDEN * 4 + 1;
export interface CloningReport {
  epochs: number;
  losses: readonly number[];
  initialLoss: number;
  finalLoss: number;
  examples: readonly Demonstration[];
}
export type ClonedPolicy = ImitationPolicy & { report: CloningReport };

// 2 observations -> 12 tanh units -> 1 tanh steering output (49 parameters).
// No teacher, lane geometry, score, or test rollout is consulted by fitting.
function predict(weights: Float64Array, [x, v]: Observation, hidden: Float64Array): number {
  let output = weights[PARAMS - 1];
  for (let j = 0; j < HIDDEN; j++) {
    hidden[j] = Math.tanh(weights[j * 4] * x + weights[j * 4 + 1] * v + weights[j * 4 + 2]);
    output += weights[j * 4 + 3] * hidden[j];
  }
  return Math.tanh(output);
}

export function createCloningTrainer(samples: readonly Demonstration[]) {
  const data = samples.map((s) => ({
    observation: [...s.observation] as Observation,
    action: s.action,
  }));
  // Identical initialization on every fit isolates the effect of changing data.
  let seed = 1337;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const weights = new Float64Array(PARAMS);
  for (let j = 0; j < HIDDEN; j++) {
    weights[j * 4] = (random() - 0.5) * 1.2;
    weights[j * 4 + 1] = (random() - 0.5) * 1.2;
    weights[j * 4 + 3] = (random() - 0.5) * 0.3;
  }
  const hidden = new Float64Array(HIDDEN);
  const first = new Float64Array(PARAMS),
    second = new Float64Array(PARAMS);
  const gradient = new Float64Array(PARAMS);
  let epoch = 0;
  const loss = () =>
    data.length
      ? data.reduce(
          (sum, s) => sum + (predict(weights, s.observation, hidden) - s.action) ** 2,
          0,
        ) / data.length
      : 0;
  const losses = [loss()];
  return {
    get epoch() {
      return epoch;
    },
    get losses(): readonly number[] {
      return losses;
    },
    get done() {
      return epoch >= BC_EPOCHS;
    },
    step(count = 1): void {
      for (let k = 0; k < count && epoch < BC_EPOCHS; k++) {
        gradient.fill(0);
        for (const s of data) {
          const y = predict(weights, s.observation, hidden);
          const outputGradient = (2 * (y - s.action) * (1 - y * y)) / data.length;
          gradient[PARAMS - 1] += outputGradient;
          for (let j = 0; j < HIDDEN; j++) {
            const h = hidden[j],
              i = j * 4;
            const hiddenGradient = outputGradient * weights[i + 3] * (1 - h * h);
            gradient[i] += hiddenGradient * s.observation[0];
            gradient[i + 1] += hiddenGradient * s.observation[1];
            gradient[i + 2] += hiddenGradient;
            gradient[i + 3] += outputGradient * h;
          }
        }
        epoch++;
        // Full-batch Adam on mean squared demonstrated-action error.
        for (let i = 0; i < PARAMS; i++) {
          first[i] = 0.9 * first[i] + 0.1 * gradient[i];
          second[i] = 0.999 * second[i] + 0.001 * gradient[i] ** 2;
          weights[i] -=
            (0.02 * (first[i] / (1 - 0.9 ** epoch))) /
            (Math.sqrt(second[i] / (1 - 0.999 ** epoch)) + 1e-8);
        }
        losses.push(loss());
      }
    },
    snapshot(): ClonedPolicy {
      const frozen = weights.slice();
      const scratch = new Float64Array(HIDDEN);
      const policy: ImitationPolicy = data.length ? (o) => predict(frozen, o, scratch) : () => 0;
      return Object.assign(policy, {
        report: {
          epochs: epoch,
          losses: [...losses],
          initialLoss: losses[0],
          finalLoss: losses.at(-1)!,
          examples: Array.from({ length: Math.min(5, data.length) }, (_, i) => {
            const s =
              data[Math.floor((i * (data.length - 1)) / Math.max(1, Math.min(5, data.length) - 1))];
            return { observation: [...s.observation] as Observation, action: s.action };
          }),
        },
      });
    },
  };
}

export function fitImitationPolicy(samples: readonly Demonstration[]): ClonedPolicy {
  const trainer = createCloningTrainer(samples);
  trainer.step(BC_EPOCHS);
  return trainer.snapshot();
}
export function replayAction(actions: readonly number[], tick: number): number {
  return actions[Math.floor(tick / 3)] ?? 0;
}
export function imitationSuccess(robot: LearnerRobot): boolean {
  return robot.x >= 740 && robot.outsideSeconds < 0.8;
}
export function evaluateImitation(
  policy: ImitationPolicy,
  course: number,
  offset: number,
): LearnerRobot {
  const robot = makeLearnerRobot(course, offset);
  while (robot.x < 740) stepLearner(robot, policy(observeLearner(robot, course)), course);
  return robot;
}
