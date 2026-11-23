// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getDiagram, getLessonNumbers, getStageModes, getStages } from "./stages";
import { startDemo, stopDemo } from "../core/lesson_demo";
import { getLang, withLang } from "../i18n";
import { setupLanguageSwitchers } from "../i18n/language_switcher";
import { setupThemeSwitchers } from "../core/theme_switcher";
import type { StageMeta } from "../types";
import { cardPreviewFor, guideCopyFor } from "./content";
import { setupCardDemos } from "./card_demos";
import { setupHeroShowcase } from "./hero_showcase";
import { guideText as gt, localizeStaticGuide } from "./localization";
import { stageDisplayLesson, stageDisplayName } from "../core/stage_labels";
import { recommendedInspectionCommand } from "../lib/terminal_commands";
import { lessonVideoFor, setupLessonVideos } from "./lesson_videos";
import { gameVideoFor, setupGameVideos } from "./game_videos";
import {
  setupAnalytics,
  trackGuideOpen,
  trackGuidePlayClick,
  trackGuideSectionView,
} from "../core/analytics";

setupAnalytics();
localizeStaticGuide();
setupThemeSwitchers();
const stages = getStages();
const modes = getStageModes();
const lessonNumbers = getLessonNumbers();
const games = stages.filter((stage) => modes.get(stage.id) === "game");
const lessons = stages.filter((stage) => modes.get(stage.id) === "lesson");

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} missing`);
  return element as T;
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char] ?? char,
  );

function stageCard(stage: StageMeta, index: number, mode: "game" | "lesson"): string {
  const concept =
    getLang() === "ja"
      ? stageDisplayLesson(stage)
      : (stage.ros2?.title ?? stage.lesson ?? "Robot System");
  const displayName = stageDisplayName(stage);
  const copy = guideCopyFor(stage);
  const preview = cardPreviewFor(stage);
  const messageTypes = stage.ros2?.msgTypes.slice(0, 2) ?? [];
  const video = mode === "lesson" ? lessonVideoFor(stage.id) : gameVideoFor(stage.id);
  const number =
    mode === "lesson"
      ? `L${String(lessonNumbers.get(stage.id) ?? index + 1).padStart(2, "0")}`
      : `G${String(index + 1).padStart(2, "0")}`;

  return `
    <article class="stage-card stage-card--${mode}">
      <div class="stage-card-top">
        <span class="stage-code">${number}</span>
        <span class="stage-mode">${mode.toUpperCase()}</span>
      </div>
      <p class="stage-concept">${escapeHtml(concept)}</p>
      <h3>${escapeHtml(displayName)}</h3>
      <div class="stage-card-preview" aria-hidden="true">
        <canvas class="card-demo card-demo--${mode}" width="320" height="104" data-stage-demo="${escapeHtml(stage.id)}"></canvas>
      </div>
      <div class="stage-at-glance">
        <div>
          <span>${mode === "game" ? gt("やること", "MISSION") : gt("操作すること", "WHAT YOU CONTROL")}</span>
          <strong>${escapeHtml(preview.action)}</strong>
        </div>
        <div>
          <span>${gt("身につくこと", "WHAT YOU WILL LEARN")}</span>
          <strong>${escapeHtml(copy.goals[0])}</strong>
        </div>
      </div>
      <div class="stage-tags">
        ${messageTypes.map((type) => `<span>${escapeHtml(type.split("/").at(-1) ?? type)}</span>`).join("")}
      </div>
      <div class="stage-card-actions">
        <button class="stage-detail-button" type="button" data-stage-id="${escapeHtml(stage.id)}">
          ${gt("説明を読む", "Read guide")} <span>→</span>
        </button>
        <a
          class="stage-open-button"
          href="${escapeHtml(withLang(`../?direct=stage#${encodeURIComponent(stage.id)}`))}"
          data-lang-link
          data-guide-play-stage="${escapeHtml(stage.id)}"
          data-stage-mode="${mode}"
        >
          ${mode === "game" ? gt("Gameを開く", "Open Game") : gt("Lessonを開く", "Open Lesson")} <span>↗</span>
        </a>
      </div>
      ${video ? `<a class="stage-video-link" href="${escapeHtml(video.href)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> <span class="video-link-label">${gt("動画で見る", mode === "game" ? "Watch game" : "Watch lesson")}</span> <span class="video-link-meta"><time>${video.time}</time><span aria-hidden="true">↗</span></span></a>` : ""}
    </article>
  `;
}

function renderGrid(
  container: HTMLElement,
  collection: StageMeta[],
  mode: "game" | "lesson",
): void {
  container.innerHTML = collection.map((stage, index) => stageCard(stage, index, mode)).join("");
}

renderGrid(byId("game-grid"), games, "game");
renderGrid(byId("lesson-grid"), lessons, "lesson");
setupLessonVideos(lessons, lessonNumbers);
setupGameVideos(games);
setupCardDemos();
setupHeroShowcase();

byId("stage-count").textContent = String(stages.length);
for (const id of ["game-count", "nav-game-count"]) byId(id).textContent = String(games.length);
for (const id of ["lesson-count", "nav-lesson-count"])
  byId(id).textContent = String(lessons.length);

const dialog = byId<HTMLDialogElement>("stage-dialog");
const dialogContent = byId("dialog-content");

function setStageQuery(stageId?: string): void {
  const url = new URL(location.href);
  if (stageId) url.searchParams.set("stage", stageId);
  else url.searchParams.delete("stage");
  history.replaceState(null, "", url.pathname + url.search + url.hash);
}

function openStage(stage: StageMeta, syncUrl = true): void {
  stopDemo();
  const mode = modes.get(stage.id) ?? "game";
  const ros = stage.ros2;
  const copy = guideCopyFor(stage);
  const topics = ros?.state?.topics ?? [];
  const services = ros?.state?.services ?? [];
  const actions = ros?.state?.actions ?? [];
  const nodes = ros?.state?.nodes ?? [];
  const diagram = getDiagram(stage.id);
  const displayName = stageDisplayName(stage);
  const displayLesson = stageDisplayLesson(stage);
  const video = mode === "lesson" ? lessonVideoFor(stage.id) : gameVideoFor(stage.id);
  const number =
    mode === "lesson"
      ? `LESSON ${lessonNumbers.get(stage.id) ?? ""}`
      : `GAME ${games.findIndex((item) => item.id === stage.id) + 1}`;

  dialog.className = `stage-dialog stage-dialog--${mode}`;
  dialogContent.innerHTML = `
    <article class="lesson-page">
      <header class="lesson-page-header">
        <div>
          <div class="dialog-kicker">${number} / ${mode.toUpperCase()}</div>
          <h2 id="dialog-stage-title">${escapeHtml(displayName)}</h2>
          <p class="dialog-lead">${escapeHtml(getLang() === "ja" ? displayLesson : (ros?.title ?? stage.lesson ?? "Robot System"))}</p>
          ${video ? `<a class="dialog-video-link" href="${escapeHtml(video.href)}" target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▶</span> <span class="video-link-label">${mode === "game" ? gt("このGameを動画で見る", "Watch this game on YouTube") : gt("このLessonを動画で見る", "Watch this lesson on YouTube")}</span> <span class="video-link-meta"><time>${video.time}</time><span aria-hidden="true">↗</span></span></a>` : ""}
        </div>
        <span class="lesson-page-id">${escapeHtml(stage.id)}</span>
      </header>

      <div class="lesson-visual">
        <div class="lesson-visual-bar">
          <span><i></i> ${mode === "game" ? gt("プレイ例", "PLAY DEMO") : gt("しくみ図", "SYSTEM DIAGRAM")}</span>
          <span>${mode === "game" ? gt("デモアニメーション", "DEMO ANIMATION") : gt("教材の説明図", "CONCEPT DIAGRAM")}</span>
        </div>
        <div class="lesson-visual-stage">
          ${
            mode === "game"
              ? `<canvas id="lesson-demo-canvas" width="760" height="190" aria-label="${escapeHtml(displayName)} gameplay animation"></canvas>`
              : `<div class="guide-diagram">${
                  diagram ||
                  `
                <div class="generic-flow">
                  <span>INPUT</span><i></i><span>ROS 2 NODE</span><i></i><span>OUTPUT</span>
                </div>
              `
                }</div>`
          }
          <div class="visual-scanline"></div>
        </div>
        <div class="lesson-visual-status">
          <span>&gt;_ ${escapeHtml(recommendedInspectionCommand(ros))}</span>
          <b>${gt("コマンド例", "COMMAND EXAMPLE")}</b>
        </div>
      </div>

      <div class="lesson-layout">
        <div class="lesson-main">
          <section class="article-section article-intro">
            <div class="article-heading">
              <span>01</span>
              <div><small>OVERVIEW</small><h3>${gt("このステージで学ぶこと", "What you will learn")}</h3></div>
            </div>
            <p class="article-lead">${escapeHtml(copy.overview)}</p>
            <aside class="insight-box">
              <span>KEY INSIGHT</span>
              <p>${escapeHtml(copy.insight)}</p>
            </aside>
          </section>

          <section class="article-section">
            <div class="article-heading">
              <span>02</span>
              <div><small>LEARNING GOALS</small><h3>${gt("学習目標", "Learning goals")}</h3></div>
            </div>
            <div class="goal-grid">
              ${copy.goals
                .map(
                  (goal, index) => `
                <div><b>0${index + 1}</b><p>${escapeHtml(goal)}</p></div>
              `,
                )
                .join("")}
            </div>
          </section>

          <section class="article-section">
            <div class="article-heading">
              <span>03</span>
              <div><small>HOW IT WORKS</small><h3>${gt("ロボットが動く仕組み", "How the robot system works")}</h3></div>
            </div>
            <div class="mechanism-steps">
              ${copy.steps
                .map(
                  (step, index) => `
                <div>
                  <span>${index + 1}</span>
                  <i></i>
                  <p>${escapeHtml(step)}</p>
                </div>
              `,
                )
                .join("")}
            </div>
            <p class="article-body">${gt("図と通信一覧はブラウザ内の教材を表しています。下のコマンドはLesson・Game内の疑似ターミナルで使う例です。", "The diagram and graph describe this browser simulation. The command examples can be used in the Lesson or Game's simulated terminal.")}</p>
          </section>

          ${
            topics.length || services.length || actions.length || nodes.length
              ? `
            <section class="article-section">
              <div class="article-heading">
                <span>04</span>
                <div><small>ROS 2 GRAPH</small><h3>${gt("通信グラフを読む", "Read the communication graph")}</h3></div>
              </div>
              ${
                nodes.length
                  ? `
                <div class="node-strip">
                  ${nodes.map((node) => `<span><i></i>${escapeHtml(node)}</span>`).join("")}
                </div>
              `
                  : ""
              }
              <div class="topic-list">
                ${topics
                  .map(
                    (topic) => `
                  <div>
                    <b>TOPIC</b>
                    <code>${escapeHtml(topic.name)}</code>
                    <span>${escapeHtml(topic.type)}</span>
                  </div>
                `,
                  )
                  .join("")}
                ${services
                  .map(
                    (service) => `
                  <div>
                    <b>SERVICE</b>
                    <code>${escapeHtml(service.name)}</code>
                    <span>${escapeHtml(service.type)}</span>
                  </div>
                `,
                  )
                  .join("")}
                ${actions
                  .map(
                    (action) => `
                  <div class="action-graph-entry">
                    <b>ACTION</b>
                    <code>${escapeHtml(action.name)}</code>
                    <span>${escapeHtml(action.type)}</span>
                    <p><strong>Client</strong> ${escapeHtml((action.clients ?? []).join(", ") || "—")}<br><strong>Server</strong> ${escapeHtml((action.servers ?? []).join(", ") || "—")}</p>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          <section class="article-section exercise-section">
            <div class="article-heading">
              <span>05</span>
              <div><small>EXERCISE</small><h3>${gt("観察して考えてみよう", "Observe, test, and explain")}</h3></div>
            </div>
            <div class="exercise-card">
              <span>TRY IT</span>
              <p>${escapeHtml(copy.exercise)}</p>
            </div>
          </section>
          ${
            copy.details?.length
              ? `<details class="guide-details"><summary>${gt("詳しく読む：モデルのしくみと教材の範囲", "Read more: the model and the scope of this lesson")}</summary>${copy.details.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</details>`
              : ""
          }
        </div>

        <aside class="lesson-rail">
          ${
            ros?.msgTypes.length
              ? `
            <div class="rail-card">
              <span class="dialog-label">INTERFACES</span>
              <div class="dialog-chips">${ros.msgTypes.map((type) => `<code>${escapeHtml(type)}</code>`).join("")}</div>
            </div>
          `
              : ""
          }
          ${
            ros?.cli.length
              ? `
            <div class="rail-card">
              <span class="dialog-label">TRY THIS COMMAND</span>
              <pre class="command-block"><span>$</span> ${escapeHtml(recommendedInspectionCommand(ros))}</pre>
            </div>
          `
              : ""
          }
          ${
            ros?.realWorld
              ? `
            <div class="dialog-real">
              <span>REAL ROBOT CONNECTION</span>
              <p>${escapeHtml(ros.realWorld)}</p>
              <a href="https://mertcookimg.github.io/ros2_lecture/" target="_blank" rel="noopener noreferrer">${gt("実機向け講義を見る", "Open the real-robot course")} ↗</a>
            </div>
          `
              : ""
          }
          <a
            class="dialog-play"
            href="${escapeHtml(withLang(`../?direct=stage#${encodeURIComponent(stage.id)}`))}"
            data-lang-link
            data-guide-play-stage="${escapeHtml(stage.id)}"
            data-stage-mode="${mode}"
          >
            ${mode === "game" ? gt("このゲームで遊ぶ", "Play this Game") : gt("このレッスンを始める", "Start this Lesson")} <span>↗</span>
          </a>
        </aside>
      </div>
    </article>
  `;
  dialog.showModal();
  dialog.scrollTop = 0;
  dialogContent.scrollTop = 0;
  trackGuideOpen(stage.id, mode);
  if (syncUrl) setStageQuery(stage.id);
  if (mode === "game") requestAnimationFrame(() => startDemo(stage.id));
}

document.addEventListener("click", (event) => {
  const playLink = (event.target as HTMLElement).closest<HTMLAnchorElement>(
    "[data-guide-play-stage]",
  );
  if (playLink?.dataset.guidePlayStage) {
    const mode = playLink.dataset.stageMode === "lesson" ? "lesson" : "game";
    trackGuidePlayClick(playLink.dataset.guidePlayStage, mode);
  }

  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-stage-id]");
  if (!button) return;
  const stage = stages.find((item) => item.id === button.dataset.stageId);
  if (stage) openStage(stage);
});

byId("dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  stopDemo();
  setStageQuery();
  queueMicrotask(trackVisibleGuideSection);
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

const sidebar = byId("guide-sidebar");
const scrim = byId("mobile-scrim");
const menuToggle = byId<HTMLButtonElement>("menu-toggle");
const menuClose = byId<HTMLButtonElement>("menu-close");
const guideShell = document.querySelector<HTMLElement>(".guide-shell")!;
const mobileMenu = window.matchMedia("(max-width: 760px)");
let menuOpen = false;
let menuPreviousFocus: HTMLElement | null = null;

function renderMenu(): void {
  const open = mobileMenu.matches && menuOpen;
  sidebar.classList.toggle("open", open);
  scrim.classList.toggle("show", open);
  sidebar.inert = mobileMenu.matches && !open;
  sidebar.setAttribute("aria-hidden", String(sidebar.inert));
  guideShell.inert = open;
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", gt("メニューを開く", "Open menu"));
  menuClose.setAttribute("aria-label", gt("メニューを閉じる", "Close menu"));
  if (open) {
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    sidebar.setAttribute("aria-label", gt("ガイドメニュー", "Guide menu"));
  } else {
    sidebar.removeAttribute("role");
    sidebar.removeAttribute("aria-modal");
    sidebar.removeAttribute("aria-label");
  }
}

function closeMenu(restoreFocus = true): void {
  const wasOpen = menuOpen;
  menuOpen = false;
  renderMenu();
  if (wasOpen && restoreFocus) {
    const target = menuPreviousFocus?.isConnected ? menuPreviousFocus : menuToggle;
    target.focus({ preventScroll: true });
  }
  menuPreviousFocus = null;
}

menuToggle.addEventListener("click", () => {
  if (menuOpen) return closeMenu();
  if (!mobileMenu.matches) return;
  menuPreviousFocus = document.activeElement as HTMLElement | null;
  menuOpen = true;
  renderMenu();
  menuClose.focus({ preventScroll: true });
});
menuClose.addEventListener("click", () => closeMenu());
scrim.addEventListener("click", () => closeMenu());
sidebar.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    if (!menuOpen) return;
    closeMenu(false);
    if (link.getAttribute("href")?.startsWith("#")) {
      const section = document.getElementById(link.hash.slice(1));
      section?.setAttribute("tabindex", "-1");
      section?.focus({ preventScroll: true });
    }
  });
});
document.addEventListener("keydown", (event) => {
  if (!menuOpen || !mobileMenu.matches) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMenu();
  } else if (event.key === "Tab") {
    const controls = [...sidebar.querySelectorAll<HTMLElement>("a[href], button:not(:disabled)")];
    const first = controls[0];
    const last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first || !sidebar.contains(document.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || !sidebar.contains(document.activeElement))
    ) {
      event.preventDefault();
      first?.focus();
    }
  }
});
mobileMenu.addEventListener("change", () => {
  const focusWasInMenu = sidebar.contains(document.activeElement);
  const focusWasToggle = document.activeElement === menuToggle;
  closeMenu(false);
  if (mobileMenu.matches && focusWasInMenu) menuToggle.focus({ preventScroll: true });
  else if (!mobileMenu.matches && (focusWasInMenu || focusWasToggle)) {
    sidebar.querySelector<HTMLAnchorElement>("a[href]")?.focus({ preventScroll: true });
  }
});
renderMenu();

setupLanguageSwitchers(() => {
  // Re-render the static shell and stage cards in the selected language.
  location.reload();
});

const observedSections = [...document.querySelectorAll<HTMLElement>("main section[id]")];
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>(".guide-nav a[href^='#']")];
const sectionVisibility = new Map<HTMLElement, number>();
const viewedSections = new Set<string>();

function trackVisibleGuideSection(): void {
  const visible = [...sectionVisibility.entries()]
    .filter(([, ratio]) => ratio > 0)
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!visible) return;

  navLinks.forEach((link) => {
    link.classList.toggle("active", link.hash === `#${visible.id}`);
  });

  // A directly opened stage dialog covers the page underneath, so do not
  // count its background section until the visitor closes the dialog.
  if (dialog.open || viewedSections.has(visible.id)) return;
  viewedSections.add(visible.id);
  trackGuideSectionView(visible.id);
}

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      sectionVisibility.set(
        entry.target as HTMLElement,
        entry.isIntersecting ? entry.intersectionRatio : 0,
      );
    });
    trackVisibleGuideSection();
  },
  { rootMargin: "-15% 0px -65%", threshold: [0, 0.2, 0.5] },
);
observedSections.forEach((section) => sectionObserver.observe(section));

const initialStageId = new URLSearchParams(location.search).get("stage");
const initialStage = stages.find((stage) => stage.id === initialStageId);
if (initialStage) openStage(initialStage, false);
