// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let makeSoccer: () => Stage;
let stage: Stage | undefined;
let hud: string[];
let passes: string[];
let finished: boolean;
let goals: string[];
let robots: Map<string, { x: number; y: number }>;
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
  hud = [];
  passes = [];
  finished = false;
  goals = [];
  robots = new Map();
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

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const state: Record<PropertyKey, unknown> = { canvas };
  const stack: Array<Record<PropertyKey, unknown>> = [];
  let ring = { x: 0, y: 0 };
  return new Proxy(state, {
    get(target, property) {
      if (property in target) return target[property];
      if (property === "save") return () => stack.push({ ...state });
      if (property === "restore") return () => Object.assign(state, stack.pop());
      if (property === "measureText") return (text: string) => ({ width: text.length * 6 });
      if (String(property).endsWith("Gradient")) return () => ({ addColorStop() {} });
      if (property === "arc")
        return (x: number, y: number, radius: number) => {
          if (radius === 13) ring = { x, y };
        };
      if (property === "fillText")
        return (text: string) => {
          if (/^(YOU|P[23]|O[123])$/.test(text)) robots.set(text, { ...ring });
        };
      return () => {};
    },
  }) as unknown as CanvasRenderingContext2D;
}

function start(twoPlayers = false): void {
  const noop = () => {};
  stage = makeSoccer();
  stage.init({
    canvas: document.querySelector("canvas")!,
    ctx: canvasContext(document.querySelector("canvas")!),
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: noop,
    setHud: (lines) => (hud = lines),
    showClear: () => (finished = true),
    awardStars: noop,
    setTimeout: (callback) => callback(),
    shake: noop,
    crash: () => (finished = true),
    publish: (topic, message) => {
      if (topic === "/soccer/pass") passes.push(message);
      if (topic === "/goal/scored") goals.push(message);
    },
    getBestTime: () => undefined,
    sfx: new Proxy({} as GameContext["sfx"], { get: () => noop }),
    ghost: {
      startRecording: noop,
      recordPose: noop,
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
  frames(60);
}

function ball(): { x: number; y: number; v: number } {
  const line = hud.find((entry) => entry.startsWith("ball:"));
  assert.ok(line, "The real stage reports the current ball every frame");
  return Object.fromEntries(
    [...line.matchAll(/(x|y|v)=(-?[\d.]+)/g)].map(([, name, value]) => [name, Number(value)]),
  ) as { x: number; y: number; v: number };
}

function waitForPass(team?: "P" | "O"): string {
  let examined = passes.length;
  for (let frame = 0; frame < 60 * 90; frame++) {
    frames(1);
    const next = passes
      .slice(examined)
      .find((message) => !team || message.startsWith(`team:${team} `));
    examined = passes.length;
    if (next) return next;
    if (finished) {
      stage!.reset();
      finished = false;
    }
  }
  assert.fail(`Expected a real ${team ?? "AI"} pass; observed ${JSON.stringify(passes)}`);
}

test("both AI teams execute teammate passes in the real match", () => {
  start();
  const opponentPass = waitForPass("O");
  assert.match(opponentPass, /^team:O from:O[123] to:O[123]$/);
  const friendlyPass = waitForPass("P");
  assert.match(friendlyPass, /^team:P from:P[23] to:(YOU|P[23])$/);
  assert.ok(stage!.ros2!.state!.topics.some((topic) => topic.name === "/soccer/pass"));
});

test("a pass is real ball motion and reset clears its receiver marker", () => {
  start();
  waitForPass();
  assert.doesNotMatch(
    hud.find((line) => line.startsWith("pass:"))!,
    /none/,
  );
  const released = ball();
  assert.ok(
    released.v >= 200 && released.v <= 440,
    `Pass speed should be controllable: ${released.v}`,
  );
  frames(3);
  const moving = ball();
  assert.ok(Math.hypot(moving.x - released.x, moving.y - released.y) > 8);
  stage!.reset();
  frames(60);
  assert.match(
    hud.find((line) => line.startsWith("pass:"))!,
    /none/,
  );
});

test("intended AI receivers collect passes and keep the ball under control", () => {
  start();
  const completed = new Set<string>();
  for (let attempt = 0; attempt < 16 && completed.size < 2; attempt++) {
    const pass = waitForPass();
    const [, team, receiver] = /^team:([PO]) from:\S+ to:(\S+)$/.exec(pass)!;
    if (receiver === "YOU") continue;
    for (let frame = 0; frame < 120; frame++) {
      frames(1);
      if (!hud.find((line) => line.startsWith("pass:"))?.includes("none")) continue;
      stage!.draw();
      const recipient = robots.get(receiver)!;
      const received = ball();
      if (Math.hypot(received.x - recipient.x, received.y - recipient.y) > 34) break;
      frames(6);
      stage!.draw();
      const controlled = ball();
      const movedRecipient = robots.get(receiver)!;
      if (
        Math.hypot(controlled.x - movedRecipient.x, controlled.y - movedRecipient.y) <= 34 &&
        controlled.v <= 220
      )
        completed.add(team);
      break;
    }
  }
  assert.deepEqual([...completed].sort(), ["O", "P"]);
});

test("AI teamwork still produces goals rather than endless passing", () => {
  start();
  frames(60 * 60);
  assert.ok(goals.length > 0, `No goals after one minute; passes=${passes.length}`);
});

test("local two-player mode leaves passing decisions to each side's AI teammates", () => {
  start(true);
  frames(60 * 45);
  assert.ok(passes.length > 0);
  assert.ok(passes.includes("team:O from:O2 to:P2"), "AI can pass to human player two");
  for (const pass of passes) {
    if (pass.startsWith("team:P ")) assert.match(pass, /^team:P from:P[23] to:(YOU|P[23])$/);
    else assert.match(pass, /^team:O from:O[23] to:(P2|O[23])$/);
  }
});
