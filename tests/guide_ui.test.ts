// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
// Real Guide DOM and stage metadata; canvas pixels are not evaluated here.
import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { createServer, type ViteDevServer } from "vite";

let browser: Window;
let server: ViteDevServer;
let setLang: (lang: "ja" | "en") => void;
let mobileQuery: { matches: boolean; dispatchEvent(event: Event): boolean };
const descriptors = new Map<string, PropertyDescriptor | undefined>();

const element = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;
const dialog = () => element<HTMLDialogElement>("stage-dialog");
const content = () => element("dialog-content");

function openStage(id: string): void {
  dialog().close();
  document.querySelector<HTMLButtonElement>(`[data-stage-id="${id}"]`)!.click();
  assert.equal(dialog().open, true);
}

function resizeMobile(matches: boolean): void {
  mobileQuery.matches = matches;
  mobileQuery.dispatchEvent(new Event("change"));
}

before(async () => {
  browser = new Window({ url: "http://localhost/guide/" });
  class Query extends browser.EventTarget {
    matches: boolean;
    constructor(
      public media: string,
      matches: boolean,
    ) {
      super();
      this.matches = matches;
    }
  }
  const mobile = new Query("(max-width: 760px)", true);
  mobileQuery = mobile as unknown as typeof mobileQuery;
  browser.matchMedia = ((query: string) =>
    query === mobile.media
      ? mobile
      : new Query(query, query.includes("prefers-reduced-motion"))) as typeof browser.matchMedia;
  browser.requestAnimationFrame = () => 0;
  browser.cancelAnimationFrame = () => {};
  for (const key of [
    "window",
    "document",
    "navigator",
    "location",
    "history",
    "localStorage",
    "HTMLElement",
    "HTMLButtonElement",
    "HTMLInputElement",
    "HTMLSelectElement",
    "HTMLCanvasElement",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "NodeFilter",
    "MutationObserver",
    "ResizeObserver",
    "IntersectionObserver",
    "DOMRect",
    "getComputedStyle",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    const value = key === "window" ? browser : Reflect.get(browser, key);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value:
        typeof value === "function" &&
        [
          "getComputedStyle",
          "matchMedia",
          "requestAnimationFrame",
          "cancelAnimationFrame",
        ].includes(key)
          ? value.bind(browser)
          : value,
    });
  }
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
          if (key === "createImageData") return pixels;
          if (key === "getImageData")
            return (_x: number, _y: number, width: number, height: number) => pixels(width, height);
          if (key === "measureText") return (text: string) => ({ width: text.length * 7 });
          if (String(key).startsWith("create") && String(key).endsWith("Gradient"))
            return () => ({ addColorStop() {} });
          return () => {};
        },
      },
    );
  } as typeof browser.HTMLCanvasElement.prototype.getContext;
  const html = await readFile(new URL("../guide/index.html", import.meta.url), "utf8");
  document.body.innerHTML = html
    .match(/<body[^>]*>([\s\S]*?)<\/body>/i)![1]
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  server = await createServer({
    configFile: false,
    appType: "custom",
    logLevel: "error",
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  ({ setLang } = await server.ssrLoadModule("/src/i18n/index.ts"));
  setLang("ja");
  await server.ssrLoadModule("/src/guide/main.ts");
});

beforeEach(() => {
  dialog().close();
  element<HTMLButtonElement>("menu-close").click();
  setLang("ja");
  resizeMobile(true);
});

after(async () => {
  await server?.close();
  await browser?.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("Guide renders all 38 stages and preserves direct Lesson/Game links", () => {
  assert.equal(document.querySelectorAll("#lesson-grid .stage-card").length, 24);
  assert.equal(document.querySelectorAll("#game-grid .stage-card").length, 14);
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    const games = document.querySelectorAll("#game-grid .stage-card").length;
    const lessons = document.querySelectorAll("#lesson-grid .stage-card").length;
    assert.equal(element("stage-count").textContent, String(games + lessons));
    for (const id of ["game-count", "nav-game-count"])
      assert.equal(element(id).textContent, String(games));
    for (const id of ["lesson-count", "nav-lesson-count"])
      assert.equal(element(id).textContent, String(lessons));
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>(".stage-open-button")) {
    assert.equal(new URL(link.href).searchParams.get("direct"), "stage");
    assert.equal(link.hash.slice(1), link.dataset.guidePlayStage);
  }
});

test("Guide reads bilingual metadata without registering executable stages", async () => {
  const runtime = await server.ssrLoadModule("/src/core/stage_def.ts");
  assert.equal(runtime.getStages().length, 0);
  const catalog = await server.ssrLoadModule("/src/guide/stages.ts");
  const delivery = catalog.getStages().find((stage: { id: string }) => stage.id === "delivery");
  assert.ok(delivery);
  setLang("ja");
  assert.match(delivery.ros2.title, /ロボット/);
  setLang("en");
  assert.match(delivery.ros2.title, /drive the robot/);
  assert.equal(delivery.init, undefined);
  assert.equal(delivery.update, undefined);
  assert.equal(catalog.getStageModes().get("world_model"), "lesson");
  assert.equal(catalog.getLessonNumbers().get("world_model"), 24);
});

test("Guide keeps the selected language on all app links and stage dialog links", () => {
  for (const lang of ["en", "ja"] as const) {
    setLang(lang);
    openStage("navigation");
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-lang-link]")];
    assert.ok(links.length >= 43);
    for (const link of links) {
      const url = new URL(link.href);
      assert.equal(url.searchParams.get("lang"), lang);
      if (link.dataset.guidePlayStage) {
        assert.equal(url.searchParams.get("direct"), "stage");
        assert.equal(url.hash.slice(1), link.dataset.guidePlayStage);
      }
    }
    assert.equal(new URL(location.href).searchParams.get("stage"), "navigation");
  }
});

test("Pub/Sub and TF guides describe the available ports and sliders in both languages", () => {
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    openStage("pubsub_builder");
    const exercise = content().querySelector(".exercise-card")!.textContent!;
    assert.match(exercise, /\/cmd_vel/);
    assert.doesNotMatch(exercise, /二つのSubscriber|two Subscribers/);
    openStage("tf_puzzle");
    const instructions = content().querySelector(".mechanism-steps")!.textContent!;
    assert.match(instructions, /tx/);
    assert.match(instructions, /ty/);
    assert.match(instructions, /yaw/);
    assert.doesNotMatch(instructions, /TF Treeから|Build.*tree/);
  }
});

test("Action guide shows the actual Action endpoints and requests only implemented operations", () => {
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    openStage("action_builder");
    const action = content().querySelector(".action-graph-entry")!.textContent!;
    assert.match(action, /\/navigate_to_pose/);
    assert.match(action, /nav2_msgs\/action\/NavigateToPose/);
    assert.match(action, /Client\s+\/nav_client/);
    assert.match(action, /Server\s+\/nav_server/);
    const steps = content().querySelector(".mechanism-steps")!.textContent!;
    assert.match(steps, /distance_remaining/);
    assert.match(steps, /SUCCEEDED/);
    assert.doesNotMatch(steps, /Cancel|cancel/i);
  }
});

test("static diagrams and example commands do not claim to execute live communication", () => {
  setLang("en");
  openStage("action_builder");
  assert.match(content().querySelector(".lesson-visual")!.textContent!, /CONCEPT DIAGRAM/);
  assert.match(content().querySelector(".lesson-visual-status")!.textContent!, /COMMAND EXAMPLE/);
  assert.doesNotMatch(content().querySelector(".lesson-visual")!.textContent!, /LIVE|RUNNING/);
  assert.equal(content().querySelector(".topic-pulse"), null);
  openStage("delivery");
  assert.match(content().querySelector(".lesson-visual-bar")!.textContent!, /DEMO ANIMATION/);
});

test("World Model starts with a short insight and keeps technical scope in closed details", () => {
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    openStage("world_model");
    const insight = content().querySelector(".insight-box p")!.textContent!;
    const details = content().querySelector<HTMLDetailsElement>(".guide-details")!;
    assert.ok(insight.length < (lang === "ja" ? 150 : 240));
    assert.equal(details.open, false);
    assert.match(details.textContent!, /4,000/);
    assert.match(details.textContent!, /40/);
    assert.ok(content().querySelector(".exercise-section")!.compareDocumentPosition(details) & 4);
  }
});

test("RL guide distinguishes the required before/after comparison from optional reward changes", () => {
  openStage("reinforcement_learning");
  const exercise = content().querySelector(".exercise-card")!.textContent!;
  assert.match(exercise, /ここまででLessonを完了/);
  assert.match(exercise, /発展課題/);
  setLang("en");
  openStage("reinforcement_learning");
  assert.match(content().querySelector(".exercise-card")!.textContent!, /optional extension/);
});

test("opening the next Guide returns its scroll and stage query to the new introduction", () => {
  openStage("world_model");
  dialog().scrollTop = 800;
  content().scrollTop = 500;
  openStage("pubsub_builder");
  assert.equal(dialog().scrollTop, 0);
  assert.equal(content().scrollTop, 0);
  assert.equal(new URL(location.href).searchParams.get("stage"), "pubsub_builder");
});

test("mobile menu hides closed links, traps focus while open and restores it on Escape", () => {
  const sidebar = element("guide-sidebar");
  const toggle = element<HTMLButtonElement>("menu-toggle");
  const close = element<HTMLButtonElement>("menu-close");
  assert.equal(sidebar.inert, true);
  assert.equal(sidebar.getAttribute("aria-hidden"), "true");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.focus();
  toggle.click();
  assert.equal(sidebar.inert, false);
  assert.equal(document.querySelector<HTMLElement>(".guide-shell")!.inert, true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, close);
  const last = [...sidebar.querySelectorAll<HTMLElement>("a[href], button")].at(-1)!;
  close.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }),
  );
  assert.equal(document.activeElement, last);
  last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, close);
  close.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
  );
  assert.equal(sidebar.inert, true);
  assert.equal(document.querySelector<HTMLElement>(".guide-shell")!.inert, false);
  assert.equal(document.activeElement, toggle);
});

test("menu links focus their section and resizing restores desktop navigation", () => {
  element<HTMLButtonElement>("menu-toggle").click();
  element("guide-sidebar").querySelector<HTMLAnchorElement>('a[href="#skills"]')!.click();
  assert.equal(document.activeElement, element("skills"));
  assert.equal(element("guide-sidebar").inert, true);
  element<HTMLButtonElement>("menu-toggle").click();
  resizeMobile(false);
  assert.equal(element("guide-sidebar").inert, false);
  assert.equal(document.querySelector<HTMLElement>(".guide-shell")!.inert, false);
  assert.equal(element("menu-toggle").getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, element("guide-sidebar").querySelector("a[href]"));
  resizeMobile(true);
  assert.equal(element("guide-sidebar").inert, true);
  assert.equal(document.activeElement, element("menu-toggle"));
});

test("all Lesson guides link to the supplied video chapter in the selected language", () => {
  // Expected chapter times from the supplied walkthrough, independent of catalog order.
  const chapters = [
    ["pubsub_builder", "00:00", 0],
    ["service_builder", "01:07", 67],
    ["action_builder", "02:19", 139],
    ["param_tuner", "03:26", 206],
    ["feedforward_controller", "04:45", 285],
    ["feedforward_mission", "05:56", 356],
    ["feedback_controller", "07:06", 426],
    ["feedback_mission", "08:11", 491],
    ["lidar_avoidance", "09:12", 552],
    ["tf_puzzle", "10:12", 612],
    ["mapping_mission", "11:13", 673],
    ["localization_mission", "12:15", 735],
    ["navigation", "13:15", 795],
    ["image_processing", "14:18", 858],
    ["edge_detection", "15:21", 921],
    ["object_detection", "16:31", 991],
    ["behavior_tree", "17:44", 1064],
    ["joint_teleop", "18:54", 1134],
    ["ik_reach", "19:59", 1199],
    ["pick_place", "21:02", 1262],
    ["imitation_learning", "22:13", 1333],
    ["reinforcement_learning", "23:53", 1433],
    ["vla_lab", "24:55", 1495],
    ["world_model", "25:55", 1555],
  ] as const;
  assert.equal(document.querySelectorAll("#lesson-grid .stage-video-link").length, 24);
  assert.equal(document.querySelectorAll("#game-grid .stage-video-link").length, 0);
  for (const [lang, videoId] of [
    ["ja", "YJ34tb8ADns"],
    ["en", "k5dfFVgThU8"],
  ] as const) {
    setLang(lang);
    for (const [stageId, time, seconds] of chapters) {
      openStage(stageId);
      const link = content().querySelector<HTMLAnchorElement>(".dialog-video-link")!;
      const url = new URL(link.href);
      assert.equal(url.origin, "https://www.youtube.com");
      assert.equal(url.searchParams.get("v"), videoId);
      assert.equal(url.searchParams.get("t"), `${seconds}s`);
      assert.equal(url.searchParams.has("lang"), false);
      assert.equal(link.hasAttribute("data-lang-link"), false);
      assert.equal(link.querySelector("time")!.textContent, time);
      assert.equal(link.target, "_blank");
      assert.ok(link.relList.contains("noopener"));
      assert.ok(link.relList.contains("noreferrer"));
    }
    openStage("delivery");
    assert.equal(content().querySelector(".dialog-video-link"), null);
  }
});

test("walkthrough loads on request, seeks chapters and preserves the chapter when changing editions", () => {
  const videos = element("lesson-video-content");
  const player = () => videos.querySelector<HTMLIFrameElement>(".lesson-video-player iframe");
  const edition = (lang: string) =>
    videos.querySelector<HTMLButtonElement>(`[data-video-lang="${lang}"]`)!;
  const details = () => videos.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!;
  assert.equal(details().open, false);
  assert.equal(videos.querySelectorAll("[data-video-chapter]").length, 24);
  assert.equal(player(), null);
  assert.equal(edition("ja").getAttribute("aria-pressed"), "true");
  assert.match(
    videos.querySelector(".lesson-video-format")!.textContent!,
    /英語の操作画面.*日本語の解説・字幕/,
  );

  edition("en").click();
  assert.equal(player(), null);
  assert.equal(edition("en").getAttribute("aria-pressed"), "true");
  assert.equal(edition("ja").getAttribute("aria-pressed"), "false");
  assert.equal(document.documentElement.lang, "ja");
  videos.querySelector<HTMLButtonElement>("[data-video-play]")!.click();
  let url = new URL(player()!.src);
  assert.equal(url.origin, "https://www.youtube-nocookie.com");
  assert.equal(url.pathname, "/embed/k5dfFVgThU8");
  assert.equal(url.searchParams.get("start"), "0");
  assert.equal(url.searchParams.get("autoplay"), "1");
  assert.equal(document.activeElement, element("lesson-video-player"));

  details().open = true;
  videos.querySelector<HTMLButtonElement>('[data-video-chapter="world_model"]')!.click();
  url = new URL(player()!.src);
  assert.equal(url.searchParams.get("start"), "1555");
  const tryLesson = videos.querySelector<HTMLAnchorElement>(".lesson-video-lesson")!;
  const lessonUrl = new URL(tryLesson.href);
  assert.equal(lessonUrl.hash, "#world_model");
  assert.equal(lessonUrl.searchParams.get("direct"), "stage");
  assert.equal(lessonUrl.searchParams.get("lang"), "ja");
  assert.equal(tryLesson.dataset.guidePlayStage, "world_model");
  assert.equal(videos.querySelectorAll('[data-video-chapter][aria-current="true"]').length, 1);
  assert.equal(
    videos
      .querySelector('[data-video-chapter][aria-current="true"]')!
      .getAttribute("data-video-chapter"),
    "world_model",
  );

  edition("ja").click();
  url = new URL(player()!.src);
  assert.equal(url.pathname, "/embed/YJ34tb8ADns");
  assert.equal(url.searchParams.get("start"), "1555");
  assert.equal(url.searchParams.get("autoplay"), "0");
  assert.equal(details().open, true);
  const fallback = videos.querySelector<HTMLAnchorElement>(".lesson-video-youtube")!;
  assert.equal(new URL(fallback.href).searchParams.get("v"), "YJ34tb8ADns");
  assert.equal(new URL(fallback.href).searchParams.get("t"), "1555s");
  assert.equal(fallback.target, "_blank");
  assert.ok(fallback.relList.contains("noopener"));
  assert.ok(fallback.relList.contains("noreferrer"));

  setLang("en");
  url = new URL(player()!.src);
  assert.equal(url.pathname, "/embed/k5dfFVgThU8");
  assert.equal(url.searchParams.get("start"), "1555");
  assert.equal(details().open, true);
  assert.match(element("lesson-videos-title").textContent!, /All 24 lessons/);
  assert.equal(
    new URL(videos.querySelector<HTMLAnchorElement>(".lesson-video-lesson")!.href).searchParams.get(
      "lang",
    ),
    "en",
  );
  assert.match(
    videos.querySelector(".lesson-video-format")!.textContent!,
    /English interface, explanations and captions/,
  );
  edition("ja").click();
  assert.match(
    videos.querySelector(".lesson-video-format")!.textContent!,
    /English interface with Japanese explanations and captions/,
  );
});
