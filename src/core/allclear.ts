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
import { setDialogVisible, restoreDialogFocus } from "./modal_visibility";

let previousFocus: HTMLElement | null = null;

export function isOpen(): boolean {
  return ui.allclearScreen.classList.contains("show");
}

export function show(stages: readonly Stage[]): void {
  if (!isOpen()) previousFocus = document.activeElement as HTMLElement | null;
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
  ui.allclearStars.scrollTop = 0;
  const total = totalStars(stages.map((s) => s.id));
  const starsLabel = getLang() === "ja" ? "スター" : "stars";
  ui.allclearStats.innerHTML =
    `<b>${total} / ${max}</b> ${starsLabel}` +
    (total === max ? "  ・ " + t("ui.toast.perfect") : "");
  ui.allclearScreen.classList.add("show");
  setDialogVisible(ui.allclearScreen, true);
  ui.allclearRestart.classList.add("gp-focus");
  ui.allclearRestart.focus({ preventScroll: true });
  sfx.victory();
  spawnConfetti(220);
}

export function hide(): void {
  ui.allclearScreen.classList.remove("show");
  setDialogVisible(ui.allclearScreen, false);
  ui.allclearRestart.classList.remove("gp-focus");
  restoreDialogFocus(previousFocus);
  previousFocus = null;
}

export function setupAllClear(onRestart: () => void): void {
  ui.allclearScreen.setAttribute("role", "dialog");
  ui.allclearScreen.setAttribute("aria-modal", "true");
  ui.allclearScreen.setAttribute("aria-labelledby", "allclear-title");
  setDialogVisible(ui.allclearScreen, isOpen());
  ui.allclearScreen.addEventListener("keydown", (event) => {
    if (isOpen() && event.key === "Tab") {
      event.preventDefault();
      ui.allclearRestart.focus({ preventScroll: true });
      return;
    }
    if (
      !isOpen() ||
      !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const results = ui.allclearStars;
    const amount = event.key.startsWith("Page") ? Math.max(40, results.clientHeight * 0.8) : 40;
    if (event.key === "Home") results.scrollTop = 0;
    else if (event.key === "End") results.scrollTop = results.scrollHeight;
    else results.scrollTop += event.key.endsWith("Up") ? -amount : amount;
  });
  ui.allclearRestart.addEventListener("click", () => {
    if (!isOpen()) return;
    sfx.click();
    hide();
    onRestart();
  });
}
