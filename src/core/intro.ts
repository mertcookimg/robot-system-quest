// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Intro splash screen shown to first-time visitors.

import { sfx, startAudio } from "./audio";
import { ui } from "./dom";
import type { Stage } from "../types";

type Mode = "game" | "lesson";

const MODE_ORDER: Mode[] = ["game", "lesson"];
let focusIdx = 0; // 0 = game, 1 = lesson
let onSelect: ((mode: Mode) => void) | null = null;
let onDismissCb: (() => void) | null = null;

function splitByMode(
  stages: readonly Stage[],
  stageModes: ReadonlyMap<string, Mode>,
): {
  gameCount: number;
  lessonCount: number;
} {
  const game = stages.filter((s) => stageModes.get(s.id) === "game");
  const lesson = stages.filter((s) => stageModes.get(s.id) === "lesson");
  return { gameCount: game.length, lessonCount: lesson.length };
}

export function renderStageList(
  stages: readonly Stage[],
  stageModes: ReadonlyMap<string, Mode>,
): void {
  const { gameCount, lessonCount } = splitByMode(stages, stageModes);
  ui.introGameCount.textContent = String(gameCount);
  ui.introGameCountEn.textContent = String(gameCount);
  ui.introLessonCount.textContent = String(lessonCount);
  ui.introLessonCountEn.textContent = String(lessonCount);
}

export function isShown(): boolean {
  return ui.introScreen.classList.contains("show");
}

function applyFocus(): void {
  const cards = ui.introScreen.querySelectorAll<HTMLElement>(".intro-mode");
  cards.forEach((c, i) => c.classList.toggle("gp-focus", i === focusIdx));
}

export function show(): void {
  document.body.classList.add("intro-open");
  ui.introScreen.classList.add("show");
  focusIdx = 0;
  applyFocus();
}

export function start(): void {
  if (!isShown()) return;
  document.body.classList.remove("intro-open");
  ui.introScreen.classList.remove("show");
  ui.introScreen
    .querySelectorAll(".intro-mode.gp-focus")
    .forEach((c) => c.classList.remove("gp-focus"));
  sfx.start();
  startAudio();
  onDismissCb?.();
}

/** Move focus between intro mode cards. Used by keyboard / gamepad. */
export function stepFocus(d: -1 | 1): void {
  if (!isShown()) return;
  focusIdx = (focusIdx + d + MODE_ORDER.length) % MODE_ORDER.length;
  applyFocus();
  // Keep native Enter/Space on the same card as the arrow-key highlight.
  if (document.activeElement?.matches(".intro-mode")) {
    ui.introScreen.querySelectorAll<HTMLElement>(".intro-mode")[focusIdx]?.focus();
  }
  sfx.click();
}

/** Tab through every Home control without moving behind the overlay. */
export function stepTab(d: -1 | 1): void {
  if (!isShown()) return;
  const controls = [
    ...ui.introScreen.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]"),
  ];
  if (!controls.length) return;
  const current = controls.indexOf(document.activeElement as HTMLElement);
  const next =
    current < 0
      ? d > 0
        ? 0
        : controls.length - 1
      : (current + d + controls.length) % controls.length;
  controls[next].focus();
}

/** Confirm the currently focused mode (keyboard Enter / pad A). */
export function confirm(): void {
  if (!isShown()) return;
  const mode = MODE_ORDER[focusIdx];
  onSelect?.(mode);
  start();
}

interface SetupIntroOptions {
  onSelectMode: (mode: Mode) => void;
  /** Fires after the intro fades out (mode-card click / keyboard / pad). */
  onDismiss?: () => void;
}

export function setupIntro(options: SetupIntroOptions): void {
  onSelect = options.onSelectMode;
  onDismissCb = options.onDismiss ?? null;

  // Mouse click on a card → confirm that mode immediately
  ui.introScreen.addEventListener("click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (!target) return;
    const mode = target.dataset.mode === "lesson" ? "lesson" : "game";
    focusIdx = MODE_ORDER.indexOf(mode);
    onSelect?.(mode);
    start();
  });

  // Hover and native keyboard focus keep the selected mode highlight in sync.
  ui.introScreen.querySelectorAll<HTMLElement>(".intro-mode").forEach((card, i) => {
    const focusCard = () => {
      if (!isShown()) return;
      focusIdx = i;
      applyFocus();
    };
    card.addEventListener("mouseenter", focusCard);
    card.addEventListener("focus", focusCard);
  });
}
