// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Help modal: triggered by toggle button, "?" key, or pad B/Esc to close.

import { sfx } from "./audio";
import { ui } from "./dom";

export function isOpen(): boolean {
  return ui.helpModal.classList.contains("show");
}

export function open(): void {
  ui.helpModal.classList.add("show");
}

export function close(): void {
  ui.helpModal.classList.remove("show");
}

export function setupHelp(): void {
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
