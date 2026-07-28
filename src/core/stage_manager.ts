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
import * as lessonModal from "./lesson_modal";
import * as intro from "./intro";
import * as help from "./help";
import * as allclear from "./allclear";
import { getBestTime as rankingBestTime } from "./rankings";
import { getLessonNumbers } from "./stage_def";
import { setStatus, setHud } from "./status";
import { clearBlockpadHighlights } from "../lib/blockpad";
import { activateNavpad, deactivateNavpad } from "../lib/navpad";
import { drawGhost } from "../lib/draw";
import { clearStageTimeouts, setStageTimeout } from "./stage_timers";

let stages: Stage[] = [];
let current: Stage;

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
    showClear: (stars, statsHtml) =>
      clearOverlay.show(stars, statsHtml, {
        current,
        stages,
        onRenderSelector: modes.renderSelector,
      }),
    awardStars: (stars, statsHtml, delayMs = 700) => {
      const completedStage = current;
      setStageTimeout(() => {
        sfx.clear();
        clearOverlay.show(stars, statsHtml, {
          current: completedStage,
          stages,
          onRenderSelector: modes.renderSelector,
        });
      }, delayMs);
    },
    setTimeout: setStageTimeout,
    shake: () => shake(),
    crash: (reason) => crash.trigger(reason),

    publish: (topic, msg) => topicMonitor.publish(topic, msg),
    sfx,
    ghost: ghostApi,

    getBestTime: (stageId) => rankingBestTime(stageId ?? current.id),
  };
  return gameContext;
}

export function loadStage(id: string): void {
  clearStageTimeouts();
  crash.clearCrashOverlay();
  if (current) current.dispose();
  topicMonitor.clearLog();
  ui.stageOverlay.innerHTML = "";
  ui.stageOverlay.style.display = "";
  clearOverlay.close();
  clearBlockpadHighlights();
  deactivateNavpad();

  ghost.loadGhostFor(id);
  ghost.startRecording();

  const next = stages.find((s) => s.id === id) ?? stages[0];
  current = next;
  current.init(gameContext);
  if (current.id === "navigation") activateNavpad();
  // `stage.lesson` holds only the concept text; the L-number comes from the
  // registry order so labels can never duplicate or fall out of sequence.
  const lessonNo = getLessonNumbers().get(current.id);
  ui.lessonLabel.textContent =
    current.lesson && lessonNo !== undefined ? `L${lessonNo} ${current.lesson}` : current.lesson;
  // Only advertise commands that have a truthful result inside this browser
  // simulation. Mutating real-ROS commands stay out until a stage implements
  // an actual in-game effect for them.
  ui.lessonCmd.textContent = terminalUi.recommendedCommand();
  ui.topicLabel.textContent = `stage: ${current.name}`;
  lessonModal.renderBrief(current.id);
  terminalUi.resetForStage();
  history.replaceState(null, "", `#${id}`);
  modes.renderSelector();
  sfx.click();

  lessonModal.maybeAutoOpen(id, modes.isGameStage(id), {
    introOpen: intro.isShown(),
    allclearOpen: allclear.isOpen(),
    helpOpen: help.isOpen(),
  });
}

export function loadNextStage(): void {
  const idx = stages.findIndex((s) => s.id === current.id);
  loadStage(stages[(idx + 1) % stages.length].id);
}

export function resetCurrent(): void {
  clearStageTimeouts();
  crash.clearCrashOverlay();
  current.reset();
}
