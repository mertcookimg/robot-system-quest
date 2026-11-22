// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";

for (const scenario of [
  { name: "local development", production: false, id: "G-TEST123", enabled: false },
  { name: "production without an ID", production: true, id: "", enabled: false },
  { name: "production with an invalid ID", production: true, id: "invalid", enabled: false },
  { name: "configured production", production: true, id: "G-TEST123", enabled: true },
]) {
  test(`${scenario.name}: app and Guide analytics notices follow the active setup`, async () => {
    // Exercise script creation without fetching or executing a remote analytics script.
    const browser = new Window({ settings: { disableJavaScriptFileLoading: true } });
    const descriptors = new Map<string, PropertyDescriptor | undefined>();
    let server: ViteDevServer | undefined;
    try {
      for (const key of ["window", "document"]) {
        descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {
          configurable: true,
          value: key === "window" ? browser : browser.document,
        });
      }
      const pages = await Promise.all(
        ["../index.html", "../guide/index.html"].map((path) =>
          readFile(new URL(path, import.meta.url), "utf8"),
        ),
      );
      document.body.innerHTML = pages
        .map((html) => html.match(/<small\b[^>]*data-analytics-note[^>]*>[\s\S]*?<\/small>/)![0])
        .join("");
      const notes = [...document.querySelectorAll<HTMLElement>("[data-analytics-note]")];
      assert.equal(notes.length, 2);
      assert.ok(
        notes.every((note) => note.hidden),
        "Both pages hide the notice before setup",
      );
      server = await createServer({
        configFile: false,
        appType: "custom",
        logLevel: "error",
        server: { middlewareMode: true, watch: null, ws: false },
        optimizeDeps: { noDiscovery: true, include: [] },
        define: {
          "import.meta.env.PROD": scenario.production,
          "import.meta.env.VITE_GA_ID": JSON.stringify(scenario.id),
        },
      });
      const analytics = await server.ssrLoadModule("/src/core/analytics.ts");
      analytics.setupAnalytics();
      assert.ok(notes.every((note) => note.hidden === !scenario.enabled));
      assert.equal(
        document.querySelectorAll('script[src^="https://www.googletagmanager.com/gtag/js"]').length,
        scenario.enabled ? 1 : 0,
      );
      const dataLayer = Reflect.get(browser, "dataLayer") as IArguments[] | undefined;
      assert.equal(dataLayer?.length ?? 0, scenario.enabled ? 2 : 0);
      analytics.trackGuideOpen("racing", "game");
      if (scenario.enabled) assert.equal(dataLayer!.at(-1)![1], "guide_open");
      else assert.equal(dataLayer, undefined, "Disabled setup must not send measurements");
    } finally {
      await server?.close();
      await browser.happyDOM.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  });
}
