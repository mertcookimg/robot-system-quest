// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Stage clear overlay: shows stars, time, leaderboard, and Restart/Next
// buttons. Both the keyboard and the gamepad share a single focus state
// (Restart / Next) which is rendered as a CSS class on the buttons.

import { sfx } from "./audio";
import { ui, shake } from "./dom";
import { spawnConfetti } from "./ambient";
import { saveTime, getTopTimes } from "./rankings";
import { saveProgress, loadProgress } from "./progress";
import { saveCurrentAsBest, getCurrentRecordingLength } from "./ghost";
import { toast } from "./toast";
import { t } from "../i18n";
import * as allclear from "./allclear";
import type { Stage } from "../types";
import { setStageTimeout } from "./stage_timers";
import { trackStageComplete } from "./analytics";

type Focus = "restart" | "next";
let focus: Focus = "next";

export function isOpen(): boolean {
  return ui.clearOverlay.classList.contains("show");
}

function applyFocus(): void {
  ui.restartBtn.classList.toggle("gp-focus", focus === "restart");
  ui.nextBtn.classList.toggle("gp-focus", focus === "next");
}

export function setFocus(target: Focus): void {
  if (focus === target) return;
  focus = target;
  applyFocus();
  sfx.click();
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

export function close(): void {
  ui.clearOverlay.classList.remove("show");
  clearOverlayFocus();
}

interface ShowDeps {
  current: Stage;
  stages: readonly Stage[];
  onRenderSelector: () => void;
}

export function show(stars: number, statsHtml: string, deps: ShowDeps): void {
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

  // Persist time / best ghost
  const { isBest } = time > 0 ? saveTime(deps.current.id, time) : { isBest: false };
  if (isBest && getCurrentRecordingLength() > 0) {
    saveCurrentAsBest(deps.current.id);
  }

  // Build the stats panel
  const top = getTopTimes(deps.current.id, 5);
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
  ui.clearOverlay.classList.add("show");

  // Reset gamepad focus state
  focus = "next";
  applyFocus();
  shake();

  // Star progress
  const prevStars = loadProgress()[deps.current.id]?.stars ?? 0;
  const isNewStarBest = stars > prevStars;
  saveProgress(deps.current.id, stars);
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
  const allDone = deps.stages.every((s) => (loadProgress()[s.id]?.stars ?? 0) > 0);
  if (allDone) {
    setStageTimeout(() => {
      ui.clearOverlay.classList.remove("show");
      allclear.show(deps.stages);
    }, 2400);
  }
}

interface WireDeps {
  onRestart: () => void;
  onNext: () => void;
  isAllCleared: () => boolean;
  showAllClear: () => void;
}

export function setupClearOverlay(deps: WireDeps): void {
  ui.restartBtn.addEventListener("click", () => {
    sfx.click();
    close();
    deps.onRestart();
  });
  ui.nextBtn.addEventListener("click", () => {
    sfx.click();
    close();
    if (deps.isAllCleared()) {
      deps.showAllClear();
      return;
    }
    deps.onNext();
  });
}
