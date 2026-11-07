// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  collectTeacherDemo,
  collectRecoveryDemos,
  fitImitationPolicy,
  createCloningTrainer,
  BC_EPOCHS,
  evaluateImitation,
  observeLearner,
  makeLearnerRobot,
  stepLearner,
  replayAction,
  imitationSuccess,
  IMITATION_TESTS,
  type Demonstration,
} from "../src/lib/imitation_model";

test("the fitted policy responds to observations rather than elapsed time", () => {
  const samples: Demonstration[] = [
    { observation: [-1, 0], action: -1 },
    { observation: [1, 0], action: 1 },
  ];
  const policy = fitImitationPolicy(samples);
  assert.ok(policy([-1, 0]) < -0.9);
  assert.ok(policy([1, 0]) > 0.9);
  assert.equal(fitImitationPolicy([])([1, 0]), 0);
});

test("fitting freezes examples until explicit retraining", () => {
  const samples: Demonstration[] = [{ observation: [1, 0], action: 1 }];
  const policy = fitImitationPolicy(samples);
  const before = policy([1, 0]);
  samples[0].action = -1;
  samples[0].observation[0] = -1;
  assert.equal(policy([1, 0]), before);
  assert.ok(policy([1, 0]) > 0.95);
  assert.ok(fitImitationPolicy(samples)([-1, 0]) < -0.95);
});

test("behavior cloning reduces measured demonstrated-action MSE by updating parameters", () => {
  const data = [...collectTeacherDemo(), ...collectRecoveryDemos()];
  const trainer = createCloningTrainer(data);
  const initial = trainer.snapshot();
  const initialPrediction = initial([0.4, 0.1]);
  trainer.step(BC_EPOCHS);
  const trained = trainer.snapshot();
  const measured =
    data.reduce((sum, s) => sum + (trained(s.observation) - s.action) ** 2, 0) / data.length;
  assert.ok(trained.report.finalLoss < trained.report.initialLoss * 0.1);
  assert.ok(Math.abs(trained.report.finalLoss - measured) < 1e-12);
  assert.equal(trained.report.losses.length, BC_EPOCHS + 1);
  assert.equal(initial([0.4, 0.1]), initialPrediction);
  assert.notEqual(trained([0.4, 0.1]), initialPrediction);
});

test("incorrect demonstrations are imitated rather than replaced with teacher actions", () => {
  const data = collectRecoveryDemos();
  const reversed = data.map((s) => ({ ...s, action: -s.action }));
  const normal = fitImitationPolicy(data),
    wrong = fitImitationPolicy(reversed);
  for (const observation of [
    [0.5, 0],
    [-0.5, 0],
  ] as [number, number][]) {
    assert.ok(normal(observation) * wrong(observation) < -0.5);
  }
  assert.ok(wrong.report.finalLoss < wrong.report.initialLoss * 0.1);
  const badRun = evaluateImitation(wrong, 1, 36);
  assert.equal(imitationSuccess(badRun), false);
});

test("conflicting actions at an identical observation fit their mean, not an invented correct action", () => {
  const data: Demonstration[] = [
    { observation: [0.8, 0], action: -1 },
    { observation: [0.8, 0], action: 1 },
  ];
  const policy = fitImitationPolicy(data);
  assert.ok(Math.abs(policy([0.8, 0])) < 0.01);
  assert.ok(Math.abs(policy.report.finalLoss - 1) < 0.001);
});

test("incremental fitting uses a frozen dataset and matches one uninterrupted fit", () => {
  const original = collectTeacherDemo();
  const editable = original.map((s) => ({
    observation: [...s.observation] as [number, number],
    action: s.action,
  }));
  const trainer = createCloningTrainer(editable);
  editable.forEach((s) => {
    s.observation[0] = 999;
    s.action = -s.action;
  });
  for (let i = 0; i < BC_EPOCHS / 4; i++) trainer.step(4);
  const streamed = trainer.snapshot(),
    fitted = fitImitationPolicy(original);
  assert.deepEqual(streamed.report.losses, fitted.report.losses);
  assert.equal(streamed([0.2, 0.1]), fitted([0.2, 0.1]));
});

test("recovery demonstrations improve these held-out tests without scripted results", () => {
  const basic = fitImitationPolicy(collectTeacherDemo());
  const recovery = fitImitationPolicy([...collectTeacherDemo(), ...collectRecoveryDemos()]);
  const evaluate = (policy: ReturnType<typeof fitImitationPolicy>) =>
    IMITATION_TESTS.map((t) => evaluateImitation(policy, t.course, t.offset));
  const first = evaluate(basic),
    second = evaluate(recovery);
  const meanError = (runs: typeof first) => runs.reduce((sum, r) => sum + r.errorSum / r.ticks, 0);
  assert.ok(meanError(second) < meanError(first));
  assert.ok(second.filter(imitationSuccess).length >= 2);
  for (const t of IMITATION_TESTS) assert.notEqual(t.course, 0);
});

test("action replay is clock-based and never reads the current observation", () => {
  assert.equal(replayAction([-0.5, 0.8], 0), -0.5);
  assert.equal(replayAction([-0.5, 0.8], 2), -0.5);
  assert.equal(replayAction([-0.5, 0.8], 3), 0.8);
  assert.equal(replayAction([-0.5, 0.8], 6), 0);
  assert.equal(replayAction([], 0), 0);
});

test("complete demonstrations have finite bounded actions and are deterministic", () => {
  const data = collectTeacherDemo();
  assert.ok(data.length > 100);
  assert.deepEqual(collectTeacherDemo(), data);
  for (const sample of [...data, ...collectRecoveryDemos()]) {
    assert.ok(sample.observation.every(Number.isFinite));
    assert.ok(Number.isFinite(sample.action) && Math.abs(sample.action) <= 1);
  }
});

test("observations reflect movement and simulation keeps the robot in view", () => {
  const robot = makeLearnerRobot();
  const before = observeLearner(robot, 0);
  for (let i = 0; i < 100; i++) stepLearner(robot, 1, 0);
  assert.notDeepEqual(observeLearner(robot, 0), before);
  assert.ok(robot.y <= 424 && robot.y >= 118);
  assert.ok(robot.outsideSeconds > 0 && robot.departures > 0);
  assert.equal(imitationSuccess(robot), false);
});
