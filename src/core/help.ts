// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Help modal: triggered by toggle button, "?" key, or pad B/Esc to close.

import { sfx } from "./audio";
import { ui } from "./dom";
import { releaseStageInputs } from "./input_reset";
import { onLangChange, t } from "../i18n";
import { setDialogVisible } from "./modal_visibility";

let previousFocus: HTMLElement | null = null;

export function isOpen(): boolean {
  return ui.helpModal.classList.contains("show");
}

export function open(): void {
  if (!isOpen()) previousFocus = document.activeElement as HTMLElement | null;
  releaseStageInputs();
  ui.helpModal.classList.add("show");
  setDialogVisible(ui.helpModal, true);
  ui.helpClose.focus({ preventScroll: true });
}

export function close(): void {
  const wasOpen = isOpen();
  ui.helpModal.classList.remove("show");
  setDialogVisible(ui.helpModal, false);
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
  const renderLanguage = (): void => {
    if (title) title.textContent = t("ui.help.title");
    ui.helpClose.textContent = t("ui.help.close");
  };
  renderLanguage();
  onLangChange(renderLanguage);
  setDialogVisible(ui.helpModal, isOpen());
  ui.helpModal.addEventListener("keydown", (event) => {
    if (!isOpen()) return;
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
