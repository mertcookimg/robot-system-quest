// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import { StorageKeys } from "../src/core/storage";

let browser: Window;
let server: ViteDevServer;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

async function openPage({
  url = "https://example.org/robot-system-quest/",
  saved,
  locale = "ja-JP",
  blockedStorage = false,
  documentOnly = false,
}: {
  url?: string;
  saved?: string;
  locale?: string;
  blockedStorage?: boolean;
  documentOnly?: boolean;
} = {}) {
  browser = new Window({ url });
  if (saved) browser.localStorage.setItem(StorageKeys.lang, saved);
  browser.document.body.innerHTML = `
    <a id="guide" href="./guide/?stage=navigation#lessons" data-lang-link>Guide</a>
    <a id="external" href="https://example.net/">External</a>
    <a id="section" href="#overview">Overview</a>`;
  const globals = {
    document: browser.document,
    location: browser.location,
    history: browser.history,
    navigator: { language: locale },
    localStorage: blockedStorage
      ? {
          getItem() {
            throw new Error("Storage disabled");
          },
          setItem() {
            throw new Error("Storage disabled");
          },
        }
      : browser.localStorage,
  };
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    if (documentOnly && (key === "location" || key === "history")) {
      Reflect.deleteProperty(globalThis, key);
    } else {
      Object.defineProperty(globalThis, key, { configurable: true, value });
    }
  }
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  return (await server.ssrLoadModule("/src/i18n/index.ts")) as typeof import("../src/i18n");
}

afterEach(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  descriptors.clear();
});

test("English QR entry overrides Japanese storage and browser locale", async () => {
  const language = await openPage({
    url: "https://example.org/robot-system-quest/?lang=en",
    saved: "ja",
  });
  assert.equal(language.getLang(), "en");
  assert.equal(document.documentElement.lang, "en");
  assert.equal(document.body.classList.contains("lang-en"), true);
  assert.equal(localStorage.getItem(StorageKeys.lang), "en");
  const guide = new URL((document.getElementById("guide") as HTMLAnchorElement).href);
  assert.equal(guide.pathname, "/robot-system-quest/guide/");
  assert.equal(guide.searchParams.get("lang"), "en");
  assert.equal(guide.searchParams.get("stage"), "navigation");
  assert.equal(guide.hash, "#lessons");
  assert.equal(document.getElementById("external")!.getAttribute("href"), "https://example.net/");
  assert.equal(document.getElementById("section")!.getAttribute("href"), "#overview");
});

test("Japanese entry overrides English storage and browser locale", async () => {
  const language = await openPage({
    url: "https://example.org/robot-system-quest/guide/?lang=ja",
    saved: "en",
    locale: "en-US",
  });
  assert.equal(language.getLang(), "ja");
  assert.equal(document.documentElement.lang, "ja");
  assert.equal(localStorage.getItem(StorageKeys.lang), "ja");
});

for (const query of ["", "?lang=fr", "?lang=", "?lang=EN"]) {
  test(`missing or invalid language ${JSON.stringify(query)} keeps the saved-language fallback`, async () => {
    const language = await openPage({
      url: `https://example.org/robot-system-quest/${query}`,
      saved: "en",
    });
    assert.equal(language.getLang(), "en");
    assert.equal(localStorage.getItem(StorageKeys.lang), "en");
    assert.equal(location.search, query === "?lang=" ? "?lang=" : query);
  });
}

for (const [locale, expected] of [
  ["ja-JP", "ja"],
  ["en-US", "en"],
] as const) {
  test(`invalid language falls back to navigator ${locale} without a valid saved value`, async () => {
    const language = await openPage({
      url: "https://example.org/robot-system-quest/?lang=fr",
      saved: "invalid",
      locale,
    });
    assert.equal(language.getLang(), expected);
  });
}

test("blocked storage still honors English and preserves direct-stage navigation", async () => {
  const language = await openPage({
    url: "https://example.org/robot-system-quest/guide/?lang=en&stage=navigation#lessons",
    blockedStorage: true,
  });
  assert.equal(language.getLang(), "en");
  const destination = new URL(language.withLang("../?direct=stage&campaign=qr#navigation"));
  assert.equal(destination.pathname, "/robot-system-quest/");
  assert.equal(destination.searchParams.get("lang"), "en");
  assert.equal(destination.searchParams.get("direct"), "stage");
  assert.equal(destination.searchParams.get("campaign"), "qr");
  assert.equal(destination.hash, "#navigation");
});

test("blocked storage without a valid URL language keeps navigator fallback", async () => {
  const language = await openPage({ blockedStorage: true });
  assert.equal(language.getLang(), "ja");
});

for (const saved of ["ja", "en"] as const) {
  test(`catalog rendering initializes ${saved} links without global location or history`, async () => {
    // Match gen:guide: these globals must be absent before i18n is imported.
    const language = await openPage({ saved, documentOnly: true });
    assert.equal(typeof location, "undefined");
    assert.equal(typeof history, "undefined");
    assert.equal(language.getLang(), saved);
    const link = document.getElementById("guide") as HTMLAnchorElement;
    const guide = new URL(link.href);
    assert.equal(guide.pathname, "/robot-system-quest/guide/");
    assert.equal(guide.searchParams.get("lang"), saved);
    assert.equal(guide.searchParams.get("stage"), "navigation");
    assert.equal(guide.hash, "#lessons");
    const relative = new URL(language.withLang("./guide/"));
    assert.equal(relative.pathname, "/robot-system-quest/guide/");
    assert.equal(relative.searchParams.get("lang"), saved);
    const next = saved === "ja" ? "en" : "ja";
    language.setLang(next);
    assert.equal(document.documentElement.lang, next);
    assert.equal(document.body.classList.contains(`lang-${next}`), true);
    assert.equal(new URL(link.href).searchParams.get("lang"), next);
  });
}

test("Guide language toggle changes its reload URL while preserving stage, hash and history state", async () => {
  const language = await openPage({
    url: "https://example.org/robot-system-quest/guide/?lang=en&stage=navigation&campaign=qr#lessons",
    blockedStorage: true,
  });
  history.replaceState({ dialog: "navigation" }, "");
  language.toggleLang();
  const current = new URL(location.href);
  assert.equal(current.searchParams.get("lang"), "ja");
  assert.equal(current.searchParams.get("stage"), "navigation");
  assert.equal(current.searchParams.get("campaign"), "qr");
  assert.equal(current.hash, "#lessons");
  assert.deepEqual(history.state, { dialog: "navigation" });
  assert.equal(
    new URL((document.getElementById("guide") as HTMLAnchorElement).href).searchParams.get("lang"),
    "ja",
  );
  server.moduleGraph.invalidateAll();
  const reloaded = await server.ssrLoadModule("/src/i18n/index.ts");
  assert.equal(reloaded.getLang(), "ja");
});
