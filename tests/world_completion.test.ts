// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Integrates L24 with the real app DOM, GameContext, completion overlay,
// keyboard dispatcher and stage timers. Happy DOM does not verify pixel layout.
import test, { after, afterEach, before, beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let makeStage: () => Stage;
let stage: Stage;
let manager: typeof import("../src/core/stage_manager");
let clear: typeof import("../src/core/clear_overlay");
let allclear: typeof import("../src/core/allclear");
let timers: typeof import("../src/core/stage_timers");
let progress: typeof import("../src/core/progress");
let menu: typeof import("../src/core/stage_menu");
let modes: typeof import("../src/core/modes");
let nextStage: Stage;
let ui: (typeof import("../src/core/dom"))["ui"];
let setLang: (typeof import("../src/i18n"))["setLang"];
let awards = 0;
let restarts = 0;
let nexts = 0;
let initialBodyNodes: ChildNode[];
let initialSceneNodes: ChildNode[];
let initialClearClass: string;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "FocusEvent",
    "KeyboardEvent",
    "MutationObserver",
    "IntersectionObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "matchMedia",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "window"
          ? browser
          : key.endsWith("AnimationFrame") || key === "matchMedia"
            ? Reflect.get(browser, key).bind(browser)
            : Reflect.get(browser, key),
    });
  }
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const styles = document.createElement("style");
  styles.textContent = (
    await Promise.all([
      readFile(new URL("../src/styles/19-allclear.css", import.meta.url), "utf8"),
      readFile(new URL("../src/styles/30-world-model.css", import.meta.url), "utf8"),
    ])
  ).join("\n");
  document.head.append(styles);
  // The real audio module honors this preference. Confetti/toast/analytics
  // retain their real implementations but are not initialized in this fixture.
  localStorage.setItem("robot_audio", "off");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  makeStage = (await server.ssrLoadModule("/src/stages/lesson/world_model.ts")).makeWorldModel;
  nextStage = {
    id: "completion-next-fixture",
    name: "Following stage",
    lesson: "",
    lessonCmd: "",
    init() {
      ui.stageOverlay.textContent = "Following stage loaded";
    },
    update() {},
    draw() {},
    reset() {},
    dispose() {},
  } as Stage;
  const definitions = await server.ssrLoadModule("/src/core/stage_def.ts");
  definitions.defineStage({ mode: "lesson", order: 25, build: () => nextStage });
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  clear = (await server.ssrLoadModule("/src/core/clear_overlay.ts")) as typeof clear;
  allclear = (await server.ssrLoadModule("/src/core/allclear.ts")) as typeof allclear;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  progress = (await server.ssrLoadModule("/src/core/progress.ts")) as typeof progress;
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
  menu = (await server.ssrLoadModule("/src/core/stage_menu.ts")) as typeof menu;
  modes = (await server.ssrLoadModule("/src/core/modes.ts")) as typeof modes;
  manager.setStages([makeStage(), nextStage]);
  menu.setupStageMenu({ getCurrentStageId: manager.getCurrentId, loadStage: manager.loadStage });
  modes.setupModes({
    get stages() {
      return manager.getStages();
    },
    getCurrentStageId: manager.getCurrentId,
    loadStage: manager.loadStage,
  });
  clear.setupClearOverlay({
    onRestart: () => {
      restarts++;
      manager.resetCurrent();
    },
    onNext: () => {
      nexts++;
      manager.loadNextStage();
    },
    showAllClear: () => allclear.show(manager.getStages()),
  });
  const keyboard = await server.ssrLoadModule("/src/core/keyboard.ts");
  keyboard.setupKeyboard({
    getCurrentStageId: manager.getCurrentId,
    resetCurrentStage: () => {
      restarts++;
      manager.resetCurrent();
    },
    startGame: () => {},
    restartFromAllClear: () => {},
  });
  initialBodyNodes = [...document.body.childNodes];
  initialSceneNodes = [...ui.canvasWrap.childNodes];
  initialClearClass = ui.clearOverlay.className;
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("robot_audio", "off");
  clear.close();
  allclear.hide();
  menu.closeMenu();
  ui.introScreen.classList.remove("show");
  ui.lessonModal.classList.remove("show");
  ui.helpModal.classList.remove("show");
  ui.canvasWrap.classList.remove("shake");
  setLang("en");
  awards = restarts = nexts = 0;
  stage = makeStage();
  manager.setStages([stage, nextStage]);
  const canvasContext = new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D;
  const context = manager.buildGameContext(ui.canvas, canvasContext);
  const award = context.awardStars;
  context.awardStars = (...args) => {
    awards++;
    award(...args);
  };
  stage.init(context);
});

afterEach(() => {
  timers.clearStageTimeouts();
  clear.close();
  allclear.hide();
  menu.closeMenu();
  stage?.dispose();
  ui.stageOverlay.textContent = "";
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const panel = () => document.querySelector<HTMLElement>(".world-lab")!;
const primary = () => panel().querySelector<HTMLButtonElement>('[data-action="continue"]')!;
const action = (name: string) =>
  panel().querySelector<HTMLButtonElement>(`[data-action="${name}"]`)!;
function advance(intent: string): void {
  assert.equal(primary().dataset.intent, intent);
  assert.equal(primary().disabled, false);
  primary().focus();
  primary().click();
}
function finishTrials(): void {
  for (let trial = 0; trial < 3; trial++) {
    advance("plan");
    advance("run");
    for (let frame = 0; frame < 21; frame++) stage.update(0.1);
    if (trial < 2) advance("next");
  }
  assert.equal(primary().dataset.intent, "finish");
}
function complete(t: TestContext): void {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  finishTrials();
  advance("finish");
  t.mock.timers.tick(1);
  assert.equal(clear.isOpen(), true);
}
function key(value: string, shiftKey = false): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: value, shiftKey, bubbles: true, cancelable: true }),
  );
}
function assertSameNodes(actual: ChildNode[], expected: ChildNode[]): void {
  assert.equal(actual.length, expected.length);
  actual.forEach((node, i) => assert.ok(node === expected[i], `DOM node ${i} was not restored`));
}

test("completion uses the shared card outside the animated canvas and focuses its action", (t) => {
  complete(t);
  assert.equal(awards, 1);
  assert.equal(progress.loadProgress()[stage.id]?.stars, 3);
  assert.equal(ui.stars.querySelectorAll(".star.on").length, 3);
  assert.match(ui.clearStats.textContent ?? "", /three trials/);
  assert.ok(ui.clearOverlay.parentElement === document.body, "completion must be a body child");
  assert.equal(ui.clearOverlay.classList.contains("world-completion-layer"), true);
  assert.equal(ui.clearOverlay.getAttribute("role"), "dialog");
  assert.equal(ui.clearOverlay.getAttribute("aria-modal"), "true");
  assert.equal(ui.clearOverlay.inert, false);
  assert.equal(ui.canvasWrap.classList.contains("shake"), true);
  assert.equal(ui.canvasWrap.contains(ui.clearOverlay), false);
  assert.equal(window.getComputedStyle(ui.clearOverlay).position, "fixed");
  assert.ok(document.activeElement === ui.nextBtn, "Next must receive actual focus");
  key("ArrowLeft");
  assert.ok(document.activeElement === ui.restartBtn, "Left must focus Retry");
  key("ArrowRight");
  assert.ok(document.activeElement === ui.nextBtn, "Right must focus Next");
});

test("Retry runs the real reset and retains one usable L24 layout", (t) => {
  complete(t);
  ui.restartBtn.click();
  assert.equal(restarts, 1);
  assert.equal(clear.isOpen(), false);
  assert.equal(panel().dataset.experiment, "near");
  assert.equal(panel().dataset.phase, "0");
  assert.equal(primary().dataset.intent, "plan");
  assert.equal(primary().disabled, false);
  assert.ok(document.activeElement === primary(), "Retry must focus the first lesson action");
  assert.equal(document.querySelectorAll(".world-workbench").length, 1);
  assert.equal(document.querySelectorAll(".world-lab").length, 1);
  assert.ok(ui.clearOverlay.parentElement === document.body);
  advance("plan");
  advance("run");
  assert.equal(panel().dataset.phase, "2");
  assert.equal(awards, 1);
});

test("Next loads the following stage and restores the original shared DOM", (t) => {
  complete(t);
  ui.nextBtn.click();
  assert.equal(nexts, 1);
  assert.equal(manager.getCurrentId(), "completion-next-fixture");
  assert.equal(clear.isOpen(), false);
  assert.equal(document.querySelector(".world-workbench"), null);
  assert.equal(document.querySelector(".world-lab"), null);
  assert.ok(ui.clearOverlay.parentElement === ui.canvasWrap);
  assert.equal(ui.clearOverlay.className, initialClearClass);
  assertSameNodes([...ui.canvasWrap.childNodes], initialSceneNodes);
  assertSameNodes([...document.body.childNodes], initialBodyNodes);
  assert.equal(ui.canvas.height, 500);
  assert.equal(ui.stageOverlay.textContent, "Following stage loaded");
});

test("closing completion cancels its scheduled all-clear transition", (t) => {
  manager.setStages([stage]);
  complete(t);
  key("Escape");
  assert.equal(clear.isOpen(), false);
  t.mock.timers.tick(3000);
  assert.equal(allclear.isOpen(), false);
});

test("Escape restores completed review controls and Start again resets without a second award", (t) => {
  complete(t);
  assert.equal(panel().inert, true);
  key("Escape");
  assert.equal(clear.isOpen(), false);
  assert.equal(ui.clearOverlay.inert, true);
  assert.equal(panel().inert, false);
  assert.equal(primary().dataset.intent, "reset");
  assert.equal(primary().disabled, false);
  assert.ok(document.activeElement === primary(), "dismissal must restore usable lesson focus");
  assert.equal(awards, 1);
  action("details").click();
  assert.equal(panel().querySelector<HTMLElement>('[data-world="details"]')!.hidden, false);
  assert.equal(panel().querySelectorAll('[data-world="records"] [data-experiment]').length, 3);
  advance("reset");
  assert.equal(primary().dataset.intent, "plan");
  assert.equal(panel().dataset.experiment, "near");
  assert.equal(panel().querySelectorAll('[data-world="records"] [data-experiment]').length, 0);
  assert.equal(awards, 1);
  assert.equal(document.querySelectorAll(".world-workbench").length, 1);
});

test("Tab keeps completion focus inside and Enter follows native button focus", (t) => {
  complete(t);
  key("Tab");
  assert.ok(document.activeElement === ui.restartBtn, "Tab must cycle to Retry");
  key("Tab");
  assert.ok(document.activeElement === ui.nextBtn, "Tab must cycle to Next");
  key("Tab", true);
  assert.ok(document.activeElement === ui.restartBtn, "Shift+Tab must cycle backwards");
  // Native focus (e.g. assistive technology / pointer) must update gamepad focus.
  ui.nextBtn.focus();
  ui.restartBtn.focus();
  key("Enter");
  assert.equal(restarts, 1);
  assert.equal(nexts, 0);
  assert.equal(clear.isOpen(), false);
  assert.equal(primary().dataset.intent, "plan");
});

test("the final lesson opens Lesson list and can return to its completed results", (t) => {
  // Keep an unfinished earlier lesson so this is mode completion, not all-clear.
  stage.dispose();
  manager.setStages([nextStage, stage]);
  localStorage.setItem("robot_quest_lesson_seen_v1", JSON.stringify([stage.id]));
  manager.loadStage(stage.id);
  complete(t);
  assert.match(ui.nextBtn.textContent ?? "", /Lesson list/);
  ui.nextBtn.click();
  assert.equal(nexts, 1);
  assert.equal(manager.getCurrentId(), stage.id);
  assert.equal(menu.isOpen(), true);
  assert.equal(modes.getMode(), "lesson");
  assert.ok(document.activeElement?.matches(".stage-pill.active"));
  assert.equal(panel().inert, false);
  assert.equal(primary().dataset.intent, "reset");
  key("Escape");
  assert.equal(menu.isOpen(), false);
  assert.ok(document.activeElement === primary(), "closing Lesson list must restore lesson focus");
  advance("reset");
  assert.equal(primary().dataset.intent, "plan");
  assert.equal(awards, 1);
});

test("an undismissed final completion still transitions to the real all-clear screen", (t) => {
  manager.setStages([stage]);
  complete(t);
  assert.match(ui.nextBtn.textContent ?? "", /View all clear/);
  t.mock.timers.tick(2400);
  assert.equal(clear.isOpen(), false);
  assert.equal(allclear.isOpen(), true);
  assert.ok(document.activeElement === ui.allclearRestart, "all-clear must receive actual focus");
  assert.equal(ui.allclearStars.querySelectorAll(".stage-result").length, 1);
  assert.match(ui.allclearStats.textContent ?? "", /3 \/ 3/);
  assert.equal(panel().inert, false);
});

test("View all clear opens and focuses the final screen immediately", (t) => {
  manager.setStages([stage]);
  complete(t);
  ui.nextBtn.click();
  assert.equal(clear.isOpen(), false);
  assert.equal(allclear.isOpen(), true);
  assert.ok(document.activeElement === ui.allclearRestart);
  assert.equal(nexts, 0);
  t.mock.timers.tick(3000);
  assert.ok(document.activeElement === ui.allclearRestart);
  assert.equal(ui.allclearStars.querySelectorAll(".stage-result").length, 1);
});

test("all-clear keeps 38 results in a bounded scroll area with a focused restart control", (t) => {
  const completedStages = Array.from({ length: 37 }, (_, i) => ({
    ...nextStage,
    id: `completed-fixture-${i}`,
    name: `Completed stage ${i + 1}`,
  }));
  completedStages.forEach((completed) => progress.saveProgress(completed.id, 3));
  manager.setStages([stage, ...completedStages]);
  complete(t);
  ui.nextBtn.click();
  assert.equal(allclear.isOpen(), true);
  assert.equal(ui.allclearStars.querySelectorAll(".stage-result").length, 38);
  assert.match(ui.allclearStats.textContent ?? "", /114 \/ 114/);
  const card = ui.allclearScreen.querySelector<HTMLElement>(".allclear-card")!;
  const cardStyle = window.getComputedStyle(card);
  const resultsStyle = window.getComputedStyle(ui.allclearStars);
  assert.equal(cardStyle.boxSizing, "border-box");
  assert.equal(cardStyle.maxHeight, "calc(100dvh - 32px)");
  assert.equal(cardStyle.display, "flex");
  assert.equal(cardStyle.flexDirection, "column");
  assert.equal(cardStyle.overflowY, "auto");
  assert.equal(parseFloat(resultsStyle.minHeight), 0);
  assert.equal(resultsStyle.overflowY, "auto");
  assert.equal(window.getComputedStyle(ui.allclearRestart).flexShrink, "0");
  assert.ok(document.activeElement === ui.allclearRestart);
});

test("leaving during the queued completion cancels the stale clear callback", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  finishTrials();
  advance("finish");
  // A repeated activation must not queue a second award before the first renders.
  primary().click();
  assert.equal(awards, 1);
  manager.loadStage(nextStage.id);
  t.mock.timers.tick(3000);
  assert.equal(clear.isOpen(), false);
  assert.equal(allclear.isOpen(), false);
  assert.equal(progress.loadProgress()[stage.id], undefined);
  assert.ok(ui.clearOverlay.parentElement === ui.canvasWrap);
  assert.equal(ui.clearOverlay.className, initialClearClass);
  assert.equal(document.querySelector(".world-workbench"), null);
});
