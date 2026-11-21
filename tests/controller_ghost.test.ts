// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";
import type { PoseSnap } from "../src/core/ghost";
import { StorageKeys } from "../src/core/storage";

let browser: Window;
let server: ViteDevServer;
let ghost: typeof import("../src/core/ghost");
let stage: Stage | undefined;
const factories = new Map<string, () => Stage>();
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const stages = [
  ["feedforward_controller", "makeFeedforwardController"],
  ["feedforward_mission", "makeFeedforwardMission"],
  ["feedback_controller", "makeFeedbackController"],
  ["feedback_mission", "makeFeedbackMission"],
] as const;

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "localStorage", "HTMLElement"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ghost = (await server.ssrLoadModule("/src/core/ghost.ts")) as typeof ghost;
  for (const [id, name] of stages) {
    factories.set(id, (await server.ssrLoadModule(`/src/stages/lesson/${id}.ts`))[name]);
  }
});

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = `
    <canvas width="800" height="500"></canvas><div id="overlay"></div>
    <section id="block-editor">
      <div class="be-palette"><p id="be-palette-hint"></p></div>
      <ol id="be-program"></ol><p id="be-program-hint"></p><span id="be-status"></span>
      <div class="be-actions">
        <button id="be-run">Run</button><button id="be-stop">Stop</button>
        <button id="be-clear">Clear</button>
      </div>
    </section>`;
});

afterEach(() => {
  stage?.dispose();
  stage = undefined;
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function initStage(id: string): void {
  const noop = () => {};
  stage = factories.get(id)!();
  stage.init({
    canvas: document.querySelector("canvas")!,
    ctx: {} as CanvasRenderingContext2D,
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: noop,
    setHud: noop,
    showClear: noop,
    awardStars: noop,
    setTimeout: noop,
    shake: noop,
    crash: noop,
    publish: noop,
    getBestTime: () => undefined,
    sfx: new Proxy({} as GameContext["sfx"], { get: () => noop }),
    ghost: { ...ghost, draw: noop },
  });
}

function frames(count: number): void {
  for (let i = 0; i < count; i++) stage!.update(0.05);
}

function click(id: string): void {
  document.getElementById(id)!.click();
}

function saveRecording(): PoseSnap[] {
  ghost.saveCurrentAsBest(stage!.id);
  return JSON.parse(localStorage.getItem(StorageKeys.ghosts)!)[stage!.id];
}

function assertNewRunRecording(): void {
  // The real recorder must accept early samples even after the previous
  // attempt/editor had advanced beyond this new run's elapsed time.
  frames(12);
  const recording = saveRecording();
  assert.ok(recording.length >= 5, "Record the first half-second of the new run");
  assert.ok(recording[0].t <= 0.05, "The replay starts with the new run");
  assert.ok(recording.at(-1)!.t <= 0.6, "Do not retain previous attempt/editor samples");
  assert.ok(recording.at(-1)!.x > recording[0].x, "The replay contains actual robot motion");
  assert.ok(recording.every((pose, index) => index === 0 || pose.t > recording[index - 1].t));
  ghost.loadGhostFor(stage!.id);
  const pose = recording.at(-1)!;
  assert.deepEqual(ghost.getPose(pose.t), { x: pose.x, y: pose.y, theta: pose.theta });
}

for (const [id] of stages) {
  test(`${id}: RUN discards the editor's idle recording`, () => {
    initStage(id);
    frames(100);
    assert.ok(saveRecording().at(-1)!.t > 4.9);
    click("be-run");
    assertNewRunRecording();
  });

  test(`${id}: STOP then RUN starts a fresh replay`, () => {
    initStage(id);
    click("be-run");
    frames(16);
    click("be-stop");
    frames(40);
    assert.ok(saveRecording().at(-1)!.t > 2.7);
    click("be-run");
    assertNewRunRecording();
  });
}
