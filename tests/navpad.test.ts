// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import * as nav from "../src/lib/navpad.ts";

let browser: Window;
let canvas: HTMLCanvasElement;
let touchpad: typeof import("../src/lib/touchpad");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const keys: string[] = [];
const mouseEvents: string[] = [];

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "HTMLElement",
    "MouseEvent",
    "KeyboardEvent",
    "MutationObserver",
    "DOMRect",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 1 });
  document.body.innerHTML = `
    <div id="canvas-wrap"><canvas width="800" height="500"></canvas></div>
    <div id="block-editor" style="display: none"></div>`;
  canvas = document.querySelector("canvas")!;
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 500);
  nav.setNavpadCanvas(canvas);
  window.addEventListener("keydown", (event) => {
    keys.push(event.key);
    nav.onNavpadKeyDown(event.key);
  });
  window.addEventListener("keyup", (event) => nav.onNavpadKeyUp(event.key));
  for (const type of ["mousedown", "mousemove", "mouseup", "mouseleave"])
    canvas.addEventListener(type, () => mouseEvents.push(type));
  touchpad = await import("../src/lib/touchpad.ts");
  touchpad.setupTouchpad();
});

beforeEach(() => {
  nav.activateNavpad();
  touchpad.setTouchpadStage("navigation");
  nav.pollNavpad(null, 0);
  keys.length = 0;
  mouseEvents.length = 0;
});

afterEach(() => nav.deactivateNavpad());

after(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function position(): { x: number; y: number } {
  const cursor = document.getElementById("pad-cursor")!;
  return { x: parseFloat(cursor.style.left), y: parseFloat(cursor.style.top) };
}

function pad(buttons: number[] = [], axes = [0, 0]): Gamepad {
  return {
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: buttons.includes(index) })),
  } as Gamepad;
}

function touch(target: Element, type: string, x = 50, y = 50): void {
  target.dispatchEvent(
    new browser.PointerEvent(type, {
      pointerId: 1,
      pointerType: "touch",
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    }),
  );
}

for (const hz of [30, 60, 144]) {
  for (const mode of ["keyboard", "dpad", "stick"] as const) {
    test(`${mode}: Navigation cursor keeps its 60 Hz speed at ${hz} Hz`, () => {
      const start = position();
      const controller = mode === "keyboard" ? null : mode === "dpad" ? pad([15]) : pad([], [1, 0]);
      if (mode === "keyboard") nav.onNavpadKeyDown("ArrowRight");
      for (let frame = 0; frame < hz / 2; frame++) nav.pollNavpad(controller, 1 / hz);
      assert.ok(Math.abs(position().x - start.x - (mode === "stick" ? 270 : 165)) < 1e-8);
      assert.equal(position().y, start.y);

      // Return to the starting point and also cover the opposite direction.
      nav.onNavpadKeyUp("ArrowRight");
      if (mode === "keyboard") nav.onNavpadKeyDown("ArrowLeft");
      const reverse = mode === "keyboard" ? null : mode === "dpad" ? pad([14]) : pad([], [-1, 0]);
      for (let frame = 0; frame < hz / 2; frame++) nav.pollNavpad(reverse, 1 / hz);
      assert.ok(Math.abs(position().x - start.x) < 1e-8);
    });
  }
}

test("touch D-PAD moves all four Navigation directions immediately and releases cleanly", () => {
  const directions = [
    ["up", "ArrowUp", 0, -5.5],
    ["down", "ArrowDown", 0, 5.5],
    ["left", "ArrowLeft", -5.5, 0],
    ["right", "ArrowRight", 5.5, 0],
  ] as const;
  for (const [name, expectedKey, dx, dy] of directions) {
    const control = document.querySelector(`.touch-${name}`)!;
    const start = position();
    touch(control, "pointerdown");
    nav.pollNavpad(null, 1 / 60);
    assert.equal(keys.at(-1), expectedKey);
    assert.deepEqual(position(), { x: start.x + dx, y: start.y + dy });
    touch(control, "pointerup");
    const released = position();
    nav.pollNavpad(null, 1 / 60);
    assert.deepEqual(position(), released);
  }
});

test("touch joystick routes Navigation diagonals and cancels all movement", () => {
  document.querySelectorAll<HTMLButtonElement>(".touchpad-switcher button")[1].click();
  const control = document.querySelector<HTMLElement>(".touch-joystick")!;
  control.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
  const start = position();
  touch(control, "pointerdown", 100, 0);
  nav.pollNavpad(null, 1 / 60);
  assert.deepEqual(position(), { x: start.x + 5.5, y: start.y - 5.5 });
  touch(control, "pointercancel");
  const cancelled = position();
  nav.pollNavpad(null, 1 / 60);
  assert.deepEqual(position(), cancelled);
});

test("switching away from Navigation releases arrows and restores other stages' WASD", () => {
  const control = document.querySelector(".touch-right")!;
  touch(control, "pointerdown");
  nav.pollNavpad(null, 1 / 60);
  const beforeSwitch = position();
  touchpad.setTouchpadStage("delivery");
  nav.pollNavpad(null, 1 / 60);
  assert.deepEqual(
    position(),
    beforeSwitch,
    "A held navigation direction cannot survive a stage switch",
  );
  touch(control, "pointerup");
  touch(control, "pointerdown");
  assert.equal(keys.at(-1), "d", "Other stages still receive their original driving keys");
  touch(control, "pointerup");
});

test("touch OK can drag a heading and commits once when released during movement", () => {
  const action = document.querySelector(".touch-ok")!;
  const right = document.querySelector(".touch-right")!;
  touch(action, "pointerdown");
  nav.pollNavpad(null, 1 / 60);
  touch(right, "pointerdown");
  nav.pollNavpad(null, 1 / 60);
  touch(action, "pointerup");
  nav.pollNavpad(null, 1 / 60);
  touch(right, "pointerup");
  nav.pollNavpad(null, 1 / 60);
  assert.deepEqual(mouseEvents, ["mousedown", "mousemove", "mousemove", "mouseup"]);
});
