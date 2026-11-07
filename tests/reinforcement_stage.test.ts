// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// DOM lifecycle tests, not browser layout or visual verification. Vite loads the
// actual stage and CSS imports; Happy DOM supplies events and HTML interfaces.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let makeStage: () => Stage;
let setLang: (lang: "ja" | "en") => void;
let stage: Stage;
let awardCalls: Array<{ stars: number; message: string }>;
let statuses: string[];
let canvasText: string[];
let scrolls = 0;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "Event",
    "MouseEvent",
    "FocusEvent",
    "KeyboardEvent",
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
  const module = await server.ssrLoadModule("/src/stages/lesson/reinforcement_learning.ts");
  makeStage = module.makeReinforcementLearning;
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
  browser.HTMLElement.prototype.scrollIntoView = () => {
    scrolls++;
  };
});

beforeEach(() => {
  document.body.innerHTML =
    '<div id="scene"><canvas id="game" width="800" height="500"></canvas><div id="clear-overlay"></div></div><div id="overlay"></div><div id="stage-controls-dock" hidden></div>';
  setLang("en");
  awardCalls = [];
  statuses = [];
  canvasText = [];
  scrolls = 0;
  // Canvas drawing is a smoke test only; no pixel or layout assertions are made.
  const canvasContext = new Proxy(
    { fillText: (value: string) => canvasText.push(value) },
    {
      get(target, key) {
        return Reflect.get(target, key) ?? (() => {});
      },
      set(target, key, value) {
        return Reflect.set(target, key, value);
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  const noop = () => {};
  const context = {
    canvas: document.getElementById("game") as HTMLCanvasElement,
    ctx: canvasContext,
    keys: new Set<string>(),
    overlay: document.getElementById("overlay")!,
    setStatus: (text: string) => statuses.push(text),
    setHud: noop,
    showClear: noop,
    awardStars: (stars: number, message: string) => awardCalls.push({ stars, message }),
    setTimeout: noop,
    shake: noop,
    crash: noop,
    publish: noop,
    sfx: {},
    ghost: {},
    getBestTime: () => undefined,
  } as unknown as GameContext;
  stage = makeStage();
  stage.init(context);
  stage.draw();
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

const panel = () => document.querySelector<HTMLElement>(".reinforcement-lab")!;
const element = <T extends HTMLElement = HTMLElement>(name: string): T =>
  panel().querySelector<T>(`[data-rl="${name}"]`)!;
const button = (action: string) =>
  panel().querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;
const visible = (node: HTMLElement) => !node.closest("[hidden]");
function click(action: string): void {
  const target = button(action);
  assert.ok(target, `Missing action ${action}`);
  assert.equal(visible(target), true, `Action ${action} must be visible`);
  assert.equal(target.disabled, false, `Action ${action} must be enabled`);
  target.click();
}
function frames(count: number): void {
  for (let i = 0; i < count; i++) stage.update(0.1);
  stage.draw();
}
function until(predicate: () => boolean, maxFrames = 600): void {
  for (let i = 0; i < maxFrames && !predicate(); i++) stage.update(0.1);
  stage.draw();
  assert.ok(predicate(), "Stage did not reach the expected state within the frame budget");
}
function train(): void {
  click("train");
  until(() => visible(button("compare")), 21);
  assert.match(element("learning-summary").textContent!, /600/);
}
function compare(): void {
  click("compare");
  // Full evaluation is synchronous; only the short optional preview is animated.
  assert.equal(visible(element("results")), true);
  assert.equal(visible(element("live-comparison")), true);
  assert.match(element("run-details").textContent!, /1:.*2:.*3:/);
  assert.equal(element("cards").querySelectorAll(".rl-result-card").length, 2);
  click("show-results");
  assert.equal(visible(button("show-results")), false);
  stage.draw();
}
function completedExperiment(): void {
  train();
  compare();
}

test("600 trials finish within 2.1 simulated seconds and all three results appear immediately", () => {
  assert.equal(visible(button("train")), true);
  assert.equal(visible(button("compare")), false);
  assert.equal(visible(button("finish")), false);
  completedExperiment();
  const cards = Array.from(element("cards").querySelectorAll(".rl-result-card"));
  assert.equal(cards.length, 2);
  assert.match(cards[0].textContent!, /Goals reached 0\/3/);
  assert.match(cards[1].textContent!, /Goals reached 3\/3/);
  assert.match(element("run-details").textContent!, /1:.*2:.*3:/);
  assert.ok(canvasText.includes("Same start 1 / 3"));
  assert.equal(visible(element("live-comparison")), true);
  assert.equal(visible(element("details")), false);
  click("details");
  click("always");
  assert.match(element("reflection").textContent!, /Not always/);
  click("finish");
  assert.equal(awardCalls.length, 1);
  assert.equal(awardCalls[0].stars, 3);
  frames(10);
  button("finish").click();
  assert.equal(awardCalls.length, 1);
});

test("the default preview ends after a short first-start excerpt without playing the other starts", () => {
  train();
  click("compare");
  const results = element("cards").textContent;
  assert.equal(visible(element("results")), true);
  assert.equal(visible(button("show-results")), true);
  assert.match(element("live-comparison").textContent!, /first 16 moves of start 1/);
  until(() => !visible(button("show-results")), 35);
  assert.equal(visible(button("pause")), false);
  assert.match(element("live-comparison").textContent!, /Before: 16 moves \/ Rest omitted/);
  assert.match(element("live-comparison").textContent!, /After training: 8 moves \/ Goal reached/);
  canvasText = [];
  frames(100);
  assert.ok(canvasText.includes("Same start 1 / 3"));
  assert.equal(element("cards").textContent, results);
});

test("skip ends playback immediately and optional controls replay any chosen starting position", () => {
  train();
  click("compare");
  const records = element("run-details").textContent;
  frames(2);
  click("show-results");
  assert.equal(visible(button("show-results")), false);
  assert.equal(visible(element("results")), true);
  click("details");
  click("case-2");
  assert.equal(visible(button("show-results")), true);
  assert.match(element("live-comparison").textContent!, /moves of start 3/);
  canvasText = [];
  stage.draw();
  assert.ok(canvasText.includes("Same start 3 / 3"));
  click("case-1");
  assert.match(element("live-comparison").textContent!, /moves of start 2/);
  click("show-results");
  click("replay");
  assert.match(element("live-comparison").textContent!, /moves of start 2/);
  until(() => !visible(button("show-results")), 35);
  click("case-0");
  assert.match(element("live-comparison").textContent!, /moves of start 1/);
  click("show-results");
  assert.equal(element("run-details").textContent, records);
  assert.match(element("learning-summary").textContent!, /600/);
});

test("lesson completion is available while the optional preview is still playing", () => {
  train();
  click("compare");
  assert.equal(visible(button("show-results")), true);
  click("finish");
  assert.equal(awardCalls.length, 1);
  assert.equal(awardCalls[0].stars, 3);
  assert.equal(visible(button("show-results")), false);
});

test("changing rewards and retraining remove stale comparison details and compare the learned models", () => {
  completedExperiment();
  click("details");
  assert.ok(element("run-details").textContent);
  click("change");
  assert.equal(visible(element("results")), false);
  assert.equal(visible(element("run-details")), false);
  assert.equal(button("bonus").getAttribute("aria-pressed"), "true");
  click("train");
  assert.equal(element("run-details").textContent, "");
  assert.equal(element("cards").textContent, "");
  frames(4);
  assert.equal(element("run-details").textContent, "");
  until(() => visible(button("compare")));
  assert.equal(element("run-details").textContent, "");
  compare();
  const cards = element("cards").querySelectorAll(".rl-result-card");
  assert.match(cards[0].textContent!, /Previous.*Goals reached 3\/3.*Goal reward/);
  assert.match(cards[1].textContent!, /Current.*Goals reached 0\/3.*Bonus reward/);
  assert.match(element("score-note").textContent!, /scores cannot be directly ranked/);
  assert.match(element("result-note").textContent!, /back and forth to the star/);
  click("finish");
  assert.equal(
    awardCalls.length,
    1,
    "Failure to reach the goal must not prevent lesson completion",
  );
});

test("stopping a fresh training run retains the last completed model", () => {
  completedExperiment();
  click("change");
  click("train");
  frames(5);
  assert.ok(element<HTMLProgressElement>("progress").value > 0);
  click("stop");
  assert.match(element("status").textContent!, /last completed model is retained/);
  assert.match(element("learning-summary").textContent!, /600/);
  assert.equal(visible(element("settings")), true);
  click("cancel-change");
  assert.equal(button("goal").getAttribute("aria-pressed"), "true");
  click("details");
  click("replay");
  click("show-results");
  assert.match(element("cards").textContent!, /Before.*After training/);
  assert.match(element("cards").textContent!, /Goals reached 3\/3/);
});

test("reset and undo restore the completed comparison, reflection, details, and canvas trial", () => {
  completedExperiment();
  click("details");
  click("case-2");
  click("show-results");
  click("depends");
  const cards = element("cards").textContent;
  const records = element("run-details").textContent;
  const reflection = element("reflection").textContent;
  click("reset");
  assert.equal(visible(element("results")), false);
  assert.equal(visible(element("learning")), false);
  assert.equal(element("run-details").textContent, "");
  assert.equal(visible(button("undo")), true);
  click("undo");
  assert.equal(visible(element("results")), true);
  assert.equal(visible(element("details")), true);
  assert.equal(element("cards").textContent, cards);
  assert.equal(element("run-details").textContent, records);
  assert.equal(element("reflection").textContent, reflection);
  canvasText = [];
  stage.draw();
  assert.ok(canvasText.includes("Same start 3 / 3"));
  assert.equal(visible(button("undo")), false);
});

test("blur pauses training, language rebuild preserves progress, and resume continues", () => {
  click("train");
  frames(5);
  assert.ok(element<HTMLProgressElement>("progress").value > 0);
  window.dispatchEvent(new Event("blur"));
  // The blur refresh also flushes the throttled progress UI to the current trial.
  const count = element<HTMLProgressElement>("progress").value;
  assert.ok(count < 600);
  assert.match(element("status").textContent!, /Paused/);
  frames(10);
  assert.equal(element<HTMLProgressElement>("progress").value, count);
  setLang("ja");
  assert.match(element("status").textContent!, /一時停止中/);
  assert.equal(element<HTMLProgressElement>("progress").value, count);
  assert.equal(document.querySelectorAll(".reinforcement-lab").length, 1);
  click("pause");
  frames(5);
  assert.ok(element<HTMLProgressElement>("progress").value > count);
  click("stop");
  assert.match(element("status").textContent!, /中止しました/);
  setLang("en");
  assert.match(element("status").textContent!, /Stopped/);
});

test("reset during playback restores the already-computed results without restarting the preview", () => {
  train();
  click("compare");
  const records = element("run-details").textContent;
  assert.equal(visible(element("results")), true);
  frames(10);
  stage.reset();
  click("undo");
  assert.equal(visible(element("results")), true);
  assert.equal(element("run-details").textContent, records);
  assert.equal(visible(button("show-results")), false);
  assert.equal(visible(button("compare")), false);
  assert.equal(visible(button("finish")), true);
});

test("dispose removes the panel and unregisters language and blur reactions", () => {
  click("train");
  frames(3);
  stage.dispose();
  const count = statuses.length;
  assert.equal(document.querySelector(".reinforcement-lab"), null);
  assert.equal(document.getElementById("stage-controls-dock")!.hidden, true);
  window.dispatchEvent(new Event("blur"));
  setLang("ja");
  assert.equal(statuses.length, count);
  assert.equal(document.querySelector(".reinforcement-lab"), null);
});

test("completion preserves review and reset controls while preventing duplicate awards", () => {
  completedExperiment();
  const records = element("cards").textContent;
  click("finish");
  assert.equal(panel().inert, true);
  const completion = document.getElementById("clear-overlay")!;
  assert.ok(completion.parentElement === document.body);
  completion.dispatchEvent(
    new window.CustomEvent("clear-overlay-close", { detail: { reason: "dismiss" } }),
  );
  assert.equal(panel().inert, false);
  assert.equal(visible(button("finish")), false);
  assert.ok(document.activeElement === button("reset"));
  click("details");
  assert.equal(visible(element("details")), true);
  assert.equal(element("cards").textContent, records);
  button("finish").click();
  assert.equal(awardCalls.length, 1);
  click("reset");
  assert.equal(visible(button("train")), true);
  assert.equal(visible(element("results")), false);
  assert.equal(awardCalls.length, 1);
});

test("required before-after comparison stays in place and layout is restored on exit", () => {
  const scene = document.getElementById("scene")!;
  const completion = document.getElementById("clear-overlay")!;
  const dock = document.getElementById("stage-controls-dock")!;
  completedExperiment();
  assert.equal(scrolls, 0);
  assert.match(element("results").textContent!, /core lesson is complete.*Optional/);
  assert.ok(document.activeElement === button("finish"));
  assert.equal(scene.parentElement, dock.parentElement);
  setLang("ja");
  assert.equal(scene.parentElement, dock.parentElement);
  stage.dispose();
  assert.equal(scene.parentElement, document.body);
  assert.equal(dock.parentElement, document.body);
  assert.equal(completion.parentElement, scene);
  assert.equal(document.querySelector(".lab-workbench"), null);
});
