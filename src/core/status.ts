// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Status bar (top right of canvas). Two writers: stages and gamepad-connect
// events. They share the same DOM element via `ui.status`.

import { ui } from "./dom";

export function setStatus(text: string, color = ""): void {
  ui.status.textContent = text;
  ui.status.style.color = color;
}

export function setHud(lines: string[]): void {
  ui.info.textContent = lines.join("\n");
}

export function setStatusForGamepad(text: string): void {
  setStatus(text);
}
