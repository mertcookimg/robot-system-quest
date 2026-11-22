// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { Stage } from "../src/types";

let browser: Window;
let server: ViteDevServer;
let modes: typeof import("../src/core/modes");
let manager: typeof import("../src/core/stage_manager");
let timers: typeof import("../src/core/stage_timers");
let setLang: (lang: "ja" | "en") => void;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const fixtures = ["game", "lesson"].map((mode) => ({
  id: `footer-${mode}`,
  name: `Footer ${mode}`,
  lesson: "Fixture concept",
  lessonCmd: "",
  init() {},
  reset() {},
  update() {},
  draw() {},
  dispose() {},
})) as Stage[];

before(async () => {
  browser = new Window({ url: "http://localhost/" });
  browser.matchMedia = (() => ({ matches: true })) as typeof browser.matchMedia;
  browser.HTMLCanvasElement.prototype.getContext = (() =>
    null) as typeof browser.HTMLCanvasElement.prototype.getContext;
  for (const key of [
    "window",
    "document",
    "navigator",
    "history",
    "localStorage",
    "Element",
    "HTMLElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "MutationObserver",
    "matchMedia",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] });
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
  await server.ssrLoadModule("/src/core/stage_catalog.ts");
  const registry = await server.ssrLoadModule("/src/core/stage_def.ts");
  fixtures.forEach((stage, index) =>
    registry.defineStage({
      mode: index === 0 ? "game" : "lesson",
      order: 999,
      build: () => stage,
    }),
  );
  ({ setLang } = await server.ssrLoadModule("/src/i18n/index.ts"));
  modes = (await server.ssrLoadModule("/src/core/modes.ts")) as typeof modes;
  manager = (await server.ssrLoadModule("/src/core/stage_manager.ts")) as typeof manager;
  timers = (await server.ssrLoadModule("/src/core/stage_timers.ts")) as typeof timers;
  const stages = registry.getStages();
  manager.setStages(stages);
  manager.buildGameContext(
    document.getElementById("game") as HTMLCanvasElement,
    {} as CanvasRenderingContext2D,
  );
  modes.setupModes({
    stages,
    getCurrentStageId: manager.getCurrentId,
    loadStage: manager.loadStage,
  });
});

after(async () => {
  timers.clearStageTimeouts();
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("all five local multiplayer games advertise keyboard and gamepads in JA and EN", () => {
  const expected = ["racing", "robo_soccer", "tag_chase", "sumo_battle", "robo_tennis"].sort();
  modes.setModeView("game");
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    const badges = [...document.querySelectorAll<HTMLElement>(".multiplayer-badge")];
    assert.deepEqual(
      badges
        .map(
          (badge) =>
            badge.closest(".stage-pill")!.querySelector<HTMLElement>("[data-stage-demo]")!.dataset
              .stageDemo,
        )
        .sort(),
      expected,
    );
    for (const badge of badges) {
      assert.equal(badge.textContent, lang === "ja" ? "2P 対戦" : "LOCAL 2P");
      const label = badge.closest(".stage-pill")!.getAttribute("aria-label")!;
      assert.match(label, lang === "ja" ? /キーボード.*ゲームパッド/ : /keyboard.*gamepads/);
      assert.ok(label.includes(badge.title));
    }
  }
});

test("footer follows the loaded Game or Lesson, even while browsing the opposite menu", async () => {
  const label = document.getElementById("stage-mode-label")!;
  await manager.loadStage("footer-game");
  assert.equal(label.textContent, "Game");
  modes.setModeView("lesson");
  assert.equal(label.textContent, "Game", "Menu browsing does not change the playing stage");
  await manager.loadStage("footer-lesson");
  assert.equal(label.textContent, "Lesson");
  modes.setModeView("game");
  assert.equal(label.textContent, "Lesson");
  await manager.loadStage("footer-game");
  assert.equal(label.textContent, "Game");
});
