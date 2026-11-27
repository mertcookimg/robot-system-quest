// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Keep instructions readable, wrapping and zoomable outside the canvas at
// every size. Compact layouts also move timing here. Capture only the live
// stage canvas, never the Guide's preview canvases.
import { tx } from "../i18n";

let canvas: HTMLCanvasElement | null = null;
let compact: MediaQueryList | null = null;
let shortViewport: MediaQueryList | null = null;
let panel: HTMLElement | null = null;
let hintElement: HTMLElement | null = null;
let timerElement: HTMLElement | null = null;
let hint = "";
let timer: { elapsed: number; best?: number } | null = null;

export function setupCanvasReadout(target: HTMLCanvasElement): void {
  panel?.remove();
  canvas = target;
  compact = target.ownerDocument.defaultView?.matchMedia("(max-width: 840px)") ?? null;
  shortViewport = target.ownerDocument.defaultView?.matchMedia("(max-height: 640px)") ?? null;
  panel = target.ownerDocument.createElement("div");
  panel.className = "canvas-readout";
  panel.hidden = true;
  timerElement = target.ownerDocument.createElement("p");
  timerElement.className = "canvas-readout-time";
  hintElement = target.ownerDocument.createElement("p");
  hintElement.className = "canvas-readout-hint";
  panel.append(timerElement, hintElement);
  target.after(panel);
  clearCanvasReadout();
}

export function beginCanvasReadoutFrame(): void {
  hint = "";
  timer = null;
}

/** True means wrapping HTML instructions replace this canvas text. */
export function reportCanvasHint(ctx: CanvasRenderingContext2D, text: string): boolean {
  if (!canvas || ctx.canvas !== canvas) return false;
  hint = text;
  return true;
}

/** True means the compact HTML readout replaces this canvas timer. */
export function reportCanvasTimer(
  ctx: CanvasRenderingContext2D,
  elapsed: number,
  best?: number,
): boolean {
  if (!canvas || ctx.canvas !== canvas) return false;
  timer = { elapsed, best };
  return !!(compact?.matches || shortViewport?.matches);
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
  element.hidden = !text;
}

export function endCanvasReadoutFrame(): void {
  if (!panel || !hintElement || !timerElement) return;
  const showTimer = !!(compact?.matches || shortViewport?.matches) && timer !== null;
  if (!hint && !showTimer) {
    panel.hidden = true;
    setText(hintElement, "");
    setText(timerElement, "");
    return;
  }
  // No live region: a running timer must not continuously interrupt speech.
  const timeText =
    showTimer && timer
      ? `${tx("時間", "Time")} ${timer.elapsed.toFixed(1)} s${timer.best == null ? "" : ` · ${tx("ベスト", "Best")} ${timer.best.toFixed(2)} s`}`
      : "";
  setText(timerElement, timeText);
  setText(hintElement, hint);
  panel.hidden = false;
}

export function clearCanvasReadout(): void {
  beginCanvasReadoutFrame();
  if (panel) panel.hidden = true;
  if (hintElement) setText(hintElement, "");
  if (timerElement) setText(timerElement, "");
}
