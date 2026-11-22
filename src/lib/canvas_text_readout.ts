// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Mirror the live scene's drawn labels as ordinary, zoomable text. This stays
// outside the sticky scene, so opening it never reduces room for stage controls.
import { onLangChange, tx } from "../i18n";

interface Label {
  text: string;
  x: number;
  y: number;
  size: number;
  left: number;
  right: number;
}

let details: HTMLDetailsElement | null = null;
let list: HTMLUListElement | null = null;
let restoreContext: (() => void) | undefined;
let disposeLanguage: (() => void) | undefined;
let capturing = false;
let labels: Label[] = [];
let seen = new Set<string>();
let latest: string[] = [];
let lastRender = -Infinity;

function capture(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  if (!capturing || ctx.globalAlpha === 0) return;
  const value = String(text).trim();
  // Keep numbers, units and every language; omit standalone decorative arrows.
  if (!/[\p{L}\p{N}]/u.test(value)) return;
  const transform = ctx.getTransform();
  const px = transform ? transform.a * x + transform.c * y + transform.e : x;
  const py = transform ? transform.b * x + transform.d * y + transform.f : y;
  const scale = transform ? Math.hypot(transform.a, transform.b) : 1;
  const size = Number(/([\d.]+)px/.exec(String(ctx.font))?.[1] ?? 12) * scale;
  const width = ctx.measureText(value).width * scale;
  const align = ctx.textAlign;
  const offset = align === "center" ? width / 2 : align === "right" || align === "end" ? width : 0;
  const key = `${value}\0${Math.round(px)}\0${Math.round(py)}`;
  // Outlined lettering calls strokeText and fillText at the same position.
  if (seen.has(key)) return;
  seen.add(key);
  labels.push({ text: value, x: px, y: py, size, left: px - offset, right: px - offset + width });
}

function groupLabels(): string[] {
  const groups: string[] = [];
  let previous: Label | undefined;
  for (const label of labels) {
    let separator: string | undefined;
    if (previous) {
      const dy = label.y - previous.y;
      if (Math.abs(label.x - previous.x) <= 12 && dy > 0 && dy <= Math.max(24, previous.size * 2)) {
        // Topic/type pairs and stacked transform values stay together.
        separator = "\n";
      } else if (
        Math.abs(dy) <= 3 &&
        label.left >= previous.right - 2 &&
        label.left - previous.right <= 24
      ) {
        separator = " ";
      } else if (
        Math.abs(dy) <= 3 &&
        /^[\d.+−-]+$/.test(previous.text) &&
        /^[\d.+−-]+$/.test(label.text)
      ) {
        separator = " · ";
      }
    }
    if (separator !== undefined) groups[groups.length - 1] += separator + label.text;
    else groups.push(label.text);
    previous = label;
  }
  return groups;
}

function render(force = false): void {
  if (!details?.open || !list) return;
  const now = performance.now();
  if (!force && now - lastRender < 250) return;
  lastRender = now;
  // Preserve the summary, list, unchanged rows, focus and scroll position.
  latest.forEach((text, index) => {
    let row = list!.children[index];
    if (!row) {
      row = list!.ownerDocument.createElement("li");
      list!.append(row);
    }
    if (row.textContent !== text) row.textContent = text;
  });
  while (list.children.length > latest.length) list.lastElementChild!.remove();
}

export function setupCanvasTextReadout(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): void {
  restoreContext?.();
  disposeLanguage?.();
  details?.remove();
  details = canvas.ownerDocument.createElement("details");
  details.className = "canvas-text-readout";
  details.hidden = true;
  const summary = canvas.ownerDocument.createElement("summary");
  list = canvas.ownerDocument.createElement("ul");
  details.append(summary, list);
  (canvas.closest(".canvas-wrap") ?? canvas).after(details);
  const localize = () => {
    summary.textContent = tx("画面の文字を大きく読む", "Read the scene text in a larger size");
    lastRender = -Infinity;
  };
  localize();
  disposeLanguage = onLangChange(localize);
  details.addEventListener("toggle", () => render(true));
  // Keyboard reading/scrolling belongs to this disclosure, not to a stage's
  // arrow-key or WASD controls. Keyup still bubbles to release earlier inputs.
  details.addEventListener("keydown", (event) => event.stopPropagation());

  const fill = ctx.fillText;
  const stroke = ctx.strokeText;
  ctx.fillText = function (...args: Parameters<typeof fill>): void {
    capture(this, args[0], args[1], args[2]);
    fill.apply(this, args);
  };
  ctx.strokeText = function (...args: Parameters<typeof stroke>): void {
    capture(this, args[0], args[1], args[2]);
    stroke.apply(this, args);
  };
  restoreContext = () => {
    ctx.fillText = fill;
    ctx.strokeText = stroke;
  };
  clearCanvasTextReadout();
}

export function beginCanvasTextReadoutFrame(): void {
  labels = [];
  seen.clear();
  capturing = true;
}

export function endCanvasTextReadoutFrame(): void {
  capturing = false;
  if (!details) return;
  latest = groupLabels();
  details.hidden = latest.length === 0;
  render();
}

export function clearCanvasTextReadout(): void {
  capturing = false;
  labels = [];
  seen.clear();
  latest = [];
  lastRender = -Infinity;
  if (details) details.hidden = true;
  list?.replaceChildren();
}
