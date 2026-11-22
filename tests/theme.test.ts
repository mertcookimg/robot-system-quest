// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import { StorageKeys } from "../src/core/storage";

let browser: Window;
let server: ViteDevServer;
let dispose: (() => void) | undefined;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

async function openPage(saved?: string, blocked = false) {
  browser = new Window({ url: "https://example.org/robot-system-quest/?lang=ja" });
  if (saved) browser.localStorage.setItem(StorageKeys.theme, saved);
  browser.document.head.innerHTML =
    '<meta name="theme-color" content="#f3f6fb"><meta name="color-scheme" content="light">';
  browser.document.body.innerHTML = ["home", "header"]
    .map(
      (id) => `<div id="${id}" data-theme-switcher role="group">
        <button data-theme-option="light"><span data-theme-label>Light</span></button>
        <button data-theme-option="dark"><span data-theme-label>Dark</span></button>
      </div>`,
    )
    .join("");
  for (const key of ["window", "document", "localStorage", "navigator", "location", "history"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value =
      key === "window"
        ? browser
        : key === "localStorage" && blocked
          ? {
              getItem() {
                throw new Error("Storage blocked");
              },
              setItem() {
                throw new Error("Storage blocked");
              },
            }
          : Reflect.get(browser, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const theme = (await server.ssrLoadModule(
    "/src/core/theme.ts",
  )) as typeof import("../src/core/theme");
  const switcher = (await server.ssrLoadModule(
    "/src/core/theme_switcher.ts",
  )) as typeof import("../src/core/theme_switcher");
  dispose = switcher.setupThemeSwitchers();
  return theme;
}

afterEach(async () => {
  dispose?.();
  dispose = undefined;
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  descriptors.clear();
});

test("saved dark theme restores on either page, including native controls and browser color", async () => {
  const api = await openPage("dark");
  assert.equal(api.getTheme(), "dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
  assert.equal(document.documentElement.style.colorScheme, "dark");
  assert.equal(document.documentElement.style.getPropertyValue("--bg"), api.theme.bg);
  assert.equal(document.documentElement.style.getPropertyValue("--cyan"), api.theme.accent);
  assert.equal(
    document.querySelector('meta[name="theme-color"]')!.getAttribute("content"),
    api.theme.bg,
  );
  for (const button of document.querySelectorAll('[data-theme-option="dark"]'))
    assert.equal(button.getAttribute("aria-pressed"), "true");
});

test("theme buttons synchronize, persist and preserve the shared palette object", async () => {
  const api = await openPage();
  const palette = api.theme;
  const draw = (await server.ssrLoadModule("/src/lib/draw.ts")) as typeof import("../src/lib/draw");
  const initialAccent = draw.COLORS.ACCENT;
  let changes = 0;
  const unsubscribe = api.onThemeChange(() => changes++);
  const button = document.querySelector<HTMLButtonElement>('#home [data-theme-option="dark"]')!;
  button.focus();
  button.click();
  assert.equal(document.activeElement, button, "Changing theme must not steal keyboard focus");
  assert.equal(api.theme, palette);
  assert.notEqual(draw.COLORS.ACCENT, initialAccent);
  assert.equal(draw.COLORS.ACCENT, api.theme.accent);
  assert.equal(localStorage.getItem(StorageKeys.theme), "dark");
  assert.equal(
    document.querySelector('#header [data-theme-option="dark"]')!.getAttribute("aria-pressed"),
    "true",
  );
  button.click();
  assert.equal(changes, 1, "Selecting the active choice must not trigger another repaint");
  document.querySelector<HTMLButtonElement>('#header [data-theme-option="light"]')!.click();
  assert.equal(draw.COLORS.ACCENT, initialAccent);
  assert.equal(localStorage.getItem(StorageKeys.theme), "light");
  assert.equal(changes, 2);
  unsubscribe();
  api.setTheme("dark");
  assert.equal(changes, 2);
});

test("unavailable storage still permits switching and an invalid saved choice uses light", async () => {
  const api = await openPage("invalid", true);
  assert.equal(api.getTheme(), "light");
  assert.doesNotThrow(() => api.setTheme("dark"));
  assert.equal(api.getTheme(), "dark");
  assert.equal(document.documentElement.dataset.theme, "dark");
});

test("theme labels localize without changing the selection", async () => {
  const api = await openPage("dark");
  const language = (await server.ssrLoadModule(
    "/src/i18n/index.ts",
  )) as typeof import("../src/i18n");
  const button = document.querySelector('[data-theme-option="dark"]')!;
  assert.equal(button.getAttribute("aria-label"), "ダークテーマ");
  language.setLang("en");
  assert.equal(button.getAttribute("aria-label"), "Dark theme");
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(api.getTheme(), "dark");
});

test("another tab updates the theme and disposed switchers stop listening", async () => {
  const api = await openPage();
  localStorage.setItem(StorageKeys.theme, "dark");
  browser.dispatchEvent(
    new browser.StorageEvent("storage", { key: StorageKeys.theme, newValue: "dark" }),
  );
  assert.equal(api.getTheme(), "dark");
  dispose?.();
  localStorage.setItem(StorageKeys.theme, "light");
  browser.dispatchEvent(
    new browser.StorageEvent("storage", { key: StorageKeys.theme, newValue: "light" }),
  );
  assert.equal(api.getTheme(), "dark");
});

test("shared text meets 4.5:1 and essential control boundaries meet 3:1 in both themes", async () => {
  const api = await openPage();
  const luminance = (hex: string): number => {
    const rgb = hex
      .match(/[a-f\d]{2}/gi)!
      .map((n) => parseInt(n, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(a),
      y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const name of ["light", "dark"] as const) {
    api.setTheme(name);
    for (const surface of [
      "bg",
      "bg2",
      "panel",
      "panel2",
      "floor",
      "canvasBg",
      "canvasPanel",
      "rightPane",
      "termBg",
      "termBodyBg",
    ] as const) {
      assert.ok(
        contrast(api.theme.line, api.theme[surface]) >= 3,
        `${name}: control boundary on ${surface}`,
      );
      for (const ink of [
        "fg",
        "fgMid",
        "fgDim",
        "accent",
        "accent2",
        "ok",
        "warn",
        "danger",
      ] as const)
        assert.ok(
          contrast(api.theme[ink], api.theme[surface]) >= 4.5,
          `${name}: ${ink} on ${surface}`,
        );
    }
    for (const fill of ["accent", "accent2", "ok", "warn", "danger"] as const)
      assert.ok(contrast(api.theme.onAccent, api.theme[fill]) >= 4.5, `${name}: filled ${fill}`);
  }
});

for (const entry of ["../index.html", "../guide/index.html"]) {
  test(`${entry}: saved theme is applied before stylesheets load`, async () => {
    const html = await readFile(new URL(entry, import.meta.url), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)!;
    assert.ok(script);
    assert.ok(html.indexOf(script[0]) < html.indexOf('rel="stylesheet"'));
    const page = new Window();
    page.document.head.innerHTML = '<meta name="color-scheme"><meta name="theme-color">';
    try {
      runInNewContext(script[1], {
        document: page.document,
        localStorage: { getItem: () => "dark" },
      });
      assert.equal(page.document.documentElement.dataset.theme, "dark");
      assert.equal(page.document.documentElement.style.colorScheme, "dark");
      runInNewContext(script[1], {
        document: page.document,
        localStorage: {
          getItem() {
            throw Error();
          },
        },
      });
      assert.equal(page.document.documentElement.dataset.theme, "light");
    } finally {
      await page.happyDOM.close();
    }
  });
}
