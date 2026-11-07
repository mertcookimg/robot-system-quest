// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Offline supervised training. No teacher is bundled into browser inference.
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  VLA_WIDTH,
  VLA_HEIGHT,
  VLA_IMAGE_SIZE,
  VLA_ACTIONS,
  VLA_INSTRUCTIONS,
  renderVlaImage,
  type VlaAction,
  type VlaInstruction,
  type VlaScene,
} from "../src/lib/vla_model";

export interface VlaTrainingSample {
  pixels: readonly number[];
  instruction: VlaInstruction;
  action: VlaAction;
}
const FEATURE_COUNT = VLA_IMAGE_SIZE + 1;
const PARAMETER_COUNT = FEATURE_COUNT * VLA_ACTIONS.length * VLA_INSTRUCTIONS.length;
const SEED = 20261103;

/** Teacher exists only in this offline script and only provides training labels. */
function demonstration(scene: VlaScene, instruction: VlaInstruction): VlaAction {
  const target = scene[instruction];
  const dx = target.x - scene.robot.x;
  const dy = target.y - scene.robot.y;
  if (!dx && !dy) return "stop";
  if (Math.abs(dy) >= Math.abs(dx)) return dy < 0 ? "up" : "down";
  return dx < 0 ? "left" : "right";
}

export function makeVlaTrainingData(seed = SEED, distractorsPerPair = 34): VlaTrainingSample[] {
  let randomState = seed >>> 0;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const positions = Array.from({ length: VLA_WIDTH * VLA_HEIGHT }, (_, i) => ({
    x: i % VLA_WIDTH,
    y: Math.floor(i / VLA_WIDTH),
  }));
  const samples: VlaTrainingSample[] = [];
  for (const instruction of VLA_INSTRUCTIONS) {
    for (let targetIndex = 0; targetIndex < positions.length; targetIndex++) {
      for (const [robotIndex, robot] of positions.entries()) {
        for (let variant = 0; variant < distractorsPerPair; variant++) {
          let distractorIndex =
            distractorsPerPair === 34 ? variant : Math.floor(random() * (positions.length - 1));
          if (distractorIndex >= targetIndex) distractorIndex++;
          // Hold out one fifth of scene/instruction combinations. Every position
          // still appears in training; this tests recombination, not new worlds.
          if (
            (robotIndex * 17 +
              targetIndex * 11 +
              distractorIndex * 7 +
              VLA_INSTRUCTIONS.indexOf(instruction) * 3 +
              seed) %
              5 ===
            0
          )
            continue;
          const target = positions[targetIndex],
            distractor = positions[distractorIndex];
          const scene = {
            robot,
            red: instruction === "red" ? target : distractor,
            blue: instruction === "blue" ? target : distractor,
          };
          samples.push({
            pixels: Array.from(renderVlaImage(scene)),
            instruction,
            action: demonstration(scene, instruction),
          });
        }
      }
    }
  }
  return samples;
}

export function trainVlaModel(
  options: { epochs?: number; seed?: number; distractorsPerPair?: number } = {},
) {
  const epochs = options.epochs ?? 1200;
  const seed = options.seed ?? SEED;
  const samples = makeVlaTrainingData(seed, options.distractorsPerPair ?? 34);
  const data = samples.map((sample) => ({
    indices: sample.pixels.flatMap((value, index) => (value ? [index] : [])),
    block: VLA_INSTRUCTIONS.indexOf(sample.instruction) * VLA_ACTIONS.length * FEATURE_COUNT,
    label: VLA_ACTIONS.indexOf(sample.action),
    importance: sample.action === "stop" ? 4 : 1,
  }));
  const normalizer = data.reduce((sum, sample) => sum + sample.importance, 0);
  const weights = new Float64Array(PARAMETER_COUNT);
  const first = new Float64Array(PARAMETER_COUNT);
  const second = new Float64Array(PARAMETER_COUNT);
  const gradient = new Float64Array(PARAMETER_COUNT);
  const logits = new Float64Array(VLA_ACTIONS.length);
  let finalLoss = Math.log(VLA_ACTIONS.length),
    correct = 0;
  for (let epoch = 1; epoch <= epochs + 1; epoch++) {
    gradient.fill(0);
    finalLoss = 0;
    correct = 0;
    for (const sample of data) {
      for (let action = 0; action < VLA_ACTIONS.length; action++) {
        const base = sample.block + action * FEATURE_COUNT;
        logits[action] = weights[base + VLA_IMAGE_SIZE];
        for (const index of sample.indices) logits[action] += weights[base + index];
      }
      const highest = Math.max(...logits);
      if (logits.indexOf(highest) === sample.label) correct++;
      let total = 0;
      for (let action = 0; action < logits.length; action++)
        total += logits[action] = Math.exp(logits[action] - highest);
      finalLoss -=
        (sample.importance / normalizer) * Math.log(Math.max(1e-300, logits[sample.label] / total));
      for (let action = 0; action < VLA_ACTIONS.length; action++) {
        const error =
          (sample.importance / normalizer) *
          (logits[action] / total - Number(action === sample.label));
        const base = sample.block + action * FEATURE_COUNT;
        gradient[base + VLA_IMAGE_SIZE] += error;
        for (const index of sample.indices) gradient[base + index] += error;
      }
    }
    // Measure the final snapshot once more, without making an extra update.
    if (epoch > epochs) break;
    for (let index = 0; index < weights.length; index++) {
      first[index] = 0.9 * first[index] + 0.1 * gradient[index];
      second[index] = 0.999 * second[index] + 0.001 * gradient[index] ** 2;
      weights[index] -=
        (0.06 * (first[index] / (1 - 0.9 ** epoch))) /
        (Math.sqrt(second[index] / (1 - 0.999 ** epoch)) + 1e-8);
    }
  }
  return {
    weights: Array.from(weights, (value) => Number(value.toFixed(10))),
    info: {
      architecture: "instruction-conditioned linear softmax",
      split: "20% of scene/instruction combinations held out by a fixed hash; same 7x5 domain",
      optimizer: "full-batch Adam",
      learningRate: 0.06,
      stopExampleWeight: 4,
      seed,
      samples: samples.length,
      epochs,
      initialLoss: Math.log(VLA_ACTIONS.length),
      finalLoss,
      trainingAccuracy: correct / data.length,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = trainVlaModel();
  const output = fileURLToPath(new URL("../src/lib/vla_weights.ts", import.meta.url));
  const source = `// Copyright 2026 Masato Kobayashi\n// SPDX-License-Identifier: Apache-2.0\n// Generated by scripts/train-vla-model.ts. Frozen offline behavior-cloning weights.\nexport const VLA_WEIGHTS: readonly number[] = Object.freeze(${JSON.stringify(result.weights)});\nexport const VLA_TRAINING_INFO = Object.freeze(${JSON.stringify(result.info)});\n`;
  writeFileSync(output, source, "utf8");
  process.stdout.write(`${JSON.stringify(result.info, null, 2)}\n`);
}
