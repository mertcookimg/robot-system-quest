// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Offline supervised transition learning, not action imitation or policy search.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WORLD_DT, stepWorldPhysics, type WorldState } from "../src/lib/world_model";

export interface WorldTransitionSample {
  state: WorldState;
  force: number;
  next: WorldState;
}
const DEFAULT_SEED = 20261103;
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
export function makeWorldTransitionData(count = 5000, seed = DEFAULT_SEED) {
  const random = seededRandom(seed);
  const train: WorldTransitionSample[] = [],
    heldOut: WorldTransitionSample[] = [];
  for (let i = 0; i < count; i++) {
    const state = {
      time: 0,
      x: random() * 2.5,
      velocity: i % 10 === 0 ? 0 : -0.3 + random() * 2.8,
    };
    const force = i % 5 === 0 ? 0 : random() * 5;
    const sample = { state, force, next: stepWorldPhysics(state, force) };
    // Rotate the held-out residue so resting and zero-force examples occur in
    // both sets; a plain i % 5 split would put all zero-force cases in training.
    ((i + Math.floor(i / 5)) % 5 === 4 ? heldOut : train).push(sample);
  }
  return { train, heldOut };
}

export function trainWorldModel(
  options: { epochs?: number; samples?: number; seed?: number } = {},
) {
  const seed = options.seed ?? DEFAULT_SEED;
  const epochs = options.epochs ?? 1800;
  const dataset = makeWorldTransitionData(options.samples ?? 5000, seed);
  const samples = dataset.train;
  const data = samples.map(({ state, force, next }) => ({
    input: [state.x / 1.5 - 1, state.velocity / 2, force / 5],
    target: [
      (next.x - state.x) / (2 * WORLD_DT),
      (next.velocity - state.velocity) / (5 * WORLD_DT),
    ],
    importance: state.velocity === 0 && force === 0 ? 4 : 1,
  }));
  const normalizer = data.reduce((sum, sample) => sum + sample.importance, 0);
  const random = seededRandom(seed + 1);
  const weights = new Float64Array(74);
  for (let i = 0; i < 48; i++) if (i % 4 !== 3) weights[i] = (random() - 0.5) * 1.4;
  for (let i = 48; i < 74; i++) if (i !== 60 && i !== 73) weights[i] = (random() - 0.5) * 0.2;
  const first = new Float64Array(74),
    second = new Float64Array(74),
    gradient = new Float64Array(74);
  const hidden = new Float64Array(12),
    output = new Float64Array(2);
  let initialLoss = 0,
    finalLoss = 0;
  for (let epoch = 0; epoch <= epochs; epoch++) {
    gradient.fill(0);
    finalLoss = 0;
    for (const sample of data) {
      for (let unit = 0; unit < 12; unit++) {
        const base = unit * 4;
        hidden[unit] = Math.tanh(
          weights[base] * sample.input[0] +
            weights[base + 1] * sample.input[1] +
            weights[base + 2] * sample.input[2] +
            weights[base + 3],
        );
      }
      output[0] = weights[60];
      output[1] = weights[73];
      for (let unit = 0; unit < 12; unit++) {
        output[0] += weights[48 + unit] * hidden[unit];
        output[1] += weights[61 + unit] * hidden[unit];
      }
      const errors = [
        ((output[0] - sample.target[0]) * sample.importance) / normalizer,
        ((output[1] - sample.target[1]) * sample.importance) / normalizer,
      ];
      finalLoss +=
        (sample.importance *
          ((output[0] - sample.target[0]) ** 2 + (output[1] - sample.target[1]) ** 2)) /
        (2 * normalizer);
      gradient[60] += errors[0];
      gradient[73] += errors[1];
      for (let unit = 0; unit < 12; unit++) {
        gradient[48 + unit] += errors[0] * hidden[unit];
        gradient[61 + unit] += errors[1] * hidden[unit];
        const chain =
          (errors[0] * weights[48 + unit] + errors[1] * weights[61 + unit]) *
          (1 - hidden[unit] ** 2);
        const base = unit * 4;
        for (let feature = 0; feature < 3; feature++)
          gradient[base + feature] += chain * sample.input[feature];
        gradient[base + 3] += chain;
      }
    }
    if (epoch === 0) initialLoss = finalLoss;
    if (epoch === epochs) break;
    for (let i = 0; i < weights.length; i++) {
      first[i] = 0.9 * first[i] + 0.1 * gradient[i];
      second[i] = 0.999 * second[i] + 0.001 * gradient[i] ** 2;
      weights[i] -=
        (0.01 * first[i]) /
        (1 - 0.9 ** (epoch + 1)) /
        (Math.sqrt(second[i] / (1 - 0.999 ** (epoch + 1))) + 1e-8);
    }
  }
  return {
    weights: Array.from(weights, (value) => Number(value.toFixed(12))),
    info: {
      architecture: "3-12-2 tanh residual transition MLP",
      parameters: weights.length,
      seed,
      samples: samples.length,
      heldOutSamples: dataset.heldOut.length,
      split:
        "rotating 20% transition holdout; all positions and forces use the same bounded simulator",
      epochs,
      optimizer: "full-batch Adam",
      learningRate: 0.01,
      inputRange: "x: 0..2.5 m; velocity: -0.3..2.5 m/s; force: 0..5 N",
      loss: "weighted MSE of normalized state-change rates; resting transitions have weight 4",
      initialLoss,
      finalLoss,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = trainWorldModel();
  const source = `// Copyright 2026 Masato Kobayashi\n// SPDX-License-Identifier: Apache-2.0\n// Generated by scripts/train-world-model.ts. Frozen transition-prediction weights.\nexport const WORLD_MODEL_WEIGHTS: readonly number[] = Object.freeze(${JSON.stringify(result.weights)});\nexport const WORLD_MODEL_TRAINING_INFO = Object.freeze(${JSON.stringify(result.info)});\n`;
  writeFileSync(
    fileURLToPath(new URL("../src/lib/world_model_weights.ts", import.meta.url)),
    source,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(result.info, null, 2)}\n`);
}
