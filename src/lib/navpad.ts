// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Gamepad input for the navigation stage. navigation uses canvas click+drag to
// send a goal pose, so on the pad side we maintain a "virtual cursor" and
// dispatch synthesized MouseEvents to the canvas. navigation.ts itself stays
// untouched.

const STICK_DEAD = 0.15;
const DPAD_STEP = 5.5; // px/frame (digital)
const STICK_MAX_STEP = 9; // px/frame (analog full deflection)

let canvasEl: HTMLCanvasElement | null = null;
let cursorEl: HTMLElement | null = null;
let active = false;
let cursorX = 0;
let cursorY = 0;
let dragging = false;
let prevAction = false; // pad A or keyboard Space/Enter
let prevB = false;
let initialized = false;
const heldKbArrows = new Set<string>();
let kbAction = false;

function ensureCursorEl() {
  if (cursorEl) return;
  cursorEl = document.createElement("div");
  cursorEl.id = "pad-cursor";
  document.body.appendChild(cursorEl);
}

export function setNavpadCanvas(c: HTMLCanvasElement) {
  canvasEl = c;
}

export function isNavpadActive(): boolean {
  return active;
}

export function activateNavpad() {
  if (!canvasEl) return;
  ensureCursorEl();
  if (!initialized) {
    cursorX = canvasEl.width / 2;
    cursorY = canvasEl.height / 2;
    initialized = true;
  }
  active = true;
}

export function deactivateNavpad() {
  active = false;
  dragging = false;
  prevAction = false;
  prevB = false;
  kbAction = false;
  heldKbArrows.clear();
  if (cursorEl) cursorEl.style.display = "none";
}

// Returns true when navpad consumed the event (caller should preventDefault).
export function onNavpadKeyDown(key: string): boolean {
  if (!active) return false;
  if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
    heldKbArrows.add(key);
    return true;
  }
  if (key === " " || key === "Enter") {
    kbAction = true;
    return true;
  }
  if (key === "Escape" && dragging) {
    dispatchCanvasMouseEvent("mouseleave");
    dragging = false;
    return true;
  }
  return false;
}

export function onNavpadKeyUp(key: string) {
  heldKbArrows.delete(key);
  if (key === " " || key === "Enter") kbAction = false;
}

function dispatchCanvasMouseEvent(type: "mousedown" | "mousemove" | "mouseup" | "mouseleave") {
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = rect.width / canvasEl.width;
  const scaleY = rect.height / canvasEl.height;
  const clientX = rect.left + cursorX * scaleX;
  const clientY = rect.top + cursorY * scaleY;
  canvasEl.dispatchEvent(
    new MouseEvent(type, {
      clientX,
      clientY,
      button: 0,
      buttons: dragging ? 1 : 0,
      bubbles: true,
      cancelable: true,
    }),
  );
}

function updateCursorDOM() {
  if (!cursorEl || !canvasEl) return;
  cursorEl.style.display = "block";
  cursorEl.classList.toggle("dragging", dragging);
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = rect.width / canvasEl.width;
  const scaleY = rect.height / canvasEl.height;
  cursorEl.style.left = rect.left + window.scrollX + cursorX * scaleX + "px";
  cursorEl.style.top = rect.top + window.scrollY + cursorY * scaleY + "px";
}

export function pollNavpad(pad: Gamepad | null): void {
  if (!active || !canvasEl) return;

  let dx = 0,
    dy = 0;

  // Pad input
  if (pad) {
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    const mag = Math.hypot(ax, ay);
    if (mag > STICK_DEAD) {
      const t = (mag - STICK_DEAD) / (1 - STICK_DEAD);
      const speed = t * t * STICK_MAX_STEP;
      dx += (ax / mag) * speed;
      dy += (ay / mag) * speed;
    }
    if (pad.buttons[14]?.pressed) dx -= DPAD_STEP;
    if (pad.buttons[15]?.pressed) dx += DPAD_STEP;
    if (pad.buttons[12]?.pressed) dy -= DPAD_STEP;
    if (pad.buttons[13]?.pressed) dy += DPAD_STEP;
  }

  // Keyboard arrow keys (added to the pad input).
  if (heldKbArrows.has("ArrowLeft")) dx -= DPAD_STEP;
  if (heldKbArrows.has("ArrowRight")) dx += DPAD_STEP;
  if (heldKbArrows.has("ArrowUp")) dy -= DPAD_STEP;
  if (heldKbArrows.has("ArrowDown")) dy += DPAD_STEP;

  cursorX = Math.max(0, Math.min(canvasEl.width, cursorX + dx));
  cursorY = Math.max(0, Math.min(canvasEl.height, cursorY + dy));

  // Action button: gamepad A, or keyboard Space/Enter. We evaluate the three
  // mouse phases in independent `if`s rather than else-if so a same-frame
  // press-and-release still fires mousedown → mousemove → mouseup in order
  // (else-if would drop the mouseup if motion happens on the release frame).
  const padA = pad?.buttons[0]?.pressed ?? false;
  const action = padA || kbAction;
  if (action && !prevAction) {
    dragging = true;
    dispatchCanvasMouseEvent("mousedown");
  }
  if (dragging && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
    dispatchCanvasMouseEvent("mousemove");
  }
  if (!action && prevAction && dragging) {
    dispatchCanvasMouseEvent("mouseup");
    dragging = false;
  }
  prevAction = action;

  // B button cancels an in-progress drag via mouseleave. Keyboard Escape is
  // handled in onNavpadKeyDown.
  const bPressed = pad?.buttons[1]?.pressed ?? false;
  if (bPressed && !prevB && dragging) {
    dispatchCanvasMouseEvent("mouseleave");
    dragging = false;
  }
  prevB = bPressed;

  updateCursorDOM();
}
