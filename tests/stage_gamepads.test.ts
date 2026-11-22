// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { consumeStageGamepadButtons, readStageGamepads } from "../src/lib/stage_gamepads";
import { withStageInputSuppressed } from "../src/lib/input_guard";

let pads: Array<Gamepad | null> = [];
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let browser: Window;

before(() => {
  browser = new Window({ url: "http://localhost/" });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: browser.document,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { getGamepads: () => pads },
  });
});

beforeEach(() => {
  browser.document.body.replaceChildren();
  pads = [];
  consumeStageGamepadButtons();
});

after(() => {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else Reflect.deleteProperty(globalThis, "navigator");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  browser.happyDOM.abort();
});

function controller(pressed: number[], id = "controller"): Gamepad {
  const state = {
    id,
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 123,
    axes: [-0.7, 0.25, 0, 1],
    vibrationActuator: { type: "dual-rumble" },
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: pressed.includes(index),
      touched: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
  // Browser Gamepad properties need not be enumerable own properties.
  return Object.create(
    null,
    Object.fromEntries(Object.entries(state).map(([key, value]) => [key, { get: () => value }])),
  ) as Gamepad;
}

test("consuming UI buttons preserves native controller fields without mutating its snapshot", () => {
  const raw = controller([0]);
  pads = [raw];
  assert.equal(readStageGamepads()[0], raw);
  consumeStageGamepadButtons();
  const masked = readStageGamepads()[0]!;
  assert.deepEqual(masked.buttons[0], { pressed: false, touched: false, value: 0 });
  assert.equal(raw.buttons[0].pressed, true);
  for (const field of [
    "id",
    "index",
    "connected",
    "mapping",
    "timestamp",
    "axes",
    "vibrationActuator",
  ] as const)
    assert.equal(masked[field], raw[field], `${field} must survive masking`);
  assert.equal(masked.buttons[1], raw.buttons[1]);
});

test("each consumed button waits for its own release while fresh buttons remain usable", () => {
  pads = [controller([0, 2])];
  consumeStageGamepadButtons();
  pads = [controller([2, 3])];
  let visible = readStageGamepads()[0]!;
  assert.equal(visible.buttons[2].pressed, false);
  assert.equal(visible.buttons[3].pressed, true);
  pads = [controller([0, 2])];
  visible = readStageGamepads()[0]!;
  assert.equal(visible.buttons[0].pressed, true, "A released then pressed again is fresh");
  assert.equal(visible.buttons[2].pressed, false, "Continuously held X stays consumed");
  pads = [controller([])];
  assert.equal(readStageGamepads()[0], pads[0], "Released controllers need no wrapper");
});

test("disconnecting or replacing a controller does not transfer its consumed buttons", () => {
  pads = [controller([0])];
  consumeStageGamepadButtons();
  pads = [null];
  assert.deepEqual(readStageGamepads(), [null]);
  pads = [controller([0])];
  assert.equal(readStageGamepads()[0]?.buttons[0].pressed, true);
  consumeStageGamepadButtons();
  pads = [controller([0], "replacement")];
  assert.equal(readStageGamepads()[0], pads[0]);
});

function assertNeutralController(raw: Gamepad): void {
  const visible = readStageGamepads()[0]!;
  assert.deepEqual(visible.axes, [0, 0, 0, 0]);
  assert.ok(visible.buttons.every((button) => !button.pressed && !button.touched && !button.value));
  for (const field of [
    "id",
    "index",
    "connected",
    "mapping",
    "timestamp",
    "vibrationActuator",
  ] as const)
    assert.equal(visible[field], raw[field], `${field} must survive suppression`);
  assert.deepEqual(raw.axes, [-0.7, 0.25, 0, 1], "The browser snapshot remains untouched");
  assert.equal(raw.buttons[0].pressed, true);
}

test("terminal input focus neutralizes sticks and buttons while preserving controller metadata", () => {
  browser.document.body.innerHTML = '<section id="ros-terminal"><input></section>';
  browser.document.querySelector("input")!.focus();
  const raw = controller([0, 2]);
  pads = [raw];
  assertNeutralController(raw);
  browser.document.querySelector("input")!.blur();
  assert.equal(readStageGamepads()[0], raw, "Normal input resumes after focus leaves the terminal");
});

test("terminal palette neutralizes all controls and still releases consumed button masks", () => {
  browser.document.body.innerHTML = '<div id="terminal-pad-palette"></div>';
  const raw = controller([0, 2]);
  pads = [raw];
  consumeStageGamepadButtons();
  assertNeutralController(raw);
  pads = [controller([])];
  readStageGamepads();
  browser.document.body.replaceChildren();
  pads = [controller([0, 2])];
  assert.equal(
    readStageGamepads()[0],
    pads[0],
    "Releasing buttons while captured clears old masks",
  );
});

test("a dismissed UI consumes the full update before live axes become available again", () => {
  const raw = controller([0]);
  pads = [raw];
  withStageInputSuppressed(true, () => assertNeutralController(raw));
  assert.equal(readStageGamepads()[0], raw);
});
