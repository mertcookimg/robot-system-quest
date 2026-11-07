// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Verify readable results, labels and lifecycle with the real stage modules.
// Canvas pixels and responsive layout still require browser visual review.
import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let stage: Stage | undefined;
let context: GameContext;
let setLang: (lang: "ja" | "en") => void;
const factories = new Map<string, () => Stage>();
const descriptors = new Map<string, PropertyDescriptor | undefined>();
let messages: Array<{ topic: string; message: string }> = [];

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const pixels = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  });
  return new Proxy(
    { canvas },
    {
      get(target, key) {
        if (key === "canvas") return target.canvas;
        if (key === "getImageData")
          return (_x: number, _y: number, w: number, h: number) => pixels(w, h);
        if (key === "createImageData") return pixels;
        if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
        if (String(key).endsWith("Gradient")) return () => ({ addColorStop() {} });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
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
    "ResizeObserver",
    "IntersectionObserver",
    "DOMRect",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    "matchMedia",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    let value = key === "window" ? browser : Reflect.get(browser, key);
    if (
      ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia"].includes(
        key,
      )
    )
      value = value.bind(browser);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  browser.HTMLCanvasElement.prototype.getContext = function () {
    return canvasContext(this as unknown as HTMLCanvasElement);
  } as typeof browser.HTMLCanvasElement.prototype.getContext;
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
  for (const id of ["object_detection", "behavior_tree", "tf_puzzle"]) {
    factories.set(id, (await server.ssrLoadModule(`/src/stages/lesson/${id}.ts`)).default.build);
  }
  setLang = (await server.ssrLoadModule("/src/i18n/index.ts")).setLang;
});

beforeEach(() => {
  setLang("en");
  messages = [];
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const noop = () => {};
  context = {
    canvas,
    ctx: canvasContext(canvas),
    keys: new Set<string>(),
    overlay: document.getElementById("stage-overlay")!,
    setStatus: noop,
    setHud: noop,
    showClear: noop,
    awardStars: noop,
    setTimeout: noop,
    shake: noop,
    crash: noop,
    publish: (topic: string, message: string) => messages.push({ topic, message }),
    sfx: new Proxy({}, { get: () => noop }),
    ghost: new Proxy({}, { get: () => noop }),
    getBestTime: () => undefined,
  } as unknown as GameContext;
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

function load(id: string): Stage {
  stage = factories.get(id)!();
  stage.init(context);
  return stage;
}

test("detection results match the published message, update units and reset", () => {
  const current = load("object_detection");
  const panel = document.querySelector<HTMLElement>(".object-detection-readout")!;
  assert.ok(panel);
  assert.equal(panel.querySelector('[data-value="threshold"]')!.textContent, "0.45");
  context.keys.add("w");
  current.update(0.11);
  const message = messages.findLast((entry) => entry.topic === "/obj_detection/objects")!.message;
  const expected = JSON.parse(message.slice(message.indexOf("{")));
  assert.deepEqual(JSON.parse(panel.querySelector("pre")!.textContent!), expected);
  assert.equal(
    panel.querySelectorAll("li:not(.object-detection-empty)").length,
    expected.objects.length,
  );
  assert.match(panel.querySelector('[data-value="linear"]')!.textContent!, /0\.55 m\/s/);
  assert.match(panel.querySelector('[data-value="angular"]')!.textContent!, /rad\/s/);
  const rows = [...panel.querySelectorAll("li:not(.object-detection-empty)")];
  expected.objects.forEach((object: { class: string; conf: number }, index: number) => {
    assert.equal(rows[index].querySelector("span")!.textContent, `${index + 1} ${object.class}`);
    assert.equal(rows[index].querySelector("strong")!.textContent, object.conf.toFixed(2));
  });
  current.reset();
  assert.equal(panel.querySelector('[data-value="linear"]')!.textContent, "0.00 m/s");
  assert.equal(panel.querySelector('[data-value="latency"]')!.textContent, "0.0 ms");
  assert.deepEqual(JSON.parse(panel.querySelector("pre")!.textContent!), { objects: [] });
});

test("detection JSON stays open across updates and language changes, then scene is restored", () => {
  const canvasWrap = document.getElementById("canvas-wrap")!;
  const originalParent = canvasWrap.parentElement;
  const current = load("object_detection");
  const panel = document.querySelector<HTMLElement>(".object-detection-readout")!;
  const details = panel.querySelector("details")!;
  details.open = true;
  details.querySelector("summary")!.focus();
  current.update(0.11);
  setLang("ja");
  assert.equal(details.open, true);
  assert.equal(document.activeElement, details.querySelector("summary"));
  assert.equal(panel.querySelector("h3")!.textContent, "検出結果");
  assert.ok(!canvasWrap.contains(panel), "Readout must not enlarge the sticky canvas wrapper");
  current.dispose();
  stage = undefined;
  assert.equal(canvasWrap.parentElement, originalParent);
  assert.equal(document.querySelector(".object-detection-view"), null);
  assert.equal(document.querySelector(".object-detection-readout"), null);
  setLang("en");
  assert.equal(
    panel.querySelector("h3")!.textContent,
    "検出結果",
    "Language listener must be disposed",
  );
});

test("Behavior Tree selects identify every rule's condition and action", () => {
  load("behavior_tree");
  const selects = [...document.querySelectorAll<HTMLSelectElement>(".bt-rule-select")];
  assert.equal(selects.length, 9);
  const names = selects.map((select) =>
    select
      .getAttribute("aria-labelledby")!
      .split(" ")
      .map((id) => document.getElementById(id)!.textContent)
      .join(" "),
  );
  assert.equal(new Set(names).size, names.length);
  assert.equal(names[0], "1 If");
  assert.equal(names[1], "1 Do");
  assert.equal(selects[0].style.fontSize, "16px");
  setLang("ja");
  assert.equal(document.getElementById("bt-condition-label-0")!.textContent, "条件");
  assert.equal(document.getElementById("bt-action-label-0")!.textContent, "動作");
  selects[0].value = "clear_ahead";
  selects[0].dispatchEvent(new Event("change"));
  assert.equal(selects[0].value, "clear_ahead");
});

test("TF controls retain labels, update values and localize their instructions", () => {
  const current = load("tf_puzzle");
  const panel = document.getElementById("tf-puzzle-panel")!;
  const sliders = [...panel.querySelectorAll<HTMLInputElement>('input[type="range"]')];
  assert.equal(sliders.length, 3);
  sliders.forEach((slider) => assert.ok(slider.closest("label")));
  sliders[0].value = "12";
  sliders[0].dispatchEvent(new Event("input"));
  assert.equal(panel.querySelector(".slider-val")!.textContent, "12 px");
  setLang("ja");
  assert.match(panel.querySelector(".tf-puzzle-reminder")!.textContent!, /合わせよう/);
  current.reset();
  assert.equal(sliders[0].value, "0");
});
