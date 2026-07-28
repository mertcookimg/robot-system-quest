// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import "../core/stage_collect";
import { getDiagram, getLessonNumbers, getStageModes, getStages } from "../core/stage_def";
import { startDemo, stopDemo } from "../core/lesson_demo";
import { getLang, setLang } from "../i18n";
import type { Stage } from "../types";
import { cardPreviewFor, guideCopyFor } from "./content";
import { setupCardDemos } from "./card_demos";
import { setupHeroShowcase } from "./hero_showcase";
import { guideText as gt, localizeStaticGuide } from "./localization";
import { setupAnalytics } from "../core/analytics";

setupAnalytics();
localizeStaticGuide();
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

function stageDescription(stage: Stage): string {
  if (getLang() === "en") {
    const interfaceName = stage.ros2?.msgTypes[0]?.split("/").at(-1) ?? "ROS 2 interfaces";
    return `Follow how ${stage.name} receives input, updates its internal state, and produces an output through ${interfaceName}. Use the animation and ROS 2 graph to connect each visible change with the data exchanged by the nodes.`;
  }
  return (
    stage.ros2?.summary ??
    gt(
      `${stage.name}を通して、ロボットシステムの基本的な考え方を体験します。`,
      `Use ${stage.name} to explore the fundamental structure of a robot system.`,
    )
  );
}

function stageCard(stage: Stage, index: number, mode: "game" | "lesson"): string {
  const concept = stage.ros2?.title ?? (stage.lesson || "Robot System");
  const copy = guideCopyFor(stage);
  const preview = cardPreviewFor(stage);
  const messageTypes = stage.ros2?.msgTypes.slice(0, 2) ?? [];
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
      <h3>${escapeHtml(stage.name)}</h3>
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
        <a class="stage-open-button" href="../?direct=stage#${encodeURIComponent(stage.id)}">
          ${mode === "game" ? gt("Gameを開く", "Open Game") : gt("Lessonを開く", "Open Lesson")} <span>↗</span>
        </a>
      </div>
    </article>
  `;
}

function renderGrid(container: HTMLElement, collection: Stage[], mode: "game" | "lesson"): void {
  container.innerHTML = collection.map((stage, index) => stageCard(stage, index, mode)).join("");
}

renderGrid(byId("game-grid"), games, "game");
renderGrid(byId("lesson-grid"), lessons, "lesson");
setupCardDemos();
setupHeroShowcase();

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

function openStage(stage: Stage, syncUrl = true): void {
  stopDemo();
  const mode = modes.get(stage.id) ?? "game";
  const ros = stage.ros2;
  const copy = guideCopyFor(stage);
  const topics = ros?.state?.topics ?? [];
  const services = ros?.state?.services ?? [];
  const nodes = ros?.state?.nodes ?? [];
  const diagram = getDiagram(stage.id);
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
          <h2>${escapeHtml(stage.name)}</h2>
          <p class="dialog-lead">${escapeHtml(ros?.title ?? (stage.lesson || "Robot System"))}</p>
        </div>
        <span class="lesson-page-id">${escapeHtml(stage.id)}</span>
      </header>

      <div class="lesson-visual">
        <div class="lesson-visual-bar">
          <span><i></i> ${mode === "game" ? gt("プレイ例", "PLAY DEMO") : gt("しくみ図", "SYSTEM DIAGRAM")}</span>
          <span>${mode === "game" ? gt("シミュレーション / 再生中", "SIMULATION / LIVE") : gt("メッセージの流れ", "MESSAGE FLOW / LIVE")}</span>
        </div>
        <div class="lesson-visual-stage">
          ${
            mode === "game"
              ? `<canvas id="lesson-demo-canvas" width="760" height="190" aria-label="${escapeHtml(stage.name)} gameplay animation"></canvas>`
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
          <span>&gt;_ ${escapeHtml(stage.lessonCmd || ros?.cli[0] || "ros2 node list")}</span>
          <b><i></i> RUNNING</b>
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
            <p class="article-body">${escapeHtml(stageDescription(stage))}</p>
          </section>

          ${
            topics.length || services.length || nodes.length
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
              <div class="topic-list topic-list--animated">
                ${topics
                  .map(
                    (topic) => `
                  <div>
                    <b>TOPIC</b>
                    <code>${escapeHtml(topic.name)}</code>
                    <span>${escapeHtml(topic.type)}</span>
                    <i class="topic-pulse"></i>
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
                    <i class="topic-pulse"></i>
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
              <pre class="command-block"><span>$</span> ${escapeHtml(ros.cli[0])}</pre>
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
          <a class="dialog-play" href="../?direct=stage#${encodeURIComponent(stage.id)}">
            ${mode === "game" ? gt("このGameで遊ぶ", "Play this Game") : gt("このLessonを始める", "Start this Lesson")} <span>↗</span>
          </a>
        </aside>
      </div>
    </article>
  `;
  dialog.showModal();
  if (syncUrl) setStageQuery(stage.id);
  if (mode === "game") requestAnimationFrame(() => startDemo(stage.id));
}

document.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-stage-id]");
  if (!button) return;
  const stage = stages.find((item) => item.id === button.dataset.stageId);
  if (stage) openStage(stage);
});

byId("dialog-close").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => {
  stopDemo();
  setStageQuery();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

const sidebar = byId("guide-sidebar");
const scrim = byId("mobile-scrim");
const closeMenu = (): void => {
  sidebar.classList.remove("open");
  scrim.classList.remove("show");
};
byId("menu-toggle").addEventListener("click", () => {
  sidebar.classList.toggle("open");
  scrim.classList.toggle("show");
});
scrim.addEventListener("click", closeMenu);
sidebar.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

const langButton = byId<HTMLButtonElement>("guide-lang");
langButton.textContent = getLang().toUpperCase();
langButton.addEventListener("click", () => {
  setLang(getLang() === "ja" ? "en" : "ja");
  // Stage metadata is created when modules register, so reload to rebuild all
  // stage copy in the newly selected language.
  location.reload();
});

const observedSections = [...document.querySelectorAll<HTMLElement>("main section[id]")];
const navLinks = [...document.querySelectorAll<HTMLAnchorElement>(".guide-nav a[href^='#']")];
const sectionObserver = new IntersectionObserver(
  (entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.hash === `#${visible.target.id}`);
    });
  },
  { rootMargin: "-15% 0px -65%", threshold: [0, 0.2, 0.5] },
);
observedSections.forEach((section) => sectionObserver.observe(section));

const initialStageId = new URLSearchParams(location.search).get("stage");
const initialStage = stages.find((stage) => stage.id === initialStageId);
if (initialStage) openStage(initialStage, false);
