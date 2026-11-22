// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { ClearOptions, GameContext, Stage } from "../src/types";
import { StorageKeys } from "../src/core/storage";

let browser: Window;
let server: ViteDevServer;
let clear: typeof import("../src/core/clear_overlay");
let ghost: typeof import("../src/core/ghost");
let rankings: typeof import("../src/core/rankings");
let progress: typeof import("../src/core/progress");
let manager: typeof import("../src/core/stage_manager");
let timers: typeof import("../src/core/stage_timers");
let i18n: typeof import("../src/i18n");
let ui: (typeof import("../src/core/dom"))["ui"];
let makePickPlace: (typeof import("../src/stages/lesson/pick_place"))["makePickPlace"];
let activeStage: Stage | undefined;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "MouseEvent",
    "MutationObserver",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  localStorage.setItem(StorageKeys.audio, "off");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  clear = (await server.ssrLoadModule("/src/core/clear_overlay.ts")) as typeof clear;
  ghost = (await server.ssrLoadModule("/src/core/ghost.ts")) as typeof ghost;
  rankings = (await server.ssrLoadModule("/src/core/rankings.ts")) as typeof rankings;
  progress = (await server.ssrLoadModule("/src/core/progress.ts")) as typeof progress;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  i18n = (await server.ssrLoadModule("/src/i18n/index.ts")) as typeof i18n;
  // Register the actual translated result labels, including Japanese "タイム".
  await server.ssrLoadModule("/src/stages/game/racing.ts");
  makePickPlace = (await server.ssrLoadModule("/src/stages/lesson/pick_place.ts")).makePickPlace;
  clear.setupClearOverlay({ onNext() {}, onRestart() {}, showAllClear() {} });
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(StorageKeys.audio, "off");
  ghost.startRecording();
});

afterEach(() => {
  activeStage?.dispose();
  activeStage = undefined;
  clear.close();
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

function stage(id: string): Stage {
  return {
    id,
    name: id,
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
    update() {},
    draw() {},
  };
}

function show(id: string, stats: string, options: ClearOptions = {}, stars = 3): void {
  const current = stage(id);
  clear.show(
    stars,
    stats,
    {
      current,
      stages: [current, stage("uncleared")],
      onRenderSelector() {},
    },
    options,
  );
}

function recordPose(x: number): void {
  ghost.startRecording();
  ghost.recordPose(0, x, 20, 0);
  ghost.recordPose(0.1, x + 1, 20, 0);
}

for (const lang of ["ja", "en"] as const) {
  test(`${lang}: translated Racing results save the explicit time and best ghost`, () => {
    i18n.setLang(lang);
    const label = i18n.t("racing.result.time");
    assert.equal(label, lang === "ja" ? "タイム" : "Time");
    recordPose(10);
    show("racing", `${label} <b>32.50 s</b>`, { timeSeconds: 32.5 });
    assert.deepEqual(rankings.getTopTimes("racing"), [32.5]);
    assert.equal(progress.loadProgress().racing.stars, 3);
    assert.equal(JSON.parse(localStorage.getItem(StorageKeys.ghosts)!).racing[0].x, 10);

    clear.close();
    recordPose(50);
    // Formatting and a slower time must never replace the best recording.
    show("racing", `<em>${label}: 40 seconds</em>`, { timeSeconds: 40 });
    assert.deepEqual(rankings.getTopTimes("racing"), [32.5, 40]);
    assert.equal(JSON.parse(localStorage.getItem(StorageKeys.ghosts)!).racing[0].x, 10);
  });
}

test("score-only and invalid timed results save stars without inventing a time or ghost", () => {
  recordPose(10);
  for (const timeSeconds of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    show("score-only", "Time <b>1.00 s</b>", { timeSeconds }, 2);
    assert.deepEqual(rankings.getTopTimes("score-only"), []);
    assert.equal(localStorage.getItem(StorageKeys.ghosts), null);
    assert.equal(progress.loadProgress()["score-only"].stars, 2);
    clear.close();
  }
});

test("local 2P results cannot change single-player time, stars or best ghost", () => {
  recordPose(10);
  show("racing", "Time <b>30.00 s</b>", { timeSeconds: 30 }, 2);
  clear.close();
  const before = [StorageKeys.rankings, StorageKeys.progress, StorageKeys.ghosts].map((key) =>
    localStorage.getItem(key),
  );
  recordPose(90);
  show("racing", "勝者 <b>P2</b><br>タイム <b>10.00 s</b>", { timeSeconds: 10, record: false });
  assert.deepEqual(
    [StorageKeys.rankings, StorageKeys.progress, StorageKeys.ghosts].map((key) =>
      localStorage.getItem(key),
    ),
    before,
  );
  assert.equal(ui.clearStats.querySelector(".rankings"), null);
});

test("awardStars forwards the captured completion time through its delayed result", async () => {
  manager.setStages([stage("delayed"), stage("uncleared")]);
  const game = manager.buildGameContext(ui.canvas, {} as CanvasRenderingContext2D);
  let elapsed = 12.345;
  game.awardStars(3, "完了", 0, { timeSeconds: elapsed });
  elapsed += 5;
  assert.equal(rankings.getBestTime("delayed"), undefined);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rankings.getBestTime("delayed"), 12.345);
  assert.equal(progress.loadProgress().delayed.stars, 3);
});

test("Pick & Place's real completion ranks elapsed time plus the mistake penalty", () => {
  activeStage = makePickPlace();
  const noop = () => {};
  let elapsed = 0;
  let result: { stars: number; stats: string; options?: ClearOptions } | undefined;
  ui.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 }) as DOMRect;
  activeStage.init({
    canvas: ui.canvas,
    ctx: {} as CanvasRenderingContext2D,
    overlay: ui.stageOverlay,
    keys: new Set(),
    setStatus: noop,
    setHud: noop,
    showClear: noop,
    awardStars: (stars, stats, _delay, options) => {
      result = { stars, stats, options };
    },
    setTimeout: noop,
    shake: noop,
    crash: noop,
    resetStage: noop,
    publish: noop,
    getBestTime: () => undefined,
    sfx: new Proxy({} as GameContext["sfx"], { get: () => noop }),
    ghost: { ...ghost, draw: noop },
  });
  const step = (dt: number) => {
    elapsed += dt;
    activeStage!.update(dt);
  };
  const move = (x: number, y: number) =>
    ui.canvas.dispatchEvent(new MouseEvent("mousemove", { clientX: x, clientY: y }));
  const grip = () => ui.canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0 }));

  step(0.5); // First parcel arrives.
  step(7); // Let it escape once to incur the real two-second penalty.
  for (const [x, y] of [
    [245, 235],
    [555, 235],
    [400, 190],
    [245, 235],
    [400, 190],
    [555, 235],
  ]) {
    move(193, 346);
    step(4); // Move to the belt while the replacement/next parcel spawns.
    grip();
    move(x, y);
    step(4); // Carry the parcel to its matching dock.
    grip();
  }
  assert.ok(result, "Sorting the six parcels reaches the real completion callback");
  assert.match(result.stats, /Mistakes <b>1<\/b>/);
  assert.equal(result.options?.timeSeconds, elapsed + 2);
  show(activeStage.id, result.stats, result.options, result.stars);
  assert.equal(rankings.getBestTime(activeStage.id), elapsed + 2);
});
