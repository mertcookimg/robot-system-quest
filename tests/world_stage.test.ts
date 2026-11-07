// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Real-stage DOM and canvas-command regressions through Vite SSR. These do not
// verify browser layout or physical keyboard/gamepad devices.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";
import {
  WORLD_INITIAL,
  WORLD_VIEW_MIN,
  WORLD_VIEW_MAX,
  predictWorldTrajectory,
  simulateWorldTrajectory,
  evaluateWorldAction,
  type WorldAction,
} from "../src/lib/world_model";

let browser: Window;
let server: ViteDevServer;
let makeStage: () => Stage;
let setLang: (lang: "ja" | "en") => void;
let stage: Stage;
let context: GameContext;
let originalBodyNodes: Node[];
let awards: Array<{ stars: number; message: string }>;
let statuses: string[];
let published: string[];
let rectangles: Array<{ x: number; y: number; width: number; height: number; fill: string }>;
let labels: string[];
let textCommands: Array<{ value: string; x: number; y: number; font: string }>;
let scrolls: Array<{ action?: string; block?: ScrollLogicalPosition }> = [];
let pad: {
  isOverlayPadAvailable(): boolean;
  isOverlayPadActive(): boolean;
  activateOverlayPad(): void;
};
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
  Object.defineProperty(browser.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: function (this: HTMLElement, options?: ScrollIntoViewOptions | boolean) {
      scrolls.push({
        action: this.dataset.action,
        block: typeof options === "object" ? options.block : undefined,
      });
    },
  });
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  makeStage = (await server.ssrLoadModule("/src/stages/lesson/world_model.ts")).makeWorldModel;
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
  pad = (await server.ssrLoadModule("/src/lib/overlaypad.ts")) as typeof pad;
});

beforeEach(() => {
  document.body.innerHTML =
    '<div id="canvas-wrap" class="canvas-wrap"><canvas id="game" width="800" height="500"></canvas><div id="clear-overlay"></div></div><div id="overlay"></div><div id="stage-controls-dock" hidden></div>';
  originalBodyNodes = [...document.body.childNodes];
  setLang("en");
  awards = [];
  statuses = [];
  published = [];
  rectangles = [];
  labels = [];
  textCommands = [];
  scrolls = [];
  const state = {
    fillStyle: "",
    font: "",
    fillRect(x: number, y: number, width: number, height: number) {
      rectangles.push({ x, y, width, height, fill: state.fillStyle });
    },
    fillText(value: string, x: number, y: number) {
      labels.push(value);
      textCommands.push({ value, x, y, font: state.font });
    },
  };
  const canvasContext = new Proxy(state, {
    get(target, key) {
      return Reflect.get(target, key) ?? (() => {});
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  }) as unknown as CanvasRenderingContext2D;
  const noop = () => {};
  context = {
    canvas: document.getElementById("game") as HTMLCanvasElement,
    ctx: canvasContext,
    keys: new Set<string>(),
    overlay: document.getElementById("overlay")!,
    setStatus: (value: string) => statuses.push(value),
    setHud: noop,
    showClear: noop,
    awardStars: (stars: number, message: string) => awards.push({ stars, message }),
    setTimeout: noop,
    shake: noop,
    crash: noop,
    publish: (topic: string, message: string) => {
      if (topic === "/world_model/trial") published.push(message);
    },
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

const panel = () => document.querySelector<HTMLElement>(".world-lab")!;
const element = <T extends HTMLElement = HTMLElement>(name: string): T =>
  panel().querySelector<T>(`[data-world="${name}"]`)!;
const button = (action: string) =>
  panel().querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!;
const primary = () => button("continue");
const intent = () => primary().dataset.intent;
const visible = (node: HTMLElement) => !node.closest("[hidden]");
function click(action: string): void {
  const target = button(action);
  assert.ok(target, `Missing action ${action}`);
  assert.equal(visible(target), true, `Action ${action} must be visible`);
  assert.equal(target.disabled, false, `Action ${action} must be enabled`);
  target.click();
}
function focusedClick(action: string): void {
  button(action).focus({ preventScroll: true });
  assert.ok(document.activeElement === button(action), "The initiating control must have focus");
  click(action);
}
function advance(expected: string): void {
  assert.equal(intent(), expected);
  click("continue");
}
function openDetails(): void {
  if (!visible(element("details"))) click("details");
}
function optional(action: string): void {
  openDetails();
  click(action);
}
function draw(): { prediction: number | undefined; actual: number } {
  rectangles = [];
  labels = [];
  textCommands = [];
  stage.draw();
  const ghost = rectangles.find(
    (r) => r.width === 40 && r.height === 40 && r.fill === "rgba(125,211,252,.18)",
  );
  const box = rectangles.find((r) => r.width === 40 && r.height === 40 && r.fill === "#e9a54b")!;
  assert.ok(box, "The actual box must remain visible before and after predicting");
  return { prediction: ghost ? ghost.x + 20 : undefined, actual: box.x + 20 };
}

type Experiment = "near" | "far" | "moving";
const experiments: readonly Experiment[] = ["near", "far", "moving"];
const targetX: Record<Experiment, number> = { near: 0.72, far: 1.3, moving: 1.3 };
const initialFor = (experiment: Experiment) => ({
  ...WORLD_INITIAL,
  velocity: experiment === "moving" ? 1.2 : 0,
});
const currentExperiment = (): Experiment => {
  const selected = experiments.filter(
    (experiment) => button("experiment-" + experiment).getAttribute("aria-pressed") === "true",
  );
  assert.equal(selected.length, 1, "Exactly one initial-condition preset must be selected");
  return selected[0];
};
function selectExperiment(experiment: Experiment): void {
  optional("experiment-" + experiment);
  assert.equal(currentExperiment(), experiment);
}
const actions: readonly WorldAction[] = ["none", "weak", "strong"];
const screenX = (x: number) =>
  70 + ((x - WORLD_VIEW_MIN) / (WORLD_VIEW_MAX - WORLD_VIEW_MIN)) * 660;
function close(actual: number | undefined, expected: number): void {
  assert.ok(
    typeof actual === "number" && Math.abs(actual - expected) < 1e-8,
    String(actual) + " differs from " + expected,
  );
}
const metersText = (meters: number) =>
  meters > 0 && meters < 0.001 ? "less than 0.001 m" : meters.toFixed(3) + " m";
function assertMovement(text: string, x: number): void {
  assert.equal(text, metersText(Math.abs(x - WORLD_INITIAL.x)).replace("less than", "<"));
}
function candidate(action: WorldAction): HTMLElement {
  return element("candidates").querySelector<HTMLElement>('[data-candidate="' + action + '"]')!;
}
function forecasts(): string[] {
  return actions.map((action) => candidate(action).querySelector("[data-forecast]")!.textContent!);
}
function assertCandidates(experiment: Experiment): void {
  assert.equal(element("candidates").querySelectorAll("[data-candidate]").length, 3);
  for (const action of actions) {
    assertMovement(
      candidate(action).querySelector("[data-forecast]")!.textContent!,
      predictWorldTrajectory(action, initialFor(experiment)).finalX,
    );
  }
}
function assertUnchecked(): void {
  for (const action of actions) {
    const text = candidate(action).querySelector("[data-actual]")!.textContent!;
    assert.doesNotMatch(text, /[0-9]/, "Unexecuted actions must not display simulator values");
    if (intent() === "pause" && candidate(action).dataset.selected === "true")
      assert.match(text, /checking|確認中/i);
    else assert.match(text, /unchecked|not checked|未確認/i);
  }
}
function assertActual(action: WorldAction, experiment: Experiment): void {
  for (const choice of actions) {
    const text = candidate(choice).querySelector("[data-actual]")!.textContent!;
    if (choice === action)
      assertMovement(text, simulateWorldTrajectory(action, initialFor(experiment)).finalX);
    else assert.match(text, /unchecked|not checked|未確認/i);
  }
}
function assertSelected(action?: WorldAction): void {
  for (const choice of actions) {
    assert.equal(candidate(choice).dataset.selected, String(choice === action));
  }
  if (action)
    close(
      draw().prediction,
      screenX(predictWorldTrajectory(action, initialFor(currentExperiment())).finalX),
    );
  else assert.equal(draw().prediction, undefined);
}
function plan(action: WorldAction): void {
  advance("plan");
  assertSelected(action);
  assertCandidates(currentExperiment());
  assert.match(element("selection").textContent!, /suggested|suggestion/i);
  assert.ok(element("selection").textContent!.includes(button(action).textContent!));
}
function manual(action: WorldAction): void {
  optional(action);
  assertSelected(action);
  assert.match(element("selection").textContent!, /your choice|you chose/i);
  assert.ok(element("selection").textContent!.includes(button(action).textContent!));
  assert.equal(document.activeElement, primary());
}
function frames(count: number): void {
  for (let i = 0; i < count; i++) stage.update(0.1);
  draw();
}
function completeRun(): void {
  for (let i = 0; i < 21 && intent() === "pause"; i++) stage.update(0.1);
  assert.ok(["next", "finish"].includes(intent()!), "Playback must finish after two seconds");
  draw();
}
function run(): void {
  advance("run");
  completeRun();
}
function record(experiment: Experiment): HTMLElement {
  return element("records").querySelector<HTMLElement>('[data-experiment="' + experiment + '"]')!;
}
function assertRecord(experiment: Experiment, action: WorldAction): void {
  const expected = evaluateWorldAction(action, initialFor(experiment));
  const item = record(experiment);
  assert.ok(item, "Missing completed " + experiment + " result");
  assert.equal(item.dataset.choice, action);
  for (const kind of ["prediction", "actual"] as const) {
    assertMovement(
      item.querySelector('[data-result="' + kind + '"] strong')!.textContent!,
      expected[kind].finalX,
    );
  }
  assert.equal(item.querySelector(".world-error strong")!.textContent, metersText(expected.error));
  assert.equal(
    item.querySelector(".world-target-error")!.textContent!.split(": ").at(-1),
    metersText(Math.abs(expected.actual.finalX - targetX[experiment])),
  );
}
function mainText(): string {
  const copy = panel().cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[hidden]").forEach((node) => node.remove());
  copy.querySelector('[data-world="details"]')?.remove();
  return copy.textContent!;
}

test("a beginner sees one experiment, one main action and a permanent empty comparison table", () => {
  assert.equal(element("status").getAttribute("aria-live"), "polite");
  assert.equal(currentExperiment(), "near");
  assert.equal(intent(), "plan");
  assert.equal(panel().querySelector(".world-workflow"), null);
  assert.equal(visible(element("candidates")), true);
  assert.equal(element("candidates").querySelectorAll('th[scope="col"]').length, 3);
  assert.ok(forecasts().every((value) => /^[—–-]$/.test(value.trim())));
  assertUnchecked();
  assertSelected();
  assert.doesNotMatch(mainText(), /world model|planner|latent|MPC/i);
  assert.equal(visible(element("insight")), false);
  assert.equal(visible(element("forecast-comparison")), false);
  assert.equal(visible(element("details")), false);
  for (const key of [
    "retry",
    "review",
    "reset",
    "stop",
    "skip",
    ...actions,
    ...experiments.map((experiment) => "experiment-" + experiment),
  ]) {
    assert.ok(element("details").contains(button(key)), key + " must remain optional");
    assert.equal(visible(button(key)), false);
  }
  const initial = forecasts();
  frames(30);
  assert.deepEqual(forecasts(), initial);
  close(draw().actual, screenX(WORLD_INITIAL.x));
  assert.equal(element("records").children.length, 0);
  assert.equal(published.length, 0);
});

test("the same primary button and table stay in place throughout the three trials without auto-scrolling", () => {
  const main = primary();
  const table = element("candidates");
  const rows = actions.map(candidate);
  assert.ok(main.compareDocumentPosition(table) & 4, "The primary action must precede the table");
  function stable(expectedIntent: string): void {
    assert.equal(primary(), main, "Progress must reuse the same focused button");
    assert.equal(intent(), expectedIntent);
    assert.equal(visible(main), true);
    assert.equal(element("candidates"), table);
    assert.equal(visible(table), true);
    assert.deepEqual(actions.map(candidate), rows);
    draw();
    const ghosts = rectangles.filter(
      (rectangle) =>
        rectangle.width === 40 &&
        rectangle.height === 40 &&
        ["rgba(125,211,252,.18)", "rgba(125,211,252,.07)"].includes(rectangle.fill),
    );
    assert.equal(
      ghosts.length,
      expectedIntent === "plan" ? 0 : 3,
      "Once revealed, all three forecasts must stay visible during execution and comparison",
    );
    assert.deepEqual(
      [...panel().querySelectorAll<HTMLButtonElement>(".world-primary")].filter(visible),
      [main],
    );
    assert.deepEqual(
      scrolls,
      [],
      "Normal progress must not scroll between canvas, controls and results",
    );
  }
  stable("plan");
  for (const [experiment, action] of [
    ["near", "weak"],
    ["far", "strong"],
    ["moving", "weak"],
  ] as const) {
    if (intent() === "next") advance("next");
    stable("plan");
    assert.equal(currentExperiment(), experiment);
    plan(action);
    stable("run");
    const predicted = forecasts();
    advance("run");
    stable("pause");
    frames(4);
    assert.deepEqual(forecasts(), predicted);
    assertUnchecked();
    completeRun();
    stable(experiment === "moving" ? "finish" : "next");
    assert.deepEqual(forecasts(), predicted);
    assertActual(action, experiment);
    assert.equal(document.activeElement, main);
  }
});

test("the learned mechanism is named after the first comparison rather than required before starting", () => {
  plan("weak");
  run();
  assert.equal(visible(element("insight")), true);
  assert.match(mainText(), /world model/i);
  assert.match(mainText(), /learn|record|motion/i);
  assert.match(mainText(), /predict|forecast/i);
  assertActual("weak", "near");
  assertRecord("near", "weak");
  assert.equal(published.length, 1);
});

test("changing only the goal preserves every forecast but changes the suggested push", () => {
  plan("weak");
  const initial = forecasts();
  assert.equal(published.length, 0);
  selectExperiment("far");
  assertSelected();
  assertUnchecked();
  close(draw().actual, screenX(WORLD_INITIAL.x));
  plan("strong");
  assert.deepEqual(forecasts(), initial);
  selectExperiment("near");
  plan("weak");
  assert.deepEqual(forecasts(), initial);
  assert.equal(published.length, 0);
});

test("changing initial velocity changes the forecasts for the same far target and restores them on return", () => {
  selectExperiment("far");
  plan("strong");
  const resting = forecasts();
  selectExperiment("moving");
  assertSelected();
  assertUnchecked();
  plan("weak");
  const moving = forecasts();
  assert.equal(visible(element("conditions")), true);
  assert.match(element("conditions").textContent!, /mov|right/i);
  for (let i = 0; i < actions.length; i++) assert.notEqual(moving[i], resting[i]);
  close(draw().actual, screenX(WORLD_INITIAL.x));
  selectExperiment("far");
  plan("strong");
  assert.deepEqual(forecasts(), resting);
  selectExperiment("moving");
  plan("weak");
  assert.deepEqual(forecasts(), moving);
  assert.equal(published.length, 0);
});

test("same-action comparisons use saved forecasts and never execute an extra candidate", () => {
  const weakMovement = (experiment: Experiment) =>
    metersText(predictWorldTrajectory("weak", initialFor(experiment)).finalX - WORLD_INITIAL.x);
  function comparison(name: string, from: Experiment, to: Experiment): void {
    const node = element(name);
    if (name === "forecast-comparison") assert.equal(visible(node), true);
    assert.deepEqual(node.textContent!.match(/\d+\.\d{3} m/g), [
      weakMovement(from),
      weakMovement(to),
    ]);
    assert.match(node.textContent!, /predict|forecast|予想|予測/i);
  }
  for (const [experiment, action] of [
    ["far", "strong"],
    ["moving", "weak"],
  ] as const) {
    selectExperiment(experiment);
    plan(action);
    assert.equal(visible(element("forecast-comparison")), false);
    assert.doesNotMatch(element("forecast-comparison").textContent!, /\d+\.\d{3} m/);
  }
  assert.equal(published.length, 0);
  selectExperiment("near");
  manual("strong");
  run();
  advance("next");
  plan("strong");
  comparison("forecast-comparison", "near", "far");
  assert.equal(published.length, 1);
  run();
  comparison("result-comparison", "near", "far");
  advance("next");
  plan("weak");
  comparison("forecast-comparison", "far", "moving");
  assert.notEqual(weakMovement("far"), weakMovement("moving"));
  setLang("ja");
  comparison("forecast-comparison", "far", "moving");
  setLang("en");
  run();
  comparison("result-comparison", "far", "moving");
  assert.equal(record("near").dataset.choice, "strong");
  setLang("ja");
  comparison("result-comparison", "far", "moving");
  setLang("en");
  selectExperiment("near");
  optional("review");
  comparison("result-comparison", "far", "moving");
  assert.equal(published.length, 3, "Showing or translating comparisons must not execute a trial");
});

test("review restores the moving-state snapshot after an unrecorded resting trial is stopped", () => {
  selectExperiment("moving");
  plan("weak");
  run();
  const savedForecasts = forecasts();
  const savedRecord = record("moving").textContent;
  const savedFrame = draw();
  selectExperiment("far");
  plan("strong");
  advance("run");
  frames(4);
  optional("stop");
  const trials = published.length;
  optional("review");
  assert.equal(currentExperiment(), "moving");
  assertCandidates("moving");
  assert.deepEqual(forecasts(), savedForecasts);
  assert.equal(record("moving").textContent, savedRecord);
  assert.equal(record("far"), null);
  assert.deepEqual(draw(), savedFrame);
  assertActual("weak", "moving");
  assert.equal(published.length, trials);
  advance("next");
  assert.equal(currentExperiment(), "near");
  assertSelected();
});

test("each run uses its chosen forecast and matching initial state for the same two-second endpoint", () => {
  for (const [experiment, action] of [
    ["near", "weak"],
    ["far", "strong"],
    ["moving", "weak"],
  ] as const) {
    if (intent() === "next") advance("next");
    assert.equal(currentExperiment(), experiment);
    plan(action);
    const allForecasts = forecasts();
    const forecastX = draw().prediction!;
    const truth = simulateWorldTrajectory(action, initialFor(experiment));
    advance("run");
    assert.equal(document.activeElement, primary());
    close(draw().actual, screenX(WORLD_INITIAL.x));
    for (const key of [...experiments.map((id) => "experiment-" + id), ...actions])
      assert.equal(button(key).disabled, true);
    frames(7);
    close(draw().actual, screenX(truth.trajectory[14].x));
    close(draw().prediction, forecastX);
    assert.deepEqual(forecasts(), allForecasts);
    assertUnchecked();
    assert.equal(record(experiment), null);
    completeRun();
    close(draw().prediction, forecastX);
    close(draw().actual, screenX(truth.finalX));
    assertRecord(experiment, action);
    assertActual(action, experiment);
    assert.deepEqual(forecasts(), allForecasts);
    assert.ok(published.at(-1)!.includes("source=plan"));
    assert.ok(published.at(-1)!.includes("initial_velocity=" + initialFor(experiment).velocity));
  }
});

test("all three experiments are required, with separate records for stationary and moving far targets", () => {
  plan("weak");
  run();
  assert.equal(intent(), "next");
  const near = record("near").textContent;
  advance("next");
  assert.equal(record("near").textContent, near);
  plan("strong");
  run();
  assert.equal(intent(), "next");
  assert.equal(element("records").children.length, 2);
  assert.equal(awards.length, 0);
  const restingFar = record("far").textContent;
  advance("next");
  plan("weak");
  run();
  assertRecord("moving", "weak");
  assert.equal(record("far").textContent, restingFar);
  assert.equal(record("far").dataset.goal, "far");
  assert.equal(record("moving").dataset.goal, "far");
  assert.equal(element("records").children.length, 3);
  assert.equal(intent(), "finish");
  assert.equal(awards.length, 0);
  advance("finish");
  const completedRecords = element("records").textContent;
  const completedForecasts = forecasts();
  assert.equal(primary().disabled, true, "The lesson must stay frozen while completion is pending");
  assert.equal(panel().inert, true);
  assert.equal(visible(element("details")), false);
  button("details").click();
  button("reset").click();
  assert.equal(visible(element("details")), false);
  assert.equal(element("records").textContent, completedRecords);
  assert.deepEqual(forecasts(), completedForecasts);
  primary().click();
  frames(30);
  assert.equal(primary().disabled, true);
  assert.equal(element("records").textContent, completedRecords);
  assert.equal(awards.length, 1);
  assert.equal(awards[0].stars, 3);
});

test("replaying clears the current actual cells without replacing saved results until completion", () => {
  plan("weak");
  run();
  const saved = record("near").textContent;
  const forecast = draw().prediction!;
  for (let repeat = 0; repeat < 2; repeat++) {
    optional("retry");
    assertUnchecked();
    plan("weak");
    advance("run");
    close(draw().actual, screenX(WORLD_INITIAL.x));
    close(draw().prediction, forecast);
    assertUnchecked();
    assert.equal(record("near").textContent, saved);
    completeRun();
    assert.equal(record("near").textContent, saved);
    assert.equal(element("records").children.length, 1);
  }
  manual("strong");
  assertUnchecked();
  assert.equal(record("near").textContent, saved);
  run();
  assertRecord("near", "strong");
  assertActual("strong", "near");
  assert.ok(published.at(-1)!.includes("source=manual"));
  assert.equal(element("records").children.length, 1);
});

test("manual choice and automatic suggestion are distinguished without changing the forecasts", () => {
  manual("strong");
  const allForecasts = forecasts();
  close(draw().actual, screenX(WORLD_INITIAL.x));
  selectExperiment("near");
  plan("weak");
  assert.deepEqual(forecasts(), allForecasts);
  assert.equal(published.length, 0);
  assert.equal(element("records").children.length, 0);
});

test("optional changes close the expanded controls and return focus to the visible primary action", () => {
  function choose(action: string, expectedIntent: string): void {
    openDetails();
    focusedClick(action);
    assert.equal(visible(element("details")), false, action + " must return to the compact lesson");
    assert.equal(button("details").getAttribute("aria-expanded"), "false");
    assert.ok(document.activeElement === primary(), "Focus must return to the primary action");
    assert.equal(visible(primary()), true);
    assert.equal(intent(), expectedIntent);
  }
  choose("strong", "run");
  assertSelected("strong");
  choose("experiment-far", "plan");
  assert.equal(currentExperiment(), "far");
  plan("strong");
  run();
  const saved = record("far").textContent;
  choose("retry", "plan");
  assert.equal(record("far").textContent, saved);
  choose("review", "next");
  assertActual("strong", "far");
  assert.equal(record("far").textContent, saved);
  choose("reset", "plan");
  assert.equal(currentExperiment(), "near");
  assert.equal(element("records").children.length, 0);
  assert.deepEqual(
    scrolls,
    [],
    "Returning to the primary action must not trigger automatic scrolling",
  );
});

test("stopping or skipping from a focused optional control returns to the compact lesson", () => {
  plan("weak");
  advance("run");
  frames(3);
  openDetails();
  focusedClick("stop");
  assert.equal(intent(), "run");
  assert.equal(visible(element("details")), false);
  assert.ok(document.activeElement === primary(), "Stopping must focus the primary action");
  assert.equal(element("records").children.length, 0);
  advance("run");
  frames(3);
  openDetails();
  focusedClick("skip");
  assert.equal(intent(), "next");
  assert.equal(visible(element("details")), false);
  assert.ok(document.activeElement === primary(), "Skipping must focus the primary action");
  assertRecord("near", "weak");
  assert.deepEqual(scrolls, []);
});

test("automatic playback completion recovers focus only when its active optional control becomes disabled", () => {
  for (const action of ["stop", "skip"] as const) {
    stage.reset();
    plan("weak");
    advance("run");
    openDetails();
    button(action).focus({ preventScroll: true });
    assert.ok(document.activeElement === button(action));
    completeRun();
    assert.equal(button(action).disabled, true);
    assert.ok(
      document.activeElement === primary(),
      "A disabled control must hand focus to the primary action",
    );
    assert.equal(visible(element("details")), false);
    assertRecord("near", "weak");
  }

  stage.reset();
  plan("weak");
  advance("run");
  openDetails();
  button("details").focus({ preventScroll: true });
  completeRun();
  assert.ok(
    document.activeElement === button("details"),
    "Reading optional content must retain focus",
  );
  assert.equal(
    visible(element("details")),
    true,
    "Completion must not interrupt an optional explanation",
  );
  assert.deepEqual(scrolls, []);
});

test("optional skip matches full playback even after a pause", () => {
  plan("weak");
  run();
  const full = record("near").textContent;
  optional("retry");
  plan("weak");
  advance("run");
  frames(3);
  optional("skip");
  assert.equal(record("near").textContent, full);
  assertActual("weak", "near");
  advance("next");
  plan("strong");
  advance("run");
  advance("pause");
  optional("skip");
  assertRecord("far", "strong");
  assertActual("strong", "far");
  assert.equal(intent(), "next");
});

test("manual no-push outcomes count even when the target is missed", () => {
  for (const experiment of experiments) {
    if (intent() === "next") advance("next");
    assert.equal(currentExperiment(), experiment);
    manual("none");
    run();
    assertRecord(experiment, "none");
    assertActual("none", experiment);
    const actual = simulateWorldTrajectory("none", initialFor(experiment));
    assert.ok(Math.abs(actual.finalX - targetX[experiment]) > 0.2);
    close(draw().actual, screenX(actual.finalX));
  }
  assert.equal(element("records").children.length, 3);
  advance("finish");
  assert.equal(awards.length, 1);
});

test("stopping a partial retry preserves the recorded action and restores it without another execution", () => {
  plan("weak");
  advance("run");
  frames(5);
  optional("stop");
  assert.equal(element("records").children.length, 0);
  assert.equal(intent(), "run");
  assertUnchecked();
  assert.equal(document.activeElement, primary());
  run();
  const saved = record("near").textContent;
  manual("strong");
  advance("run");
  frames(5);
  optional("stop");
  assert.equal(record("near").textContent, saved);
  assertRecord("near", "weak");
  assertUnchecked();
  const trials = published.length;
  optional("review");
  assert.equal(published.length, trials);
  assertSelected("weak");
  assertActual("weak", "near");
  close(draw().actual, screenX(simulateWorldTrajectory("weak").finalX));
  assert.equal(intent(), "next");
});

test("pause and language rebuilding retain initial velocity, predictions and completed records", () => {
  plan("weak");
  run();
  advance("next");
  plan("strong");
  run();
  advance("next");
  plan("weak");
  advance("run");
  frames(5);
  advance("pause");
  const paused = draw();
  const pauseLabel = textCommands.find((command) => command.value === "Paused")!;
  assert.ok(pauseLabel, "Pause must be visible without replacing the scene");
  const fontSize = Number(/(\d+)px/.exec(pauseLabel.font)?.[1]);
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  assert.ok(pauseLabel.y <= canvas.height);
  for (const box of rectangles.filter(
    (rectangle) => rectangle.width === 40 && rectangle.height === 40,
  ))
    assert.ok(
      pauseLabel.y - fontSize > box.y + box.height,
      "The pause label must not cover the boxes",
    );
  assert.match(element("status").textContent!, /Paused/i);
  assertUnchecked();
  frames(30);
  assert.deepEqual(draw(), paused);
  setLang("ja");
  assert.equal(document.querySelectorAll(".world-lab").length, 1);
  assert.match(element("status").textContent!, /一時停止/);
  assert.equal(currentExperiment(), "moving");
  assertSelected("weak");
  assertCandidates("moving");
  assert.deepEqual(draw(), paused);
  assert.equal(element("records").children.length, 2);
  advance("pause");
  frames(3);
  assert.ok(draw().actual > paused.actual);
  completeRun();
  setLang("en");
  assertRecord("near", "weak");
  assertRecord("far", "strong");
  assertRecord("moving", "weak");
  assertActual("weak", "moving");
  assert.equal(intent(), "finish");
});

test("language rebuilding restores the focused lesson action without stealing focus from global controls", () => {
  plan("weak");
  advance("run");
  frames(3);
  advance("pause");
  const paused = draw();
  const oldPrimary = primary();
  primary().focus({ preventScroll: true });
  setLang("ja");
  assert.notEqual(primary(), oldPrimary);
  assert.ok(
    document.activeElement === primary(),
    "Rebuilding must restore focus to the same action",
  );
  assert.equal(intent(), "pause");
  assert.deepEqual(draw(), paused);

  openDetails();
  button("skip").focus({ preventScroll: true });
  setLang("en");
  assert.ok(
    document.activeElement === button("skip"),
    "Rebuilding must preserve optional action focus",
  );
  assert.equal(visible(element("details")), true);
  assert.deepEqual(draw(), paused);

  const globalLanguageControl = document.createElement("button");
  globalLanguageControl.textContent = "Language";
  document.body.append(globalLanguageControl);
  globalLanguageControl.focus({ preventScroll: true });
  setLang("ja");
  assert.ok(
    document.activeElement === globalLanguageControl,
    "Global focus must stay outside the lesson",
  );
  assert.equal(visible(element("details")), true);
  assert.deepEqual(draw(), paused);
  globalLanguageControl.remove();
  assert.deepEqual(scrolls, []);
});

test("blur and hidden document pause motion until the same primary button resumes it", () => {
  plan("weak");
  advance("run");
  frames(4);
  window.dispatchEvent(new Event("blur"));
  const blurred = draw();
  frames(30);
  assert.deepEqual(draw(), blurred);
  assert.match(primary().textContent!, /resume/i);
  advance("pause");
  frames(2);
  const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  try {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const hidden = draw();
    frames(30);
    assert.deepEqual(draw(), hidden);
    assert.match(element("status").textContent!, /Paused/i);
  } finally {
    if (descriptor) Object.defineProperty(document, "hidden", descriptor);
    else Reflect.deleteProperty(document, "hidden");
  }
  advance("pause");
  completeRun();
  assertRecord("near", "weak");
});

test("reset clears all trials, returns to the first setup and restores focus without scrolling", () => {
  plan("weak");
  run();
  advance("next");
  plan("strong");
  advance("run");
  frames(5);
  stage.reset();
  assert.equal(element("records").children.length, 0);
  assert.equal(intent(), "plan");
  assert.equal(visible(element("details")), false);
  assert.equal(currentExperiment(), "near");
  assert.ok(
    document.activeElement === primary(),
    "A shared reset must focus the first lesson action",
  );
  assertSelected();
  assertUnchecked();
  const reset = draw();
  close(reset.actual, screenX(WORLD_INITIAL.x));
  frames(30);
  assert.deepEqual(draw(), reset);
  optional("reset");
  assert.equal(document.activeElement, primary());
  assert.deepEqual(scrolls, []);
});

test("common gamepad navigation reaches the same primary action and unregisters on dispose", () => {
  for (const node of [panel(), ...panel().querySelectorAll<HTMLElement>("button")]) {
    Object.defineProperty(node, "offsetParent", {
      configurable: true,
      get: () => (visible(node) ? document.body : null),
    });
  }
  assert.equal(pad.isOverlayPadAvailable(), true);
  assert.deepEqual(scrolls, []);
  pad.activateOverlayPad();
  assert.equal(pad.isOverlayPadActive(), true);
  assert.equal(document.activeElement, primary());
  assert.deepEqual(
    scrolls,
    [{ action: "continue", block: "nearest" }],
    "Deliberate gamepad activation must still bring the focused control into view",
  );
  button("details").focus({ preventScroll: true });
  primary().focus({ preventScroll: true });
  assert.equal(
    scrolls.length,
    1,
    "Passive focus must not add scrolling even while gamepad navigation is active",
  );
  plan("weak");
  advance("run");
  assert.equal(document.activeElement, primary());
  assert.equal(scrolls.length, 1);
  stage.dispose();
  assert.equal(pad.isOverlayPadActive(), false);
  assert.equal(pad.isOverlayPadAvailable(), false);
});

test("dispose restores the shared canvas height and removes all stage event reactions", () => {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  assert.equal(canvas.height, 300);
  plan("weak");
  advance("run");
  frames(3);
  setLang("ja");
  assert.equal(canvas.height, 300, "Rebuilding translated controls must retain the compact scene");
  stage.dispose();
  assert.equal(canvas.height, 500);
  const count = statuses.length;
  assert.equal(document.querySelector(".world-lab"), null);
  assert.equal(document.getElementById("stage-controls-dock")!.hidden, true);
  window.dispatchEvent(new Event("blur"));
  document.dispatchEvent(new Event("visibilitychange"));
  setLang("en");
  assert.equal(statuses.length, count);
  assert.equal(document.querySelector(".world-lab"), null);
});

test("the compact workbench reuses the shared scene and controls, then restores their original DOM positions", () => {
  const scene = document.getElementById("canvas-wrap")!;
  const canvas = context.canvas;
  const clearOverlay = document.getElementById("clear-overlay")!;
  const dock = document.getElementById("stage-controls-dock")!;
  const workbench = document.querySelector<HTMLElement>(".world-workbench")!;
  assert.ok(workbench, "The scene and controls need one responsive layout container");
  assert.equal(scene.parentElement, workbench);
  assert.equal(dock.parentElement, workbench);
  assert.ok(scene.compareDocumentPosition(dock) & 4);
  assert.equal(canvas.parentElement, scene);
  assert.ok(clearOverlay.parentElement === document.body, "Completion must escape the canvas clip");
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), true);
  assert.equal(document.querySelectorAll("#game").length, 1);

  plan("weak");
  advance("run");
  frames(5);
  advance("pause");
  const paused = draw();
  for (const language of ["ja", "en"] as const) {
    setLang(language);
    assert.equal(document.querySelector(".world-workbench"), workbench);
    assert.equal(document.querySelectorAll(".world-workbench").length, 1);
    assert.equal(context.canvas, canvas);
    assert.equal(canvas.parentElement, scene);
    assert.ok(clearOverlay.parentElement === document.body);
    assert.equal(clearOverlay.classList.contains("world-completion-layer"), true);
    assert.equal(dock.parentElement, workbench);
    assert.deepEqual(draw(), paused);
  }
  stage.reset();
  assert.equal(document.querySelector(".world-workbench"), workbench);
  assert.equal(canvas.parentElement, scene);
  assert.ok(clearOverlay.parentElement === document.body);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), true);
  assert.equal(dock.parentElement, workbench);
  assert.equal(canvas.height, 300);
  assert.equal(published.length, 1);
  assert.deepEqual(scrolls, []);

  stage.dispose();
  assert.equal(document.querySelector(".world-workbench"), null);
  assert.equal(workbench.isConnected, false);
  assert.equal(canvas.height, 500);
  assert.equal(canvas.parentElement, scene);
  assert.equal(clearOverlay.parentElement, scene);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), false);
  assert.equal(scene.parentElement, document.body);
  assert.equal(dock.parentElement, document.body);
  assert.equal(document.body.childNodes.length, originalBodyNodes.length);
  originalBodyNodes.forEach((node, i) => assert.equal(document.body.childNodes[i], node));

  stage = makeStage();
  stage.init(context);
  const reopened = document.querySelector<HTMLElement>(".world-workbench")!;
  assert.ok(reopened);
  assert.equal(scene.parentElement, reopened);
  assert.equal(dock.parentElement, reopened);
  assert.equal(document.querySelectorAll(".world-workbench").length, 1);
  assert.equal(canvas.height, 300);
  assert.ok(clearOverlay.parentElement === document.body);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), true);
  stage.dispose();
  assert.equal(clearOverlay.parentElement, scene);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), false);
  assert.equal(document.body.childNodes.length, originalBodyNodes.length);
  originalBodyNodes.forEach((node, i) => assert.equal(document.body.childNodes[i], node));
});

test("the overlay fallback keeps the canvas in place without creating a workbench", () => {
  stage.dispose();
  document.getElementById("stage-controls-dock")!.remove();
  const scene = context.canvas.parentElement!;
  const sceneParent = scene.parentElement;
  const clearOverlay = document.getElementById("clear-overlay")!;
  const remaining = [...document.body.childNodes];

  stage = makeStage();
  stage.init(context);
  assert.equal(document.querySelector(".world-workbench"), null);
  assert.equal(panel().parentElement, context.overlay);
  assert.equal(context.canvas.parentElement, scene);
  assert.equal(scene.parentElement, sceneParent);
  assert.ok(clearOverlay.parentElement === document.body);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), true);
  plan("weak");
  run();
  assertActual("weak", "near");
  assert.equal(published.length, 1);
  setLang("ja");
  assert.equal(panel().parentElement, context.overlay);
  assert.equal(document.querySelector(".world-workbench"), null);
  setLang("en");
  for (const action of ["strong", "weak"] as const) {
    advance("next");
    plan(action);
    run();
  }
  const savedResults = element("records").textContent;
  advance("finish");
  assert.equal(primary().disabled, true);
  assert.equal(panel().inert, true);
  // Simulate the shared dialog close contract; this unit suite stubs awardStars.
  clearOverlay.dispatchEvent(
    new window.CustomEvent("clear-overlay-close", { detail: { reason: "dismiss" } }),
  );
  assert.equal(primary().disabled, false);
  assert.equal(panel().inert, false);
  assert.equal(intent(), "reset");
  assert.ok(document.activeElement === primary(), "Dismissal must focus an available next action");
  assert.equal(element("records").textContent, savedResults);
  assert.equal(awards.length, 1);
  advance("reset");
  assert.equal(currentExperiment(), "near");
  assert.equal(intent(), "plan");
  assert.equal(element("records").children.length, 0);
  assert.equal(awards.length, 1);
  stage.dispose();
  assert.equal(context.canvas.height, 500);
  assert.ok(clearOverlay.parentElement === scene);
  assert.equal(clearOverlay.classList.contains("world-completion-layer"), false);
  assert.equal(context.canvas.parentElement, scene);
  assert.equal(scene.parentElement, sceneParent);
  assert.equal(document.body.childNodes.length, remaining.length);
  remaining.forEach((node, i) => assert.equal(document.body.childNodes[i], node));
});
