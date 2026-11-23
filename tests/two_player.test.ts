// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import * as twoPlayer from "../src/lib/two_player";

let browser: Window;
let pads: Array<Gamepad | null> = [];
const originals = new Map(
  ["window", "document", "navigator"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);

before(() => {
  browser = new Window({ url: "http://localhost/" });
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: { getGamepads: () => pads },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
});

beforeEach(() => {
  browser.document.body.replaceChildren();
  pads = [];
  twoPlayer.setActive(false);
  twoPlayer.releasePlayerInput();
  twoPlayer.setActive(true);
});

after(async () => {
  twoPlayer.setActive(false);
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  await browser.happyDOM.abort();
});

function controller(index: number, axes = [0, 0], pressed: number[] = []): Gamepad {
  return {
    id: `controller-${index}`,
    index,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes,
    buttons: Array.from({ length: 17 }, (_, button) => ({
      pressed: pressed.includes(button),
      touched: pressed.includes(button),
      value: Number(pressed.includes(button)),
    })),
  } as Gamepad;
}

function key(value: string, type = "keydown") {
  browser.dispatchEvent(new browser.KeyboardEvent(type, { key: value, bubbles: true }));
}

function close(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`);
}

test("stick movement preserves its angle and proportional speed for both players", () => {
  pads = [controller(0, [0.24, -0.32]), controller(1, [-0.6, 0.8])];
  const p1 = twoPlayer.pollP1();
  const p2 = twoPlayer.pollP2();
  close(p1.moveX / -p1.moveY, 0.75);
  close(Math.hypot(p1.moveX, p1.moveY), (0.4 - 0.18) / (1 - 0.18));
  close(p2.moveX, -0.6);
  close(p2.moveY, 0.8);
  assert.equal(p1.right, false, "Racing retains its original digital stick threshold");
  assert.equal(p1.fwd, false);
  assert.equal(p2.left, true);
  assert.equal(p2.back, true);
});

test("radial deadzone removes drift and clamps diagonal sticks to full speed", () => {
  for (const axes of [
    [0, 0],
    [0.12, 0.12],
    [0.18, 0],
  ]) {
    pads = [controller(0, axes)];
    const input = twoPlayer.pollP1();
    assert.equal(input.moveX, 0);
    assert.equal(input.moveY, 0);
  }
  pads = [controller(0, [0.14, 0.14])];
  assert.ok(twoPlayer.pollP1().moveX > 0, "The deadzone uses vector length, not each axis");
  pads = [controller(0, [1, 1])];
  const diagonal = twoPlayer.pollP1();
  close(Math.hypot(diagonal.moveX, diagonal.moveY), 1);
  close(diagonal.moveX, Math.SQRT1_2);
});

test("keyboard movement has priority and diagonals keep the same speed", () => {
  pads = [controller(0, [-0.8, 0.6])];
  key("w");
  key("d");
  let input = twoPlayer.pollP1();
  close(input.moveX, Math.SQRT1_2);
  close(input.moveY, -Math.SQRT1_2);
  close(Math.hypot(input.moveX, input.moveY), 1);
  key("w", "keyup");
  input = twoPlayer.pollP1();
  assert.equal(input.moveX, 1);
  assert.equal(input.moveY, 0);
  key("a");
  input = twoPlayer.pollP1();
  assert.equal(input.moveX, 0, "Opposing held keys cancel without falling back to the stick");
  assert.equal(input.moveY, 0);
  key("a", "keyup");
  key("d", "keyup");
  input = twoPlayer.pollP1();
  close(input.moveX, -0.8);
  close(input.moveY, 0.6);
});

test("D-pad overrides the stick and normalizes diagonal movement", () => {
  pads = [controller(0, [-1, 0], [12, 15])];
  const input = twoPlayer.pollP1();
  close(input.moveX, Math.SQRT1_2);
  close(input.moveY, -Math.SQRT1_2);
  close(Math.hypot(input.moveX, input.moveY), 1);
});

test("one-player arrow aliases are optional and two-player controls remain separate", () => {
  key("ArrowUp");
  key("ArrowRight");
  let p1 = twoPlayer.pollP1();
  assert.equal(p1.moveX, 0);
  assert.equal(p1.moveY, 0);
  p1 = twoPlayer.pollP1({ arrowKeys: true });
  close(p1.moveX, Math.SQRT1_2);
  close(p1.moveY, -Math.SQRT1_2);
  key("a");
  key("Enter");
  p1 = twoPlayer.pollP1({ arrowKeys: false });
  const p2 = twoPlayer.pollP2();
  assert.equal(p1.moveX, -1);
  assert.equal(p1.moveY, 0);
  assert.equal(p1.action, false);
  close(p2.moveX, Math.SQRT1_2);
  close(p2.moveY, -Math.SQRT1_2);
  assert.equal(p2.action, true);
});

test("UI release suppresses held actions through resets until each button is released", () => {
  pads = [controller(0, [0, 0], [0, 2, 3]), controller(1, [0, 0], [0])];
  assert.equal(twoPlayer.pollP1().action, true);
  assert.equal(twoPlayer.pollP2().action, true);
  twoPlayer.releasePlayerInput();
  twoPlayer.resetEdges();
  for (let frame = 0; frame < 3; frame++) {
    const p1 = twoPlayer.pollP1();
    const p2 = twoPlayer.pollP2();
    assert.equal(p1.action, false);
    assert.equal(p1.actionEdge, false);
    assert.equal(p2.action, false);
    assert.equal(twoPlayer.pollToggleEdge(), false);
  }
  pads = [controller(0, [0, 0], [2]), controller(1)];
  assert.equal(twoPlayer.pollP1().action, false, "Held X stays consumed after A is released");
  twoPlayer.pollP2();
  pads = [controller(0, [0, 0], [0, 2]), controller(1, [0, 0], [0])];
  assert.equal(twoPlayer.pollP1().actionEdge, true, "A fresh A press works despite held X");
  assert.equal(twoPlayer.pollP2().actionEdge, true);
});

test("blocked polls neutralize movement and prevent held UI actions from leaking on return", () => {
  key("w");
  key("e");
  pads = [controller(0, [0.8, 0.6], [0])];
  browser.document.body.innerHTML = '<div id="help-modal" class="show"></div>';
  const blocked = twoPlayer.pollP1();
  assert.equal(blocked.moveX, 0);
  assert.equal(blocked.moveY, 0);
  assert.equal(blocked.action, false);
  browser.document.body.replaceChildren();
  const resumed = twoPlayer.pollP1();
  close(resumed.moveX, 0.8);
  close(resumed.moveY, 0.6);
  assert.equal(resumed.action, false, "A held dismissal must not become a held kick");
  key("e");
  assert.equal(twoPlayer.pollP1().action, true, "A fresh keyboard action remains available");
});
