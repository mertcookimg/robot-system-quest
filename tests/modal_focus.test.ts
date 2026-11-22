// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer } from "vite";

test("hidden dialogs cannot act or trap focus; open dialogs isolate and restore their background", async () => {
  const browser = new Window({ url: "http://localhost/" });
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  const frames: FrameRequestCallback[] = [];
  for (const key of [
    "window",
    "document",
    "navigator",
    "localStorage",
    "HTMLElement",
    "Event",
    "KeyboardEvent",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        key === "window"
          ? browser
          : key === "requestAnimationFrame"
            ? (cb: FrameRequestCallback) => frames.push(cb)
            : key === "cancelAnimationFrame"
              ? () => {}
              : Reflect.get(browser, key),
    });
  }
  const server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    document.body.innerHTML = html
      .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    localStorage.setItem("robot_audio", "off");
    const { ui } = await server.ssrLoadModule("/src/core/dom.ts");
    const intro = await server.ssrLoadModule("/src/core/intro.ts");
    const lesson = await server.ssrLoadModule("/src/core/lesson_modal.ts");
    const allclear = await server.ssrLoadModule("/src/core/allclear.ts");
    const help = await server.ssrLoadModule("/src/core/help.ts");
    const { registerLang } = await server.ssrLoadModule("/src/i18n/index.ts");
    registerLang({
      en: {
        "fixture.lesson.title": "Fixture",
        "fixture.lesson.goal": "Goal",
        "fixture.lesson.first": "First",
        "fixture.lesson.learn": "Learn",
      },
    });
    let selected = 0;
    let restarted = 0;
    intro.setupIntro({
      onSelectMode() {
        selected++;
      },
    });
    lesson.setupLessonModal(() => "fixture");
    allclear.setupAllClear(() => restarted++);
    help.setupHelp();
    ui.canvas.tabIndex = 0;
    ui.canvas.focus();
    ui.introScreen.querySelector("[data-mode]").click();
    ui.allclearRestart.click();
    assert.equal(selected, 0);
    assert.equal(restarted, 0);
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    ui.lessonClose.dispatchEvent(tab);
    assert.equal(tab.defaultPrevented, false);
    assert.equal(document.activeElement, ui.canvas);
    for (const modal of [ui.introScreen, ui.lessonModal, ui.allclearScreen]) {
      assert.equal(modal.inert, true);
      assert.equal(modal.getAttribute("aria-hidden"), "true");
    }
    intro.show();
    assert.ok(ui.canvas.closest("[inert]"));
    assert.equal(ui.introScreen.inert, false);
    const lazyControl = document.createElement("button");
    document.body.append(lazyControl);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(lazyControl.inert, true, "Late-mounted stage controls stay behind Home");
    // Nested modal close returns to Home, keeping the stage disabled.
    help.open();
    assert.equal(ui.introScreen.inert, true);
    help.close();
    assert.equal(ui.introScreen.inert, false);
    assert.ok(ui.canvas.closest("[inert]"));
    intro.start();
    assert.equal(lazyControl.inert, false);
    lazyControl.remove();
    assert.equal(ui.canvas.closest("[inert]"), null);
    assert.equal(document.activeElement, ui.canvas);
    const card = ui.lessonModal.querySelector<HTMLElement>(".lesson-card")!;
    card.scrollTop = 500;
    const focus = ui.lessonClose.focus.bind(ui.lessonClose);
    let preventScroll = false;
    ui.lessonClose.focus = (options?: FocusOptions) => {
      preventScroll = options?.preventScroll === true;
      focus(options);
    };
    lesson.open("fixture");
    frames.splice(0).forEach((cb) => cb(0));
    assert.equal(card.scrollTop, 0);
    assert.equal(preventScroll, true);
    assert.equal(document.activeElement, ui.lessonClose);
    assert.ok(ui.canvas.closest("[inert]"));
    lesson.close();
    ui.lessonClose.focus = focus;
    assert.equal(ui.canvas.closest("[inert]"), null);
    assert.equal(document.activeElement, ui.canvas);
    allclear.show([]);
    assert.equal(document.activeElement, ui.allclearRestart);
    assert.ok(ui.canvas.closest("[inert]"));
    ui.allclearRestart.click();
    assert.equal(restarted, 1);
    assert.equal(ui.canvas.closest("[inert]"), null);
    assert.equal(document.activeElement, ui.canvas);
  } finally {
    await server.close();
    await browser.happyDOM.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
