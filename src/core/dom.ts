// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Typed lookups for the DOM elements that core modules wire onto. Kept in one
// place so the wiring is auditable and there are no scattered `getElementById`
// calls. All elements come from index.html and are guaranteed to exist when
// this module is first imported (we ship as type="module" so DOM is parsed).

export const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing in DOM`);
  return el as T;
};

export const ui = {
  // Game canvases
  canvas: $<HTMLCanvasElement>("game"),
  ambient: $<HTMLCanvasElement>("ambient"),
  canvasWrap: $<HTMLElement>("canvas-wrap"),

  // Right panel
  info: $<HTMLElement>("info"),
  topic: $<HTMLElement>("topic"),
  topicLabel: $<HTMLElement>("topic-label"),
  status: $<HTMLElement>("status"),

  // Stage clear overlay
  clearOverlay: $<HTMLElement>("clear-overlay"),
  stageOverlay: $<HTMLElement>("stage-overlay"),
  stars: $<HTMLElement>("stars"),
  clearStats: $<HTMLElement>("clear-stats"),
  restartBtn: $<HTMLButtonElement>("restart"),
  nextBtn: $<HTMLButtonElement>("next-stage"),

  // Stage selector + tabs
  stageSelector: $<HTMLElement>("stage-selector"),
  modeTabs: $<HTMLElement>("mode-tabs"),

  // Lesson hints in main bar
  lessonLabel: $<HTMLElement>("lesson-label"),
  lessonCmd: $<HTMLElement>("lesson-cmd"),
  lessonBrief: $<HTMLElement>("lesson-brief"),
  lessonBriefNumber: $<HTMLElement>("lesson-brief-number"),
  lessonBriefTitle: $<HTMLElement>("lesson-brief-title"),
  lessonBriefFirst: $<HTMLElement>("lesson-brief-first"),
  lessonBriefGoal: $<HTMLElement>("lesson-brief-goal"),
  lessonBriefGuide: $<HTMLButtonElement>("lesson-brief-guide"),

  // Terminal
  terminalBody: $<HTMLElement>("terminal-body"),
  terminalInput: $<HTMLInputElement>("terminal-input"),
  terminalStage: $<HTMLElement>("terminal-stage"),

  // Toggle buttons
  homeToggle: $<HTMLElement>("home-toggle"),
  audioToggle: $<HTMLElement>("audio-toggle"),
  ghostToggle: $<HTMLElement>("ghost-toggle"),
  langToggle: $<HTMLElement>("lang-toggle"),

  // Intro
  introScreen: $<HTMLElement>("intro-screen"),
  introLangToggle: $<HTMLButtonElement>("intro-lang-toggle"),
  introGameCount: $<HTMLElement>("intro-game-count"),
  introGameCountEn: $<HTMLElement>("intro-game-count-en"),
  introLessonCount: $<HTMLElement>("intro-lesson-count"),
  introLessonCountEn: $<HTMLElement>("intro-lesson-count-en"),

  // All-clear screen
  allclearScreen: $<HTMLElement>("allclear-screen"),
  allclearStars: $<HTMLElement>("allclear-stars"),
  allclearStats: $<HTMLElement>("allclear-stats"),
  allclearRestart: $<HTMLButtonElement>("allclear-restart"),

  // Help modal
  helpToggle: $<HTMLElement>("help-toggle"),
  helpModal: $<HTMLElement>("help-modal"),
  helpClose: $<HTMLButtonElement>("help-close"),

  // Lesson modal
  lessonToggle: $<HTMLElement>("lesson-toggle"),
  lessonModal: $<HTMLElement>("lesson-modal"),
  lessonClose: $<HTMLButtonElement>("lesson-close"),
  lessonTitle: $<HTMLElement>("lesson-title"),
  lessonDiagram: $<HTMLElement>("lesson-diagram"),
  lessonLearn: $<HTMLElement>("lesson-learn"),
  lessonGoal: $<HTMLElement>("lesson-goal"),
  lessonFirst: $<HTMLElement>("lesson-first"),

  // Misc
  toastContainer: $<HTMLElement>("toast-container"),
  crashOverlay: $<HTMLElement>("crash-overlay"),
  crashSub: $<HTMLElement>("crash-sub"),
} as const;

/** Trigger a CSS shake animation by toggling the class. */
export function shake(): void {
  const el = ui.canvasWrap;
  el.classList.remove("shake");
  void el.offsetWidth; // force reflow
  el.classList.add("shake");
}
