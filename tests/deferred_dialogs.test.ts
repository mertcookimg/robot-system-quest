// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let clear: typeof import("../src/core/clear_overlay");
let help: typeof import("../src/core/help");
let intro: typeof import("../src/core/intro");
let lesson: typeof import("../src/core/lesson_modal");
let allclear: typeof import("../src/core/allclear");
let menu: typeof import("../src/core/stage_menu");
let manager: typeof import("../src/core/stage_manager");
let timers: typeof import("../src/core/stage_timers");
let rankings: typeof import("../src/core/rankings");
let progress: typeof import("../src/core/progress");
let game: GameContext;
let ui: (typeof import("../src/core/dom"))["ui"];
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const current: Stage = {
  id: "deferred-result",
  name: "Deferred result",
  lesson: "",
  lessonCmd: "",
  init() {},
  reset() {},
  update() {},
  draw() {},
  dispose() {},
};
const next = { ...current, id: "next-result" };
const deps = { current, stages: [current, next], onRenderSelector() {} };

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "HTMLElement",
    "Element",
    "MutationObserver",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value =
      key === "window"
        ? browser
        : key === "requestAnimationFrame"
          ? (callback: FrameRequestCallback) => {
              callback(0);
              return 1;
            }
          : key === "cancelAnimationFrame"
            ? () => {}
            : Reflect.get(browser, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
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
  clear = (await server.ssrLoadModule("/src/core/clear_overlay.ts")) as typeof clear;
  help = (await server.ssrLoadModule("/src/core/help.ts")) as typeof help;
  intro = (await server.ssrLoadModule("/src/core/intro.ts")) as typeof intro;
  lesson = (await server.ssrLoadModule("/src/core/lesson_modal.ts")) as typeof lesson;
  allclear = (await server.ssrLoadModule("/src/core/allclear.ts")) as typeof allclear;
  menu = (await server.ssrLoadModule("/src/core/stage_menu.ts")) as typeof menu;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  rankings = (await server.ssrLoadModule("/src/core/rankings.ts")) as typeof rankings;
  progress = (await server.ssrLoadModule("/src/core/progress.ts")) as typeof progress;
  const { registerLang } = await server.ssrLoadModule("/src/i18n/index.ts");
  registerLang({
    en: {
      "briefing-fixture.lesson.title": "Fixture briefing",
      "briefing-fixture.lesson.goal": "Goal",
      "briefing-fixture.lesson.first": "First",
      "briefing-fixture.lesson.learn": "Learn",
    },
  });
  clear.setupClearOverlay({ onNext() {}, onRestart() {}, showAllClear() {} });
  help.setupHelp();
  intro.setupIntro({ onSelectMode() {} });
  lesson.setupLessonModal(() => "briefing-fixture");
  allclear.setupAllClear(() => {});
  menu.setupStageMenu({ getCurrentStageId: () => current.id, loadStage() {} });
  game = manager.buildGameContext(ui.canvas, {} as CanvasRenderingContext2D);
});

beforeEach(async () => {
  localStorage.clear();
  manager.setStages([current, next]);
  await manager.loadStage(current.id);
});

afterEach(() => {
  clear.close();
  help.close();
  intro.start();
  lesson.close();
  allclear.hide();
  menu.closeMenu();
  timers.clearStageTimeouts();
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const blockers = [
  { name: "Help", open: () => help.open(), close: () => help.close(), active: () => ui.helpModal },
  {
    name: "Home",
    open: () => intro.show(),
    close: () => intro.start(),
    active: () => ui.introScreen,
  },
  {
    name: "briefing",
    open: () => lesson.open("briefing-fixture"),
    close: () => lesson.close(),
    active: () => ui.lessonModal,
  },
  {
    name: "all-clear",
    open: () => allclear.show([]),
    close: () => allclear.hide(),
    active: () => ui.allclearScreen,
  },
  {
    name: "stage menu",
    open: () => menu.openMenu(),
    close: () => menu.closeMenu(),
    active: () => ui.modeTabs,
  },
];

for (const blocker of blockers) {
  test(`a delayed result waits for ${blocker.name}, then saves its captured result once`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    game.awardStars(2, "Completed before opening the dialog", 10, { timeSeconds: 12.5 });
    blocker.open();
    t.mock.timers.tick(10);
    t.mock.timers.tick(500);
    assert.equal(clear.isOpen(), false);
    assert.equal(blocker.active().inert, false, "The visible UI keeps input ownership");
    assert.equal(rankings.getBestTime(current.id), undefined);
    assert.equal(progress.loadProgress()[current.id], undefined);
    blocker.close();
    t.mock.timers.tick(100);
    assert.equal(clear.isOpen(), true);
    assert.match(ui.clearStats.textContent!, /Completed before opening the dialog/);
    assert.deepEqual(rankings.getTopTimes(current.id), [12.5]);
    assert.equal(progress.loadProgress()[current.id].stars, 2);
    t.mock.timers.tick(500);
    assert.deepEqual(rankings.getTopTimes(current.id), [12.5]);
  });
}

test("waiting copies result options and keeps local 2P results unrecorded", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  help.open();
  const options = { timeSeconds: 8, record: false };
  clear.show(3, "P2 won", deps, options);
  options.record = true;
  options.timeSeconds = 99;
  help.close();
  t.mock.timers.tick(100);
  assert.equal(clear.isOpen(), true);
  assert.deepEqual(rankings.getTopTimes(current.id), []);
  assert.equal(progress.loadProgress()[current.id], undefined);
});

for (const operation of ["close", "reset", "stage change"] as const) {
  test(`${operation} cancels a pending result before its dialog closes`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    help.open();
    clear.show(3, "Cancelled result", deps, { timeSeconds: 5 });
    if (operation === "close") clear.close();
    else if (operation === "reset") manager.resetCurrent();
    else await manager.loadStage(next.id);
    help.close();
    t.mock.timers.tick(500);
    assert.equal(clear.isOpen(), false);
    assert.deepEqual(rankings.getTopTimes(current.id), []);
    assert.equal(progress.loadProgress()[current.id], undefined);
  });
}

for (const blocker of [
  ...blockers.filter((item) => item.name !== "briefing"),
  {
    name: "completion",
    open: () => clear.show(1, "Completed", deps),
    close: () => clear.close(),
    active: () => ui.clearOverlay,
  },
]) {
  test(`the first-visit briefing cannot cover ${blocker.name} opened during its delay`, (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    lesson.maybeAutoOpen("briefing-fixture", false, {
      introOpen: false,
      allclearOpen: false,
      helpOpen: false,
    });
    blocker.open();
    t.mock.timers.tick(220);
    assert.equal(lesson.isOpen(), false);
    assert.equal(blocker.active().inert, false);
    blocker.close();
    lesson.maybeAutoOpen("briefing-fixture", false, {
      introOpen: false,
      allclearOpen: false,
      helpOpen: false,
    });
    t.mock.timers.tick(220);
    assert.equal(lesson.isOpen(), true, "The unseen briefing remains available afterwards");
  });
}
