// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { makeDelivery } from "../src/stages/game/delivery.ts";
import { getTheme, setTheme, theme } from "../src/core/theme.ts";
import { stageColor, cssStageColor } from "../src/lib/stage_colors.ts";
import type { GameContext } from "../src/types.ts";

test("a running Delivery scene changes colors both ways without restarting its robot or timer", () => {
  const previous = getTheme();
  const fills: string[] = [];
  let starts = 0;
  let hud: string[] = [];
  const noop = () => {};
  const ctx = new Proxy(
    { canvas: { width: 800, height: 500 } },
    {
      get(target, key) {
        if (String(key).endsWith("Gradient")) return () => ({ addColorStop: noop });
        if (key === "measureText") return (value: string) => ({ width: value.length * 7 });
        return Reflect.get(target, key) ?? noop;
      },
      set(target, key, value) {
        if (key === "fillStyle" && typeof value === "string") fills.push(value);
        return Reflect.set(target, key, value);
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const game = {
    ctx,
    keys: new Set(["w"]),
    setStatus: noop,
    setHud: (lines: string[]) => (hud = lines),
    publish: noop,
    getBestTime: () => undefined,
    ghost: {
      startRecording: () => starts++,
      recordPose: noop,
      draw: noop,
      hasReplay: () => false,
    },
  } as unknown as GameContext;
  const stage = makeDelivery();
  try {
    setTheme("light");
    stage.init(game);
    stage.update(0.1);
    const runningHud = [...hud];
    assert.ok(runningHud.some((line) => line.includes("420.0")));
    stage.draw();
    assert.ok(fills.includes("#f8fafc"));
    assert.ok(fills.includes("#075f93"));
    fills.length = 0;
    setTheme("dark");
    stage.draw();
    assert.ok(fills.includes(theme.canvasBg));
    assert.ok(fills.includes("#7dd3fc"));
    stage.update(0);
    assert.deepEqual(hud, runningHud);
    assert.equal(starts, 1);
    fills.length = 0;
    setTheme("light");
    stage.draw();
    assert.ok(fills.includes("#075f93"));
    stage.update(0);
    assert.deepEqual(hud, runningHud);
    assert.equal(starts, 1);
  } finally {
    stage.dispose();
    setTheme(previous);
  }
});

test("stored palette colors resolve in both directions and literal sensor colors stay opt-in", () => {
  const previous = getTheme();
  try {
    setTheme("dark");
    assert.equal(stageColor("#075f93"), "#7dd3fc");
    assert.equal(stageColor("rgba(7, 95, 147, 0.4)"), "rgba(125, 211, 252, 0.4)");
    setTheme("light");
    assert.equal(stageColor("#7dd3fc"), "#075f93");
    assert.equal(stageColor("#ffffff"), "#ffffff");
    assert.equal(stageColor("#000000"), "#000000");
    assert.equal(cssStageColor("#075f93"), "light-dark(#075f93, #7dd3fc)");
  } finally {
    setTheme(previous);
  }
});
