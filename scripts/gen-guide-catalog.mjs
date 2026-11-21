// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Evaluate the stage manifests at build time, never in the Guide visitor's
// browser. The checked-in catalog also lets plain Vite and DOM tests run.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { createServer } from "vite";
import { format, resolveConfig } from "prettier";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = new URL("../src/guide/stages.generated.json", import.meta.url);
const runtimeDestination = new URL("../src/core/stages.generated.json", import.meta.url);

async function readCatalog(lang) {
  const browser = new Window({ url: "http://localhost/" });
  const originals = new Map();
  for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement"]) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : browser[key],
    });
  }
  browser.localStorage.setItem("robot_quest_lang_v1", lang);
  browser.localStorage.setItem("robot_audio", "off");
  // Some legacy factories prepare their demo image while registering. Only
  // metadata is exported; a canvas shim avoids requiring a graphics driver.
  browser.HTMLCanvasElement.prototype.getContext = function () {
    const pixels = (width, height) => ({
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
    });
    return new Proxy(
      { canvas: this },
      {
        get(target, key) {
          if (key === "canvas") return target.canvas;
          if (key === "createImageData") return pixels;
          if (key === "getImageData") return (_x, _y, width, height) => pixels(width, height);
          if (key === "measureText") return (text) => ({ width: text.length * 7 });
          if (String(key).startsWith("create") && String(key).endsWith("Gradient"))
            return () => ({ addColorStop() {} });
          return () => {};
        },
      },
    );
  };
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  browser.document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let server;
  try {
    // A separate module graph for each language also captures legacy metadata
    // whose tx() calls happen during the factory rather than in a getter.
    server = await createServer({
      root,
      configFile: false,
      appType: "custom",
      logLevel: "error",
      server: { middlewareMode: true, watch: null, ws: false },
      optimizeDeps: { noDiscovery: true, include: [] },
    });
    await server.ssrLoadModule("/src/core/stage_collect.ts");
    const registry = await server.ssrLoadModule("/src/core/stage_def.ts");
    const modes = registry.getStageModes();
    const numbers = registry.getLessonNumbers();
    return registry.getStages().map((stage) => {
      const { id, name, lesson, lessonCmd, ros2 } = stage;
      const concept = ros2 ? { ...ros2 } : undefined;
      // Author-only Python snippets are neither displayed nor executed by Guide.
      if (concept) delete concept.python;
      return {
        id,
        mode: modes.get(id),
        lessonNumber: numbers.get(id),
        diagram: registry.getDiagram(id),
        meta: { id, name, lesson, lessonCmd, ros2: concept },
      };
    });
  } finally {
    await server?.close();
    await browser.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const ja = await readCatalog("ja");
const en = await readCatalog("en");
const catalog = ja.map(({ meta, ...entry }, index) => {
  if (en[index]?.id !== entry.id) throw new Error("Guide catalog order differs by language");
  return { ...entry, ja: meta, en: en[index].meta };
});
const listings = catalog.map((entry, index) => ({
  id: entry.id,
  mode: entry.mode,
  order: index + 1,
  ja: { name: entry.ja.name, lesson: entry.ja.lesson },
  en: { name: entry.en.name, lesson: entry.en.lesson },
}));
for (const [name, path, data] of [
  ["Guide catalog", destination, catalog],
  ["Stage listings", runtimeDestination, listings],
]) {
  const output = await format(JSON.stringify(data), {
    ...(await resolveConfig(fileURLToPath(path))),
    parser: "json",
  });
  const previous = await readFile(path, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return "";
  });
  if (process.argv.includes("--check")) {
    if (previous !== output) {
      console.error(`${name} is out of date. Run: npm run gen:guide`);
      process.exitCode = 1;
    } else console.log(`${name} is up to date (${data.length} stages, JA/EN).`);
  } else if (previous !== output) {
    await writeFile(path, output);
    console.log(`Generated ${name} (${data.length} stages, JA/EN).`);
  } else console.log(`${name} already up to date.`);
}
