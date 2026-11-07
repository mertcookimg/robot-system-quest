// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Help modal: triggered by toggle button, "?" key, or pad B/Esc to close.

import { sfx } from "./audio";
import { ui } from "./dom";
import { releaseStageInputs } from "./input_reset";

let previousFocus: HTMLElement | null = null;

export function isOpen(): boolean {
  return ui.helpModal.classList.contains("show");
}

export function open(): void {
  if (!isOpen()) previousFocus = document.activeElement as HTMLElement | null;
  releaseStageInputs();
  ui.helpModal.inert = false;
  ui.helpModal.setAttribute("aria-hidden", "false");
  ui.helpModal.classList.add("show");
  ui.helpClose.focus({ preventScroll: true });
}

export function close(): void {
  const wasOpen = isOpen();
  ui.helpModal.classList.remove("show");
  ui.helpModal.inert = true;
  ui.helpModal.setAttribute("aria-hidden", "true");
  if (wasOpen) {
    const target =
      previousFocus?.isConnected &&
      !previousFocus.matches(":disabled") &&
      !previousFocus.closest("[hidden], [inert]")
        ? previousFocus
        : ui.helpToggle;
    target.focus({ preventScroll: true });
  }
  previousFocus = null;
}

export function setupHelp(): void {
  ui.helpModal.setAttribute("role", "dialog");
  ui.helpModal.setAttribute("aria-modal", "true");
  const title = ui.helpModal.querySelector("h2");
  if (title) {
    title.id = "help-title";
    ui.helpModal.setAttribute("aria-labelledby", title.id);
  }
  ui.helpModal.inert = !isOpen();
  ui.helpModal.setAttribute("aria-hidden", String(!isOpen()));
  ui.helpModal.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      ui.helpClose.focus();
    }
  });
  ui.helpToggle.addEventListener("click", () => {
    open();
    sfx.click();
  });
  ui.helpClose.addEventListener("click", () => {
    close();
    sfx.click();
  });
  ui.helpModal.addEventListener("click", (e) => {
    if (e.target === ui.helpModal) close();
  });
}
