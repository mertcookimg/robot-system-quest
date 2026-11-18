// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Real menu, keyboard and stage-manager modules against the app's DOM.
import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let menu: typeof import("../src/core/stage_menu");
let modes: typeof import("../src/core/modes");
let manager: typeof import("../src/core/stage_manager");
let allclear: typeof import("../src/core/allclear");
let timers: typeof import("../src/core/stage_timers");
let ui: (typeof import("../src/core/dom"))["ui"];
let stages: Stage[];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
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
    if (key === "requestAnimationFrame") value = () => 1;
    if (key === "cancelAnimationFrame") value = () => {};
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
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
  const registry = await server.ssrLoadModule("/src/core/stage_def.ts");
  for (const [id, mode, order] of [
    ["delivery", "game", 1],
    ["follower", "game", 2],
    ["fixture_lesson", "lesson", 1],
  ] as const) {
    registry.defineStage({
      mode,
      order,
      build: () => ({
        id,
        name: id,
        lesson: "",
        lessonCmd: "",
        init() {},
        reset() {},
        dispose() {},
        update() {},
        draw() {},
      }),
    });
  }
  stages = registry.getStages();
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  modes = (await server.ssrLoadModule("/src/core/modes.ts")) as typeof modes;
  menu = (await server.ssrLoadModule("/src/core/stage_menu.ts")) as typeof menu;
  allclear = (await server.ssrLoadModule("/src/core/allclear.ts")) as typeof allclear;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  manager.setStages(stages);
  manager.buildGameContext(ui.canvas, {} as CanvasRenderingContext2D);
  const terminal = await server.ssrLoadModule("/src/core/terminal_ui.ts");
  terminal.setupTerminal({ getConcept: () => undefined, getStageName: manager.getCurrentId });
  const dependencies = {
    stages,
    getCurrentStageId: manager.getCurrentId,
    loadStage: manager.loadStage,
  };
  modes.setupModes(dependencies);
  menu.setupStageMenu(dependencies);
  allclear.setupAllClear(() => manager.loadStage("delivery"));
  const keyboard = await server.ssrLoadModule("/src/core/keyboard.ts");
  keyboard.setupKeyboard({
    getCurrentStageId: manager.getCurrentId,
    resetCurrentStage: manager.resetCurrent,
    startGame() {},
    restartFromAllClear: () => manager.loadStage("delivery"),
  });
  ui.canvas.tabIndex = 0;
});

beforeEach(() => {
  menu.closeMenu();
  allclear.hide();
  timers.clearStageTimeouts();
  for (const element of [ui.introScreen, ui.lessonModal, ui.helpModal, ui.clearOverlay]) {
    element.classList.remove("show");
  }
  manager.loadStage("delivery");
  ui.canvas.focus();
});

after(async () => {
  timers?.clearStageTimeouts();
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const tab = (mode: "game" | "lesson") =>
  ui.modeTabs.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`)!;
const pills = () => [...ui.stageSelector.querySelectorAll<HTMLButtonElement>(".stage-pill")];
function key(value: string, shiftKey = false): void {
  const event = new KeyboardEvent("keydown", {
    key: value,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  (document.activeElement ?? document.body).dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, `The open menu must own ${value}`);
}

test("clicking the other mode replaces the open list without changing the running stage", () => {
  tab("game").click();
  assert.equal(menu.isOpen(), true);
  assert.equal(pills().length, 2);
  tab("lesson").click();
  assert.equal(menu.isOpen(), true);
  assert.equal(modes.getMode(), "lesson");
  assert.equal(manager.getCurrentId(), "delivery");
  assert.equal(pills().length, 1);
  assert.equal(document.activeElement, pills()[0]);
  assert.equal(tab("lesson").getAttribute("aria-expanded"), "true");
  assert.equal(tab("game").getAttribute("aria-expanded"), "false");
});

test("clicking the selected mode closes its list", () => {
  tab("game").click();
  tab("game").click();
  assert.equal(menu.isOpen(), false);
  assert.equal(document.body.classList.contains("stage-menu-open"), false);
  assert.equal(tab("game").getAttribute("aria-expanded"), "false");
  assert.equal(manager.getCurrentId(), "delivery");
});

test("Enter activates the natively focused card instead of the old arrow selection", () => {
  menu.openMenu("game");
  const follower = pills()[1];
  follower.focus();
  assert.equal(follower.classList.contains("gp-focus"), true);
  key("Enter");
  assert.equal(manager.getCurrentId(), "follower");
  assert.equal(menu.isOpen(), false);
  assert.equal(location.hash, "#follower");
});

test("Enter on the close button closes the menu without loading a stage", () => {
  menu.openMenu("game");
  pills()[1].focus();
  ui.stageSelector.querySelector<HTMLButtonElement>(".stage-menu-close")!.focus();
  key("Enter");
  assert.equal(menu.isOpen(), false);
  assert.equal(manager.getCurrentId(), "delivery");
  assert.equal(document.activeElement, ui.canvas);
});

test("Tab and Shift+Tab cycle through modes, close and cards without leaving the picker", () => {
  menu.openMenu("game");
  const controls = [
    tab("game"),
    tab("lesson"),
    ...ui.stageSelector.querySelectorAll<HTMLButtonElement>("button"),
  ];
  controls[0].focus();
  for (let i = 1; i <= controls.length; i++) {
    key("Tab");
    assert.equal(document.activeElement, controls[i % controls.length]);
  }
  for (let i = 1; i <= controls.length; i++) {
    key("Tab", true);
    assert.equal(document.activeElement, controls[(controls.length - i) % controls.length]);
  }
  assert.equal(menu.isOpen(), true);
});

test("arrows keep native focus and controller focus on the same card or mode", () => {
  menu.openMenu("game");
  assert.equal(document.activeElement, pills()[0]);
  key("ArrowRight");
  assert.equal(document.activeElement, pills()[1]);
  assert.equal(pills()[1].classList.contains("gp-focus"), true);
  key("ArrowLeft");
  key("ArrowUp");
  assert.equal(document.activeElement, tab("game"));
  key("ArrowRight");
  assert.equal(document.activeElement, tab("lesson"));
  key("Enter");
  assert.equal(modes.getMode(), "lesson");
  assert.equal(document.activeElement, pills()[0]);
  assert.equal(pills()[0].classList.contains("gp-focus"), true);
  assert.equal(tab("lesson").getAttribute("aria-expanded"), "true");
});

test("all-clear restart from a lesson loads Delivery and restores the GAME tab and list", () => {
  manager.loadStage("fixture_lesson");
  assert.equal(modes.getMode(), "lesson");
  allclear.show(stages);
  ui.allclearRestart.click();
  assert.equal(allclear.isOpen(), false);
  assert.equal(manager.getCurrentId(), "delivery");
  assert.equal(modes.getMode(), "game");
  assert.equal(tab("game").classList.contains("active"), true);
  assert.equal(tab("lesson").classList.contains("active"), false);
  assert.equal(pills().length, 2);
  assert.match(ui.stageSelector.querySelector(".stage-pill.active")!.textContent!, /delivery/);
});

test("Home resumes a mode at the current or first uncleared stage", async () => {
  const progress = (await server.ssrLoadModule(
    "/src/core/progress.ts",
  )) as typeof import("../src/core/progress");
  const [first, second] = modes.modeIds("game");
  const lessonId = modes.modeIds("lesson")[0];
  localStorage.clear();
  try {
    assert.equal(modes.hasClearedStageIn("game"), false, "A newcomer starts the first stage");

    progress.saveProgress(first, 2);
    assert.equal(modes.hasClearedStageIn("game"), true);
    assert.equal(modes.hasClearedStageIn("lesson"), false, "Progress is counted per mode");
    assert.equal(modes.resumeStageId("game", first), second, "A cleared stage moves on");
    assert.equal(modes.resumeStageId("game", second), second, "An unfinished stage is kept");
    assert.equal(modes.resumeStageId("game", lessonId), second);

    progress.saveProgress(second, 1);
    assert.equal(modes.resumeStageId("game", second), second, "All cleared keeps the stage");
    assert.equal(modes.resumeStageId("game", lessonId), first, "Or starts from the first");
  } finally {
    localStorage.clear();
  }
});

test("the menu's close callback runs only when the same stage stays loaded", () => {
  let closes = 0;
  const onClose = () => closes++;

  menu.openMenu("game", { onClose });
  key("Escape");
  assert.equal(closes, 1, "Closing the menu runs the callback");
  menu.closeMenu();
  assert.equal(closes, 1, "The callback runs only once");

  menu.openMenu("game", { onClose });
  pills()[0].focus();
  key("Enter");
  assert.equal(manager.getCurrentId(), "delivery");
  assert.equal(closes, 2, "Confirming the loaded stage also runs it");

  menu.openMenu("game", { onClose });
  pills()[1].focus();
  key("Enter");
  assert.equal(manager.getCurrentId(), "follower");
  assert.equal(closes, 2, "Loading another stage leaves first-visit handling to that load");

  menu.openMenu("game", { onClose });
  menu.openMenu("game");
  menu.closeMenu();
  assert.equal(closes, 2, "Reopening without a callback clears the previous one");
});
