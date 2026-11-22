// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../src/i18n/index.ts";
import {
  TriangleTracker,
  TRIANGLE_VERTICES,
  finishTriangleLesson,
  type TriangleResult,
} from "../src/lib/triangle_course.ts";
import type { GameContext } from "../src/types";

const [start, b, c] = TRIANGLE_VERTICES;

function follow(points: Array<{ x: number; y: number }>): TriangleResult {
  const tracker = new TriangleTracker();
  tracker.reset();
  let previous = start;
  for (const point of points) {
    for (let step = 1; step <= 40; step++) {
      tracker.observe(
        previous.x + ((point.x - previous.x) * step) / 40,
        previous.y + ((point.y - previous.y) * step) / 40,
      );
    }
    previous = { ...start, ...point };
  }
  return tracker.result(previous.x, previous.y);
}

function failureMessage(result: TriangleResult): string {
  let status = "";
  const context = {
    setStatus: (message: string) => {
      status = message;
    },
    awardStars: () => assert.fail("An incomplete triangle must not earn stars"),
  } as unknown as GameContext;
  assert.equal(finishTriangleLesson(context, result, 1, 1), false);
  assert.doesNotMatch(status, /Infinity|NaN/);
  return status;
}

for (const language of ["ja", "en"] as const) {
  test(`${language}: stationary and partially completed triangles name the missing vertices`, () => {
    setLang(language);
    const stationary = follow([]);
    assert.equal(stationary.closureErrorPx, 0);
    assert.deepEqual(stationary.missingVertices, ["B", "C"]);
    const message = failureMessage(stationary);
    assert.match(message, language === "ja" ? /未通過の頂点: B・C/ : /Missed vertices: B, C/);
    assert.doesNotMatch(message, /0\.00|not closed|閉じて/);
    const partial = follow([b]);
    assert.deepEqual(partial.missingVertices, ["C"]);
    assert.match(
      failureMessage(partial),
      language === "ja" ? /未通過の頂点: C/ : /Missed vertices: C/,
    );
  });

  test(`${language}: a closed route off the triangle edges reports path error`, () => {
    setLang(language);
    const center = { x: 370, y: 300 };
    const detours = Array.from({ length: 8 }, (_, i) => ({
      x: center.x + (i % 2) * 20,
      y: center.y,
    }));
    const result = follow([b, ...detours, c, start]);
    assert.equal(result.closureErrorPx, 0);
    assert.deepEqual(result.missingVertices, []);
    assert.ok(result.pathErrorPx > 14);
    assert.match(
      failureMessage(result),
      language === "ja" ? /経路の平均ずれ/ : /Average path error/,
    );
  });

  test(`${language}: an unfinished final side reports the measured return error`, () => {
    setLang(language);
    const finish = { x: start.x + 15, y: start.y - 30 * Math.sin(Math.PI / 3) };
    const result = follow([b, c, finish]);
    assert.deepEqual(result.missingVertices, []);
    assert.ok(result.pathErrorPx < 1e-8);
    assert.match(
      failureMessage(result),
      language === "ja" ? /始点からのずれ 0\.30 m/ : /Start-point error 0\.30 m/,
    );
  });
}

test("an exact triangle still earns three stars and keeps its measured time", () => {
  const result = follow([b, c, start]);
  let awarded = false;
  assert.equal(result.success, true);
  assert.equal(result.stars, 3);
  assert.deepEqual(result.missingVertices, []);
  const context = {
    awardStars: (
      stars: number,
      _stats: string,
      _next: unknown,
      options: { timeSeconds: number },
    ) => {
      assert.equal(stars, 3);
      assert.equal(options.timeSeconds, 12);
      awarded = true;
    },
  } as unknown as GameContext;
  assert.equal(finishTriangleLesson(context, result, 12, 6), true);
  assert.equal(awarded, true);
});
