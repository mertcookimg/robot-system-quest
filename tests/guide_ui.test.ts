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
const videoDisclosure = (mode: "game" | "lesson") =>
  element(`${mode}-video-content`).querySelector<HTMLDetailsElement>(".stage-video-disclosure")!;

function setVideoOpen(mode: "game" | "lesson", open: boolean): void {
  const disclosure = videoDisclosure(mode);
  disclosure.open = open;
  // Happy DOM does not consistently schedule the native toggle event.
  disclosure.dispatchEvent(new Event("toggle"));
}

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

test("Guide translates its introductions and keeps the selected language on app links", async () => {
  const { localizeStaticGuide } = await server.ssrLoadModule("/src/guide/localization.ts");
  for (const lang of ["en", "ja"] as const) {
    setLang(lang);
    if (lang === "en") {
      // The real language switch reloads the static shell. Translate a fresh
      // copy here so other UI tests can keep their original Japanese shell.
      const shell = document.querySelector("main")!.cloneNode(true) as HTMLElement;
      localizeStaticGuide(shell);
      for (const introduction of shell.querySelectorAll(
        ".hero-copy > p, .hero-learn-tags, .section-heading > p, .skill-card, .catalogue-guide, .flow-card",
      )) {
        assert.doesNotMatch(introduction.textContent!, /[ぁ-んァ-ヶ一-龥]/);
      }
    }
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
  assert.equal(document.querySelectorAll("#game-grid .stage-video-link").length, 14);
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
  }
});

test("walkthrough loads on request, seeks chapters and preserves the chapter when changing editions", () => {
  const videos = element("lesson-video-content");
  const player = () => videos.querySelector<HTMLIFrameElement>(".lesson-video-player iframe");
  const thumbnail = () =>
    videos.querySelector<HTMLImageElement>(".stage-video-summary-thumbnail img")!;
  const edition = (lang: string) =>
    videos.querySelector<HTMLButtonElement>(`[data-video-lang="${lang}"]`)!;
  const details = () => videos.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!;
  assert.equal(videoDisclosure("lesson").open, false);
  assert.equal(videoDisclosure("game").open, false);
  assert.match(thumbnail().src, /\/YJ34tb8ADns\/hqdefault\.jpg$/);
  setVideoOpen("lesson", true);
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
  assert.match(thumbnail().src, /\/k5dfFVgThU8\/hqdefault\.jpg$/);
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
  assert.match(thumbnail().src, /\/YJ34tb8ADns\/hqdefault\.jpg$/);
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
  assert.match(thumbnail().src, /\/k5dfFVgThU8\/hqdefault\.jpg$/);
  url = new URL(player()!.src);
  assert.equal(url.pathname, "/embed/k5dfFVgThU8");
  assert.equal(url.searchParams.get("start"), "1555");
  assert.equal(details().open, true);
  assert.equal(videoDisclosure("lesson").open, true);
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

test("all Game cards, guides and chapters use the supplied English showcase timestamps", () => {
  const chapters = [
    ["delivery", "00:00", 0],
    ["follower", "00:16", 16],
    ["lidar_explorer", "00:32", 32],
    ["patrol", "00:54", 54],
    ["racing", "01:13", 73],
    ["robo_soccer", "01:51", 111],
    ["treasure_map", "02:25", 145],
    ["tag_chase", "02:45", 165],
    ["sumo_battle", "03:21", 201],
    ["battery_rush", "03:45", 225],
    ["robo_kitchen", "04:30", 270],
    ["swarm_rescue", "05:15", 315],
    ["robo_baseball", "05:40", 340],
    ["robo_tennis", "06:08", 368],
  ] as const;
  for (const lang of ["ja", "en"] as const) {
    setLang(lang);
    assert.equal(document.querySelectorAll("#game-grid .stage-video-link").length, 14);
    for (const [stageId, time, seconds] of chapters) {
      const card = document.querySelector(`[data-stage-id="${stageId}"]`)!.closest(".stage-card")!;
      openStage(stageId);
      const links = [
        card.querySelector<HTMLAnchorElement>(".stage-video-link")!,
        content().querySelector<HTMLAnchorElement>(".dialog-video-link")!,
      ];
      for (const link of links) {
        assert.ok(link);
        const url = new URL(link.href);
        assert.equal(url.origin, "https://www.youtube.com");
        assert.equal(url.searchParams.get("v"), "bTiUXUTwiko");
        assert.equal(url.searchParams.get("t"), `${seconds}s`);
        assert.equal(url.searchParams.has("lang"), false);
        assert.equal(link.hasAttribute("data-lang-link"), false);
        assert.equal(link.querySelector("time")!.textContent, time);
        assert.equal(link.target, "_blank");
        assert.ok(link.relList.contains("noopener"));
        assert.ok(link.relList.contains("noreferrer"));
      }
      const chapter = element("game-video-content").querySelector(
        `[data-video-chapter="${stageId}"]`,
      )!;
      assert.equal(chapter.querySelector("time")!.textContent, time);
      assert.equal(chapter.querySelector("time")!.getAttribute("datetime"), `PT${seconds}S`);
    }
  }
});

test("Game showcase loads on demand and keeps its chapter in both Guide languages", () => {
  const videos = element("game-video-content");
  const player = () => videos.querySelector<HTMLIFrameElement>(".lesson-video-player iframe");
  const details = () => videos.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!;
  const lessonPlayer = () =>
    element("lesson-video-content").querySelector<HTMLIFrameElement>("iframe");
  assert.equal(videoDisclosure("game").open, false);
  setVideoOpen("game", true);
  assert.equal(player(), null);
  assert.equal(details().open, false);
  assert.equal(videos.querySelectorAll("[data-video-chapter]").length, 14);
  assert.equal(videos.querySelector('[data-video-lang="ja"]'), null);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /英語/);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /ダーク/);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /ナレーションなし/);

  const previousLesson = lessonPlayer();
  videos.querySelector<HTMLButtonElement>("[data-video-play]")!.click();
  let url = new URL(player()!.src);
  assert.equal(url.origin, "https://www.youtube-nocookie.com");
  assert.equal(url.pathname, "/embed/bTiUXUTwiko");
  assert.equal(url.searchParams.get("start"), "0");
  assert.equal(url.searchParams.get("autoplay"), "1");
  assert.equal(document.activeElement, element("game-video-player"));
  assert.equal(
    lessonPlayer(),
    previousLesson,
    "Playing a Game video must not reload Lesson playback",
  );

  details().open = true;
  videos.querySelector<HTMLButtonElement>('[data-video-chapter="robo_soccer"]')!.click();
  url = new URL(player()!.src);
  assert.equal(url.searchParams.get("start"), "111");
  assert.equal(videos.querySelectorAll('[data-video-chapter][aria-current="true"]').length, 1);
  assert.equal(
    videos
      .querySelector('[data-video-chapter][aria-current="true"]')!
      .getAttribute("data-video-chapter"),
    "robo_soccer",
  );
  const tryGame = () => videos.querySelector<HTMLAnchorElement>(".lesson-video-lesson")!;
  const gameUrl = new URL(tryGame().href);
  assert.equal(gameUrl.hash, "#robo_soccer");
  assert.equal(gameUrl.searchParams.get("direct"), "stage");
  assert.equal(gameUrl.searchParams.get("lang"), "ja");
  assert.equal(tryGame().dataset.guidePlayStage, "robo_soccer");
  assert.equal(tryGame().dataset.stageMode, "game");

  setLang("en");
  url = new URL(player()!.src);
  assert.equal(url.pathname, "/embed/bTiUXUTwiko");
  assert.equal(url.searchParams.get("start"), "111");
  assert.equal(url.searchParams.get("autoplay"), "0");
  assert.equal(details().open, true);
  assert.equal(videoDisclosure("game").open, true);
  assert.equal(videos.querySelector('[data-video-lang="ja"]'), null);
  assert.match(element("game-videos-title").textContent!, /14 games/i);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /English/);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /dark mode/i);
  assert.match(videos.querySelector(".lesson-video-format")!.textContent!, /no spoken narration/i);
  assert.equal(new URL(tryGame().href).searchParams.get("lang"), "en");
  const fallback = videos.querySelector<HTMLAnchorElement>(".lesson-video-youtube")!;
  assert.equal(new URL(fallback.href).searchParams.get("v"), "bTiUXUTwiko");
  assert.equal(new URL(fallback.href).searchParams.get("t"), "111s");
  assert.equal(fallback.target, "_blank");
  assert.ok(fallback.relList.contains("noopener"));
  assert.ok(fallback.relList.contains("noreferrer"));

  const previousGame = player();
  element("lesson-video-content")
    .querySelector<HTMLButtonElement>('[data-video-chapter="navigation"]')!
    .click();
  assert.equal(player(), previousGame, "Lesson chapter changes must leave Game playback alone");
  details().open = false;
  setLang("ja");
  assert.equal(new URL(player()!.src).pathname, "/embed/bTiUXUTwiko");
  assert.equal(new URL(player()!.src).searchParams.get("start"), "111");
  assert.equal(details().open, false);
});

test("collapsing either video stops playback while preserving its chapter and the other player", () => {
  const cases = [
    ["game", "robo_soccer", "111"],
    ["lesson", "navigation", "795"],
  ] as const;
  for (const [mode, stageId] of cases) {
    setVideoOpen(mode, true);
    const videos = element(`${mode}-video-content`);
    const chapters = videos.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!;
    chapters.open = true;
    chapters.dispatchEvent(new Event("toggle"));
    videos.querySelector<HTMLButtonElement>(`[data-video-chapter="${stageId}"]`)!.click();
  }
  for (const [mode, , start] of cases) {
    const videos = element(`${mode}-video-content`);
    const player = () => videos.querySelector<HTMLIFrameElement>("iframe");
    const chapters = () => videos.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!;
    const other = mode === "game" ? "lesson" : "game";
    const otherPlayer = element(`${other}-video-content`).querySelector("iframe");
    chapters().open = true;
    const beforeChapterToggle = player();
    chapters().dispatchEvent(new Event("toggle"));
    assert.equal(player(), beforeChapterToggle, "Chapter expansion must not stop playback");
    if (mode === "lesson")
      videos.querySelector<HTMLButtonElement>('[data-video-lang="en"]')!.click();

    setVideoOpen(mode, false);
    assert.equal(player(), null, "A collapsed panel cannot leave a hidden player running");
    assert.equal(element(`${other}-video-content`).querySelector("iframe"), otherPlayer);
    assert.equal(chapters().open, true);

    setVideoOpen(mode, true);
    assert.equal(player(), null, "Opening the panel does not restart playback");
    videos.querySelector<HTMLButtonElement>("[data-video-play]")!.click();
    let url = new URL(player()!.src);
    assert.equal(url.searchParams.get("start"), start);
    if (mode === "lesson") assert.equal(url.pathname, "/embed/k5dfFVgThU8");
    setVideoOpen(mode, false);
    setLang("en");
    assert.equal(videoDisclosure(mode).open, false);
    assert.equal(chapters().open, true);
    assert.equal(player(), null, "Language changes must not reload a collapsed video");
    const fallback = videos.querySelector<HTMLAnchorElement>(".lesson-video-youtube")!;
    assert.equal(new URL(fallback.href).searchParams.get("t"), `${start}s`);
    setVideoOpen(mode, true);
    videos.querySelector<HTMLButtonElement>("[data-video-play]")!.click();
    url = new URL(player()!.src);
    assert.equal(url.searchParams.get("start"), start);
  }
});

test("video navigation opens only its compact panel without starting playback", () => {
  setVideoOpen("game", false);
  setVideoOpen("lesson", false);
  document.querySelector<HTMLAnchorElement>('.hero-video-link[href="#game-videos"]')!.click();
  assert.equal(videoDisclosure("game").open, true);
  assert.equal(videoDisclosure("lesson").open, false);
  assert.equal(element("game-video-content").querySelector("iframe"), null);
  setVideoOpen("game", false);
  element<HTMLButtonElement>("menu-toggle").click();
  element("guide-sidebar").querySelector<HTMLAnchorElement>('a[href="#lesson-videos"]')!.click();
  assert.equal(videoDisclosure("lesson").open, true);
  assert.equal(videoDisclosure("game").open, false);
  assert.equal(element("lesson-video-content").querySelector("iframe"), null);
});
