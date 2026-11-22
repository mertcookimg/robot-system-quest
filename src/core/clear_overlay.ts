// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Stage clear overlay: shows stars, time, leaderboard, and Restart/Next
// buttons. Both the keyboard and the gamepad share a single focus state
// (Restart / Next) which follows the native keyboard focus as well.

import { sfx } from "./audio";
import { ui, shake } from "./dom";
import { spawnConfetti } from "./ambient";
import { saveTime, getTopTimes } from "./rankings";
import { saveProgress, loadProgress } from "./progress";
import { saveCurrentAsBest, getCurrentRecordingLength } from "./ghost";
import { toast } from "./toast";
import { t } from "../i18n";
import * as allclear from "./allclear";
import type { ClearOptions, Stage } from "../types";
import { cancelStageTimeout, setStageTimeout, type StageTimeout } from "./stage_timers";
import { trackStageComplete } from "./analytics";
import { getStageModes } from "./stage_def";

type Focus = "restart" | "next";
export type ClearOverlayCloseReason = "dismiss" | "restart" | "next" | "allclear";
let focus: Focus = "next";
let allclearTimeout: StageTimeout | null = null;
let focusBeforeOpen: HTMLElement | null = null;
let completionSlot: Comment | null = null;
/** True when the open result just completed every stage for the first time. */
let nextShowsAllClear = false;

export function isOpen(): boolean {
  return ui.clearOverlay.classList.contains("show");
}

function applyFocus(moveFocus = false): void {
  ui.restartBtn.classList.toggle("gp-focus", focus === "restart");
  ui.nextBtn.classList.toggle("gp-focus", focus === "next");
  if (moveFocus) {
    (focus === "restart" ? ui.restartBtn : ui.nextBtn).focus({ preventScroll: true });
  }
}

export function setFocus(target: Focus): void {
  const changed = focus !== target;
  focus = target;
  applyFocus(true);
  if (changed) sfx.click();
}

export function confirmFocus(): void {
  sfx.click();
  if (focus === "next") ui.nextBtn.click();
  else ui.restartBtn.click();
}

export function clearOverlayFocus(): void {
  ui.restartBtn.classList.remove("gp-focus");
  ui.nextBtn.classList.remove("gp-focus");
}

export function close(reason: ClearOverlayCloseReason = "dismiss"): void {
  const wasOpen = isOpen();
  const restoreFocus = focusBeforeOpen;
  focusBeforeOpen = null;
  if (allclearTimeout !== null) {
    cancelStageTimeout(allclearTimeout);
    allclearTimeout = null;
  }
  ui.clearOverlay.classList.remove("show");
  ui.clearOverlay.inert = true;
  ui.clearOverlay.setAttribute("aria-hidden", "true");
  completionSlot?.replaceWith(ui.clearOverlay);
  completionSlot = null;
  clearOverlayFocus();
  if (!wasOpen) return;
  // A stage may re-enable its completed results before focus returns to it.
  ui.clearOverlay.dispatchEvent(
    new window.CustomEvent("clear-overlay-close", { detail: { reason } }),
  );
  if (
    reason === "dismiss" &&
    restoreFocus?.isConnected &&
    !restoreFocus.matches(":disabled") &&
    !restoreFocus.closest("[inert], [hidden]")
  ) {
    restoreFocus.focus({ preventScroll: true });
  }
}

interface ShowDeps {
  current: Stage;
  stages: readonly Stage[];
  onRenderSelector: () => void;
}

export function show(
  stars: number,
  statsHtml: string,
  deps: ShowDeps,
  options: ClearOptions = {},
): void {
  const record = options.record ?? true;
  if (allclearTimeout !== null) {
    cancelStageTimeout(allclearTimeout);
    allclearTimeout = null;
  }
  if (!isOpen()) {
    const active = document.activeElement;
    focusBeforeOpen = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  trackStageComplete(deps.current.id, stars);

  // Pull elapsed time out of the stats HTML — stages embed it as
  // "Time <b>X.XX s</b>" so we can save it to the rankings without changing
  // every stage's signature.
  const m = statsHtml.match(/Time\s*<b>([\d.]+)\s*s<\/b>/);
  const time = m ? parseFloat(m[1]) : 0;

  // Render stars
  ui.stars.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const span = document.createElement("span");
    span.className = i < stars ? "star on" : "star";
    span.textContent = "★";
    span.style.animationDelay = `${i * 0.18}s`;
    ui.stars.appendChild(span);
  }

  // Persist time / best ghost. Unrecorded results (local 2P matches) must not
  // overwrite the single-player best time or replace the best ghost.
  const { isBest } = record && time > 0 ? saveTime(deps.current.id, time) : { isBest: false };
  if (isBest && getCurrentRecordingLength() > 0) {
    saveCurrentAsBest(deps.current.id);
  }

  // Build the stats panel. The single-player leaderboard is unrelated to an
  // unrecorded match, so it is only shown for recorded results.
  const top = record ? getTopTimes(deps.current.id, 5) : [];
  let html = statsHtml;
  if (isBest) {
    html = `<div class="new-record">★ ${t("ui.toast.newrecord")} ★</div>` + html;
  }
  if (top.length > 0) {
    html += `<div class="rankings">
      <h4>BEST TIMES</h4>
      ${top
        .map(
          (tt, i) => `
        <div class="row ${Math.abs(tt - time) < 0.001 ? "current" : ""}">
          <span class="rk">#${i + 1}</span>
          <span>${tt.toFixed(2)} s</span>
        </div>`,
        )
        .join("")}
    </div>`;
  }
  ui.clearStats.innerHTML = html;
  ui.clearStats.scrollTop = 0;
  // Results can be taller than the game canvas, especially with rankings or
  // mobile layouts. Escape its clipping/transform without disturbing a lab's
  // existing body-level completion lifecycle.
  if (ui.clearOverlay.parentElement !== document.body) {
    completionSlot = document.createComment("clear-overlay-slot");
    ui.clearOverlay.before(completionSlot);
    document.body.append(ui.clearOverlay);
  }
  ui.clearOverlay.inert = false;
  ui.clearOverlay.setAttribute("aria-hidden", "false");
  ui.clearOverlay.classList.add("show");

  // Star progress
  const isEveryStageCleared = () => {
    const progress = loadProgress();
    return deps.stages.every((stage) => (progress[stage.id]?.stars ?? 0) > 0);
  };
  const wasAllDone = isEveryStageCleared();
  const prevStars = loadProgress()[deps.current.id]?.stars ?? 0;
  const isNewStarBest = record && stars > prevStars;
  if (record) saveProgress(deps.current.id, stars);
  // Celebrate only the clear that completes the set for the first time.
  // Replaying any stage after 100% must still lead to the next stage.
  const completedAllNow = record && !wasAllDone && isEveryStageCleared();
  nextShowsAllClear = completedAllNow;
  const modes = getStageModes();
  const mode = modes.get(deps.current.id);
  const modeStages = deps.stages.filter((stage) => modes.get(stage.id) === mode);
  const isModeEnd = mode !== undefined && modeStages.at(-1)?.id === deps.current.id;
  const [nextJa, nextEn] = completedAllNow
    ? ["全クリアを見る", "View all clear"]
    : isModeEnd
      ? mode === "lesson"
        ? ["レッスン一覧へ", "Lesson list"]
        : ["ゲーム一覧へ", "Game list"]
      : ["次へ →", "Next →"];
  ui.nextBtn.innerHTML = `<span class="i18n-ja">${nextJa}</span><span class="i18n-en">${nextEn}</span>`;
  focus = "next";
  applyFocus(true);
  shake();
  deps.onRenderSelector();
  spawnConfetti(stars === 3 ? 90 : 50);

  if (isNewStarBest) {
    toast(
      stars === 3 ? t("ui.toast.perfect") : t("ui.toast.starsupd"),
      `${deps.current.name}: ${stars}★`,
    );
  } else if (isBest) {
    toast(t("ui.toast.newrecord"), `${time.toFixed(2)}s`);
  }

  // If this clear completed every stage, transition to the all-clear screen.
  if (completedAllNow) {
    allclearTimeout = setStageTimeout(() => {
      allclearTimeout = null;
      if (!isOpen()) return;
      close("allclear");
      allclear.show(deps.stages);
      ui.allclearRestart.focus({ preventScroll: true });
    }, 2400);
  }
}

interface WireDeps {
  onRestart: () => void;
  onNext: () => void;
  showAllClear: () => void;
}

export function setupClearOverlay(deps: WireDeps): void {
  ui.clearOverlay.setAttribute("role", "dialog");
  ui.clearOverlay.setAttribute("aria-modal", "true");
  const title = ui.clearOverlay.querySelector<HTMLElement>(".card-title");
  if (title) {
    if (!title.id) title.id = "clear-overlay-title";
    ui.clearOverlay.setAttribute("aria-labelledby", title.id);
  }
  ui.clearOverlay.inert = !isOpen();
  ui.clearOverlay.setAttribute("aria-hidden", String(!isOpen()));
  for (const [target, button] of [
    ["restart", ui.restartBtn],
    ["next", ui.nextBtn],
  ] as const) {
    button.addEventListener("focus", () => {
      if (!isOpen()) return;
      focus = target;
      applyFocus();
    });
  }
  ui.clearOverlay.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
    const scrollKeys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"];
    if (scrollKeys.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const amount = event.key.startsWith("Page")
        ? Math.max(40, ui.clearStats.clientHeight * 0.8)
        : 40;
      if (event.key === "Home") ui.clearStats.scrollTop = 0;
      else if (event.key === "End") ui.clearStats.scrollTop = ui.clearStats.scrollHeight;
      else ui.clearStats.scrollTop += event.key.endsWith("Up") ? -amount : amount;
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    setFocus(focus === "next" ? "restart" : "next");
  });
  ui.restartBtn.addEventListener("click", () => {
    sfx.click();
    close("restart");
    deps.onRestart();
  });
  ui.nextBtn.addEventListener("click", () => {
    sfx.click();
    const showAllClear = nextShowsAllClear;
    close("next");
    if (showAllClear) {
      deps.showAllClear();
      ui.allclearRestart.focus({ preventScroll: true });
      return;
    }
    deps.onNext();
  });
}
