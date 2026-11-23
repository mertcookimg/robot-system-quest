// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, GhostPose, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let makeSoccer: () => Stage;
let stage: Stage | undefined;
let pose: GhostPose;
let hud: string[];
let messages: Map<string, string>;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  makeSoccer = (await server.ssrLoadModule("/src/stages/game/robo_soccer.ts")).makeRoboSoccer;
  (await server.ssrLoadModule("/src/i18n/index.ts")).setLang("en");
});

beforeEach(() => {
  document.body.innerHTML = '<canvas width="800" height="500"></canvas><div id="overlay"></div>';
  pose = { x: 200, y: 250, theta: 0 };
  hud = [];
  messages = new Map();
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

function key(key: string, down: boolean): void {
  window.dispatchEvent(new browser.KeyboardEvent(down ? "keydown" : "keyup", { key }));
}

function frames(count: number): void {
  for (let frame = 0; frame < count; frame++) stage!.update(1 / 60);
}

function start(twoPlayers = true, readyFrames = 60): void {
  const noop = () => {};
  stage = makeSoccer();
  stage.init({
    canvas: document.querySelector("canvas")!,
    ctx: {} as CanvasRenderingContext2D,
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: noop,
    setHud: (lines) => (hud = lines),
    showClear: noop,
    awardStars: noop,
    setTimeout: noop,
    shake: noop,
    crash: noop,
    publish: (topic, message) => messages.set(topic, message),
    getBestTime: () => undefined,
    sfx: new Proxy({} as GameContext["sfx"], { get: () => noop }),
    ghost: {
      startRecording: noop,
      recordPose: (_t, x, y, theta) => (pose = { x, y, theta }),
      getPose: () => undefined,
      hasReplay: () => false,
      draw: noop,
    },
  });
  if (twoPlayers) {
    key("2", true);
    frames(1);
    key("2", false);
  }
  frames(readyFrames);
}

function ball(): { x: number; y: number; vx: number; vy: number } {
  const message = messages.get("/ball/pose");
  assert.ok(message, "The real stage must publish ball telemetry");
  return Object.fromEntries(
    [...message.matchAll(/(x|y|vx|vy)=(-?[\d.]+)/g)].map(([, name, value]) => [
      name,
      Number(value),
    ]),
  ) as { x: number; y: number; vx: number; vy: number };
}

function kickState(): string {
  return hud.find((line) => line.startsWith("kick P1:")) ?? "";
}

function moveToBall(): void {
  key("d", true);
  for (let frame = 0; frame < 65 && pose.x < 380; frame++) frames(1);
  key("d", false);
  frames(7);
  assert.ok(pose.x >= 380 && pose.x < 385, "Approach the ball using actual movement input");
}

test("single-player arrow keys move the actual robot in screen directions", () => {
  start(false);
  key("ArrowUp", true);
  frames(12);
  key("ArrowUp", false);
  assert.ok(pose.y < 210);
  assert.ok(Math.abs(pose.x - 200) < 0.001);
  frames(7);
  assert.match(messages.get("/cmd_vel")!, /linear\.x:\s+0\.00/);
});

test("two-player arrow movement belongs only to P2", () => {
  start();
  key("ArrowRight", true);
  frames(12);
  key("ArrowRight", false);
  assert.ok(Math.abs(pose.x - 200) < 0.001);
  assert.ok(Math.abs(pose.y - 250) < 0.001);
  assert.match(messages.get("/cmd_vel")!, /linear\.x:\s+0\.00/);
  assert.match(messages.get("/p2/cmd_vel")!, /linear\.x:\s+1\.00/);
});

test("holding kick more than the old buffer window still shoots on a later approach", () => {
  start(true, 0);
  key("e", true);
  // Hold through kickoff, then approach before either AI midfielder reaches
  // the loose ball. AI teammates now retrieve and pass it if we wait idle.
  frames(62);
  assert.match(kickState(), /armed/);
  key("d", true);
  for (let frame = 0; frame < 65 && !kickState().includes("cooldown"); frame++) frames(1);
  key("d", false);
  key("e", false);
  assert.match(kickState(), /cooldown/);
  frames(7);
  assert.ok(ball().vx > 400, "The held request must produce a real shot");
});

test("the ball stays at the feet after releasing movement, then leaves when kicked", () => {
  start();
  // Slow the AI midfielders so this checks possession rather than a tackle.
  const easy = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Easy",
  );
  assert.ok(easy);
  easy.click();
  moveToBall();
  const stopped = { ...pose };
  const heldBall = ball();
  assert.ok(Math.hypot(heldBall.x - pose.x, heldBall.y - pose.y) < 34);
  assert.equal(Math.hypot(heldBall.vx, heldBall.vy), 0);
  frames(4);
  assert.deepEqual(pose, stopped);
  assert.ok(Math.hypot(ball().x - pose.x, ball().y - pose.y) < 34);
  assert.equal(Math.hypot(ball().vx, ball().vy), 0);
  key(" ", true);
  frames(1);
  key(" ", false);
  assert.match(kickState(), /cooldown/);
  frames(4);
  const shotLine = hud.find((line) => line.startsWith("ball:"))!;
  const shot = Object.fromEntries(
    [...shotLine.matchAll(/(x|y|v)=(-?[\d.]+)/g)].map(([, name, value]) => [name, Number(value)]),
  );
  assert.ok(shot.v > 400, shotLine);
  assert.ok(shot.x - pose.x > 55, "Shot release must not be immediately trapped again");
});

test("terminal focus clears a buffered shot before the player reaches the ball", () => {
  start();
  key("d", true);
  frames(38);
  key("d", false);
  key("e", true);
  frames(1);
  key("e", false);
  assert.match(kickState(), /armed/);
  const terminal = document.createElement("section");
  terminal.id = "ros-terminal";
  terminal.innerHTML = "<input>";
  document.body.append(terminal);
  const input = terminal.querySelector("input")!;
  input.focus();
  frames(1);
  assert.match(kickState(), /ready/);
  input.blur();
  key("d", true);
  frames(10);
  key("d", false);
  frames(7);
  assert.doesNotMatch(kickState(), /cooldown|armed/);
  assert.ok(Math.hypot(ball().x - pose.x, ball().y - pose.y) < 34);
  assert.equal(Math.hypot(ball().vx, ball().vy), 0);
});
