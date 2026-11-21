// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { setupPalette } from "../src/lib/block_editor.ts";
import { GAUSSIAN_SIGMA_MAX } from "../src/lib/imgproc.ts";
import { setLang } from "../src/i18n/index.ts";
import type { GameContext, Stage } from "../src/types";

let browser: Window;
let context: GameContext;
let current: Stage | undefined;
let makeImageProcessing: () => Stage;
let makeEdgeDetection: () => Stage;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement", "Event"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  browser.HTMLCanvasElement.prototype.getContext = function () {
    const pixels = (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    });
    return new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === "getImageData")
            return (_x: number, _y: number, w: number, h: number) => pixels(w, h);
          if (key === "createImageData") return pixels;
          if (String(key).endsWith("Gradient")) return () => ({ addColorStop() {} });
          return () => {};
        },
      },
    );
  } as typeof browser.HTMLCanvasElement.prototype.getContext;
  makeImageProcessing = (await import("../src/stages/lesson/image_processing.ts"))
    .makeImageProcessing;
  makeEdgeDetection = (await import("../src/stages/lesson/edge_detection.ts")).makeCameraMission;
});

beforeEach(() => {
  document.body.innerHTML = `
    <canvas width="800" height="500"></canvas><div id="overlay"></div>
    <div id="block-editor">
      <div class="be-palette"><p id="be-palette-hint"></p></div>
      <ol id="be-program"></ol><p id="be-status"></p><p id="be-program-hint"></p>
      <button id="be-run"></button><button id="be-stop"></button><button id="be-clear"></button>
    </div>`;
  setLang("en");
  const noop = () => {};
  context = {
    canvas: document.querySelector("canvas")!,
    ctx: {},
    overlay: document.getElementById("overlay")!,
    keys: new Set<string>(),
    setStatus: noop,
    setHud: noop,
    publish: noop,
    sfx: new Proxy({}, { get: () => noop }),
    ghost: new Proxy({}, { get: () => noop }),
  } as unknown as GameContext;
});

afterEach(() => {
  current?.dispose();
  current = undefined;
});

after(async () => {
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function load(make: () => Stage): Stage {
  current?.dispose();
  current = make();
  current.init(context);
  return current;
}

const sigmaInput = () => document.querySelector<HTMLInputElement>('input[aria-label="sigma"]')!;
const paletteButton = () =>
  document.querySelector<HTMLButtonElement>('.be-palette-block[data-add="gaussian_blur"]')!;

test("both image lessons constrain typed and stepped sigma and retain the bounded value on reset", () => {
  for (const make of [makeEdgeDetection, makeImageProcessing]) {
    const stage = load(make);
    assert.equal(sigmaInput().min, "0");
    assert.equal(sigmaInput().max, String(GAUSSIAN_SIGMA_MAX));
    for (const [typed, expected] of [
      ["1000", GAUSSIAN_SIGMA_MAX],
      ["1e308", GAUSSIAN_SIGMA_MAX],
      ["-5", 0],
    ] as const) {
      const input = sigmaInput();
      input.value = typed;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      assert.equal(input.valueAsNumber, expected);
      stage.reset();
      assert.equal(
        sigmaInput().valueAsNumber,
        expected,
        "The program must retain the bounded value",
      );
    }
    sigmaInput().closest("label")!.querySelector<HTMLButtonElement>("button")!.click();
    assert.equal(sigmaInput().valueAsNumber, 0);
    sigmaInput().value = String(GAUSSIAN_SIGMA_MAX);
    sigmaInput().dispatchEvent(new Event("input", { bubbles: true }));
    sigmaInput().closest("label")!.querySelectorAll<HTMLButtonElement>("button")[1].click();
    assert.equal(sigmaInput().valueAsNumber, GAUSSIAN_SIGMA_MAX);
  }
});

test("L15 to L14 and language reinitialization refresh the shared palette labels and arguments", () => {
  load(makeEdgeDetection);
  assert.equal(paletteButton().querySelector(".bp-name")!.textContent, "gaussian_blur");
  assert.equal(paletteButton().querySelector(".bp-args")!.textContent, "sigma");
  const imageStage = load(makeImageProcessing);
  assert.equal(paletteButton().querySelector(".bp-name")!.textContent, "① reduce noise");
  assert.equal(paletteButton().querySelector(".bp-args")!.textContent, "gaussian_blur / sigma");
  for (const [language, label] of [
    ["ja", "① ノイズを減らす"],
    ["en", "① reduce noise"],
  ] as const) {
    imageStage.dispose();
    setLang(language);
    imageStage.init(context);
    assert.equal(paletteButton().querySelector(".bp-name")!.textContent, label);
    const before = document.querySelectorAll("#be-program > li").length;
    paletteButton().click();
    assert.equal(document.querySelectorAll("#be-program > li").length, before + 1);
    assert.equal(document.querySelectorAll('[data-add="gaussian_blur"]').length, 1);
  }
  load(makeEdgeDetection);
  assert.equal(paletteButton().querySelector(".bp-name")!.textContent, "gaussian_blur");
  assert.equal(paletteButton().querySelector(".bp-args")!.textContent, "sigma");
});

test("reconfiguring a palette replaces its old callback", () => {
  let oldAdds = 0;
  let newAdds = 0;
  setupPalette(
    [{ id: "gaussian_blur", name: "old", args: "old args", onAdd: () => oldAdds++ }],
    "",
  );
  setupPalette(
    [{ id: "gaussian_blur", name: "new", args: "new args", onAdd: () => newAdds++ }],
    "",
  );
  paletteButton().click();
  assert.equal(oldAdds, 0);
  assert.equal(newAdds, 1);
});
