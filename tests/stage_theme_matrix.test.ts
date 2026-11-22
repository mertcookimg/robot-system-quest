// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Exercise every real stage through both palettes. Canvas calls are recorded,
// not rasterized: this checks runtime/lifecycle behavior, not visual contrast.
import test, { after, afterEach, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";

const sources: Array<{ category: string; id: string }> = [];
for (const category of ["game", "lesson"]) {
  const files = await readdir(new URL(`../src/stages/${category}/`, import.meta.url));
  for (const file of files.filter((name) => name.endsWith(".ts")).sort())
    sources.push({ category, id: file.slice(0, -3) });
}

let browser: Window;
let server: ViteDevServer;
let stage: Stage | undefined;
let theme: typeof import("../src/core/theme");
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const recordings = new WeakMap<HTMLCanvasElement, { colors: string[]; paints: number }>();
let totalPaints = 0;

function canvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const recording = { colors: [] as string[], paints: 0 };
  recordings.set(canvas, recording);
  const pixels = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  });
  const state: Record<PropertyKey, unknown> = { canvas, globalAlpha: 1, lineWidth: 1 };
  const stack: Array<Record<PropertyKey, unknown>> = [];
  return new Proxy(state, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "save") return () => stack.push({ ...state });
      if (key === "restore") return () => Object.assign(state, stack.pop());
      if (key === "getImageData")
        return (_x: number, _y: number, w: number, h: number) => pixels(w, h);
      if (key === "createImageData") return pixels;
      if (key === "measureText") return (value: string) => ({ width: value.length * 7 });
      if (String(key).endsWith("Gradient"))
        return () => ({
          stops: [] as string[],
          addColorStop(_position: number, color: string) {
            this.stops.push(color);
          },
        });
      return (...args: unknown[]) => {
        for (const value of args)
          if (typeof value === "number")
            assert.ok(Number.isFinite(value), `${String(key)} received a non-finite coordinate`);
        if (/^(fill|stroke|drawImage|putImageData)/.test(String(key))) {
          recording.paints++;
          totalPaints++;
        }
      };
    },
    set(target, key, value) {
      if (key === "fillStyle" || key === "strokeStyle") {
        assert.ok(value != null, `${String(key)} must have a color`);
        recording.colors.push(typeof value === "string" ? value : JSON.stringify(value));
      }
      target[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
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
    "FocusEvent",
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
    if (["getComputedStyle", "matchMedia"].includes(key)) value = value.bind(browser);
    // The test drives frames explicitly; previews must not run in the background.
    if (key === "requestAnimationFrame") value = () => 1;
    if (key === "cancelAnimationFrame") value = () => {};
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
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
  theme = (await server.ssrLoadModule("/src/core/theme.ts")) as typeof theme;
  (await server.ssrLoadModule("/src/i18n/index.ts")).setLang("en");
});

afterEach(() => {
  stage?.dispose();
  stage = undefined;
  document.getElementById("stage-overlay")!.replaceChildren();
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("theme matrix includes all 14 games and 24 lessons", () => {
  assert.equal(sources.filter(({ category }) => category === "game").length, 14);
  assert.equal(sources.filter(({ category }) => category === "lesson").length, 24);
});

for (const { category, id } of sources) {
  test(`${category}/${id}: live light-dark-light draw, reset and disposal`, async () => {
    const module = await server.ssrLoadModule(`/src/stages/${category}/${id}.ts`);
    theme.setTheme("light");
    const canvas = document.getElementById("game") as HTMLCanvasElement;
    const ctx = canvasContext(canvas);
    const recording = recordings.get(canvas)!;
    const overlay = document.getElementById("stage-overlay")!;
    const noop = () => {};
    let starts = 0;
    const context = {
      canvas,
      ctx,
      overlay,
      keys: new Set<string>(),
      setStatus: noop,
      setHud: noop,
      showClear: noop,
      awardStars: noop,
      setTimeout: noop,
      shake: noop,
      crash: noop,
      publish: noop,
      sfx: new Proxy({}, { get: () => noop }),
      ghost: {
        startRecording: () => starts++,
        recordPose: noop,
        getPose: () => undefined,
        hasReplay: () => false,
        draw: noop,
      },
      getBestTime: () => undefined,
    } as unknown as GameContext;
    stage = module.default.build();
    stage!.init(context);
    stage!.update(0.1);
    const startsBeforeSwitch = starts;
    const firstControl = overlay.querySelector<HTMLElement>("button, input, select");
    firstControl?.focus();

    function drawColors(): string[] {
      recording.colors.length = 0;
      recording.paints = 0;
      stage!.draw();
      assert.ok(recording.paints > 0, `${id} must draw its scene`);
      return [...recording.colors];
    }
    const light = drawColors();
    theme.setTheme("dark");
    const dark = drawColors();
    assert.notDeepEqual(dark, light, `${id} must respond to a live theme change`);
    theme.setTheme("light");
    assert.deepEqual(drawColors(), light, `${id} must restore the light palette`);
    assert.equal(starts, startsBeforeSwitch, "Theme switching must not restart a recording");
    if (firstControl) {
      assert.ok(firstControl.isConnected, "Theme switching must preserve existing controls");
      assert.equal(document.activeElement, firstControl, "Theme switching must preserve focus");
    }
    stage!.update(0.1);
    stage!.reset();
    stage!.update(0.1);
    drawColors();
    stage!.dispose();
    stage = undefined;
    const paintsAfterDispose = totalPaints;
    theme.setTheme("dark");
    theme.setTheme("light");
    assert.equal(totalPaints, paintsAfterDispose, "Disposed stages must stop theme redraws");
  });
}
