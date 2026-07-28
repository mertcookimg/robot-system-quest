// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// "All stages cleared" screen. Shows total stars and lets the player loop
// back to stage 1.

import { sfx } from "./audio";
import { ui } from "./dom";
import { spawnConfetti } from "./ambient";
import { loadProgress, totalStars } from "./progress";
import { t, getLang } from "../i18n";
import type { Stage } from "../types";

export function isOpen(): boolean {
  return ui.allclearScreen.classList.contains("show");
}

export function show(stages: readonly Stage[]): void {
  const p = loadProgress();
  const max = stages.length * 3;
  ui.allclearStars.innerHTML = stages
    .map((s) => {
      const ss = p[s.id]?.stars ?? 0;
      return `<div class="stage-result">
        <h4>${s.name}</h4>
        <div class="ss">${[0, 1, 2].map((i) => `<span class="${i < ss ? "on" : ""}">★</span>`).join("")}</div>
      </div>`;
    })
    .join("");
  const total = totalStars(stages.map((s) => s.id));
  const starsLabel = getLang() === "ja" ? "スター" : "stars";
  ui.allclearStats.innerHTML =
    `<b>${total} / ${max}</b> ${starsLabel}` +
    (total === max ? "  ・ " + t("ui.toast.perfect") : "");
  ui.allclearScreen.classList.add("show");
  ui.allclearRestart.classList.add("gp-focus");
  sfx.victory();
  spawnConfetti(220);
}

export function hide(): void {
  ui.allclearScreen.classList.remove("show");
  ui.allclearRestart.classList.remove("gp-focus");
}

export function setupAllClear(onRestart: () => void): void {
  ui.allclearRestart.addEventListener("click", () => {
    sfx.click();
    hide();
    onRestart();
  });
}
