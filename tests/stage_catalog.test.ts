// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test, { after, afterEach, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";
import type { GameContext, Stage } from "../src/types";
import type { StageListing } from "../src/core/stage_def";

let browser: Window;
let server: ViteDevServer;
let registry: typeof import("../src/core/stage_def");
let i18n: typeof import("../src/i18n");
let loadedRuntimeModules: string[];
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const guide = JSON.parse(
  await readFile(new URL("../src/guide/stages.generated.json", import.meta.url), "utf8"),
) as Array<StageListing & { lessonNumber?: number }>;

before(() => {
  browser = new Window({ url: "http://localhost/" });
  for (const key of ["window", "document", "localStorage", "HTMLElement"]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: key === "window" ? browser : Reflect.get(browser, key),
    });
  }
});

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<canvas width="800" height="500"></canvas><div id="overlay"></div>';
  loadedRuntimeModules = [];
  // A fresh module graph isolates the registry for each scenario. The plugin
  // observes stage/weight loads without importing those modules itself.
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [
      {
        name: "observe-stage-loads",
        transform(_code, id) {
          const path = id.replaceAll("\\", "/");
          if (/\/src\/(stages\/|lib\/(vla|world_model)_weights\.ts)/.test(path)) {
            loadedRuntimeModules.push(path.slice(path.indexOf("/src/")));
          }
        },
      },
    ],
  });
  registry = (await server.ssrLoadModule("/src/core/stage_def.ts")) as typeof registry;
  i18n = (await server.ssrLoadModule("/src/i18n/index.ts")) as typeof i18n;
});

afterEach(async () => {
  await server?.close();
});

after(async () => {
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

async function loadCatalog(): Promise<Stage[]> {
  await server.ssrLoadModule("/src/core/stage_catalog.ts");
  return registry.getStages();
}

function assertCatalogOrder(): void {
  assert.deepEqual(
    registry.getStages().map((stage) => stage.id),
    guide.map((entry) => entry.id),
  );
  assert.deepEqual(
    [...registry.getStageModes()],
    guide.map((entry) => [entry.id, entry.mode]),
  );
  assert.deepEqual(
    [...registry.getLessonNumbers()],
    guide
      .filter((entry) => entry.lessonNumber !== undefined)
      .map((entry) => [entry.id, entry.lessonNumber]),
  );
}

function listing(id = "lazy_fixture"): StageListing {
  return {
    id,
    mode: "lesson",
    order: 1,
    ja: { name: "遅延ステージ", lesson: "実装を必要な時に読み込む" },
    en: { name: "Lazy stage", lesson: "Load the implementation when needed" },
  };
}

function implementation(id = "lazy_fixture", overrides: Partial<Stage> = {}): Stage {
  const noop = () => {};
  return {
    id,
    name: "Loaded stage",
    lesson: "Loaded lesson",
    lessonCmd: "ros2 node list",
    init: noop,
    update: noop,
    draw: noop,
    reset: noop,
    dispose: noop,
    ...overrides,
  };
}

test("the catalog exposes all bilingual menus without loading stage code or model weights", async () => {
  const handles = await loadCatalog();
  assert.equal(handles.length, 38);
  assert.equal([...registry.getStageModes().values()].filter((mode) => mode === "game").length, 14);
  assert.equal(registry.getLessonNumbers().size, 24);
  assertCatalogOrder();
  for (const lang of ["ja", "en"] as const) {
    i18n.setLang(lang);
    for (const stage of handles) {
      const expected = guide.find((entry) => entry.id === stage.id)![lang];
      assert.equal(stage.name, expected.name);
      assert.equal(stage.lesson, expected.lesson);
      assert.equal(stage.ros2, undefined);
    }
  }
  assert.deepEqual(loadedRuntimeModules, []);
});

test("preparing Delivery loads only its implementation and preserves all 38 handles", async () => {
  const handles = await loadCatalog();
  const delivery = handles.find((stage) => stage.id === "delivery")!;
  i18n.setLang("en");
  const pending = registry.prepareStage(delivery);
  assert.ok(pending instanceof Promise);
  assert.equal(registry.prepareStage(delivery), pending, "Share concurrent load requests");
  await pending;
  assert.deepEqual(loadedRuntimeModules, ["/src/stages/game/delivery.ts"]);
  assert.deepEqual(registry.getStages(), handles);
  assertCatalogOrder();
  assert.equal(registry.prepareStage(delivery), undefined, "Loaded stages are synchronous");
  assert.ok(delivery.ros2?.state?.topics.some((topic) => topic.name === "/robot/odom"));
  assert.match(delivery.ros2!.title, /drive the robot/);
  assert.ok(delivery.lessonCmd.startsWith("ros2 "));
  for (const lang of ["ja", "en"] as const) {
    i18n.setLang(lang);
    assert.match(i18n.t("delivery.status.pickup"), lang === "ja" ? /パッケージ/ : /package/);
    assert.match(i18n.t("delivery.lesson.title"), lang === "ja" ? /入門/ : /basics/);
  }
  assert.ok(
    handles.filter((stage) => stage !== delivery).every((stage) => stage.ros2 === undefined),
  );

  const poses: number[][] = [];
  const noop = () => {};
  delivery.init({
    keys: new Set(["w"]),
    setStatus: noop,
    setHud: noop,
    publish: noop,
    ghost: { startRecording: noop, recordPose: (...pose: number[]) => poses.push(pose) },
  } as unknown as GameContext);
  delivery.update(0.1);
  assert.deepEqual(poses.at(-1), [0.1, 420, 250, 0]);
  delivery.dispose();
});

test("loading a middle Lesson keeps menu order and lesson numbers unchanged", async () => {
  const handles = await loadCatalog();
  const navigation = handles.find((stage) => stage.id === "navigation")!;
  assert.equal(registry.getLessonNumbers().get(navigation.id), 13);
  await registry.prepareStage(navigation);
  assertCatalogOrder();
  assert.deepEqual(registry.getStages(), handles);
  assert.equal(registry.getLessonNumbers().get(navigation.id), 13);
  assert.deepEqual(loadedRuntimeModules, ["/src/stages/lesson/navigation.ts"]);
});

test("a lazy handle stays stable and delegates metadata and every lifecycle method after loading", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let loads = 0;
  let builds = 0;
  const calls: Array<[string, unknown?]> = [];
  const actual = implementation("lazy_fixture", {
    init: (context) => {
      calls.push(["init", context]);
    },
    update: (dt) => {
      calls.push(["update", dt]);
    },
    draw: () => {
      calls.push(["draw"]);
    },
    reset: () => {
      calls.push(["reset"]);
    },
    dispose: () => {
      calls.push(["dispose"]);
    },
  });
  registry.registerStageLoader(listing(), async () => {
    loads++;
    await gate;
    registry.defineStage({
      mode: "lesson",
      order: 1,
      build: () => {
        builds++;
        return actual;
      },
    });
  });
  const handle = registry.getStages()[0];
  i18n.setLang("ja");
  assert.equal(handle.name, "遅延ステージ");
  i18n.setLang("en");
  assert.equal(handle.name, "Lazy stage");
  assert.equal(loads, 0);
  assert.equal(builds, 0);
  const pending = registry.prepareStage(handle);
  assert.equal(registry.prepareStage(handle), pending);
  assert.equal(loads, 1);
  assert.equal(builds, 0);
  release();
  await pending;
  assert.equal(builds, 1);
  assert.equal(registry.getStages()[0], handle);
  assert.equal(registry.getStages().length, 1);
  assert.equal(handle.name, actual.name);
  assert.equal(handle.lesson, actual.lesson);
  assert.equal(handle.lessonCmd, actual.lessonCmd);
  const context = {} as GameContext;
  handle.init(context);
  handle.update(0.05);
  handle.draw();
  handle.reset();
  handle.dispose();
  assert.deepEqual(calls, [["init", context], ["update", 0.05], ["draw"], ["reset"], ["dispose"]]);
  assert.equal(registry.prepareStage(handle), undefined);
  assert.equal(loads, 1);
});

for (const failure of ["network", "missing registration"] as const) {
  test(`a ${failure} failure leaves the stage retryable`, async () => {
    let attempts = 0;
    registry.registerStageLoader(listing(), async () => {
      if (++attempts === 1) {
        if (failure === "network") throw new Error("network unavailable");
        return;
      }
      registry.defineStage({ mode: "lesson", order: 1, build: () => implementation() });
    });
    const handle = registry.getStages()[0];
    const first = registry.prepareStage(handle)!;
    assert.equal(registry.prepareStage(handle), first);
    await assert.rejects(first, failure === "network" ? /network unavailable/ : /did not register/);
    assert.equal(handle.lessonCmd, "");
    await registry.prepareStage(handle);
    assert.equal(attempts, 2);
    assert.equal(registry.getStages()[0], handle);
    assert.equal(handle.lessonCmd, "ros2 node list");
    assert.equal(registry.prepareStage(handle), undefined);
  });
}

test("eager and standalone stages do not require asynchronous preparation", () => {
  const standalone = implementation("standalone");
  assert.equal(registry.prepareStage(standalone), undefined);
  registry.defineStage({ mode: "game", order: 1, build: () => implementation("eager") });
  assert.equal(registry.prepareStage(registry.getStages()[0]), undefined);
});
