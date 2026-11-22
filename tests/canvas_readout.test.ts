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
let viewportMatchMedia: Window["matchMedia"];
const descriptors = new Map<string, PropertyDescriptor | undefined>();

function makeContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  return new Proxy(
    { canvas: target },
    {
      get(object, key) {
        if (key in object) return Reflect.get(object, key);
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
  viewportMatchMedia = browser.matchMedia.bind(browser);
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
  readout.setupCanvasReadout(canvas, context);
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

const sceneText = () => document.querySelector<HTMLDetailsElement>(".canvas-text-readout")!;

function openSceneText(): void {
  sceneText().open = true;
  sceneText().dispatchEvent(new browser.Event("toggle"));
}

test("small scene labels have a larger text alternative outside the sticky canvas on any viewport", () => {
  compact = false; // A short, wide PC window also needs this alternative.
  context.font = "9px monospace";
  context.fillText("/cmd_vel", 60, 80);
  context.fillText("geometry_msgs/msg/Twist", 60, 96);
  context.fillText("tx=12", 300, 80);
  context.fillText("ty=0", 300, 90);
  context.fillText("yaw=30°", 300, 100);
  context.strokeText("yaw=30°", 300, 100);
  context.fillText("▶", 310, 180);
  readout.endCanvasReadoutFrame();
  const details = sceneText();
  assert.equal(details.hidden, false);
  assert.equal(
    details.open,
    false,
    "The text alternative must not push the controls down by default",
  );
  assert.equal(
    details.querySelector("ul")!.childElementCount,
    0,
    "Closed text needs no live DOM updates",
  );
  assert.ok(!canvas.parentElement!.contains(details), "Reading must not enlarge the sticky scene");
  openSceneText();
  assert.deepEqual(
    [...details.querySelectorAll("li")].map((row) => row.textContent),
    ["/cmd_vel\ngeometry_msgs/msg/Twist", "tx=12\nty=0\nyaw=30°"],
    "Topic/type and transform values retain their grouping, without outlines or decorations",
  );
  assert.equal(details.hasAttribute("aria-live"), false);
  assert.equal(details.querySelector("[aria-live]"), null);
  assert.ok(canvasText.includes("/cmd_vel"), "The normal scene must retain its labels");
});

test("text inspection preserves focus, existing rows and scroll while rate-limiting changing values", (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const draw = (score: number) => {
    readout.beginCanvasReadoutFrame();
    context.fillText("SCORE", 40, 40);
    context.fillText(String(score), 40, 55);
    context.fillText("A <robot> & a long/type/name", 400, 40);
    readout.endCanvasReadoutFrame();
  };
  draw(1);
  openSceneText();
  const details = sceneText();
  const summary = details.querySelector("summary")!;
  const rows = [...details.querySelectorAll("li")];
  summary.focus();
  details.scrollTop = 91;
  now = 100;
  draw(2);
  assert.equal(rows[0].textContent, "SCORE\n1", "Do not redraw text on every animation frame");
  now = 250;
  draw(3);
  assert.equal(rows[0].textContent, "SCORE\n3");
  assert.deepEqual([...details.querySelectorAll("li")], rows);
  assert.equal(document.activeElement, summary);
  assert.equal(details.scrollTop, 91);
  assert.equal(details.querySelector("robot"), null, "Drawn strings remain escaped text");
  language.setLang("ja");
  assert.equal(summary.textContent, "画面の文字を大きく読む");
  assert.equal(details.open, true);
  assert.equal(document.activeElement, summary);

  readout.clearCanvasReadout();
  assert.equal(details.hidden, true);
  assert.equal(details.querySelector("ul")!.textContent, "");
  draw(4);
  assert.equal(details.querySelector("li")!.textContent, "SCORE\n4");
  assert.equal(details.open, true, "A restart keeps the chosen reading mode");
});

test("short desktop viewports also show time as readable HTML", (t) => {
  t.mock.method(browser, "matchMedia", viewportMatchMedia);
  browser.happyDOM.setWindowSize({ width: 1280, height: 480 });
  readout.setupCanvasReadout(canvas, context);
  readout.beginCanvasReadoutFrame();
  drawing.drawTimer(context, 8.5, 7.25);
  readout.endCanvasReadoutFrame();
  assert.equal(
    panel().querySelector(".canvas-readout-time")!.textContent,
    "Time 8.5 s · Best 7.25 s",
  );
  assert.deepEqual(canvasText, [], "A height-limited canvas must not be the only timer readout");
});

test("keyboard reading keys keep native behavior without reaching stage handlers", (t) => {
  context.fillText("Read these instructions", 40, 40);
  readout.endCanvasReadoutFrame();
  openSceneText();
  const summary = sceneText().querySelector("summary")!;
  let downs = 0;
  let ups = 0;
  const down = () => downs++;
  const up = () => ups++;
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  t.after(() => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
  });
  for (const key of ["ArrowDown", "PageDown", " ", "w"]) {
    const event = new browser.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    summary.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    summary.dispatchEvent(new browser.KeyboardEvent("keyup", { key, bubbles: true }));
  }
  assert.equal(downs, 0, "Reading keys must not drive a stage");
  assert.equal(ups, 4, "Previously held stage keys still need their release events");
});

test("preview text and prior frames never leak into the current scene text", () => {
  const preview = makeContext(document.createElement("canvas"));
  context.fillText("Live lesson", 40, 40);
  preview.fillText("Guide preview", 40, 40);
  readout.endCanvasReadoutFrame();
  openSceneText();
  assert.equal(sceneText().querySelector("ul")!.textContent, "Live lesson");
  readout.clearCanvasReadout();
  readout.beginCanvasReadoutFrame();
  context.fillText("Next lesson", 40, 40);
  readout.endCanvasReadoutFrame();
  assert.equal(sceneText().querySelector("ul")!.textContent, "Next lesson");
});
