// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let ui: (typeof import("../src/core/dom"))["ui"];
let crash: typeof import("../src/core/crash");
let terminal: typeof import("../src/core/terminal_ui");
let gamepad: typeof import("../src/core/gamepad");
let input: typeof import("../src/core/input");
let guard: typeof import("../src/lib/input_guard");
let manager: typeof import("../src/core/stage_manager");
let timers: typeof import("../src/core/stage_timers");
let delivery: Stage;
let pads: Gamepad[] = [];
let resets = 0;
let hudFrames = 0;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "Element",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLCanvasElement",
    "Event",
    "CustomEvent",
    "KeyboardEvent",
    "MutationObserver",
    "IntersectionObserver",
    "ResizeObserver",
    "getComputedStyle",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    let value = key === "window" ? browser : Reflect.get(browser, key);
    if (["getComputedStyle", "matchMedia"].includes(key)) value = value.bind(browser);
    if (key === "requestAnimationFrame") value = () => 1;
    if (key === "cancelAnimationFrame") value = () => {};
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  // happy-dom does not compute display:none layout for this inactive editor.
  Object.defineProperty(document.getElementById("block-editor"), "offsetParent", {
    configurable: true,
    value: null,
  });
  localStorage.setItem("robot_audio", "off");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  crash = (await server.ssrLoadModule("/src/core/crash.ts")) as typeof crash;
  terminal = (await server.ssrLoadModule("/src/core/terminal_ui.ts")) as typeof terminal;
  gamepad = (await server.ssrLoadModule("/src/core/gamepad.ts")) as typeof gamepad;
  input = (await server.ssrLoadModule("/src/core/input.ts")) as typeof input;
  guard = (await server.ssrLoadModule("/src/lib/input_guard.ts")) as typeof guard;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  delivery = (await server.ssrLoadModule("/src/stages/game/delivery.ts")).makeDelivery();
  manager.setStages([delivery]);
  const ctx = new Proxy(
    { canvas: ui.canvas },
    {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    },
  ) as unknown as CanvasRenderingContext2D;
  const game = manager.buildGameContext(ui.canvas, ctx);
  game.setHud = () => hudFrames++;
  const restart = () => {
    resets++;
    manager.resetCurrent();
  };
  crash.setupCrash({ overlay: ui.crashOverlay, sub: ui.crashSub, shake() {}, onReset: restart });
  terminal.setupTerminal({ getConcept: () => delivery.ros2, getStageName: () => delivery.name });
  gamepad.setupGamepad({ startGame() {}, resetCurrentStage: restart });
  const keyboard = await server.ssrLoadModule("/src/core/keyboard.ts");
  keyboard.setupKeyboard({
    getCurrentStageId: manager.getCurrentId,
    resetCurrentStage: restart,
    startGame() {},
    restartFromAllClear() {},
  });
});

beforeEach(() => {
  for (const element of document.querySelectorAll(".show")) element.classList.remove("show");
  document.body.classList.remove("stage-menu-open");
  crash.clearCrashOverlay();
  timers.clearStageTimeouts();
  pads = [];
  window.dispatchEvent(new Event("gamepaddisconnected"));
  window.dispatchEvent(new Event("focus"));
  manager.loadStage("delivery");
  timers.clearStageTimeouts();
  terminal.resumeStageControls();
  resets = hudFrames = 0;
});

afterEach(() => {
  crash.clearCrashOverlay();
  timers.clearStageTimeouts();
});
after(async () => {
  delivery.dispose();
  await server.close();
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function key(value: string, target: EventTarget = ui.canvas): void {
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: value,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function poll(buttons: number[] = [], axes = [0, 0, 0, 0]): void {
  pads = [
    {
      id: "test controller",
      index: 0,
      connected: true,
      mapping: "standard",
      timestamp: 0,
      axes,
      buttons: Array.from({ length: 17 }, (_, i) => ({
        pressed: buttons.includes(i),
        touched: buttons.includes(i),
        value: buttons.includes(i) ? 1 : 0,
      })),
    } as Gamepad,
  ];
  gamepad.poll();
  input.syncKeys();
}

function driveIntoWall(): void {
  input.setKbKey("w", true);
  input.syncKeys();
  for (let i = 0; i < 100 && !crash.isCrashing(); i++) delivery.update(0.05);
  assert.equal(crash.isCrashing(), true, "The actual delivery stage must have collided");
}

function assertStageResumed(): void {
  const before = hudFrames;
  input.setKbKey("s", true);
  input.syncKeys();
  delivery.update(0.05);
  assert.equal(hudFrames, before + 1, "The crashed stage must update again after dismissal");
}

test("Escape dismisses a delivery crash by restarting exactly once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  driveIntoWall();
  key("Escape");
  assert.equal(crash.isCrashing(), false);
  assert.equal(resets, 1);
  assertStageResumed();
  t.mock.timers.tick(1400);
  assert.equal(resets, 1, "The old automatic reset must not restart the new attempt");
});

test("gamepad B dismisses a delivery crash without leaving the stage frozen", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  driveIntoWall();
  poll([1]);
  assert.equal(resets, 1);
  assertStageResumed();
  poll([1]);
  t.mock.timers.tick(1400);
  assert.equal(resets, 1);
});

test("automatic crash recovery remains active, while a stage change cancels it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  driveIntoWall();
  t.mock.timers.tick(1300);
  assert.equal(resets, 1);
  assertStageResumed();
  input.clearAll();
  driveIntoWall();
  manager.loadStage("delivery");
  t.mock.timers.tick(1400);
  assert.equal(resets, 1, "A discarded stage must not reset the newly loaded stage");
});

for (const id of ["terminal-input", "terminal-command-select", "terminal-command-run"]) {
  for (const closeButton of [1, 10]) {
    test(`${id}: closing the palette with ${closeButton === 1 ? "B" : "L3"} restores pad controls`, () => {
      document.getElementById(id)!.focus();
      assert.equal(guard.isStageInteractionBlocked(), true);
      assert.equal(guard.isStageSimulationPaused(), false);
      poll([10]);
      assert.equal(terminal.isPadPaletteOpen(), true);
      assert.equal(guard.isStageSimulationPaused(), false);
      poll();
      poll([closeButton]);
      assert.equal(terminal.isPadPaletteOpen(), false);
      assert.ok(document.activeElement === ui.canvas);
      assert.equal(guard.isStageInteractionBlocked(), false);
      poll();
      poll([], [0, -1, 0, 0]);
      assert.equal(input.getKeys().has("w"), true);
      poll([9]);
      assert.equal(resets, 1, "Start is available again after leaving the terminal");
    });
  }
}

test("Escape and B leave every terminal control without resetting or needing a return button", () => {
  assert.equal(document.getElementById("terminal-resume"), null);
  for (const id of ["terminal-input", "terminal-command-select", "terminal-command-run"]) {
    const control = document.getElementById(id)!;
    control.focus();
    key("Escape", control);
    assert.ok(document.activeElement === ui.canvas);
    control.focus();
    poll();
    poll([1]);
    assert.ok(document.activeElement === ui.canvas);
  }
  assert.equal(resets, 0);
});
