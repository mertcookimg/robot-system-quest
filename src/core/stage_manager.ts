// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Stage registry, current-stage state, GameContext construction, loadStage().
// Owns the runtime "what's playing right now" state.

import type { Stage, GameContext } from "../types";
import { sfx } from "./audio";
import { ui, shake } from "./dom";
import * as topicMonitor from "./topic_monitor";
import * as terminalUi from "./terminal_ui";
import * as ghost from "./ghost";
import * as crash from "./crash";
import * as input from "./input";
import * as clearOverlay from "./clear_overlay";
import * as modes from "./modes";
import * as stageMenu from "./stage_menu";
import * as lessonModal from "./lesson_modal";
import * as intro from "./intro";
import * as help from "./help";
import * as allclear from "./allclear";
import { getBestTime as rankingBestTime } from "./rankings";
import { getLessonNumbers, getStageModes, prepareStage } from "./stage_def";
import { tx } from "../i18n";
import { setStatus, setHud } from "./status";
import { clearBlockpadHighlights } from "../lib/blockpad";
import { activateNavpad, deactivateNavpad } from "../lib/navpad";
import { drawGhost } from "../lib/draw";
import { clearStageTimeouts, setStageTimeout } from "./stage_timers";
import { trackStageReset, trackStageStart } from "./analytics";
import { resetTouchpadLayout, setTouchpadStage } from "../lib/touchpad";
import { stageDisplayName } from "./stage_labels";
import { clearCanvasReadout } from "../lib/canvas_readout";
import { releaseStageInputs } from "./input_reset";

let stages: Stage[] = [];
let current: Stage;
let currentReady = false;
let loadVersion = 0;
let pendingLoad: Promise<void> = Promise.resolve();
let notifyLoadChanged: () => void = () => {};
let loadChanged = new Promise<void>((resolve) => {
  notifyLoadChanged = resolve;
});

function setPendingLoad(pending: Promise<void>): void {
  pendingLoad = pending;
  notifyLoadChanged();
  loadChanged = new Promise<void>((resolve) => {
    notifyLoadChanged = resolve;
  });
}

export function isStageReady(): boolean {
  return currentReady;
}

/** Home actions wait for the latest selection, including a newer request. */
export async function whenStageReady(): Promise<void> {
  let pending: Promise<void>;
  do {
    pending = pendingLoad;
    await Promise.race([pending, loadChanged]);
  } while (pending !== pendingLoad);
}

export function getStages(): readonly Stage[] {
  return stages;
}

export function getCurrent(): Stage {
  return current;
}

export function getCurrentId(): string {
  return current.id;
}

export function setStages(list: Stage[]): void {
  stages = list;
  current = stages[0];
  currentReady = false;
}

const ghostApi = {
  startRecording: () => ghost.startRecording(),
  recordPose: (t: number, x: number, y: number, theta: number) => ghost.recordPose(t, x, y, theta),
  getPose: (t: number) => ghost.getPose(t),
  hasReplay: () => ghost.hasReplay(),
  draw(ctx: CanvasRenderingContext2D, t: number, animTime: number): void {
    const p = ghost.getPose(t);
    if (p) drawGhost(ctx, p, animTime);
  },
};

let gameContext: GameContext;

export function buildGameContext(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): GameContext {
  gameContext = {
    canvas,
    ctx,
    keys: input.getKeys(),
    overlay: ui.stageOverlay,

    setStatus,
    setHud,
    showClear: (stars, statsHtml, options) =>
      clearOverlay.show(
        stars,
        statsHtml,
        {
          current,
          stages,
          onRenderSelector: modes.renderSelector,
        },
        options,
      ),
    awardStars: (stars, statsHtml, delayMs = 700, options) => {
      const completedStage = current;
      setStageTimeout(() => {
        sfx.clear();
        clearOverlay.show(
          stars,
          statsHtml,
          {
            current: completedStage,
            stages,
            onRenderSelector: modes.renderSelector,
          },
          options,
        );
      }, delayMs);
    },
    setTimeout: setStageTimeout,
    shake: () => shake(),
    crash: (reason) => crash.trigger(reason),
    resetStage: resetCurrent,

    publish: (topic, msg) => topicMonitor.publish(topic, msg),
    sfx,
    ghost: ghostApi,

    getBestTime: (stageId) => rankingBestTime(stageId ?? current.id),
  };
  return gameContext;
}

export function loadStage(id: string): Promise<void> {
  const version = ++loadVersion;
  releaseStageInputs();
  clearCanvasReadout();
  clearStageTimeouts();
  lessonModal.close();
  crash.clearCrashOverlay();
  resetTouchpadLayout();
  if (currentReady) current.dispose();
  currentReady = false;
  topicMonitor.clearLog();
  ui.stageOverlay.innerHTML = "";
  ui.stageOverlay.style.cssText = "";
  clearOverlay.close();
  clearBlockpadHighlights();
  deactivateNavpad();

  const next = stages.find((s) => s.id === id) ?? stages[0];
  current = next;
  const preparation = prepareStage(next);
  if (!preparation) {
    setPendingLoad(Promise.resolve());
    finishStageLoad();
    return pendingLoad;
  }

  document.body.classList.add("stage-loading");
  ui.canvasWrap.setAttribute("aria-busy", "true");
  // A stage's canvas cannot be drawn before its implementation is initialized.
  gameContext.ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  const loading = document.createElement("p");
  loading.className = "stage-loading-message";
  loading.textContent = tx("ステージを読み込んでいます…", "Loading stage…");
  ui.stageOverlay.replaceChildren(loading);
  setStatus(loading.textContent);
  setPendingLoad(
    preparation
      .then(() => {
        if (version !== loadVersion) return;
        ui.stageOverlay.replaceChildren();
        finishStageLoad();
      })
      .catch((error: unknown) => {
        if (version !== loadVersion) return;
        document.body.classList.add("stage-loading");
        console.error("[stage] load failed:", error);
        loading.textContent = tx(
          "ステージを読み込めませんでした。再試行するか、別のステージを選んでください。",
          "Could not load this stage. Retry or choose another stage.",
        );
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = tx("再試行", "Retry");
        retry.addEventListener("click", () => {
          void loadStage(next.id);
        });
        loading.append(document.createElement("br"), retry);
        ui.stageOverlay.replaceChildren(loading);
        ui.canvasWrap.setAttribute("aria-busy", "false");
        setStatus(tx("読み込みに失敗しました", "Stage loading failed"), "var(--warn)");
      }),
  );
  return pendingLoad;
}

function finishStageLoad(): void {
  document.body.classList.remove("stage-loading");
  ui.canvasWrap.setAttribute("aria-busy", "false");
  ghost.loadGhostFor(current.id);
  ghost.startRecording();
  current.init(gameContext);
  currentReady = true;
  releaseStageInputs();
  setTouchpadStage(current.id);
  if (!intro.isShown()) {
    trackStageStart(current.id, modes.isGameStage(current.id) ? "game" : "lesson");
  }
  if (current.id === "navigation") activateNavpad();
  // `stage.lesson` holds only the concept text; the L-number comes from the
  // registry order so labels can never duplicate or fall out of sequence.
  const lessonNo = getLessonNumbers().get(current.id);
  const mode = getStageModes().get(current.id);
  const footerMode = document.getElementById("stage-mode-label");
  if (footerMode) footerMode.textContent = mode === "game" ? "Game" : "Lesson";
  ui.lessonLabel.textContent =
    current.lesson && lessonNo !== undefined ? `L${lessonNo} ${current.lesson}` : current.lesson;
  // Only advertise commands that have a truthful result inside this browser
  // simulation. Mutating real-ROS commands stay out until a stage implements
  // an actual in-game effect for them.
  ui.lessonCmd.textContent = terminalUi.recommendedCommand();
  ui.topicLabel.textContent = `stage: ${stageDisplayName(current)}`;
  lessonModal.renderBrief(current.id);
  terminalUi.resetForStage();
  history.replaceState(null, "", `#${current.id}`);
  if (mode && mode !== modes.getMode()) modes.setModeView(mode);
  else modes.renderSelector();
  sfx.click();

  lessonModal.maybeAutoOpen(current.id, modes.isGameStage(current.id), {
    introOpen: intro.isShown(),
    allclearOpen: allclear.isOpen(),
    helpOpen: help.isOpen(),
  });
}

export function loadNextStage(): void {
  const stageModes = getStageModes();
  const mode = stageModes.get(current.id);
  if (mode) {
    const sameMode = stages.filter((stage) => stageModes.get(stage.id) === mode);
    const idx = sameMode.findIndex((stage) => stage.id === current.id);
    if (idx === sameMode.length - 1) {
      stageMenu.openMenu(mode);
      ui.stageSelector.querySelector<HTMLButtonElement>(".stage-pill.active")?.focus();
      return;
    }
    modes.setModeView(mode);
    loadStage(sameMode[idx + 1].id);
    return;
  }
  const idx = stages.findIndex((s) => s.id === current.id);
  loadStage(stages[(idx + 1) % stages.length].id);
}

export function resetCurrent(): void {
  if (!currentReady) {
    void loadStage(current.id);
    return;
  }
  releaseStageInputs();
  clearCanvasReadout();
  trackStageReset(current.id, modes.isGameStage(current.id) ? "game" : "lesson");
  clearOverlay.close("restart");
  clearStageTimeouts();
  crash.clearCrashOverlay();
  topicMonitor.clearLog();
  current.reset();
  releaseStageInputs();
  terminalUi.resetForStage();
}
