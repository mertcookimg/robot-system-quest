// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

let browser: Window;
let readout: typeof import("../src/lib/canvas_readout");
let drawing: typeof import("../src/lib/draw");
let language: typeof import("../src/i18n");
let compact = true;
let canvas: HTMLCanvasElement;
let context: CanvasRenderingContext2D;
let canvasText: string[];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function makeContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  return new Proxy(
    { canvas: target },
    {
      get(object, key) {
        if (key === "canvas") return object.canvas;
        if (key === "fillText") return (text: string) => canvasText.push(text);
        if (key === "measureText") return (text: string) => ({ width: [...text].length * 7 });
        return () => {};
      },
    },
  ) as unknown as CanvasRenderingContext2D;
}

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "navigator", "localStorage"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  browser.matchMedia = () =>
    ({
      get matches() {
        return compact;
      },
    }) as MediaQueryList;
  readout = await import("../src/lib/canvas_readout");
  drawing = await import("../src/lib/draw");
  language = await import("../src/i18n");
});

beforeEach(() => {
  document.body.innerHTML = '<div class="canvas-wrap"><canvas id="game"></canvas></div>';
  canvas = document.getElementById("game") as HTMLCanvasElement;
  canvasText = [];
  context = makeContext(canvas);
  compact = true;
  language.setLang("en");
  readout.setupCanvasReadout(canvas);
  readout.beginCanvasReadoutFrame();
});

after(async () => {
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const panel = () => document.querySelector<HTMLElement>(".canvas-readout")!;

test("compact scenes render actual hints and timing as normal text without duplicate canvas text", () => {
  drawing.drawHint(context, "Move <left> & stop");
  drawing.drawTimer(context, 12.34, 9.87);
  readout.endCanvasReadoutFrame();
  assert.equal(canvas.nextElementSibling, panel());
  assert.equal(panel().hidden, false);
  assert.equal(panel().querySelector(".canvas-readout-hint")!.textContent, "Move <left> & stop");
  assert.equal(
    panel().querySelector(".canvas-readout-time")!.textContent,
    "Time 12.3 s · Best 9.87 s",
  );
  assert.equal(panel().querySelector("left"), null, "Hints must not be interpreted as HTML");
  assert.deepEqual(canvasText, []);
  assert.equal(panel().hasAttribute("aria-live"), false, "Timer updates must not interrupt speech");
});

test("each scene frame removes obsolete hints and a stage with no readout leaves no empty panel", () => {
  drawing.drawHint(context, "Old instructions");
  drawing.drawTimer(context, 5, 4);
  readout.endCanvasReadoutFrame();
  readout.beginCanvasReadoutFrame();
  drawing.drawTimer(context, 6);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().querySelector<HTMLElement>(".canvas-readout-hint")!.hidden, true);
  assert.equal(panel().textContent, "Time 6.0 s");
  readout.beginCanvasReadoutFrame();
  readout.endCanvasReadoutFrame();
  assert.equal(panel().hidden, true);
  assert.equal(panel().textContent, "");
});

test("clearing on restart or stage navigation immediately removes the prior scene readout", () => {
  drawing.drawHint(context, "Previous game");
  drawing.drawTimer(context, 15);
  readout.endCanvasReadoutFrame();
  readout.clearCanvasReadout();
  assert.equal(panel().hidden, true);
  assert.equal(panel().textContent, "");
  drawing.drawHint(context, "New game");
  readout.endCanvasReadoutFrame();
  assert.equal(panel().textContent, "New game");
});

test("Guide and menu preview canvases cannot replace the live stage's readout", () => {
  drawing.drawHint(context, "Live game");
  const preview = document.createElement("canvas");
  drawing.drawHint(makeContext(preview), "Preview only");
  drawing.drawTimer(makeContext(preview), 30);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().textContent, "Live game");
  assert.ok(canvasText.includes("Preview only"));
  assert.ok(canvasText.includes("30.00s"));
});

test("desktop instructions wrap in HTML while resizing moves only timing out of the canvas", () => {
  compact = false;
  drawing.drawHint(context, "Desktop hint");
  drawing.drawTimer(context, 1);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().hidden, false);
  assert.equal(panel().querySelector(".canvas-readout-hint")!.textContent, "Desktop hint");
  assert.equal(panel().querySelector<HTMLElement>(".canvas-readout-time")!.hidden, true);
  assert.equal(canvasText.includes("Desktop hint"), false);
  assert.ok(canvasText.includes("1.00s"));

  canvasText = [];
  compact = true;
  language.setLang("ja");
  readout.beginCanvasReadoutFrame();
  drawing.drawHint(context, "操作の説明");
  drawing.drawTimer(context, 2, 1.23);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().hidden, false);
  assert.match(panel().textContent!, /時間 2.0 s · ベスト 1.23 s/);
  assert.match(panel().textContent!, /操作の説明/);
  assert.deepEqual(canvasText, []);
  assert.equal(document.querySelectorAll(".canvas-readout").length, 1);
});

test("long instructions remain complete outside the desktop scene without leaving empty space", () => {
  compact = false;
  const longHint =
    "Follow the route, stop at the marked position, then adjust the heading. ".repeat(8);
  drawing.drawHint(context, longHint);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().querySelector(".canvas-readout-hint")!.textContent, longHint);
  assert.deepEqual(canvasText, []);
  readout.beginCanvasReadoutFrame();
  drawing.drawTimer(context, 3);
  readout.endCanvasReadoutFrame();
  assert.equal(panel().hidden, true, "Desktop timing alone uses its existing canvas badge");
});
