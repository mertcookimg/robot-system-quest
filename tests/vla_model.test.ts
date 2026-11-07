// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  VLA_ACTIONS,
  VLA_WIDTH,
  VLA_HEIGHT,
  VLA_IMAGE_SIZE,
  VLA_INSTRUCTIONS,
  VLA_SCENES,
  VLA_MODEL_INFO,
  evaluateVla,
  predictVla,
  renderVlaImage,
  stepVla,
  type VlaScene,
} from "../src/lib/vla_model";
import { VLA_WEIGHTS } from "../src/lib/vla_weights";
import { makeVlaTrainingData, trainVlaModel } from "../scripts/train-vla-model";

test("rendering supplies 105 RGB values with separate additive channels on overlap", () => {
  const scene: VlaScene = { robot: { x: 2, y: 1 }, red: { x: 2, y: 1 }, blue: { x: 4, y: 3 } };
  const image = renderVlaImage(scene);
  assert.equal(image.length, VLA_IMAGE_SIZE);
  assert.equal(image.length, 7 * 5 * 3);
  const overlap = (1 * VLA_WIDTH + 2) * 3;
  assert.deepEqual(Array.from(image.slice(overlap, overlap + 3)), [1, 1, 0]);
  assert.equal(image[(3 * VLA_WIDTH + 4) * 3 + 2], 1);
  assert.equal(
    image.reduce((sum, value) => sum + value, 0),
    3,
  );
  assert.throws(() => renderVlaImage({ ...scene, robot: { x: -1, y: 0 } }), RangeError);
});

test("the same image changes action with language and the same language changes action with pixels", () => {
  const image = renderVlaImage(VLA_SCENES[0]);
  assert.equal(predictVla(image, "red").action, "left");
  assert.equal(predictVla(image, "blue").action, "right");
  // Direct pixel intervention: swap R and B while retaining the robot channel.
  const changedPixels = image.slice();
  for (let i = 0; i < image.length; i += 3) {
    changedPixels[i] = image[i + 2];
    changedPixels[i + 2] = image[i];
  }
  assert.equal(predictVla(changedPixels, "red").action, "right");
  assert.equal(predictVla(changedPixels, "blue").action, "left");
  assert.deepEqual(changedPixels, renderVlaImage(VLA_SCENES[1]));
  assert.equal(predictVla(renderVlaImage(VLA_SCENES[2]), "red").action, "up");
  assert.equal(predictVla(renderVlaImage(VLA_SCENES[2]), "blue").action, "down");
});

test("prediction reads only supplied pixel numbers and instruction, including a hidden image", () => {
  const scene = structuredClone(VLA_SCENES[0]);
  const image = renderVlaImage(scene);
  const original = predictVla(image, "red");
  scene.red = { x: 6, y: 4 };
  scene.blue = { x: 0, y: 0 };
  assert.deepEqual(
    predictVla(image, "red"),
    original,
    "Mutating world coordinates must not affect an existing image",
  );
  const hiddenA = renderVlaImage(VLA_SCENES[0]);
  const hiddenB = renderVlaImage(VLA_SCENES[1]);
  hiddenA.fill(0);
  hiddenB.fill(0);
  Object.defineProperty(hiddenA, "scene", {
    get: () => {
      throw new Error("Scene metadata must not be read");
    },
  });
  for (const instruction of VLA_INSTRUCTIONS) {
    assert.deepEqual(predictVla(hiddenA, instruction), predictVla(hiddenB, instruction));
    assert.deepEqual(
      predictVla(Array.from(hiddenA), instruction),
      predictVla(hiddenA, instruction),
    );
  }
  assert.notDeepEqual(original.probabilities, predictVla(hiddenA, "red").probabilities);
  assert.throws(() => predictVla([0, 1, 0], "red"), RangeError);
  const invalid = new Float32Array(VLA_IMAGE_SIZE);
  invalid[0] = NaN;
  assert.throws(() => predictVla(invalid, "red"), RangeError);
});

test("bundled behavior-cloning weights and output scores are frozen and inference is repeatable", () => {
  assert.equal(VLA_WEIGHTS.length, (VLA_IMAGE_SIZE + 1) * VLA_ACTIONS.length * 2);
  assert.ok(VLA_WEIGHTS.every(Number.isFinite));
  assert.ok(VLA_WEIGHTS.some((value) => value !== 0));
  assert.ok(Object.isFrozen(VLA_WEIGHTS));
  assert.ok(Object.isFrozen(VLA_MODEL_INFO));
  assert.throws(() => {
    (VLA_WEIGHTS as number[])[0] = 999;
  }, TypeError);
  const before = [...VLA_WEIGHTS];
  const image = renderVlaImage(VLA_SCENES[0]);
  const prediction = predictVla(image, "red");
  assert.deepEqual(predictVla(image, "red"), prediction);
  assert.ok(Object.isFrozen(prediction.probabilities));
  assert.ok(Math.abs(prediction.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.equal(prediction.confidence, Math.max(...prediction.probabilities));
  evaluateVla(VLA_SCENES[0], "red");
  assert.deepEqual(VLA_WEIGHTS, before);
  assert.ok(VLA_MODEL_INFO.finalLoss < VLA_MODEL_INFO.initialLoss * 0.1);
  assert.equal(VLA_MODEL_INFO.trainingAccuracy, 1);
});

test("offline training learns from demonstrations and reproduces its weights for the same seed", () => {
  const options = { epochs: 3, seed: 1337, distractorsPerPair: 1 };
  const first = trainVlaModel(options);
  const second = trainVlaModel(options);
  assert.deepEqual(first, second);
  assert.ok(first.weights.some((weight) => weight !== 0));
  assert.ok(first.info.finalLoss < first.info.initialLoss);
  assert.notDeepEqual(first.weights, trainVlaModel({ ...options, seed: 1338 }).weights);
});

test("the environment applies actions without steering correction and scores actual target arrival", () => {
  const scene = structuredClone(VLA_SCENES[0]);
  const before = structuredClone(scene);
  const wrongWay = stepVla(scene, "right", "red");
  assert.deepEqual(wrongWay.scene.robot, { x: 4, y: 2 });
  assert.equal(wrongWay.atTarget, false);
  assert.equal(wrongWay.moved, true);
  assert.deepEqual(scene, before);
  const stopped = stepVla(scene, "stop", "red");
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.atTarget, false, "Stop is not success unless physically at the target");
  const boundary = stepVla({ ...scene, robot: { x: 0, y: 0 } }, "left", "blue");
  assert.equal(boundary.moved, false);
  assert.equal(boundary.atTarget, false, "Being at the other colored box is not success");
  const arrival = stepVla({ ...scene, robot: { x: 1, y: 0 } }, "left", "red");
  assert.equal(arrival.atTarget, true);
  assert.equal(predictVla(renderVlaImage(arrival.scene), "red").action, "stop");
});

test("all six lesson comparisons reach the instructed box with real image-driven actions", () => {
  for (const scene of VLA_SCENES) {
    for (const instruction of VLA_INSTRUCTIONS) {
      const run = evaluateVla(scene, instruction);
      assert.equal(run.success, true);
      assert.deepEqual(run.path.at(-1), scene[instruction]);
      assert.equal(run.path.length, run.steps + 1);
      assert.equal(run.actions.length, run.steps);
      let current = structuredClone(scene);
      for (let i = 0; i < run.steps; i++) {
        const prediction = predictVla(renderVlaImage(current), instruction);
        assert.deepEqual(prediction, run.predictions[i]);
        assert.equal(prediction.action, run.actions[i]);
        current = stepVla(current, prediction.action, instruction).scene;
        assert.deepEqual(current.robot, run.path[i + 1]);
      }
    }
  }
  assert.equal(evaluateVla(VLA_SCENES[0], "red", 1).success, false);
});

test("the complete bounded color-image domain succeeds, including combinations absent from training", () => {
  const training = makeVlaTrainingData();
  const key = (image: ArrayLike<number>, instruction: string) => {
    const active: number[] = [];
    for (let i = 0; i < image.length; i++) if (image[i]) active.push(i);
    return `${instruction}:${active.join(",")}`;
  };
  const trainingKeys = new Set(training.map((sample) => key(sample.pixels, sample.instruction)));
  assert.equal(trainingKeys.size, 66640);
  assert.equal(training.length, VLA_MODEL_INFO.samples);
  const position = (i: number) => ({ x: i % VLA_WIDTH, y: Math.floor(i / VLA_WIDTH) });
  const cells = VLA_WIDTH * VLA_HEIGHT;
  let total = 0,
    heldOut = 0,
    failures = 0,
    stopErrors = 0,
    longest = 0;
  for (let robot = 0; robot < cells; robot++) {
    for (let red = 0; red < cells; red++) {
      for (let blue = 0; blue < cells; blue++) {
        if (red === blue) continue;
        const scene = { robot: position(robot), red: position(red), blue: position(blue) };
        const image = renderVlaImage(scene);
        for (const instruction of VLA_INSTRUCTIONS) {
          if (!trainingKeys.has(key(image, instruction))) heldOut++;
          const run = evaluateVla(scene, instruction);
          if (!run.success) failures++;
          if (
            robot === (instruction === "red" ? red : blue) &&
            predictVla(image, instruction).action !== "stop"
          )
            stopErrors++;
          longest = Math.max(longest, run.steps);
          total++;
        }
      }
    }
  }
  assert.equal(total, 83300);
  assert.equal(heldOut, 16660);
  assert.equal(failures, 0);
  assert.equal(stopErrors, 0);
  assert.ok(longest <= 10);
});
