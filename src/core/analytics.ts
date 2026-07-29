// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Analytics is opt-in at build time. Local development and forks without
// their own VITE_GA_ID never load Google Tag Manager or send measurements.

type AnalyticsWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
};

export type AnalyticsStageMode = "game" | "lesson";

interface ActiveStage {
  id: string;
  mode: AnalyticsStageMode;
  startedAt: number;
}

type AnalyticsParams = Record<string, string | number | boolean>;

let analyticsEnabled = false;
let activeStage: ActiveStage | null = null;

function sendEvent(name: string, params: AnalyticsParams): void {
  if (!analyticsEnabled) return;
  (window as AnalyticsWindow).gtag?.("event", name, params);
}

function durationSeconds(stage: ActiveStage): number {
  return Math.max(0, Math.round((performance.now() - stage.startedAt) / 100) / 10);
}

function finishActiveStage(eventName: "stage_exit" | "stage_reset"): ActiveStage | null {
  if (!activeStage) return null;

  const finished = activeStage;
  activeStage = null;
  sendEvent(eventName, {
    stage_id: finished.id,
    stage_mode: finished.mode,
    duration_seconds: durationSeconds(finished),
  });
  return finished;
}

export function setupAnalytics(): void {
  const measurementId = import.meta.env.VITE_GA_ID?.trim();
  if (!import.meta.env.PROD || !measurementId || !/^G-[A-Z0-9]+$/.test(measurementId)) return;

  const analyticsWindow = window as AnalyticsWindow;
  analyticsWindow.dataLayer = analyticsWindow.dataLayer ?? [];
  analyticsWindow.gtag = function (): void {
    analyticsWindow.dataLayer!.push(arguments);
  };
  analyticsWindow.gtag("js", new Date());
  analyticsWindow.gtag("config", measurementId);
  analyticsEnabled = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

export function trackStageStart(id: string, mode: AnalyticsStageMode): void {
  // Loading another stage ends the previous active attempt. Loading the same
  // stage again is also a fresh attempt, such as selecting it from the menu.
  finishActiveStage("stage_exit");
  activeStage = { id, mode, startedAt: performance.now() };
  sendEvent("stage_start", {
    stage_id: id,
    stage_mode: mode,
  });
}

export function trackStageComplete(id: string, stars: number): void {
  if (!activeStage || activeStage.id !== id) return;

  const completed = activeStage;
  activeStage = null;
  sendEvent("stage_complete", {
    stage_id: completed.id,
    stage_mode: completed.mode,
    duration_seconds: durationSeconds(completed),
    stars,
  });
}

export function trackStageReset(id: string, mode: AnalyticsStageMode): void {
  // A reset ends the current attempt. Restarting after a clear has no active
  // attempt, so only the new stage_start event is emitted in that case.
  finishActiveStage("stage_reset");
  activeStage = { id, mode, startedAt: performance.now() };
  sendEvent("stage_start", {
    stage_id: id,
    stage_mode: mode,
  });
}

export function trackStageExit(): void {
  finishActiveStage("stage_exit");
}

export function trackGuideOpen(id: string, mode: AnalyticsStageMode): void {
  sendEvent("guide_open", {
    stage_id: id,
    stage_mode: mode,
  });
}

export function trackGuidePlayClick(id: string, mode: AnalyticsStageMode): void {
  sendEvent("guide_play_click", {
    stage_id: id,
    stage_mode: mode,
  });
}

export function trackGuideSectionView(section: string): void {
  sendEvent("guide_section_view", {
    guide_section: section,
  });
}
