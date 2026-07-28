// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Per-stage lesson modal. Auto-opens on first visit to a LESSON stage; GAME
// stages must be opened explicitly via the LESSON button. "Seen" state is per
// stage id, persisted to localStorage.

import { sfx } from "./audio";
import { ui } from "./dom";
import { t, onLangChange } from "../i18n";
import { StorageKeys, loadJson, saveJson } from "./storage";
import { isGameStage, getGameIds, getLessonIds } from "./modes";
import { getDiagram, getStages } from "./stage_def";
import { startDemo, stopDemo } from "./lesson_demo";
import { setStageTimeout } from "./stage_timers";

function loadSeen(): Set<string> {
  return new Set(
    loadJson(
      StorageKeys.lessonSeen,
      [],
      (value): value is string[] =>
        Array.isArray(value) && value.every((stageId) => typeof stageId === "string"),
    ),
  );
}

/** Tracks whether the current open() was triggered by the first-visit
 * auto-open (vs. a manual click on the LESSON button). When non-null,
 * dismissing the modal also resets the stage so the timer starts at 0
 * the moment the player presses START. */
let autoOpenedFor: string | null = null;
let onAutoDismiss: (() => void) | null = null;
let focusBeforeOpen: HTMLElement | null = null;

function markSeen(stageId: string): void {
  const s = loadSeen();
  s.add(stageId);
  saveJson(StorageKeys.lessonSeen, [...s]);
}

function hasContent(stageId: string): boolean {
  const key = `${stageId}.lesson.title`;
  return t(key) !== key;
}

export function isOpen(): boolean {
  return ui.lessonModal.classList.contains("show");
}

/** Keep the task visible after the intro modal is dismissed. */
export function renderBrief(stageId: string): void {
  const lesson = !isGameStage(stageId) && hasContent(stageId);
  ui.lessonBrief.hidden = !lesson;
  if (!lesson) return;

  ui.lessonBriefNumber.textContent = stagePrefix(stageId);
  ui.lessonBriefTitle.textContent = t(`${stageId}.lesson.title`);
  ui.lessonBriefFirst.textContent = t(`${stageId}.lesson.first`);
  ui.lessonBriefGoal.textContent = t(`${stageId}.lesson.goal`);
}

function stagePrefix(stageId: string): string {
  const gameIds = getGameIds();
  const i = gameIds.indexOf(stageId);
  if (i >= 0) return `G${i + 1}`;
  const lessonIds = getLessonIds();
  const j = lessonIds.indexOf(stageId);
  if (j >= 0) return `L${j + 1}`;
  return "";
}

function stageName(stageId: string): string {
  const s = getStages().find((st) => st.id === stageId);
  return s?.name ?? stageId;
}

export function open(stageId: string): void {
  if (!hasContent(stageId)) return;
  const game = isGameStage(stageId);
  ui.lessonModal.dataset.kind = game ? "game" : "lesson";
  // GAME stages use a mission-briefing layout:
  //   - Large stage badge (G1/G2/...)
  //   - Stage name (Delivery / Racing / ...) as the main title
  //   - Original lesson title as a smaller subtitle
  // LESSON stages keep the standard layout (badge and subtitle hidden).
  const badge = document.getElementById("lesson-stage-badge");
  const subtitle = document.getElementById("lesson-subtitle");
  const eyebrow = ui.lessonModal.querySelector<HTMLElement>("#lesson-eyebrow");
  const lessonTitle = t(`${stageId}.lesson.title`);
  if (game) {
    if (badge) badge.textContent = stagePrefix(stageId);
    ui.lessonTitle.textContent = stageName(stageId).toUpperCase();
    if (subtitle) subtitle.textContent = lessonTitle;
    if (eyebrow) eyebrow.textContent = "MISSION";
  } else {
    if (badge) badge.textContent = "";
    ui.lessonTitle.textContent = lessonTitle;
    if (subtitle) subtitle.textContent = "";
    if (eyebrow) eyebrow.textContent = "LESSON";
  }
  ui.lessonLearn.textContent = t(`${stageId}.lesson.learn`);
  ui.lessonGoal.textContent = t(`${stageId}.lesson.goal`);
  ui.lessonFirst.textContent = t(`${stageId}.lesson.first`);
  ui.lessonDiagram.innerHTML = getDiagram(stageId);
  if (!isOpen()) focusBeforeOpen = document.activeElement as HTMLElement | null;
  ui.lessonModal.classList.add("show");
  ui.lessonModal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => ui.lessonClose.focus());
  if (game) startDemo(stageId);
  else stopDemo();
}

export function close(): void {
  ui.lessonModal.classList.remove("show");
  ui.lessonModal.setAttribute("aria-hidden", "true");
  stopDemo();
  const restore = focusBeforeOpen;
  focusBeforeOpen = null;
  restore?.focus();
}

/** Close + mark seen + click sound. Use when the user dismisses the modal. */
export function dismiss(stageId: string): void {
  const wasAuto = autoOpenedFor === stageId;
  autoOpenedFor = null;
  close();
  markSeen(stageId);
  sfx.click();
  // If this was the first-visit auto-open, restart the stage so the
  // 220ms head-start before the modal appeared doesn't show up on the
  // timer / state when the player begins.
  if (wasAuto) onAutoDismiss?.();
}

/**
 * Auto-open on stage load if (a) the stage has lesson content, (b) it has
 * not been seen yet, and (c) no other modal is in the way. Both GAME and
 * LESSON stages get the first-visit explainer; the modal serves as a
 * "what is this stage about?" intro regardless of category.
 */
export function maybeAutoOpen(
  stageId: string,
  _isGame: boolean,
  blockers: { introOpen: boolean; allclearOpen: boolean; helpOpen: boolean },
): void {
  if (!hasContent(stageId)) return;
  if (loadSeen().has(stageId)) return;
  if (blockers.introOpen || blockers.allclearOpen || blockers.helpOpen) return;
  // Mark this as an auto-open so dismissal resets the stage (so the
  // timer starts at 0 the moment the player presses START).
  autoOpenedFor = stageId;
  // Slight delay so it does not collide with stage transition animation.
  setStageTimeout(() => open(stageId), 220);
}

export function setupLessonModal(
  getCurrentStageId: () => string,
  onAutoDismissCb?: () => void,
): void {
  onAutoDismiss = onAutoDismissCb ?? null;
  ui.lessonToggle.addEventListener("click", () => {
    autoOpenedFor = null; // manual open, no reset on dismiss
    open(getCurrentStageId());
    sfx.click();
  });
  ui.lessonBriefGuide.addEventListener("click", () => {
    autoOpenedFor = null;
    open(getCurrentStageId());
    sfx.click();
  });
  ui.lessonClose.addEventListener("click", () => dismiss(getCurrentStageId()));
  ui.lessonModal.addEventListener("click", (e) => {
    if (e.target === ui.lessonModal) dismiss(getCurrentStageId());
  });
  ui.lessonModal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      dismiss(getCurrentStageId());
      return;
    }
    if (e.key === "Tab") {
      // The current modal has one actionable control. Keep keyboard focus
      // inside it instead of allowing the stage controls behind it to receive it.
      e.preventDefault();
      ui.lessonClose.focus();
    }
  });
  // Re-render in the new language if it's currently open.
  onLangChange(() => {
    renderBrief(getCurrentStageId());
    if (isOpen()) {
      const wasAuto = autoOpenedFor; // preserve flag across re-render
      open(getCurrentStageId());
      autoOpenedFor = wasAuto;
    }
  });
}
