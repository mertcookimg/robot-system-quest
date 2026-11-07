// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {
  appendCategoryData,
  countImitationData,
  countManualActions,
  selectImitationData,
  imitationTrainingKey,
  changedImitationSources,
  defaultImitationSelection,
  emptyImitationCounts,
  IMITATION_SOURCES,
  MAX_SAMPLES_PER_CATEGORY,
  type CategorizedDemonstration,
} from "../src/lib/imitation_data";
import {
  collectRecoveryDemos,
  createCloningTrainer,
  BC_EPOCHS,
  type Demonstration,
} from "../src/lib/imitation_model";

const sequence = (length: number): Demonstration[] =>
  Array.from({ length }, (_, i) => ({ observation: [i, 0], action: i % 2 ? 1 : -1 }));

test("a new experiment starts with only manual data selected", () => {
  assert.deepEqual(IMITATION_SOURCES, ["manual", "recovery"]);
  assert.deepEqual(emptyImitationCounts(), { manual: 0, recovery: 0 });
  assert.deepEqual(defaultImitationSelection(), { manual: true, recovery: false });
});

test("each category is capped at 100 without evicting the other categories", () => {
  let data: CategorizedDemonstration[] = appendCategoryData([], collectRecoveryDemos(), "recovery");
  const recoveryData = structuredClone(data);
  for (const sample of sequence(180)) data = appendCategoryData(data, [sample], "manual");
  assert.deepEqual(countImitationData(data), { manual: 100, recovery: 100 });
  assert.equal(data.length, 200);
  assert.deepEqual(
    data.filter((s) => s.source === "recovery"),
    recoveryData,
  );
  assert.equal(data.filter((s) => s.source === "manual")[0].observation[0], 80);
  assert.equal(data.at(-1)!.observation[0], 179);
  const manualData = structuredClone(data.filter((s) => s.source === "manual"));
  data = appendCategoryData(data, collectRecoveryDemos(), "recovery");
  assert.deepEqual(
    data.filter((s) => s.source === "manual"),
    manualData,
  );
  assert.equal(data.length, 200);
});

test("generated data samples the whole batch including its beginning and end", () => {
  const data = appendCategoryData([], sequence(650), "recovery");
  assert.equal(data.length, MAX_SAMPLES_PER_CATEGORY);
  assert.equal(data[0].observation[0], 0);
  assert.equal(data.at(-1)!.observation[0], 649);
  assert.ok(new Set(data.map((s) => Math.floor(s.observation[0] / 65))).size === 10);
  const replacement = appendCategoryData(data, sequence(105), "recovery");
  assert.equal(replacement.length, 100);
  assert.equal(replacement.at(-1)!.observation[0], 104);
});

test("manual action counts use retained records, include no input, and leave data unchanged", () => {
  let data: CategorizedDemonstration[] = [];
  const actions = [
    ...Array<number>(80).fill(1), // These earlier records are evicted.
    ...Array<number>(20).fill(-1),
    ...Array<number>(55).fill(0),
    ...Array<number>(25).fill(1),
  ];
  for (const [i, action] of actions.entries())
    data = appendCategoryData(data, [{ observation: [i, 0], action }], "manual");
  data = appendCategoryData(
    data,
    [
      { observation: [0.2, 0.1], action: -0.25 },
      { observation: [0, 0], action: 0 },
      { observation: [-0.3, -0.2], action: 0.5 },
    ],
    "recovery",
  );
  const before = structuredClone(data);
  assert.deepEqual(countManualActions(data), { up: 20, neutral: 55, down: 25 });
  assert.deepEqual(data, before);
});

test("no manual records have zero counts", () => {
  assert.deepEqual(countManualActions([]), { up: 0, neutral: 0, down: 0 });
  const recovery = appendCategoryData([], collectRecoveryDemos(), "recovery");
  assert.deepEqual(countManualActions(recovery), { up: 0, neutral: 0, down: 0 });
});

test("excluded categories remain stored but never enter the fitting dataset", () => {
  const manual = sequence(100).map((s, i) => ({
    observation: [(i - 50) / 100, ((i % 9) - 4) / 10] as Demonstration["observation"],
    action: s.action,
  }));
  let data = appendCategoryData([], manual, "manual");
  data = appendCategoryData(data, collectRecoveryDemos(), "recovery");
  const selection = defaultImitationSelection();
  const chosen = selectImitationData(data, selection);
  assert.deepEqual(countImitationData(chosen), { manual: 100, recovery: 0 });
  const trainer = createCloningTrainer(chosen);
  selection.manual = false;
  selection.recovery = true;
  trainer.step(BC_EPOCHS);
  const policy = trainer.snapshot();
  const measured =
    chosen.reduce((sum, s) => sum + (policy(s.observation) - s.action) ** 2, 0) / chosen.length;
  assert.ok(Math.abs(policy.report.finalLoss - measured) < 1e-12);
  assert.deepEqual(countImitationData(data), { manual: 100, recovery: 100 });
  assert.deepEqual(countImitationData(selectImitationData(data, selection)), {
    manual: 0,
    recovery: 100,
  });
  assert.equal(selectImitationData(data, { manual: false, recovery: false }).length, 0);
});

test("training identity follows selected category versions and can return to the original selection", () => {
  const counts = { manual: 100, recovery: 100 };
  const versions = { manual: 1, recovery: 1 };
  const selection = defaultImitationSelection();
  const key = imitationTrainingKey(counts, versions, selection);
  assert.equal(key, "manual:1");
  assert.equal(imitationTrainingKey(counts, { ...versions, recovery: 2 }, selection), key);
  assert.notEqual(imitationTrainingKey(counts, { ...versions, manual: 2 }, selection), key);
  selection.recovery = true;
  assert.equal(imitationTrainingKey(counts, versions, selection), "manual:1|recovery:1");
  assert.equal(imitationTrainingKey({ ...counts, recovery: 0 }, versions, selection), key);
  selection.recovery = false;
  assert.equal(imitationTrainingKey(counts, versions, selection), key);
});

test("comparison identifies changed manual recordings even when the sample count stays the same", () => {
  const counts = { manual: 100, recovery: 100 };
  const before = { manual: 105, recovery: 1 };
  const after = { manual: 210, recovery: 1 };
  assert.deepEqual(changedImitationSources(counts, before, counts, after), ["manual"]);
});

test("comparison identifies recovery selection changes while manual records stay fixed", () => {
  const manualOnly = { manual: 100, recovery: 0 };
  const combined = { manual: 100, recovery: 100 };
  const versions = { manual: 105, recovery: 1 };
  assert.deepEqual(changedImitationSources(manualOnly, versions, combined, versions), ["recovery"]);
  assert.deepEqual(changedImitationSources(combined, versions, manualOnly, versions), ["recovery"]);
});

test("comparison ignores updates to excluded categories and unchanged snapshots", () => {
  const manualOnly = { manual: 100, recovery: 0 };
  const versions = { manual: 105, recovery: 1 };
  assert.deepEqual(
    changedImitationSources(manualOnly, versions, manualOnly, { ...versions, recovery: 2 }),
    [],
  );
  const combined = { manual: 100, recovery: 100 };
  assert.deepEqual(
    changedImitationSources(combined, versions, { ...combined }, { ...versions }),
    [],
  );
});
