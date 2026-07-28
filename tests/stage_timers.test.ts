// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test from "node:test";
import { clearStageTimeouts, setStageTimeout } from "../src/core/stage_timers";

test("stage timeouts are cancelled during a stage transition", async () => {
  let called = false;
  setStageTimeout(() => {
    called = true;
  }, 10);

  clearStageTimeouts();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(called, false);
});

test("completed stage timeouts are removed without affecting later timeouts", async () => {
  let calls = 0;
  setStageTimeout(() => {
    calls += 1;
  }, 0);
  await new Promise((resolve) => setTimeout(resolve, 10));

  setStageTimeout(() => {
    calls += 1;
  }, 10);
  clearStageTimeouts();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(calls, 1);
});
