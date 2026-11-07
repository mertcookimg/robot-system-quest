// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  RL_ACTIONS,
  RL_ALPHA,
  RL_BONUS,
  RL_EPISODES,
  RL_GAMMA,
  RL_GOAL,
  RL_HEIGHT,
  RL_MAX_STEPS,
  RL_STARTS,
  RL_WIDTH,
  calculateReinforcementUpdate,
  createReinforcementTrainer,
  evaluateReinforcement,
  isReinforcementCellOpen,
  stepReinforcement,
  type ReinforcementPolicy,
  type ReinforcementRun,
} from "../src/lib/reinforcement_model";

const allValues = (policy: ReinforcementPolicy) =>
  Array.from({ length: RL_WIDTH * RL_HEIGHT }, (_, index) =>
    policy.qValues({ x: index % RL_WIDTH, y: Math.floor(index / RL_WIDTH) }),
  );

function assertRunAccounting(run: ReinforcementRun): void {
  assert.equal(run.path.length, run.steps + 1);
  assert.equal(run.transitions.length, run.steps);
  assert.equal(
    run.return,
    run.transitions.reduce((sum, transition) => sum + transition.reward, 0),
  );
  assert.equal(run.success, run.transitions.at(-1)?.terminated ?? false);
  assert.equal(run.truncated, !run.success && run.steps === RL_MAX_STEPS);
  for (const [index, transition] of run.transitions.entries()) {
    assert.deepEqual(transition.state, run.path[index]);
    assert.deepEqual(transition.nextState, run.path[index + 1]);
    const r = transition.rewards;
    assert.equal(transition.reward, r.step + r.wall + r.bonus + r.goal);
    assert.equal(transition.reward, r.total);
  }
}

test("grid transitions report real additive rewards, blocked movement, and an absorbing goal", () => {
  const wall = stepReinforcement({ x: 2, y: 1 }, "right", "goal");
  assert.deepEqual(wall.nextState, wall.state);
  assert.deepEqual(wall.rewards, { step: -0.1, wall: -1, bonus: 0, goal: 0, total: -1.1 });
  assert.equal(wall.terminated, false);
  const boundary = stepReinforcement({ x: 0, y: 0 }, "up", "goal");
  assert.equal(boundary.rewards.wall, -1);
  const open = stepReinforcement({ x: 2, y: 2 }, "right", "goal");
  assert.deepEqual(open.nextState, { x: 3, y: 2 });
  assert.equal(open.reward, -0.1);
  const goal = stepReinforcement({ x: 5, y: 2 }, "right", "goal");
  assert.deepEqual(goal.nextState, RL_GOAL);
  assert.equal(goal.reward, 9.9);
  assert.equal(goal.terminated, true);
  const afterGoal = stepReinforcement(RL_GOAL, "left", "bonus");
  assert.deepEqual(afterGoal.nextState, RL_GOAL);
  assert.equal(afterGoal.reward, 0);
  assert.equal(afterGoal.terminated, true);
  assert.equal(isReinforcementCellOpen({ x: 3, y: 0 }), false);
  assert.throws(() => stepReinforcement({ x: 3, y: 0 }, "left", "goal"), RangeError);
});

test("the bonus is paid on every actual re-entry and the goal preset omits it", () => {
  const first = stepReinforcement({ x: 1, y: 0 }, "down", "bonus");
  assert.deepEqual(first.nextState, RL_BONUS);
  assert.equal(first.rewards.bonus, 2);
  const leave = stepReinforcement(first.nextState, "up", "bonus");
  assert.equal(leave.rewards.bonus, 0);
  const again = stepReinforcement(leave.nextState, "down", "bonus");
  assert.equal(again.reward, 1.9);
  assert.equal(stepReinforcement({ x: 1, y: 0 }, "down", "goal").reward, -0.1);
});

test("Q learning bootstraps nonterminal states and excludes all future value at the goal", () => {
  const continuing = calculateReinforcementUpdate(3, 1.9, 7, false);
  assert.equal(continuing.target, 1.9 + RL_GAMMA * 7);
  assert.equal(continuing.qAfter, 3 + RL_ALPHA * (continuing.target - 3));
  const terminal = calculateReinforcementUpdate(3, 9.9, 1000, true);
  assert.equal(terminal.target, 9.9);
  assert.equal(terminal.qAfter, 3 + RL_ALPHA * (9.9 - 3));
});

test("training starts from zero Q and updates it using measured transitions", () => {
  const trainer = createReinforcementTrainer("goal");
  const before = trainer.snapshot();
  assert.ok(
    allValues(before)
      .flat()
      .every((q) => q === 0),
  );
  assert.equal(trainer.lastEpisode, null);
  assert.equal(trainer.lastUpdate, null);
  trainer.step();
  const after = trainer.snapshot();
  assert.ok(
    allValues(after)
      .flat()
      .some((q) => q !== 0),
  );
  assert.equal(trainer.episode, 1);
  assert.equal(trainer.history.length, 1);
  const update = trainer.lastUpdate!;
  const measured = stepReinforcement(update.transition.state, update.transition.action, "goal");
  assert.deepEqual(update.transition, measured);
  const expected = calculateReinforcementUpdate(
    update.qBefore,
    measured.reward,
    update.nextMaxQ,
    measured.terminated,
  );
  assert.equal(update.target, expected.target);
  assert.equal(update.qAfter, expected.qAfter);
  assert.equal(after.qValues(measured.state)[RL_ACTIONS.indexOf(measured.action)], expected.qAfter);
  assertRunAccounting(trainer.lastEpisode!);
  assert.equal(trainer.history[0].return, trainer.lastEpisode!.return);
  assert.equal(trainer.history[0].success, trainer.lastEpisode!.success);
});

test("a snapshot remains unchanged by further training or mutation of returned Q values", () => {
  const trainer = createReinforcementTrainer("goal");
  trainer.step(10);
  const frozen = trainer.snapshot();
  const before = allValues(frozen);
  const returned = frozen.qValues(RL_STARTS[0]) as number[];
  returned.fill(9999);
  trainer.step(30);
  assert.deepEqual(allValues(frozen), before);
  assert.equal(frozen.episodes, 10);
  assert.notDeepEqual(allValues(trainer.snapshot()), before);
});

test("same seed and split episode batches reproduce the same learned values and history", () => {
  const first = createReinforcementTrainer("bonus");
  const second = createReinforcementTrainer("bonus");
  first.step(RL_EPISODES);
  for (let i = 0; i < 30; i++) second.step(20);
  assert.equal(first.done, true);
  assert.equal(first.episode, RL_EPISODES);
  assert.deepEqual(first.history, second.history);
  assert.deepEqual(allValues(first.snapshot()), allValues(second.snapshot()));
  assert.equal(first.history[0].epsilon, 1);
  assert.equal(first.history.at(-1)!.epsilon, 0.08);
  first.step(100);
  assert.equal(first.episode, RL_EPISODES);
});

test("evaluation is greedy, deterministic, and never changes Q or the training random stream", () => {
  const first = createReinforcementTrainer("goal");
  const control = createReinforcementTrainer("goal");
  first.step(30);
  control.step(30);
  const policy = first.snapshot();
  const before = allValues(policy);
  const historyBefore = [...first.history];
  const a = evaluateReinforcement(policy, RL_STARTS[0]);
  assert.deepEqual(evaluateReinforcement(policy, RL_STARTS[0]), a);
  for (const transition of a.transitions) {
    const values = policy.qValues(transition.state);
    assert.equal(values[RL_ACTIONS.indexOf(transition.action)], Math.max(...values));
  }
  assert.deepEqual(allValues(policy), before);
  assert.deepEqual(first.history, historyBefore);
  first.step(20);
  control.step(20);
  assert.deepEqual(first.history, control.history);
  assert.deepEqual(allValues(first.snapshot()), allValues(control.snapshot()));
  assertRunAccounting(a);
});

test("real learning reaches the goal while repeatable bonus rewards favor an unsuccessful loop", () => {
  const goalTrainer = createReinforcementTrainer("goal");
  const bonusTrainer = createReinforcementTrainer("bonus");
  const untrained = goalTrainer.snapshot();
  assert.ok(RL_STARTS.every((start) => !evaluateReinforcement(untrained, start).success));
  goalTrainer.step(RL_EPISODES);
  bonusTrainer.step(RL_EPISODES);
  const goalPolicy = goalTrainer.snapshot();
  const bonusPolicy = bonusTrainer.snapshot();
  for (const start of RL_STARTS) {
    const goalRun = evaluateReinforcement(goalPolicy, start);
    const bonusRun = evaluateReinforcement(bonusPolicy, start);
    assert.equal(goalRun.success, true);
    assert.ok(goalRun.steps < 15);
    assert.equal(bonusRun.success, false);
    assert.equal(bonusRun.truncated, true);
    assert.ok(bonusRun.bonusVisits > 20);
    // Use the SAME bonus scoring rule for this reward comparison.
    const goalUnderBonusScoring = evaluateReinforcement(goalPolicy, start, "bonus");
    assert.ok(bonusRun.return > goalUnderBonusScoring.return);
    assertRunAccounting(goalRun);
    assertRunAccounting(bonusRun);
  }
  assert.ok(bonusTrainer.lastEpisode!.truncated);
  const final = bonusTrainer.lastUpdate!;
  assert.equal(final.transition.terminated, false);
  assert.equal(final.target, final.transition.reward + RL_GAMMA * final.nextMaxQ);
});
