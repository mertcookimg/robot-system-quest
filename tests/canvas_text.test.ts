// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { drawCanvasLabel, drawWrappedText, wrapCanvasText } from "../src/lib/canvas_text";

function context(align: CanvasTextAlign = "left", baseline: CanvasTextBaseline = "alphabetic") {
  const calls: Array<{ text: string; x: number; y: number }> = [];
  const ctx = {
    canvas: { width: 320, height: 180 },
    font: "700 14px sans-serif",
    textAlign: align,
    textBaseline: baseline,
    direction: "ltr",
    measureText: (text: string) => ({ width: [...text].length * 9 }),
    fillText: (text: string, x: number, y: number) => calls.push({ text, x, y }),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

test("wrapping preserves Japanese and long identifiers without squeezing their font", () => {
  const { ctx } = context();
  for (const text of ["ロボットの開始位置を変更します", "/robot/controller/cmd_velocity"]) {
    const lines = wrapCanvasText(ctx, text, 90);
    assert.equal(lines.join(""), text);
    assert.ok(lines.length > 1);
    assert.ok(lines.every((line) => ctx.measureText(line).width <= 90));
  }
  assert.equal(ctx.font, "700 14px sans-serif");
});

test("wrapped descriptions retain words, paragraph breaks and report their height", () => {
  const { ctx, calls } = context();
  const height = drawWrappedText(ctx, "Choose a target\nThen start", 10, 20, 90, 20);
  assert.deepEqual(
    calls.map(({ text }) => text),
    ["Choose a", "target", "Then start"],
  );
  assert.deepEqual(
    calls.map(({ y }) => y),
    [20, 40, 60],
  );
  assert.equal(height, 60);
});

test("moving labels stay inside their panel at every edge and preserve text alignment", () => {
  for (const align of ["left", "center", "right"] as const) {
    for (const baseline of ["top", "middle", "alphabetic", "bottom"] as const) {
      const { ctx, calls } = context(align, baseline);
      const bounds = { x: 20, y: 30, w: 160, h: 100 };
      for (const [x, y] of [
        [-50, -40],
        [500, 600],
      ])
        drawCanvasLabel(ctx, "MOVING TARGET", x, y, { bounds, padding: 6 });
      for (const call of calls) {
        const width = ctx.measureText(call.text).width;
        const left = call.x - (align === "center" ? width / 2 : align === "right" ? width : 0);
        const ascent =
          baseline === "top" ? 0 : baseline === "middle" ? 7 : baseline === "bottom" ? 14 : 11.2;
        assert.ok(left >= 26 && left + width <= 174);
        assert.ok(call.y - ascent >= 36 - 0.001);
        assert.ok(call.y + 14 - ascent <= 124 + 0.001);
      }
      assert.equal(ctx.textAlign, align);
      assert.equal(ctx.textBaseline, baseline);
    }
  }
});

test("an overlong label wraps upward from the bottom edge without losing text", () => {
  const { ctx, calls } = context("center", "middle");
  const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  drawCanvasLabel(ctx, text, 320, 180, { bounds: { x: 100, y: 60, w: 120, h: 100 } });
  assert.equal(calls.map(({ text }) => text).join(""), text);
  assert.equal(calls.length, 3);
  assert.ok(calls[0].y >= 73);
  assert.ok(calls.at(-1)!.y + 7 <= 154);
  assert.equal(ctx.font, "700 14px sans-serif");
});
