// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Exercise asynchronous stage transitions against the real manager, loop and DOM.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let registry: typeof import("../src/core/stage_def");
let manager: typeof import("../src/core/stage_manager");
let loop: typeof import("../src/core/loop");
let timers: typeof import("../src/core/stage_timers");
let ui: (typeof import("../src/core/dom"))["ui"];
let nextId = 0;
let rafId = 0;
const raf = new Map<number, FrameRequestCallback>();
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
    if (key === "requestAnimationFrame")
      value = (callback: FrameRequestCallback) => {
        const id = ++rafId;
        raf.set(id, callback);
        return id;
      };
    if (key === "cancelAnimationFrame") value = (id: number) => raf.delete(id);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
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
  registry = (await server.ssrLoadModule("/src/core/stage_def.ts")) as typeof registry;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  loop = (await server.ssrLoadModule("/src/core/loop.ts")) as typeof loop;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  ui = (await server.ssrLoadModule("/src/core/dom.ts")).ui;
  manager.setStages([stageFixture().stage]);
  const terminal = await server.ssrLoadModule("/src/core/terminal_ui.ts");
  terminal.setupTerminal({
    getConcept: () => manager.getCurrent().ros2,
    getStageName: manager.getCurrentId,
  });
  manager.buildGameContext(
    ui.canvas,
    new Proxy({}, { get: () => () => {} }) as CanvasRenderingContext2D,
  );
});

beforeEach(() => {
  for (const element of [
    ui.introScreen,
    ui.lessonModal,
    ui.helpModal,
    ui.clearOverlay,
    ui.allclearScreen,
  ]) {
    element.classList.remove("show");
  }
  document.body.classList.remove("stage-menu-open", "stage-loading");
  ui.canvas.tabIndex = 0;
  ui.canvas.focus();
  raf.clear();
});

afterEach(() => {
  if (manager.isStageReady()) manager.getCurrent().dispose();
  timers.clearStageTimeouts();
  raf.clear();
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function stageFixture() {
  const id = `loading-fixture-${++nextId}`;
  const calls = { init: 0, update: 0, draw: 0, reset: 0, dispose: 0 };
  const stage: Stage = {
    id,
    name: id,
    lesson: "",
    lessonCmd: "",
    init(context) {
      calls.init++;
      context.overlay.textContent = `Loaded ${id}`;
    },
    update() {
      assert.ok(calls.init > 0);
      calls.update++;
    },
    draw() {
      assert.ok(calls.init > 0);
      calls.draw++;
    },
    reset() {
      assert.ok(calls.init > 0);
      calls.reset++;
    },
    dispose() {
      assert.ok(calls.init > 0, "An uninitialized stage must never be disposed");
      calls.dispose++;
    },
  };
  return { stage, calls };
}

function lazyFixture() {
  const fixture = stageFixture();
  const attempts: ReturnType<typeof deferred>[] = [];
  registry.registerStageLoader(
    {
      id: fixture.stage.id,
      mode: "game",
      order: nextId,
      ja: { name: fixture.stage.name, lesson: "" },
      en: { name: fixture.stage.name, lesson: "" },
    },
    () => {
      const attempt = deferred();
      attempts.push(attempt);
      return attempt.promise;
    },
  );
  const handle = registry.getStages().find((stage) => stage.id === fixture.stage.id)!;
  const register = () =>
    registry.defineStage({ mode: "game", order: nextId, build: () => fixture.stage });
  return { ...fixture, handle, attempts, register };
}

function frame(): void {
  const callbacks = [...raf.values()];
  raf.clear();
  assert.ok(callbacks.length > 0);
  callbacks.forEach((callback) => callback(performance.now()));
}

test("initial loading never disposes or ticks an uninitialized stage", async () => {
  const lazy = lazyFixture();
  manager.setStages([lazy.handle]);
  const loading = manager.loadStage(lazy.handle.id);
  assert.equal(manager.isStageReady(), false);
  assert.equal(ui.canvasWrap.getAttribute("aria-busy"), "true");
  assert.ok(ui.stageOverlay.querySelector(".stage-loading-message"));
  loop.startLoop();
  frame();
  // The module may register synchronously before its import promise settles.
  lazy.register();
  frame();
  assert.deepEqual(lazy.calls, { init: 0, update: 0, draw: 0, reset: 0, dispose: 0 });
  lazy.attempts[0].resolve();
  await loading;
  assert.equal(manager.isStageReady(), true);
  assert.equal(ui.canvasWrap.getAttribute("aria-busy"), "false");
  assert.equal(document.body.classList.contains("stage-loading"), false);
  frame();
  assert.deepEqual(lazy.calls, { init: 1, update: 1, draw: 1, reset: 0, dispose: 0 });
});

test("out-of-order imports initialize only the latest selected stage", async () => {
  const base = stageFixture();
  const older = lazyFixture();
  const latest = lazyFixture();
  manager.setStages([base.stage, older.handle, latest.handle]);
  await manager.loadStage(base.stage.id);
  const olderLoad = manager.loadStage(older.handle.id);
  const latestLoad = manager.loadStage(latest.handle.id);
  assert.equal(base.calls.dispose, 1);
  latest.register();
  latest.attempts[0].resolve();
  await latestLoad;
  older.register();
  older.attempts[0].resolve();
  await olderLoad;
  assert.equal(manager.getCurrentId(), latest.handle.id);
  assert.equal(ui.stageOverlay.textContent, `Loaded ${latest.handle.id}`);
  assert.equal(location.hash, `#${latest.handle.id}`);
  assert.equal(older.calls.init, 0);
  assert.equal(older.calls.dispose, 0);
  assert.equal(latest.calls.init, 1);
  assert.equal(latest.calls.dispose, 0);
});

test("readiness follows a new completed selection without waiting for an obsolete import", async () => {
  const older = lazyFixture();
  const latest = lazyFixture();
  manager.setStages([older.handle, latest.handle]);
  const olderLoad = manager.loadStage(older.handle.id);
  let ready = false;
  const readiness = manager.whenStageReady().then(() => {
    ready = true;
  });
  const latestLoad = manager.loadStage(latest.handle.id);
  latest.register();
  latest.attempts[0].resolve();
  await latestLoad;
  // All promise callbacks settle before the next event-loop turn.
  await new Promise<void>((resolve) => setImmediate(resolve));
  const readyBeforeObsoleteFinished = ready;
  older.register();
  older.attempts[0].resolve();
  await olderLoad;
  await readiness;
  assert.equal(readyBeforeObsoleteFinished, true);
  assert.equal(manager.getCurrentId(), latest.handle.id);
  assert.equal(latest.calls.init, 1);
  assert.equal(older.calls.init, 0);
});

test("a failed import offers Retry and the same selection can subsequently load", async (t) => {
  const lazy = lazyFixture();
  const errors = t.mock.method(console, "error", () => {});
  manager.setStages([lazy.handle]);
  const loading = manager.loadStage(lazy.handle.id);
  lazy.attempts[0].reject(new Error("network failure"));
  await loading;
  assert.equal(manager.isStageReady(), false);
  assert.equal(ui.canvasWrap.getAttribute("aria-busy"), "false");
  const retry = ui.stageOverlay.querySelector<HTMLButtonElement>("button");
  assert.ok(retry);
  assert.equal(errors.mock.callCount(), 1);
  retry.click();
  assert.equal(lazy.attempts.length, 2, "Retry must initiate another import attempt");
  assert.equal(ui.canvasWrap.getAttribute("aria-busy"), "true");
  lazy.register();
  lazy.attempts[1].resolve();
  await manager.whenStageReady();
  assert.equal(manager.isStageReady(), true);
  assert.equal(lazy.calls.init, 1);
  assert.equal(lazy.calls.dispose, 0);
  assert.equal(ui.stageOverlay.textContent, `Loaded ${lazy.handle.id}`);
});

test("a late rejection cannot replace the newer stage with a loading error", async (t) => {
  const older = lazyFixture();
  const cached = stageFixture();
  const errors = t.mock.method(console, "error", () => {});
  manager.setStages([older.handle, cached.stage]);
  const olderLoad = manager.loadStage(older.handle.id);
  await manager.loadStage(cached.stage.id);
  older.attempts[0].reject(new Error("obsolete import failure"));
  await olderLoad;
  assert.equal(manager.isStageReady(), true);
  assert.equal(manager.getCurrentId(), cached.stage.id);
  assert.equal(ui.stageOverlay.textContent, `Loaded ${cached.stage.id}`);
  assert.equal(errors.mock.callCount(), 0);
});

test("returning to an imported stage initializes synchronously without another import", async () => {
  const lazy = lazyFixture();
  const other = stageFixture();
  manager.setStages([lazy.handle, other.stage]);
  const loading = manager.loadStage(lazy.handle.id);
  lazy.register();
  lazy.attempts[0].resolve();
  await loading;
  await manager.loadStage(other.stage.id);
  assert.equal(lazy.calls.dispose, 1);
  const reloaded = manager.loadStage(lazy.handle.id);
  assert.equal(manager.isStageReady(), true, "A cached stage must be ready in the calling turn");
  assert.equal(lazy.calls.init, 2);
  assert.equal(lazy.attempts.length, 1);
  assert.equal(other.calls.dispose, 1);
  assert.equal(document.body.classList.contains("stage-loading"), false);
  await reloaded;
});
