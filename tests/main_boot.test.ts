// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Boot the actual entry point and its lazy imports. Canvas pixels and browser
// layout are outside this integration test; all shell event wiring is real.
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";

async function boot(t: TestContext, url: string, progress: Record<string, { stars: number }> = {}) {
  const browser = new Window({ url });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  let server: ViteDevServer | undefined;
  let manager: typeof import("../src/core/stage_manager") | undefined;
  let timers: typeof import("../src/core/stage_timers") | undefined;
  browser.requestAnimationFrame = () => 1;
  browser.cancelAnimationFrame = () => {};
  t.after(async () => {
    timers?.clearStageTimeouts();
    if (manager?.isStageReady()) manager.getCurrent().dispose();
    await server?.close();
    await browser.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
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
    "IntersectionObserver",
    "ResizeObserver",
    "DOMRect",
    "NodeFilter",
    "getComputedStyle",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    let value = key === "window" ? browser : Reflect.get(browser, key);
    if (
      ["getComputedStyle", "matchMedia", "requestAnimationFrame", "cancelAnimationFrame"].includes(
        key,
      )
    ) {
      value = value.bind(browser);
    }
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  browser.HTMLCanvasElement.prototype.getContext = function () {
    const pixels = (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    });
    return new Proxy(
      { canvas: this },
      {
        get(target, key) {
          if (key === "canvas") return target.canvas;
          if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
          if (key === "createImageData") return pixels;
          if (key === "getImageData")
            return (_x: number, _y: number, width: number, height: number) => pixels(width, height);
          if (String(key).startsWith("create") && String(key).endsWith("Gradient"))
            return () => ({ addColorStop() {} });
          return Reflect.get(target, key) ?? (() => {});
        },
      },
    );
  } as typeof browser.HTMLCanvasElement.prototype.getContext;
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  localStorage.setItem("robot_audio", "off");
  localStorage.setItem("robot_quest_progress_v5", JSON.stringify(progress));
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.ssrLoadModule("/src/main.ts");
  manager = (await server.ssrLoadModule(
    "/src/core/stage_manager.ts",
  )) as typeof import("../src/core/stage_manager");
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  const intro = (await server.ssrLoadModule(
    "/src/core/intro.ts",
  )) as typeof import("../src/core/intro");
  const menu = (await server.ssrLoadModule(
    "/src/core/stage_menu.ts",
  )) as typeof import("../src/core/stage_menu");
  const lesson = (await server.ssrLoadModule(
    "/src/core/lesson_modal.ts",
  )) as typeof import("../src/core/lesson_modal");
  const modes = (await server.ssrLoadModule(
    "/src/core/modes.ts",
  )) as typeof import("../src/core/modes");
  await manager.whenStageReady();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    manager.isStageReady(),
    true,
    "The full entry point must finish initializing its stage",
  );
  return { manager, intro, menu, lesson, modes };
}

function homeCard(mode: "game" | "lesson"): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(`.intro-mode[data-mode="${mode}"]`)!;
}

test("Home boots the full catalog while loading only Delivery and keeping the root URL", async (t) => {
  const { manager, intro, lesson } = await boot(t, "http://localhost/");
  assert.equal(intro.isShown(), true);
  assert.equal(manager.getCurrentId(), "delivery");
  assert.equal(manager.getStages().length, 38);
  assert.equal(document.getElementById("intro-stage-count")!.textContent, "38");
  assert.equal(document.querySelectorAll(".stage-pill").length, 14);
  assert.equal(location.hash, "");
  assert.deepEqual(
    manager
      .getStages()
      .filter((stage) => stage.ros2)
      .map((stage) => stage.id),
    ["delivery"],
  );
  assert.equal(lesson.isOpen(), false);
  homeCard("game").click();
  await manager.whenStageReady();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(intro.isShown(), false);
  assert.equal(lesson.isOpen(), true, "Starting a first visit must offer its briefing");
});

test("a Guide direct link boots its lazy lesson and consumes only the direct-open query", async (t) => {
  const { manager, intro, modes } = await boot(
    t,
    "http://localhost/?direct=stage&lang=ja#navigation",
  );
  assert.equal(intro.isShown(), false);
  assert.equal(manager.getCurrentId(), "navigation");
  assert.equal(modes.getMode(), "lesson");
  assert.equal(document.querySelectorAll(".stage-pill").length, 24);
  assert.equal(manager.getStages().length, 38);
  assert.equal(new URLSearchParams(location.search).has("direct"), false);
  assert.equal(new URLSearchParams(location.search).get("lang"), "ja");
  assert.equal(location.hash, "#navigation");
  assert.equal(document.documentElement.lang, "ja");
  assert.deepEqual(
    manager
      .getStages()
      .filter((stage) => stage.ros2)
      .map((stage) => stage.id),
    ["navigation"],
  );
});

test("returning Home waits for its next lazy stage and keeps the briefing behind the stage menu", async (t) => {
  const { manager, intro, menu, lesson } = await boot(t, "http://localhost/", {
    delivery: { stars: 1 },
  });
  assert.equal(manager.getCurrentId(), "delivery");
  homeCard("game").click();
  assert.equal(intro.isShown(), false);
  assert.equal(manager.getCurrentId(), "follower");
  assert.equal(manager.isStageReady(), false, "The next stage must be imported on demand");
  await manager.whenStageReady();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(manager.getCurrentId(), "follower");
  assert.equal(menu.isOpen(), true);
  assert.equal(lesson.isOpen(), false, "The delayed first-visit briefing must not cover the menu");
  assert.deepEqual(
    manager
      .getStages()
      .filter((stage) => stage.ros2)
      .map((stage) => stage.id),
    ["delivery", "follower"],
  );
  menu.closeMenu();
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(lesson.isOpen(), true, "Closing the menu must offer the deferred briefing");
  assert.equal(document.getElementById("lesson-title")!.textContent, "FOLLOWER");
});
