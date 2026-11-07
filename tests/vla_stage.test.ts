// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// DOM lifecycle and input/output consistency tests. These do not verify browser
// layout or real-device input. The real stage is loaded through Vite SSR.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";
import {
  VLA_SCENES,
  VLA_WIDTH,
  VLA_HEIGHT,
  renderVlaImage,
  predictVla,
  stepVla,
  evaluateVla,
  type VlaInstruction,
  type VlaScene,
} from "../src/lib/vla_model";

let browser: Window;
let server: ViteDevServer;
let makeStage: () => Stage;
let setLang: (lang: "ja" | "en") => void;
let stage: Stage;
let awards: Array<{ stars: number; message: string }>;
let statuses: string[];
let published: string[];
let translations: Array<[number, number]>;
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
  makeStage = (await server.ssrLoadModule("/src/stages/lesson/vla_lab.ts")).makeVlaLab;
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
  browser.HTMLElement.prototype.scrollIntoView = () => {
    scrolls++;
  };
});

beforeEach(() => {
  document.body.innerHTML =
    '<div id="scene"><canvas id="game" width="800" height="500"></canvas><div id="clear-overlay"></div></div><div id="overlay"></div><div id="stage-controls-dock" hidden></div>';
  setLang("en");
  awards = [];
  statuses = [];
  published = [];
  translations = [];
  scrolls = 0;
  const canvasContext = new Proxy(
    { translate: (x: number, y: number) => translations.push([x, y]) },
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
  stage = makeStage();
  stage.init({
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
    publish: (_topic: string, message: string) => published.push(message),
    sfx: {},
    ghost: {},
    getBestTime: () => undefined,
  } as unknown as GameContext);
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

const panel = () => document.querySelector<HTMLElement>(".vla-lab")!;
const element = <T extends HTMLElement = HTMLElement>(name: string): T =>
  panel().querySelector<T>(`[data-vla="${name}"]`)!;
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
function run(): void {
  click("run");
  for (let i = 0; i < 70 && visible(button("stop")); i++) stage.update(0.1);
  stage.draw();
  assert.equal(visible(button("stop")), false, "The run should finish within 7 seconds");
  assert.equal(visible(element("results")), true);
}
function inputImage(): number[] {
  return readImage(element("image"));
}
function readImage(image: HTMLElement): number[] {
  const cells = Array.from(image.children) as HTMLElement[];
  assert.equal(cells.length, VLA_WIDTH * VLA_HEIGHT);
  return cells.flatMap((cell) => {
    const channels = cell.style.backgroundColor.match(/\d+/g);
    assert.ok(channels && channels.length === 3, "Every displayed cell must have RGB channels");
    return channels.map((channel) => Number(channel) / 255);
  });
}
function assertInput(scene: VlaScene, instruction: VlaInstruction): void {
  const expected = Array.from(renderVlaImage(scene));
  assert.deepEqual(inputImage(), expected);
  assert.equal(element("action").dataset.action, predictVla(expected, instruction).action);
  assert.equal(button(instruction).getAttribute("aria-pressed"), "true");
}
function guidedComparison(): void {
  run();
  click("next-language");
  run();
  click("next-vision");
  run();
}

test("initial V pixels and A prediction match the frozen model without starting a run", () => {
  assertInput(VLA_SCENES[0], "red");
  assert.equal(visible(button("run")), true);
  assert.equal(visible(button("finish")), false);
  assert.equal(visible(element("results")), false);
  const initial = inputImage();
  frames(30);
  assert.deepEqual(inputImage(), initial);
  assert.equal(published.length, 0);
});

test("the guided three runs isolate language then vision and permit completing the lesson once", () => {
  const initial = inputImage();
  run();
  assert.match(element("records").textContent!, /Go to red.*Red box.*✓/);
  assert.equal(
    visible(element("action")),
    true,
    "A stop prediction must not be confused with the Stop button",
  );
  assert.equal(element("action").dataset.action, "stop");
  assert.equal(published.length, evaluateVla(VLA_SCENES[0], "red").steps);
  click("next-language");
  assert.deepEqual(
    inputImage(),
    initial,
    "Changing only instruction must restore the same starting image",
  );
  assertInput(VLA_SCENES[0], "blue");
  assert.match(element("change").textContent!, /instruction only.*Same starting image/);
  run();
  assert.match(element("language-check").textContent!, /✓/);
  assert.doesNotMatch(element("vision-check").textContent!, /✓/);
  assert.equal(element("records").children.length, 2);
  const startingImages = Array.from(
    element("records").querySelectorAll<HTMLElement>(".vla-record-image"),
  );
  assert.equal(startingImages.length, 2);
  assert.deepEqual(readImage(startingImages[0]), initial);
  assert.deepEqual(readImage(startingImages[1]), initial);
  assert.match(
    element("records").textContent!,
    /Before.*Go to red.*Red box.*Now.*Go to blue.*Blue box/,
  );
  click("next-vision");
  assertInput(VLA_SCENES[1], "blue");
  assert.notDeepEqual(inputImage(), initial);
  assert.match(element("change").textContent!, /layout only.*Same instruction/);
  run();
  assert.match(element("vision-check").textContent!, /✓/);
  assert.match(element("insight").textContent!, /same instruction.*boxes move/i);
  assert.equal(visible(button("finish")), true);
  click("finish");
  assert.equal(awards.length, 1);
  assert.equal(awards[0].stars, 3);
  frames(10);
  button("finish").click();
  assert.equal(awards.length, 1);
});

test("same-input replay is available after each guided run and preserves inputs, outcomes and earned comparisons", () => {
  assert.equal(visible(button("replay")), false);
  run();
  const checkpoints: Array<{
    scene: VlaScene;
    instruction: VlaInstruction;
    language: boolean;
    vision: boolean;
    next?: string;
  }> = [
    {
      scene: VLA_SCENES[0],
      instruction: "red",
      language: false,
      vision: false,
      next: "next-language",
    },
    {
      scene: VLA_SCENES[0],
      instruction: "blue",
      language: true,
      vision: false,
      next: "next-vision",
    },
    { scene: VLA_SCENES[1], instruction: "blue", language: true, vision: true },
  ];
  for (const checkpoint of checkpoints) {
    assert.equal(visible(button("replay")), true);
    assert.equal(visible(button("run")), false);
    const records = element("records").textContent;
    const lastRecord = element("records").lastElementChild!;
    const outcome = Array.from(lastRecord.querySelectorAll("strong")).map(
      (node) => node.textContent,
    );
    const startImage = readImage(lastRecord.querySelector<HTMLElement>(".vla-record-image")!);
    const languageCheck = element("language-check").textContent;
    const visionCheck = element("vision-check").textContent;
    assert.equal(languageCheck!.includes("✓"), checkpoint.language);
    assert.equal(visionCheck!.includes("✓"), checkpoint.vision);
    click("replay");
    assertInput(checkpoint.scene, checkpoint.instruction);
    assert.deepEqual(inputImage(), startImage);
    assert.equal(
      element("records").textContent,
      records,
      "Replay must retain completed records while moving",
    );
    assert.equal(visible(element("results")), false);
    assert.equal(visible(button("replay")), false);
    assert.equal(visible(button("finish")), false);
    for (let i = 0; i < 70 && visible(button("stop")); i++) stage.update(0.1);
    assert.equal(visible(button("stop")), false);
    assert.equal(visible(element("results")), true);
    assert.equal(element("language-check").textContent, languageCheck);
    assert.equal(element("vision-check").textContent, visionCheck);
    const repeatedRecords = Array.from(element("records").children);
    assert.equal(repeatedRecords.length, 2);
    for (const record of repeatedRecords) {
      assert.deepEqual(
        readImage(record.querySelector<HTMLElement>(".vla-record-image")!),
        startImage,
      );
      assert.deepEqual(
        Array.from(record.querySelectorAll("strong")).map((node) => node.textContent),
        outcome,
      );
    }
    assert.doesNotMatch(element("insight").textContent!, /Both inputs changed/);
    assert.equal(visible(button("replay")), true);
    if (checkpoint.next) {
      click(checkpoint.next);
      run();
    }
  }
  assert.equal(visible(button("finish")), true);
  assert.equal(awards.length, 0, "Replay must not award completion automatically");
});

test("completion can be dismissed for review and a fresh run without a second award", () => {
  guidedComparison();
  const results = element("records").textContent;
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
  assert.equal(element("records").textContent, results);
  button("finish").click();
  assert.equal(awards.length, 1);
  click("reset");
  assert.equal(visible(element("results")), false);
  assert.equal(visible(button("run")), true);
  assert.equal(awards.length, 1);
});

test("normal trials keep the viewport still and shared layout is restored on exit", () => {
  const scene = document.getElementById("scene")!;
  const completion = document.getElementById("clear-overlay")!;
  const dock = document.getElementById("stage-controls-dock")!;
  const canvas = document.getElementById("game")!;
  guidedComparison();
  assert.equal(scrolls, 0);
  assert.equal(scene.parentElement, dock.parentElement);
  setLang("ja");
  assert.equal(scene.parentElement, dock.parentElement);
  assert.equal(document.querySelectorAll("#game").length, 1);
  stage.dispose();
  assert.equal(scene.parentElement, document.body);
  assert.equal(dock.parentElement, document.body);
  assert.equal(canvas.parentElement, scene);
  assert.equal(completion.parentElement, scene);
  assert.equal(document.querySelector(".lab-workbench"), null);
});

test("every live image and next action match the logical robot position shown on the board", () => {
  let expected = VLA_SCENES[0];
  click("run");
  for (let move = 0; move < 3; move++) {
    const action = predictVla(renderVlaImage(expected), "red").action;
    expected = stepVla(expected, action, "red").scene;
    const before = published.length;
    for (let i = 0; i < 5 && published.length === before; i++) stage.update(0.1);
    assert.equal(published.length, before + 1);
    assertInput(expected, "red");
    translations = [];
    stage.draw();
    assert.deepEqual(
      translations[0],
      [176 + (expected.robot.x + 0.5) * 64, 83 + (expected.robot.y + 0.5) * 64],
      "The displayed robot must occupy the same cell encoded by the green input pixel",
    );
  }
});

test("manual instruction buttons preserve the starting image and manual layouts preserve instruction", () => {
  const initial = inputImage();
  click("blue");
  assert.deepEqual(inputImage(), initial);
  assertInput(VLA_SCENES[0], "blue");
  run();
  click("red");
  assert.deepEqual(inputImage(), initial);
  assertInput(VLA_SCENES[0], "red");
  run();
  assert.match(element("language-check").textContent!, /✓/);
  click("details");
  for (const index of [1, 2, 0]) {
    click("layout");
    assertInput(VLA_SCENES[index], "red");
  }
});

test("changing both inputs does not count as either isolated comparison", () => {
  run();
  click("blue");
  click("details");
  click("layout");
  assert.match(element("change").textContent!, /Both the image and instruction changed/);
  run();
  assert.doesNotMatch(element("language-check").textContent!, /✓/);
  assert.doesNotMatch(element("vision-check").textContent!, /✓/);
  assert.match(element("insight").textContent!, /Both inputs changed/);
  assert.equal(visible(button("finish")), false);
});

test("repeating identical inputs is not described as changing both inputs", () => {
  run();
  click("red");
  assert.equal(visible(element("change")), false);
  run();
  assert.doesNotMatch(element("insight").textContent!, /Both inputs changed/);
  assert.doesNotMatch(element("language-check").textContent!, /✓/);
  assert.doesNotMatch(element("vision-check").textContent!, /✓/);
});

test("stopping discards the partial run and does not create a comparison or replace completed records", () => {
  click("run");
  frames(5);
  click("stop");
  assert.equal(element("records").children.length, 0);
  assert.equal(visible(element("results")), false);
  assert.match(element("status").textContent!, /Stopped/);
  click("blue");
  run();
  assert.equal(element("records").children.length, 1);
  assert.doesNotMatch(element("language-check").textContent!, /✓/);
  const record = element("records").textContent;
  click("red");
  click("run");
  frames(5);
  click("stop");
  assert.equal(element("records").textContent, record);
  assert.doesNotMatch(element("language-check").textContent!, /✓/);
  run();
  assert.match(element("language-check").textContent!, /✓/);
});

test("pause and blur freeze observations, language changes preserve the run, and resume continues", () => {
  click("run");
  frames(5);
  click("pause");
  const pausedImage = inputImage();
  const action = element("action").dataset.action;
  const moves = published.length;
  frames(10);
  assert.deepEqual(inputImage(), pausedImage);
  assert.equal(published.length, moves);
  setLang("ja");
  assert.match(element("status").textContent!, /一時停止中/);
  assert.deepEqual(inputImage(), pausedImage);
  assert.equal(element("action").dataset.action, action);
  assert.equal(document.querySelectorAll(".vla-lab").length, 1);
  click("pause");
  frames(4);
  assert.ok(published.length > moves);
  window.dispatchEvent(new Event("blur"));
  const blurredImage = inputImage();
  const blurredMoves = published.length;
  frames(10);
  assert.deepEqual(inputImage(), blurredImage);
  assert.equal(published.length, blurredMoves);
  setLang("en");
  assert.match(element("status").textContent!, /Paused/);
  click("pause");
  for (let i = 0; i < 70 && visible(button("stop")); i++) stage.update(0.1);
  assert.equal(visible(element("results")), true);
});

test("visibility loss pauses the run and changing language after results preserves both comparison images", () => {
  click("run");
  frames(5);
  const descriptor = Object.getOwnPropertyDescriptor(document, "hidden");
  try {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    const image = inputImage();
    const count = published.length;
    frames(10);
    assert.deepEqual(inputImage(), image);
    assert.equal(published.length, count);
    assert.match(element("status").textContent!, /Paused/);
  } finally {
    if (descriptor) Object.defineProperty(document, "hidden", descriptor);
    else Reflect.deleteProperty(document, "hidden");
  }
  click("pause");
  for (let i = 0; i < 70 && visible(button("stop")); i++) stage.update(0.1);
  click("next-language");
  run();
  const images = Array.from(
    element("records").querySelectorAll<HTMLElement>(".vla-record-image"),
  ).map(readImage);
  const input = inputImage();
  setLang("ja");
  assert.match(element("records").textContent!, /前回.*赤い箱へ.*今回.*青い箱へ/);
  assert.deepEqual(inputImage(), input);
  assert.deepEqual(
    Array.from(element("records").querySelectorAll<HTMLElement>(".vla-record-image")).map(
      readImage,
    ),
    images,
  );
  assert.match(element("language-check").textContent!, /✓/);
});

test("reset during a run clears pending and completed comparisons and returns to the original input", () => {
  guidedComparison();
  click("blue");
  click("run");
  frames(5);
  stage.reset();
  assertInput(VLA_SCENES[0], "red");
  assert.equal(visible(button("run")), true);
  assert.equal(visible(button("stop")), false);
  assert.equal(visible(button("finish")), false);
  assert.equal(element("records").children.length, 0);
  assert.doesNotMatch(element("language-check").textContent!, /✓/);
  assert.doesNotMatch(element("vision-check").textContent!, /✓/);
  const count = published.length;
  frames(15);
  assert.equal(published.length, count);
});

test("dispose removes the panel and all language and blur reactions", () => {
  click("run");
  frames(3);
  stage.dispose();
  const count = statuses.length;
  assert.equal(document.querySelector(".vla-lab"), null);
  assert.equal(document.getElementById("stage-controls-dock")!.hidden, true);
  window.dispatchEvent(new Event("blur"));
  setLang("ja");
  assert.equal(statuses.length, count);
  assert.equal(document.querySelector(".vla-lab"), null);
});
