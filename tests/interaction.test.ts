// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Exercise the real shell routing against the app DOM. Canvas pixels and
// physical controller drivers are outside this deterministic integration test.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let input: typeof import("../src/core/input");
let twoPlayer: typeof import("../src/lib/two_player");
let stageGamepads: typeof import("../src/lib/stage_gamepads");
let nav: typeof import("../src/lib/navpad");
let arm: typeof import("../src/lib/armpad");
let help: typeof import("../src/core/help");
let menu: typeof import("../src/core/stage_menu");
let clear: typeof import("../src/core/clear_overlay");
let terminal: typeof import("../src/core/terminal_ui");
let loop: typeof import("../src/core/loop");
let manager: typeof import("../src/core/stage_manager");
let timers: typeof import("../src/core/stage_timers");
let ui: (typeof import("../src/core/dom"))["ui"];
let current: Stage;
let actualStage: Stage | undefined;
let makeBaseball: (typeof import("../src/stages/game/robo_baseball"))["makeRoboBaseball"];
let makeTennis: (typeof import("../src/stages/game/robo_tennis"))["makeRoboTennis"];
let makePubsub: (typeof import("../src/stages/lesson/pubsub_builder"))["makePubsub"];
let pageHidden = false;
let pads: Array<Gamepad | null> = [];
let updates = 0;
let elapsed = 0;
let draws = 0;
let actions = 0;
let forwardFrames = 0;
let rawInputFrames = 0;
let nexts = 0;
let restarts = 0;
let allClears = 0;
let canvasDowns = 0;
let canvasUps = 0;
let canvasLeaves = 0;
let rafId = 0;
const raf = new Map<number, FrameRequestCallback>();
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
    "MouseEvent",
    "FocusEvent",
    "KeyboardEvent",
    "MutationObserver",
    "IntersectionObserver",
    "ResizeObserver",
    "DOMRect",
    "getComputedStyle",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    let value = key === "window" ? browser : Reflect.get(browser, key);
    if (["getComputedStyle", "matchMedia"].includes(key)) value = value.bind(browser);
    if (key === "requestAnimationFrame")
      value = (callback: FrameRequestCallback) => {
        const id = ++rafId;
        raf.set(id, callback);
        return id;
      };
    if (key === "cancelAnimationFrame") value = (id: number) => raf.delete(id);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(document, "hidden", { configurable: true, get: () => pageHidden });
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => pads });
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  localStorage.setItem("robot_audio", "off");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  input = (await server.ssrLoadModule("/src/core/input.ts")) as typeof input;
  twoPlayer = (await server.ssrLoadModule("/src/lib/two_player.ts")) as typeof twoPlayer;
  stageGamepads = (await server.ssrLoadModule(
    "/src/lib/stage_gamepads.ts",
  )) as typeof stageGamepads;
  nav = (await server.ssrLoadModule("/src/lib/navpad.ts")) as typeof nav;
  arm = (await server.ssrLoadModule("/src/lib/armpad.ts")) as typeof arm;
  help = (await server.ssrLoadModule("/src/core/help.ts")) as typeof help;
  menu = (await server.ssrLoadModule("/src/core/stage_menu.ts")) as typeof menu;
  clear = (await server.ssrLoadModule("/src/core/clear_overlay.ts")) as typeof clear;
  terminal = (await server.ssrLoadModule("/src/core/terminal_ui.ts")) as typeof terminal;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  loop = (await server.ssrLoadModule("/src/core/loop.ts")) as typeof loop;
  makeBaseball = (await server.ssrLoadModule("/src/stages/game/robo_baseball.ts")).makeRoboBaseball;
  makeTennis = (await server.ssrLoadModule("/src/stages/game/robo_tennis.ts")).makeRoboTennis;
  makePubsub = (await server.ssrLoadModule("/src/stages/lesson/pubsub_builder.ts")).makePubsub;
  current = {
    id: "navigation",
    name: "Navigation",
    lesson: "",
    lessonCmd: "",
    ros2: {
      title: "Fixture",
      summary: "",
      msgTypes: [],
      cli: [],
      realWorld: "",
      state: { nodes: [], topics: [] },
    },
    init() {},
    reset() {},
    dispose() {},
    update(dt) {
      updates++;
      elapsed += dt;
      const direct = twoPlayer.pollP1();
      if (direct.actionEdge) actions++;
      if (direct.fwd) forwardFrames++;
      if (
        stageGamepads
          .readStageGamepads()
          .some(
            (pad) =>
              pad && (pad.axes.some(Boolean) || pad.buttons.some((button) => button.pressed)),
          )
      )
        rawInputFrames++;
    },
    draw() {
      draws++;
    },
  };
  manager.setStages([current]);
  manager.buildGameContext(ui.canvas, {} as CanvasRenderingContext2D);
  menu.setupStageMenu({ getCurrentStageId: () => current.id, loadStage() {} });
  terminal.setupTerminal({
    getConcept: () => manager.getCurrent().ros2,
    getStageName: () => manager.getCurrent().name,
  });
  clear.setupClearOverlay({
    onRestart() {
      restarts++;
    },
    onNext() {
      nexts++;
    },
    showAllClear() {
      allClears++;
    },
  });
  const keyboard = await server.ssrLoadModule("/src/core/keyboard.ts");
  keyboard.setupKeyboard({
    getCurrentStageId: () => current.id,
    resetCurrentStage() {
      restarts++;
    },
    startGame() {},
    restartFromAllClear() {},
  });
  const gamepad = await server.ssrLoadModule("/src/core/gamepad.ts");
  gamepad.setupGamepad({ startGame() {}, resetCurrentStage() {} });
  nav.setNavpadCanvas(ui.canvas);
  ui.canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 500);
  ui.canvas.tabIndex = 0;
  ui.canvas.addEventListener("mousedown", () => canvasDowns++);
  ui.canvas.addEventListener("mouseup", () => canvasUps++);
  ui.canvas.addEventListener("mouseleave", () => canvasLeaves++);
});

beforeEach(() => {
  manager.setStages([current]);
  pads = [];
  pageHidden = false;
  localStorage.clear();
  localStorage.setItem("robot_audio", "off");
  timers.clearStageTimeouts();
  clear.close();
  menu.closeMenu();
  help.close();
  terminal.closePadPalette();
  terminal.resetForStage();
  document.body.classList.remove("stage-menu-open");
  for (const element of [ui.introScreen, ui.lessonModal, ui.allclearScreen])
    element.classList.remove("show");
  nav.deactivateNavpad();
  arm.reset();
  twoPlayer.setActive(false);
  twoPlayer.setActive(true);
  window.dispatchEvent(new Event("gamepaddisconnected"));
  window.dispatchEvent(new Event("focus"));
  ui.canvas.focus();
  input.clearAll();
  input.syncKeys();
  void manager.loadStage(current.id);
  updates =
    elapsed =
    draws =
    actions =
    forwardFrames =
    rawInputFrames =
    nexts =
    restarts =
    allClears =
    canvasDowns =
    canvasUps =
    canvasLeaves =
      0;
  raf.clear();
  loop.startLoop();
});

afterEach(() => {
  actualStage?.dispose();
  actualStage = undefined;
  timers.clearStageTimeouts();
  raf.clear();
  twoPlayer.setActive(false);
  nav.deactivateNavpad();
  document.getElementById("interaction-test-button")?.remove();
});

after(async () => {
  await server.close();
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function frame(): void {
  const callbacks = [...raf.values()];
  raf.clear();
  assert.ok(callbacks.length > 0, "The actual shell loop must remain scheduled");
  callbacks.forEach((callback) => callback(performance.now()));
}

function key(
  value: string,
  kind: "keydown" | "keyup" = "keydown",
  target: EventTarget = ui.canvas,
): KeyboardEvent {
  const event = new KeyboardEvent(kind, { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function pad(buttons: number[] = [], axes = [0, 0, 0, 0]): Gamepad {
  const controller = {
    id: "test controller",
    index: 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: buttons.includes(index),
      touched: buttons.includes(index),
      value: buttons.includes(index) ? 1 : 0,
    })),
  } as Gamepad;
  pads = [controller];
  return controller;
}

function loadActualStage(
  stage: Stage,
  contextOverrides: Partial<CanvasRenderingContext2D> = {},
): string[] {
  const drawing = {
    canvas: ui.canvas,
    measureText: (value: string) => ({ width: value.length * 7 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    ...contextOverrides,
  };
  const context = new Proxy(drawing, {
    get: (target, key) => Reflect.get(target, key) ?? (() => {}),
  }) as unknown as CanvasRenderingContext2D;
  const publications: string[] = [];
  const game = manager.buildGameContext(ui.canvas, context);
  const publish = game.publish;
  game.publish = (topic, message) => {
    publications.push(topic);
    publish(topic, message);
  };
  manager.setStages([current, stage]);
  manager.loadStage(stage.id);
  actualStage = stage;
  timers.clearStageTimeouts();
  twoPlayer.setActive(false);
  ui.canvas.focus();
  return publications;
}

test("Navigation completion owns Enter and Retry, while all-clear also retains R", () => {
  nav.activateNavpad();
  clear.show(1, "Time <b>2.00 s</b>", {
    current,
    stages: [current, { ...current, id: "next-stage" }],
    onRenderSelector() {},
  });
  assert.ok(document.activeElement === ui.nextBtn);
  const event = key("Enter", "keydown", ui.nextBtn);
  nav.pollNavpad(null);
  assert.equal(event.defaultPrevented, true);
  assert.equal(nexts, 1);
  assert.equal(clear.isOpen(), false);
  assert.equal(canvasDowns, 0, "Completion confirmation must not create a navigation goal");
  clear.show(1, "Time <b>2.00 s</b>", {
    current,
    stages: [current, { ...current, id: "next-stage" }],
    onRenderSelector() {},
  });
  key("r", "keydown", ui.nextBtn);
  assert.equal(restarts, 1);
  assert.equal(clear.isOpen(), false);
  ui.allclearScreen.classList.add("show");
  key("r");
  assert.equal(restarts, 2);
  assert.equal(ui.allclearScreen.classList.contains("show"), false);
});

test("an unrecorded 2P result keeps P1's best time and stars untouched", async () => {
  const rankings = (await server.ssrLoadModule(
    "/src/core/rankings.ts",
  )) as typeof import("../src/core/rankings");
  const progress = (await server.ssrLoadModule(
    "/src/core/progress.ts",
  )) as typeof import("../src/core/progress");
  const deps = { current, stages: [current], onRenderSelector() {} };

  clear.show(2, "Winner <b>P2</b><br>Time <b>2.10 s</b>", deps, { record: false });
  assert.equal(clear.isOpen(), true, "The match result is still shown");
  assert.deepEqual(rankings.getTopTimes(current.id, 5), []);
  assert.equal(progress.loadProgress()[current.id], undefined);
  assert.equal(ui.clearStats.querySelector(".rankings"), null);
  clear.close();

  clear.show(3, "Time <b>5.00 s</b>", deps);
  assert.deepEqual(rankings.getTopTimes(current.id, 5), [5]);
  assert.equal(progress.loadProgress()[current.id]?.stars, 3);
  clear.close();

  clear.show(1, "Winner <b>P2</b><br>Time <b>1.00 s</b>", deps, { record: false });
  assert.deepEqual(rankings.getTopTimes(current.id, 5), [5], "A 2P time never becomes a record");
  assert.equal(progress.loadProgress()[current.id]?.stars, 3);
});

test("long completion results escape the canvas clip, scroll by keyboard and restore their DOM slot", () => {
  const originalNodes = [...ui.canvasWrap.childNodes];
  const deps = { current, stages: [current], onRenderSelector() {} };
  const stats = Array.from({ length: 30 }, (_, i) => `Result ${i}: <b>complete</b>`).join("<br>");
  clear.show(3, stats, deps, { record: false });
  assert.equal(ui.clearOverlay.parentElement, document.body);
  assert.equal(ui.clearStats.querySelectorAll("b").length, 30);
  assert.equal(document.activeElement, ui.nextBtn);
  const down = key("PageDown", "keydown", ui.nextBtn);
  assert.equal(down.defaultPrevented, true);
  assert.ok(ui.clearStats.scrollTop > 0, "Results can be read without moving the action focus");
  assert.equal(document.activeElement, ui.nextBtn);
  key("Home", "keydown", ui.nextBtn);
  assert.equal(ui.clearStats.scrollTop, 0);
  ui.clearStats.scrollTop = 120;
  clear.close();
  assert.deepEqual([...ui.canvasWrap.childNodes], originalNodes);
  clear.show(1, "Another result", deps, { record: false });
  assert.equal(ui.clearStats.scrollTop, 0, "A new result opens at its beginning");
  ui.nextBtn.click();
  assert.equal(clear.isOpen(), false);
  assert.equal(nexts, 1);
  assert.deepEqual([...ui.canvasWrap.childNodes], originalNodes);
});

test("only the clear that first completes every stage leads to the all-clear screen", async () => {
  const progress = (await server.ssrLoadModule(
    "/src/core/progress.ts",
  )) as typeof import("../src/core/progress");
  const other = { ...current, id: "other-stage" };
  const deps = { current, stages: [current, other], onRenderSelector() {} };
  progress.saveProgress(other.id, 3);

  clear.show(1, "Time <b>4.00 s</b>", deps);
  assert.match(ui.nextBtn.textContent ?? "", /View all clear/);
  ui.nextBtn.click();
  assert.equal(allClears, 1, "Completing the set shows the all-clear screen");
  assert.equal(nexts, 0);

  // Replaying any stage after 100% must continue to the next stage.
  clear.show(3, "Time <b>3.00 s</b>", deps);
  assert.doesNotMatch(ui.nextBtn.textContent ?? "", /View all clear/);
  ui.nextBtn.click();
  assert.equal(allClears, 1);
  assert.equal(nexts, 1);
});

test("all-clear lets keyboard users read all 38 results and resets its scroll on reopening", async () => {
  const allclear = await server.ssrLoadModule("/src/core/allclear.ts");
  allclear.setupAllClear(() => {});
  const stages = Array.from({ length: 38 }, (_, i) => ({ ...current, id: `review-${i}` }));
  allclear.show(stages);
  ui.allclearRestart.focus();
  assert.equal(ui.allclearStars.children.length, 38);
  const down = key("PageDown", "keydown", ui.allclearRestart);
  assert.equal(down.defaultPrevented, true);
  assert.ok(ui.allclearStars.scrollTop > 0);
  assert.equal(document.activeElement, ui.allclearRestart);
  allclear.hide();
  allclear.show(stages);
  assert.equal(ui.allclearStars.scrollTop, 0);
  allclear.hide();
});

test("holding R resets once instead of on every auto-repeat", () => {
  key("r");
  for (let i = 0; i < 5; i++) {
    ui.canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "r", repeat: true, bubbles: true, cancelable: true }),
    );
  }
  assert.equal(restarts, 1);
  key("r", "keyup");
  key("r");
  assert.equal(restarts, 2, "A fresh press resets again");
});

test("Ctrl/Cmd/Alt shortcuts keep their native behavior and never hold a drive key", () => {
  for (const modifier of ["ctrlKey", "metaKey", "altKey"] as const) {
    const event = new KeyboardEvent("keydown", {
      key: "d",
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    });
    ui.canvas.dispatchEvent(event);
    input.syncKeys();
    assert.equal(event.defaultPrevented, false, `${modifier}+D must reach the browser`);
    assert.equal(input.getKeys().has("d"), false);
    assert.equal(twoPlayer.pollP1().right, false);
  }
  const reload = new KeyboardEvent("keydown", {
    key: "r",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  ui.canvas.dispatchEvent(reload);
  assert.equal(reload.defaultPrevented, false, "Ctrl+R must still reload the page");
  assert.equal(restarts, 0);
});

test("releasing Cmd drops drive keys whose keyup macOS never sends", () => {
  key("d");
  input.syncKeys();
  assert.equal(input.getKeys().has("d"), true);
  assert.equal(twoPlayer.pollP1().right, true);
  key("Meta");
  key("Meta", "keyup");
  input.syncKeys();
  assert.equal(input.getKeys().has("d"), false);
  assert.equal(twoPlayer.pollP1().right, false);
});

test("focused stage buttons retain Space and Enter without triggering direct player actions", () => {
  const button = document.createElement("button");
  button.id = "interaction-test-button";
  button.textContent = "Start trial";
  ui.stageOverlay.appendChild(button);
  button.focus();
  for (const value of [" ", "Enter"]) {
    const event = key(value, "keydown", button);
    assert.equal(event.defaultPrevented, false, "Native button activation must remain available");
    assert.equal(twoPlayer.pollP1().action, false);
    assert.equal(twoPlayer.pollP2().action, false);
    key(value, "keyup", button);
  }
});

test("blur and hidden documents release shared keys and both direct-player key sets", () => {
  for (const interruption of ["blur", "hidden"] as const) {
    key("w");
    key("ArrowUp");
    input.syncKeys();
    assert.equal(input.getKeys().has("w"), true);
    assert.equal(twoPlayer.pollP1().fwd, true);
    assert.equal(twoPlayer.pollP2().fwd, true);
    if (interruption === "blur") window.dispatchEvent(new Event("blur"));
    else {
      pageHidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    assert.equal(input.getKeys().size, 0);
    assert.equal(twoPlayer.pollP1().fwd, false);
    assert.equal(twoPlayer.pollP2().fwd, false);
    const before = updates;
    frame();
    assert.equal(updates, before, "An inactive page must not advance game physics");
    pageHidden = false;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    assert.equal(twoPlayer.pollP1().fwd, false, "Focus must not restore an old held key");
    key("w");
    assert.equal(twoPlayer.pollP1().fwd, true, "A fresh press must work after returning");
    key("w", "keyup");
    key("ArrowUp", "keyup");
  }
});

test("help and stage menu pause updates while drawing continues", () => {
  const cases = [
    { name: "help", open: () => help.open(), close: () => help.close() },
    { name: "stage menu", open: () => menu.openMenu(), close: () => menu.closeMenu() },
  ];
  for (const item of cases) {
    pads = [];
    ui.canvas.focus();
    frame();
    const before = updates;
    const drawnBefore = draws;
    item.open();
    const controller = pad([12], [0, -1, 1, 0]);
    frame();
    assert.equal(updates, before, `${item.name} must pause stage updates`);
    assert.ok(draws > drawnBefore, `${item.name} must preserve scene rendering`);
    assert.equal(twoPlayer.pollP1().fwd, false, `${item.name} must block raw gamepad readers`);
    arm.poll();
    assert.equal(arm.rightStickX(), 0);
    nav.activateNavpad();
    nav.pollNavpad(controller);
    assert.equal(canvasDowns, 0);
    nav.deactivateNavpad();
    pads = [];
    item.close();
    ui.canvas.focus();
    frame();
    assert.equal(updates, before + 1, `${item.name} must allow resuming after close`);
  }
});

test("terminal input, command controls and palette keep time running while capturing player input", (t) => {
  let now = performance.now();
  t.mock.method(performance, "now", () => now);
  const cases = [
    ...["terminal-input", "terminal-command-select", "terminal-command-run"].map((id) => ({
      name: id,
      open: () => document.getElementById(id)!.focus(),
    })),
    { name: "palette", open: () => terminal.openPadPalette() },
  ];
  for (const item of cases) {
    item.open();
    const target = document.activeElement!;
    for (const value of ["w", "a", "s", "d"]) key(value, "keydown", target);
    ui.terminalInput.value = "ros2 topic list";
    key("Enter", "keydown", target);
    if (item.name === "terminal-command-run") (target as HTMLButtonElement).click();
    const controller = pad([0, 12], [0, -1, 1, 0]);
    const before = updates;
    const timeBefore = elapsed;
    const drawnBefore = draws;
    now += 50;
    frame();
    assert.equal(updates, before + 1, `${item.name} must keep the lesson updating`);
    assert.ok(elapsed > timeBefore, `${item.name} must keep lesson time advancing`);
    assert.ok(draws > drawnBefore, `${item.name} must keep rendering`);
    assert.equal(actions, 0, `${item.name} must consume Enter and gamepad A`);
    assert.equal(forwardFrames, 0, `${item.name} must capture WASD and gamepad movement`);
    assert.equal(
      rawInputFrames,
      0,
      `${item.name} must also neutralize raw gamepad axes and buttons`,
    );
    assert.equal(input.getKeys().size, 0);
    assert.equal(twoPlayer.pollP1().fwd, false);
    arm.poll();
    assert.equal(arm.rightStickX(), 0);
    assert.equal(arm.buttonEdge(0), false);
    nav.activateNavpad();
    nav.pollNavpad(controller);
    assert.equal(canvasDowns, 0);
    nav.deactivateNavpad();
    for (const value of ["w", "a", "s", "d", "Enter"]) key(value, "keyup", target);
    pads = [];
    terminal.closePadPalette();
    ui.canvas.focus();
  }
});

for (const closeButton of [1, 10]) {
  test(`closing the terminal with ${closeButton === 1 ? "B" : "L3"} keeps updates live and consumes the frame's input`, () => {
    terminal.openPadPalette();
    pad();
    frame();
    const before = updates;
    pad([closeButton, 0, 12], [0, -1, 1, 0]);
    frame();
    assert.equal(terminal.isPadPaletteOpen(), false);
    assert.ok(document.activeElement === ui.canvas);
    assert.equal(updates, before + 1, "Closing the palette must not skip a simulation tick");
    assert.equal(actions, 0, "A pressed while dismissing the terminal belongs to the terminal");
    assert.equal(forwardFrames, 0, "Raw gamepad axes must stay neutral for the dismissal frame");
    assert.equal(rawInputFrames, 0, "Direct gamepad readers must also consume the dismissal frame");
    pad();
    frame();
    pad([0], [0, -1, 0, 0]);
    frame();
    assert.equal(actions, 1, "A fresh action must reach the stage after dismissal");
    assert.equal(forwardFrames, 1, "Fresh movement must reach the stage after dismissal");
  });
}

test("A used for terminal commands does not also trigger a game action and fresh presses resume", () => {
  terminal.openPadPalette();
  pad();
  frame();
  const before = ui.terminalBody.querySelectorAll(".tline-cmd").length;
  pad([0]);
  frame();
  assert.equal(updates, 2, "Terminal commands must leave simulation updates running");
  assert.equal(actions, 0);
  assert.equal(ui.terminalBody.querySelectorAll(".tline-cmd").length, before + 1);
  assert.equal(twoPlayer.pollP1().actionEdge, false);
  arm.poll();
  assert.equal(arm.buttonEdge(0), false);
  terminal.closePadPalette();
  ui.canvas.focus();
  frame();
  assert.equal(actions, 0, "A held while closing the palette must not become a new action");
  pad();
  frame();
  pad([0]);
  frame();
  assert.equal(actions, 1, "A fresh controller press must still reach the stage");
});

test("Feedforward keeps moving and publishing current odometry while the terminal is in use", async (t) => {
  const { makeFeedforwardController } = await server.ssrLoadModule(
    "/src/stages/lesson/feedforward_controller.ts",
  );
  const topics = (await server.ssrLoadModule(
    "/src/core/topic_monitor.ts",
  )) as typeof import("../src/core/topic_monitor");
  let now = performance.now();
  t.mock.method(performance, "now", () => now);
  const lesson = makeFeedforwardController() as Stage;
  loadActualStage(lesson);
  (document.getElementById("be-run") as HTMLButtonElement).click();
  const advance = () => {
    for (let index = 0; index < 4; index++) {
      now += 50;
      frame();
    }
  };
  const currentOdometry = () => topics.recentMessages("/robot/odom", 1)[0];

  ui.terminalInput.focus();
  advance();
  const first = currentOdometry();
  assert.ok(first, "The running lesson must publish odometry with terminal input focused");
  assert.match(ui.info.textContent ?? "", /mode:\s+running/);

  const select = document.getElementById("terminal-command-select") as HTMLSelectElement;
  select.focus();
  select.value = "ros2 topic echo /robot/odom";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  advance();
  const second = currentOdometry();
  assert.ok(second.ts > first.ts, "Selecting an inspection command must keep topics live");
  assert.notEqual(
    second.msg,
    first.msg,
    "Autonomous motion must continue while selecting a command",
  );

  const run = document.getElementById("terminal-command-run") as HTMLButtonElement;
  run.focus();
  advance();
  const third = currentOdometry();
  assert.ok(third.ts > second.ts, "The Run control must not pause the lesson");
  assert.notEqual(third.msg, second.msg);
  run.click();
  assert.ok(
    ui.terminalBody.textContent?.includes(third.msg),
    "Terminal echo must show odometry from the still-running lesson",
  );

  terminal.openPadPalette();
  advance();
  const fourth = currentOdometry();
  assert.ok(fourth.ts > third.ts, "The gamepad palette must keep topics live");
  assert.notEqual(fourth.msg, third.msg, "The robot must keep moving while inspecting via gamepad");
  assert.match(ui.info.textContent ?? "", /t:\s+0\.80\s*\/\s*1\.00 s/);
});

test("a visible Help dialog owns A while raw players, arm and Navigation remain idle", () => {
  help.open();
  nav.activateNavpad();
  pad([0, 12], [0, -1, 1, -1]);
  frame();
  assert.equal(help.isOpen(), true);
  assert.equal(updates, 0);
  assert.equal(actions, 0);
  assert.equal(canvasDowns, 0);
  assert.equal(twoPlayer.pollP1().action, false);
  arm.poll();
  assert.equal(arm.buttonDown(0), false);
  assert.equal(arm.rightStickY(), 0);
  assert.equal(input.getKeys().size, 0);
});

test("opening a modal cancels a Navigation drag and held A does not start another goal on dismissal", () => {
  nav.activateNavpad();
  pad([0]);
  frame();
  assert.equal(canvasDowns, 1);
  help.open();
  frame();
  assert.equal(canvasLeaves, 1, "The interrupted drag must be cancelled");
  help.close();
  frame();
  assert.equal(canvasDowns, 1, "Held A must not silently create a new goal after dismissal");
  pad();
  frame();
  pad([0]);
  frame();
  assert.equal(canvasDowns, 2, "A fresh press may create a new goal");
  pad();
  frame();
  const releasedGoals = canvasUps;
  key("Enter");
  frame();
  assert.equal(canvasDowns, 3);
  const cancelled = canvasLeaves;
  key("Escape");
  key("Enter", "keyup");
  frame();
  assert.equal(canvasLeaves, cancelled + 1, "Escape must cancel an active keyboard drag");
  assert.equal(
    canvasUps,
    releasedGoals,
    "Releasing Enter after cancellation must not submit a goal",
  );
});

test("UI dismissal and stage reinitialization consume controller actions before play resumes", () => {
  const cases = [
    { name: "help", open: () => help.open(), closed: () => !help.isOpen(), button: 1 },
    { name: "menu", open: () => menu.openMenu(), closed: () => !menu.isOpen(), button: 1 },
    {
      name: "lesson briefing",
      open: () => ui.lessonModal.classList.add("show"),
      closed: () => !ui.lessonModal.classList.contains("show"),
      button: 0,
    },
  ];
  for (const item of cases) {
    pad();
    ui.canvas.focus();
    frame();
    item.open();
    const before = updates;
    const beforeActions = actions;
    pad([item.button]);
    frame();
    assert.equal(item.closed(), true, `${item.name} must close through its controller button`);
    assert.equal(updates, before, `${item.name} must consume its dismissal frame`);
    frame();
    assert.equal(actions, beforeActions, `${item.name} must not leak its held button into play`);
    pad();
    frame();
  }

  const reinitializeInputs = () => {
    twoPlayer.resetEdges();
    arm.reset();
  };
  const receiving: Stage = {
    ...current,
    id: "receiving-stage",
    init: reinitializeInputs,
    reset: reinitializeInputs,
  };
  manager.setStages([current, receiving]);
  manager.buildGameContext(
    ui.canvas,
    new Proxy(
      { canvas: ui.canvas },
      { get: (target, key) => (key === "canvas" ? target.canvas : () => {}) },
    ) as unknown as CanvasRenderingContext2D,
  );
  const beforeActions = actions;
  pad([0]);
  manager.loadStage(receiving.id);
  frame();
  arm.poll();
  assert.equal(actions, beforeActions, "Stage initialization must retain the consumed A edge");
  assert.equal(arm.buttonEdge(0), false);
  manager.resetCurrent();
  frame();
  arm.poll();
  assert.equal(actions, beforeActions, "Retry must retain the consumed A edge");
  assert.equal(arm.buttonEdge(0), false);
  pad();
  frame();
  arm.poll();
  pad([0]);
  frame();
  arm.poll();
  assert.equal(actions, beforeActions + 1);
  assert.equal(arm.buttonEdge(0), true, "Fresh arm commands remain usable after reinitialization");
});

test("Tennis pointer movement respects terminal capture, modals and inactive pages", () => {
  const tennis = makeTennis();
  const positions: number[][] = [];
  loadActualStage(tennis, { translate: (x, y) => positions.push([x, y]) });
  const pointer = (type: string, x: number, y: number) =>
    ui.canvas.dispatchEvent(
      new browser.PointerEvent(type, { pointerType: "mouse", clientX: x, clientY: y }),
    );
  const playerPosition = () => {
    positions.length = 0;
    tennis.draw();
    return positions[0];
  };
  tennis.update(1);
  pointer("pointerdown", 112, 317);
  tennis.update(0); // Serve so pointer movement is no longer locked to the baseline.
  pointer("pointermove", 160, 220);
  assert.deepEqual(playerPosition(), [160, 220]);

  const interruptions = [
    { open: () => help.open(), close: () => help.close() },
    { open: () => menu.openMenu(), close: () => menu.closeMenu() },
    { open: () => ui.terminalInput.focus(), close: () => ui.canvas.focus() },
    {
      open: () => window.dispatchEvent(new Event("blur")),
      close: () => window.dispatchEvent(new Event("focus")),
    },
    {
      open: () => {
        pageHidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      close: () => {
        pageHidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    },
  ];
  for (const interruption of interruptions) {
    interruption.open();
    pointer("pointermove", 300, 350);
    pointer("pointerdown", 300, 350);
    assert.deepEqual(playerPosition(), [160, 220], "Paused pointer input must not move the robot");
    interruption.close();
    ui.canvas.focus();
    frame();
    assert.deepEqual(playerPosition(), [160, 220], "Resuming must retain the paused position");
  }
  pointer("pointermove", 260, 180);
  assert.deepEqual(playerPosition(), [260, 180], "Fresh pointer movement must work after resuming");
});

test("Tennis discards pointer actions during terminal capture and other interruptions", () => {
  const tennis = makeTennis();
  loadActualStage(tennis);
  const click = () =>
    ui.canvas.dispatchEvent(new browser.PointerEvent("pointerdown", { pointerType: "touch" }));
  const interruptions = [
    {
      name: "terminal",
      open: () => ui.terminalInput.focus(),
      close: () => ui.canvas.focus(),
      drawWhilePaused: true,
    },
    {
      name: "help",
      open: () => help.open(),
      close: () => help.close(),
      drawWhilePaused: true,
    },
    {
      name: "blur",
      open: () => window.dispatchEvent(new Event("blur")),
      close: () => window.dispatchEvent(new Event("focus")),
      drawWhilePaused: false,
    },
    {
      name: "hidden",
      open: () => {
        pageHidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      close: () => {
        pageHidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
      },
      drawWhilePaused: false,
    },
  ];
  for (const interruption of interruptions) {
    for (const clickBeforePause of [false, true]) {
      tennis.reset();
      tennis.update(1); // Human serve is ready and waits for a new action.
      if (clickBeforePause) click();
      interruption.open();
      if (!clickBeforePause) click();
      if (interruption.drawWhilePaused) frame();
      interruption.close();
      ui.canvas.focus();
      frame();
      assert.match(
        ui.info.textContent ?? "",
        /RALLY\s+0/,
        `${interruption.name} must discard clicks`,
      );
      click();
      frame();
      assert.match(
        ui.info.textContent ?? "",
        /RALLY\s+1/,
        "A fresh click must serve after resuming",
      );
    }
  }
});

test("Baseball keeps pitching while terminal capture discards queued and new pointer swings", (t) => {
  let now = performance.now();
  t.mock.method(performance, "now", () => now);
  const baseball = makeBaseball();
  const publications = loadActualStage(baseball);
  const click = () =>
    ui.canvas.dispatchEvent(
      new browser.PointerEvent("pointerdown", {
        pointerType: "touch",
        clientX: 600,
        clientY: 250,
      }),
    );
  const count = (topic: string) => publications.filter((value) => value === topic).length;

  for (const queuedBeforeFocus of [false, true]) {
    baseball.reset();
    ui.canvas.focus();
    baseball.update(0.8); // Ready -> pitch, so a stale swing would publish /bat/swing.
    const swingsBefore = count("/bat/swing");
    const pitchesBefore = count("/pitch/trajectory");
    if (queuedBeforeFocus) click();
    ui.terminalInput.focus();
    if (!queuedBeforeFocus) click();
    key("e", "keydown", ui.terminalInput);
    key("e", "keyup", ui.terminalInput);
    for (let index = 0; index < 4; index++) {
      now += 50;
      frame();
    }
    assert.ok(
      count("/pitch/trajectory") > pitchesBefore,
      "Terminal focus must keep the actual pitch simulation and topics advancing",
    );
    assert.equal(
      count("/bat/swing"),
      swingsBefore,
      queuedBeforeFocus
        ? "A queued swing must be discarded on focus"
        : "Terminal input must not swing",
    );
    ui.canvas.focus();
    click();
    now += 50;
    frame();
    assert.equal(count("/bat/swing"), swingsBefore + 1, "A fresh canvas click must still swing");
  }
});

test("Baseball does not swing for briefing A, terminal typing or native button activation", () => {
  const baseball = makeBaseball();
  const publications = loadActualStage(baseball);
  baseball.update(0.8); // Advance ready -> pitch, where a swing has observable consequences.
  pad();
  frame();
  ui.lessonModal.classList.add("show");
  pad([0]);
  frame();
  assert.equal(ui.lessonModal.classList.contains("show"), false);
  frame();
  assert.equal(publications.includes("/bat/swing"), false, "Briefing A must not swing the bat");
  pad();
  frame();

  help.open();
  key("e", "keydown", ui.helpModal);
  key("e", "keyup", ui.helpModal);
  frame();
  help.close();
  ui.terminalInput.focus();
  key("e", "keydown", ui.terminalInput);
  key("e", "keyup", ui.terminalInput);
  const button = document.createElement("button");
  button.id = "interaction-test-button";
  ui.stageOverlay.appendChild(button);
  button.focus();
  assert.equal(key(" ", "keydown", button).defaultPrevented, false);
  key(" ", "keyup", button);
  ui.canvas.focus();
  frame();
  assert.equal(publications.includes("/bat/swing"), false, "UI keys must not queue a later swing");

  for (const interruption of ["blur", "hidden"] as const) {
    key("e");
    if (interruption === "blur") window.dispatchEvent(new Event("blur"));
    else {
      pageHidden = true;
      document.dispatchEvent(new Event("visibilitychange"));
    }
    pageHidden = false;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    frame();
    assert.equal(
      publications.includes("/bat/swing"),
      false,
      `${interruption} must clear a queued swing`,
    );
    key("e", "keyup");
  }

  pad([0]);
  frame();
  assert.equal(
    publications.filter((topic) => topic === "/bat/swing").length,
    1,
    "A fresh press must still swing in the actual game",
  );
});

test("Pub/Sub Builder ignores the briefing press and accepts a fresh two-port connection", () => {
  const builder = makePubsub();
  const publications = loadActualStage(builder);
  const initialStatus = ui.status.textContent;
  pad();
  frame();
  ui.lessonModal.classList.add("show");
  pad([0]);
  frame();
  frame();
  assert.equal(ui.lessonModal.classList.contains("show"), false);
  assert.equal(ui.status.textContent, initialStatus, "Briefing A must not select the first port");
  assert.equal(publications.includes("/cmd_vel"), false);

  pad();
  frame();
  pad([0]);
  frame();
  assert.notEqual(ui.status.textContent, initialStatus, "Fresh A selects the output port");
  pad([15]);
  frame();
  pad([0]);
  frame();
  builder.update(0.3);
  assert.equal(
    publications.includes("/cmd_vel"),
    true,
    "Fresh navigation and confirmation must complete a working ROS connection",
  );
});
