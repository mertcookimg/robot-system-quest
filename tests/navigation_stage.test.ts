// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Exercise the real navigation stage through pointer events and simulated time.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let makeStage: () => Stage;
let stage: Stage;
let canvas: HTMLCanvasElement;
let delivered = 0;
let simulatedTime = 0;
let status = "";
let pose = { x: 80, y: 80, theta: 0 };
let recordedTimes: number[] = [];
let awards: Array<{ stars: number; stats: string }> = [];
let published: Array<{ topic: string; message: string }> = [];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "localStorage",
    "HTMLElement",
    "MouseEvent",
    "DOMRect",
  ]) {
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
  makeStage = (await server.ssrLoadModule("/src/stages/lesson/navigation.ts")).makeNav2Goal;
  (await server.ssrLoadModule("/src/i18n/index.ts")).setLang("en");
});

beforeEach(() => {
  document.body.innerHTML = '<canvas width="800" height="500"></canvas><div id="overlay"></div>';
  canvas = document.querySelector("canvas")!;
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 500);
  delivered = 0;
  simulatedTime = 0;
  status = "";
  pose = { x: 80, y: 80, theta: 0 };
  recordedTimes = [];
  awards = [];
  published = [];
  const noop = () => {};
  const context = {
    canvas,
    ctx: {},
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: (text: string) => (status = text),
    setHud: noop,
    showClear: (stars: number, stats: string) => awards.push({ stars, stats }),
    setTimeout: (callback: () => void) => callback(),
    shake: noop,
    publish: (topic: string, message: string) => published.push({ topic, message }),
    sfx: { click: noop, bump: noop, clear: noop, deliver: () => delivered++ },
    ghost: {
      startRecording: noop,
      recordPose: (time: number, x: number, y: number, theta: number) => {
        pose = { x, y, theta };
        recordedTimes.push(time);
      },
    },
  } as unknown as GameContext;
  stage = makeStage();
  stage.init(context);
});

afterEach(() => stage?.dispose());
after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function sendGoal(x: number, y: number, theta = 0): void {
  canvas.dispatchEvent(new MouseEvent("mousedown", { button: 0, clientX: x, clientY: y }));
  canvas.dispatchEvent(
    new MouseEvent("mouseup", {
      button: 0,
      clientX: x + Math.cos(theta) * 50,
      clientY: y + Math.sin(theta) * 50,
    }),
  );
}

function frames(count: number): void {
  for (let i = 0; i < count; i++) {
    simulatedTime += 1 / 60;
    stage.update(1 / 60);
  }
}

function untilReached(count: number): void {
  for (let i = 0; i < 2400 && delivered < count; i++) frames(1);
  assert.equal(delivered, count, `Goal ${count} should finish; last status: ${status}`);
}

test("a same-position goal rotates to its requested heading before it counts", () => {
  sendGoal(80, 80, Math.PI / 2);
  frames(1);
  assert.equal(delivered, 0);
  assert.ok(pose.theta > 0 && pose.theta < Math.PI / 2);
  assert.equal(pose.x, 80);
  assert.equal(pose.y, 80);
  untilReached(1);
  assert.ok(Math.abs(pose.theta - Math.PI / 2) < 0.07);
  assert.equal(awards.length, 0);
});

test("already-satisfied goals do not add progress, including repeated completed poses", () => {
  for (let i = 0; i < 5; i++) {
    sendGoal(80, 80, 0);
    frames(1);
  }
  assert.equal(delivered, 0);
  assert.match(status, /already reached/);
  sendGoal(80, 80, Math.PI / 2);
  untilReached(1);
  for (let i = 0; i < 5; i++) {
    sendGoal(80, 80, Math.PI / 2);
    frames(1);
  }
  assert.equal(delivered, 1);
  assert.equal(awards.length, 0);
});

test("a same-cell goal just outside position tolerance has a valid movement segment", () => {
  sendGoal(89.99, 89.99, Math.PI / 4);
  untilReached(1);
  assert.ok(Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.theta));
  assert.ok(Math.hypot(pose.x - 89.99, pose.y - 89.99) < 14);
  assert.ok(Math.abs(pose.theta - Math.PI / 4) < 0.07);
  assert.ok(
    published.some((entry) => entry.topic === "/plan" && /waypoints:2/.test(entry.message)),
  );
});

test("completion time covers all five goals and reset starts a new attempt", () => {
  for (let i = 0; i < 5; i++) {
    frames(30);
    sendGoal(80, 80, i % 2 === 0 ? Math.PI / 2 : 0);
    untilReached(i + 1);
  }
  assert.equal(awards.length, 1);
  assert.equal(awards[0].stars, 3);
  assert.ok(awards[0].stats.includes(`<b>${simulatedTime.toFixed(2)} s</b>`));
  assert.ok(simulatedTime > 10);
  assert.ok(recordedTimes.every((time, index) => index === 0 || time >= recordedTimes[index - 1]));
  sendGoal(180, 80);
  frames(1);
  assert.equal(delivered, 5);
  stage.reset();
  frames(1);
  assert.ok(recordedTimes.at(-1)! < 0.02);
  assert.deepEqual(pose, { x: 80, y: 80, theta: 0 });
  sendGoal(80, 80, 0);
  frames(1);
  assert.match(status, /already reached/);
});

test("replacing an active goal only counts the destination actually reached", () => {
  sendGoal(180, 80, 0);
  frames(10);
  assert.ok(pose.x > 80);
  sendGoal(80, 180, Math.PI / 2);
  untilReached(1);
  assert.ok(Math.hypot(pose.x - 80, pose.y - 180) < 14);
  assert.ok(Math.abs(pose.theta - Math.PI / 2) < 0.07);
  assert.equal(awards.length, 0);
});

test("an invalid replacement leaves the accepted goal running", () => {
  sendGoal(180, 80, 0);
  frames(10);
  sendGoal(260, 150, 0);
  assert.match(status, /obstacle/);
  untilReached(1);
  assert.ok(Math.hypot(pose.x - 180, pose.y - 80) < 14);
  assert.equal(published.filter((entry) => entry.topic === "/goal_pose").length, 1);
});
