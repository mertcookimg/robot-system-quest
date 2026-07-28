// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { baseballStars, classifyBaseballSwing } from "../src/lib/baseball_rules.ts";

test("a perfectly timed and aimed swing is a home run", () => {
  const result = classifyBaseballSwing(0.9, 0);
  assert.equal(result.contact, "homer");
  assert.ok(result.quality > 0.99);
});

test("contact quality separates hits and fouls", () => {
  assert.equal(classifyBaseballSwing(0.86, 28).contact, "hit");
  assert.equal(classifyBaseballSwing(0.78, 45).contact, "foul");
});

test("bad timing or aim is a miss", () => {
  assert.equal(classifyBaseballSwing(0.7, 0).contact, "miss");
  assert.equal(classifyBaseballSwing(1.05, 0).contact, "miss");
  assert.equal(classifyBaseballSwing(0.9, 70).contact, "miss");
});

test("baseball score thresholds award one to three stars", () => {
  assert.equal(baseballStars(0), 1);
  assert.equal(baseballStars(3499), 1);
  assert.equal(baseballStars(3500), 2);
  assert.equal(baseballStars(6499), 2);
  assert.equal(baseballStars(6500), 3);
});
