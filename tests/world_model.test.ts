// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  WORLD_ACTIONS,
  WORLD_ACTION_FORCE,
  WORLD_GOALS,
  WORLD_TARGET_X,
  WORLD_DT,
  WORLD_HORIZON,
  WORLD_INITIAL,
  WORLD_MODEL_INFO,
  WORLD_PUSH_SECONDS,
  WORLD_VIEW_MIN,
  WORLD_VIEW_MAX,
  evaluateWorldAction,
  planWorldAction,
  predictWorldCandidates,
  predictWorldNext,
  predictWorldTrajectory,
  simulateWorldTrajectory,
  stepWorldPhysics,
  worldForceAt,
  type WorldAction,
  type WorldTrajectory,
} from "../src/lib/world_model";
import { WORLD_MODEL_WEIGHTS } from "../src/lib/world_model_weights";
import { makeWorldTransitionData, trainWorldModel } from "../scripts/train-world-model";

test("the separate world moves under force, slows after release, and does not move an unpushed resting box", () => {
  const resting = { ...WORLD_INITIAL };
  assert.equal(stepWorldPhysics(resting, 0).x, resting.x);
  assert.equal(stepWorldPhysics(resting, 0).velocity, 0);
  const weak = stepWorldPhysics(resting, 2);
  const strong = stepWorldPhysics(resting, 5);
  assert.ok(weak.x > resting.x);
  assert.ok(strong.x > weak.x);
  assert.ok(strong.velocity > weak.velocity);
  const released = stepWorldPhysics(strong, 0);
  assert.ok(released.velocity > 0 && released.velocity < strong.velocity);
  assert.ok(released.x > strong.x);
  assert.deepEqual(resting, WORLD_INITIAL);
});

test("all candidate actions share the same initial state, push duration, and two-second horizon", () => {
  const positions: number[] = [];
  for (const action of WORLD_ACTIONS) {
    const run = simulateWorldTrajectory(action);
    assert.equal(run.duration, WORLD_HORIZON);
    assert.equal(run.trajectory.length, 41);
    assert.equal(run.trajectory[0].x, WORLD_INITIAL.x);
    assert.equal(run.trajectory[0].velocity, WORLD_INITIAL.velocity);
    assert.ok(Math.abs(run.trajectory.at(-1)!.time - WORLD_HORIZON) < 1e-12);
    for (let tick = 0; tick < run.trajectory.length; tick++) {
      const frame = run.trajectory[tick];
      const expected =
        tick < Math.round(WORLD_PUSH_SECONDS / WORLD_DT) ? WORLD_ACTION_FORCE[action] : 0;
      assert.equal(frame.force, expected);
      assert.equal(frame.force, worldForceAt(action, tick * WORLD_DT));
      if (tick + 1 < run.trajectory.length) {
        const next = stepWorldPhysics(frame, frame.force);
        const recorded = run.trajectory[tick + 1];
        assert.deepEqual(
          [recorded.time, recorded.x, recorded.velocity],
          [next.time, next.x, next.velocity],
        );
      }
    }
    positions.push(run.finalX);
  }
  assert.equal(positions[0], WORLD_INITIAL.x);
  assert.ok(positions[1] > positions[0] + 0.3);
  assert.ok(positions[2] > positions[1] + 0.4);
});

test("forecast is exactly the repeated learned transition, without real observations or result correction", () => {
  const before = [...WORLD_MODEL_WEIGHTS];
  for (const action of WORLD_ACTIONS) {
    const forecast = predictWorldTrajectory(action);
    let predicted = { ...WORLD_INITIAL };
    for (let tick = 0; tick < 40; tick++) {
      predicted = predictWorldNext(predicted, worldForceAt(action, tick * WORLD_DT));
      const frame = forecast.trajectory[tick + 1];
      assert.deepEqual(
        [frame.time, frame.x, frame.velocity],
        [predicted.time, predicted.x, predicted.velocity],
      );
    }
    assert.equal(forecast.finalX, predicted.x);
    const saved = structuredClone(forecast);
    const real = simulateWorldTrajectory(action);
    real.trajectory.forEach((frame) => {
      frame.x = 100;
      frame.velocity = -100;
    });
    assert.deepEqual(forecast, saved);
    assert.deepEqual(predictWorldTrajectory(action), saved);
  }
  assert.deepEqual(WORLD_MODEL_WEIGHTS, before);
});

test("the frozen learned model responds to both state and planned force and reproduces its outputs", () => {
  const state = { time: 0, x: 0.8, velocity: 0.4 };
  const weak = predictWorldNext(state, 2);
  const strong = predictWorldNext(state, 5);
  assert.ok(strong.velocity > weak.velocity);
  assert.notEqual(predictWorldNext({ ...state, velocity: 1 }, 2).x, weak.x);
  assert.deepEqual(predictWorldNext(state, 2), weak);
  assert.equal(WORLD_MODEL_WEIGHTS.length, 74);
  assert.ok(WORLD_MODEL_WEIGHTS.every(Number.isFinite));
  assert.ok(Object.isFrozen(WORLD_MODEL_WEIGHTS));
  assert.throws(() => {
    (WORLD_MODEL_WEIGHTS as number[])[0] = 999;
  }, TypeError);
  assert.ok(Object.isFrozen(WORLD_MODEL_INFO));
});

test("offline supervised training is deterministic and reduces actual transition prediction loss", () => {
  const options = { epochs: 30, samples: 250, seed: 1337 };
  const first = trainWorldModel(options);
  assert.deepEqual(trainWorldModel(options), first);
  assert.ok(first.info.finalLoss < first.info.initialLoss * 0.2);
  assert.notDeepEqual(trainWorldModel({ ...options, seed: 1338 }).weights, first.weights);
  assert.ok(WORLD_MODEL_INFO.finalLoss < WORLD_MODEL_INFO.initialLoss * 0.001);
  const dataset = makeWorldTransitionData();
  assert.equal(dataset.train.length, WORLD_MODEL_INFO.samples);
  assert.equal(dataset.train.length, 4000);
  assert.equal(dataset.heldOut.length, 1000);
  const trainingKeys = new Set(dataset.train.map((sample) => JSON.stringify(sample)));
  assert.ok(dataset.heldOut.every((sample) => !trainingKeys.has(JSON.stringify(sample))));
  for (const split of [dataset.train, dataset.heldOut]) {
    assert.ok(split.some((sample) => sample.force === 0 && sample.state.velocity === 0));
    assert.ok(split.some((sample) => sample.force === 0 && sample.state.velocity !== 0));
    assert.ok(split.some((sample) => sample.force > 0));
  }
  // Verify the bundled loss against the same weighted, normalized regression target.
  let loss = 0,
    totalWeight = 0;
  for (const sample of dataset.train) {
    const prediction = predictWorldNext(sample.state, sample.force);
    const weight = sample.state.velocity === 0 && sample.force === 0 ? 4 : 1;
    loss +=
      (weight *
        (((prediction.x - sample.next.x) / (2 * WORLD_DT)) ** 2 +
          ((prediction.velocity - sample.next.velocity) / (5 * WORLD_DT)) ** 2)) /
      2;
    totalWeight += weight;
  }
  assert.ok(Math.abs(loss / totalWeight - WORLD_MODEL_INFO.finalLoss) < 1e-10);
});

test("one-step prediction error stays small on the separate bounded transition set", () => {
  const samples = makeWorldTransitionData().heldOut;
  let squaredPositionError = 0,
    squaredVelocityError = 0;
  for (const sample of samples) {
    const predicted = predictWorldNext(sample.state, sample.force);
    squaredPositionError += (predicted.x - sample.next.x) ** 2;
    squaredVelocityError += (predicted.velocity - sample.next.velocity) ** 2;
  }
  assert.ok(Math.sqrt(squaredPositionError / samples.length) < 0.0005);
  assert.ok(Math.sqrt(squaredVelocityError / samples.length) < 0.003);
});

test("the three lesson forecasts have measured small errors and fit the fixed display axis", () => {
  const predictions: number[] = [];
  for (const action of WORLD_ACTIONS) {
    const result = evaluateWorldAction(action);
    assert.equal(result.error, Math.abs(result.prediction.finalX - result.actual.finalX));
    assert.ok(result.error < 0.04);
    assert.equal(result.prediction.duration, result.actual.duration);
    for (const run of [result.prediction, result.actual]) {
      assert.ok(
        run.trajectory.every((frame) => frame.x >= WORLD_VIEW_MIN && frame.x <= WORLD_VIEW_MAX),
      );
    }
    predictions.push(result.prediction.finalX);
  }
  assert.ok(predictions[0] < predictions[1] && predictions[1] < predictions[2]);
});

test("multi-step evaluation is separate from one-step loss and exposes a range limitation", () => {
  let maximum = 0,
    count = 0;
  for (const x of [0.1, 0.6, 1.1]) {
    for (const velocity of [0, 0.2, 0.4]) {
      for (const action of WORLD_ACTIONS) {
        const result = evaluateWorldAction(action, { time: 0, x, velocity });
        maximum = Math.max(maximum, result.error);
        count++;
      }
    }
  }
  assert.equal(count, 27);
  assert.ok(maximum < 0.04);
  const outside = evaluateWorldAction("none", { time: 0, x: 0.25, velocity: 6 });
  assert.ok(outside.error > 0.1);
  assert.ok(outside.error > maximum);
});

test("all planning candidates use learned predictions from the same unmodified initial state", () => {
  const initial = { time: 0, x: 0.6, velocity: 0.2 };
  const saved = { ...initial };
  const candidates = predictWorldCandidates(initial);
  assert.ok(Object.isFrozen(candidates));
  assert.deepEqual(Object.keys(candidates), [...WORLD_ACTIONS]);
  for (const action of WORLD_ACTIONS) {
    assert.deepEqual(candidates[action], predictWorldTrajectory(action, saved));
    assert.equal(candidates[action].trajectory[0].x, saved.x);
    assert.equal(candidates[action].trajectory[0].velocity, saved.velocity);
    assert.equal(candidates[action].duration, WORLD_HORIZON);
  }
  assert.deepEqual(initial, saved);
});

test("changing only the goal changes the selected push but leaves every forecast unchanged", () => {
  const candidates = predictWorldCandidates();
  const saved = structuredClone(candidates);
  assert.deepEqual([...WORLD_GOALS], ["near", "far"]);
  assert.ok(Object.isFrozen(WORLD_TARGET_X));
  const near = planWorldAction(candidates, WORLD_TARGET_X.near);
  const far = planWorldAction(candidates, WORLD_TARGET_X.far);
  assert.equal(near.action, "weak");
  assert.equal(far.action, "strong");
  assert.equal(near.targetX, WORLD_TARGET_X.near);
  assert.equal(far.targetX, WORLD_TARGET_X.far);
  assert.equal(near.predictedDistance, Math.abs(candidates.weak.finalX - near.targetX));
  assert.equal(far.predictedDistance, Math.abs(candidates.strong.finalX - far.targetX));
  assert.deepEqual(candidates, saved);
  assert.deepEqual(predictWorldCandidates(), saved);
});

test("the same learned model changes its forecasts and far-target plan when the box starts moving", () => {
  const weights = [...WORLD_MODEL_WEIGHTS];
  const resting = predictWorldCandidates();
  const initial = { ...WORLD_INITIAL, velocity: 1.2 };
  const moving = predictWorldCandidates(initial);
  assert.equal(planWorldAction(resting, WORLD_TARGET_X.far).action, "strong");
  assert.equal(planWorldAction(moving, WORLD_TARGET_X.far).action, "weak");
  for (const action of WORLD_ACTIONS) {
    const evaluated = evaluateWorldAction(action, initial);
    assert.deepEqual(moving[action], evaluated.prediction);
    assert.ok(moving[action].finalX > resting[action].finalX);
    assert.equal(moving[action].trajectory[0].velocity, 1.2);
    assert.equal(evaluated.actual.trajectory[0].velocity, 1.2);
    assert.ok(evaluated.error < 0.04);
    for (const run of [evaluated.prediction, evaluated.actual])
      assert.ok(
        run.trajectory.every((frame) => frame.x >= WORLD_VIEW_MIN && frame.x <= WORLD_VIEW_MAX),
      );
  }
  assert.ok(moving.none.finalX > WORLD_INITIAL.x + 0.6, "No push is not the same as no motion");
  assert.deepEqual(WORLD_MODEL_WEIGHTS, weights);
  assert.deepEqual(initial, { ...WORLD_INITIAL, velocity: 1.2 });
});

function candidateFixture(
  finalX: Record<WorldAction, number>,
): Record<WorldAction, WorldTrajectory> {
  return Object.fromEntries(
    WORLD_ACTIONS.map((action) => [
      action,
      { finalX: finalX[action], trajectory: [], duration: WORLD_HORIZON },
    ]),
  ) as Record<WorldAction, WorldTrajectory>;
}

test("planning follows supplied forecasts rather than target-specific or simulator-derived actions", () => {
  const near = candidateFixture({ none: 0.8, weak: 0.6, strong: 0.721 });
  const far = candidateFixture({ none: 1.29, weak: 4, strong: -5 });
  assert.equal(planWorldAction(near, WORLD_TARGET_X.near).action, "strong");
  assert.equal(planWorldAction(far, WORLD_TARGET_X.far).action, "none");
  // Changing only one forecast changes the decision for the exact same goal.
  near.weak.finalX = WORLD_TARGET_X.near;
  assert.deepEqual(planWorldAction(near, WORLD_TARGET_X.near), {
    action: "weak",
    targetX: WORLD_TARGET_X.near,
    predictedDistance: 0,
  });
});

test("equally close planning candidates use WORLD_ACTIONS order on either side of the goal", () => {
  const candidates = candidateFixture({ none: 0, weak: 2, strong: 4 });
  assert.equal(planWorldAction(candidates, 1).action, "none");
  assert.equal(planWorldAction(candidates, 3).action, "weak");
  assert.equal(
    planWorldAction(candidateFixture({ none: 2, weak: 2, strong: 2 }), 2).action,
    "none",
  );
});

test("planning selects the best available candidate even when every outcome misses a distant goal", () => {
  const candidates = predictWorldCandidates();
  for (const targetX of [-10, 10]) {
    const plan = planWorldAction(candidates, targetX);
    assert.equal(plan.action, targetX < 0 ? "none" : "strong");
    assert.ok(plan.predictedDistance > 8);
    assert.ok(
      WORLD_ACTIONS.every(
        (action) => plan.predictedDistance <= Math.abs(candidates[action].finalX - targetX),
      ),
    );
  }
});
