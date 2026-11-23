// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Per-player input polling for stages that opt into local 2-player mode
// (G5 racing, G6 robo_soccer). Bypasses the global input.ts merge layer so
// pad #0's d-pad writes ("arrowup", "w", ...) do not bleed into P2's keys.
//
// Activation is per-stage: call setActive(true) when entering 2P mode and
// setActive(false) on dispose / when toggling back to 1P.
//
// P1 reads pad slot 0 OR WASD / E (kick) / Shift (boost).
// P2 reads pad slot 1 OR Arrows / Enter (kick) / RShift (boost).
//
// RShift is disambiguated from LShift via KeyboardEvent.location === 2.

import { isStageInteractionBlocked, isTypingTarget, ownsNativeKey } from "./input_guard";
import { consumeStageGamepadButtons, readStageGamepads } from "./stage_gamepads";

const STICK_DEAD = 0.35;
const MOVE_DEAD = 0.18;

const p1Keys = new Set<string>();
const p2Keys = new Set<string>();
let installed = false;

let prevP1Action = false;
let prevP2Action = false;

export interface PlayerInput {
  /** Screen-space movement vector with a maximum length of one. */
  moveX: number;
  moveY: number;
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  /** Kick (soccer) / one-shot action. */
  action: boolean;
  /** True only on the frame the action button transitions pressed. */
  actionEdge: boolean;
  /** Boost (racing) / sustained secondary. */
  boost: boolean;
  /** A gamepad slot was found for this player. */
  hasPad: boolean;
}

function onKeyDown(e: KeyboardEvent): void {
  if (isStageInteractionBlocked() || ownsNativeKey(e)) return;
  // Browser and OS shortcuts (Ctrl/Cmd/Alt + key) are never player input.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "shift") {
    if (e.location === 2) p2Keys.add("rshift");
    else p1Keys.add("shift");
    return;
  }
  switch (k) {
    case "arrowup":
    case "arrowdown":
    case "arrowleft":
    case "arrowright":
    case "enter":
      p2Keys.add(k);
      return;
    case "w":
    case "a":
    case "s":
    case "d":
    case "e":
    case " ":
    case "x":
      p1Keys.add(k);
      return;
  }
}

function onKeyUp(e: KeyboardEvent): void {
  // macOS drops keyup for letters released while Cmd is held; release all.
  if (e.key === "Meta") {
    p1Keys.clear();
    p2Keys.clear();
    return;
  }
  const k = e.key.toLowerCase();
  if (k === "shift") {
    if (e.location === 2) p2Keys.delete("rshift");
    else p1Keys.delete("shift");
    return;
  }
  switch (k) {
    case "arrowup":
    case "arrowdown":
    case "arrowleft":
    case "arrowright":
    case "enter":
      p2Keys.delete(k);
      return;
    case "w":
    case "a":
    case "s":
    case "d":
    case "e":
    case " ":
    case "x":
      p1Keys.delete(k);
      return;
  }
}

export function setActive(active: boolean): void {
  if (active && !installed) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    installed = true;
  } else if (!active && installed) {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    installed = false;
    p1Keys.clear();
    p2Keys.clear();
    prevP1Action = false;
    prevP2Action = false;
  }
}

/** True while a stage is reading pads directly for local-player actions. */
export function isActive(): boolean {
  return installed;
}

/** Reset round edges while keeping consumed UI buttons masked until release. */
export function resetEdges(): void {
  prevP1Action = false;
  prevP2Action = false;
}

/** Drop held keys and consume currently held pad actions across UI transitions. */
export function releasePlayerInput(): void {
  p1Keys.clear();
  p2Keys.clear();
  consumeStageGamepadButtons();
  prevP1Action = false;
  prevP2Action = false;
  prevToggleY = false;
  key2Pending = false;
}

function findPads(): { p1: Gamepad | null; p2: Gamepad | null } {
  const pads = readStageGamepads();
  let p1: Gamepad | null = null;
  let p2: Gamepad | null = null;
  for (const p of pads) {
    if (!p) continue;
    if (!p1) p1 = p;
    else if (!p2) {
      p2 = p;
      break;
    }
  }
  return { p1, p2 };
}

interface DigitalInput {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
  boost: boolean;
}

interface PadAxes extends DigitalInput {
  moveX: number;
  moveY: number;
}

function digitalMovement(input: Pick<DigitalInput, "fwd" | "back" | "left" | "right">) {
  const x = Number(input.right) - Number(input.left);
  const y = Number(input.back) - Number(input.fwd);
  const length = Math.hypot(x, y) || 1;
  return { moveX: x / length, moveY: y / length };
}

function stickMovement(x: number, y: number) {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length <= MOVE_DEAD) return { moveX: 0, moveY: 0 };
  const strength = (Math.min(1, length) - MOVE_DEAD) / (1 - MOVE_DEAD);
  return { moveX: (x / length) * strength, moveY: (y / length) * strength };
}

function readPad(pad: Gamepad): PadAxes {
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const dpad = {
    fwd: pad.buttons[12]?.pressed ?? false,
    back: pad.buttons[13]?.pressed ?? false,
    left: pad.buttons[14]?.pressed ?? false,
    right: pad.buttons[15]?.pressed ?? false,
  };
  // Racing keeps its original digital thresholds. Soccer uses the continuous
  // vector below, including fine stick movements and arbitrary angles.
  const fwd = dpad.fwd || ay < -STICK_DEAD;
  const back = dpad.back || ay > STICK_DEAD;
  const left = dpad.left || ax < -STICK_DEAD;
  const right = dpad.right || ax > STICK_DEAD;
  const movement =
    dpad.fwd || dpad.back || dpad.left || dpad.right
      ? digitalMovement(dpad)
      : stickMovement(ax, ay);
  const action =
    (pad.buttons[0]?.pressed ?? false) || // A / Cross
    (pad.buttons[2]?.pressed ?? false); // X / Square
  const boost =
    (pad.buttons[4]?.pressed ?? false) || // LB
    (pad.buttons[5]?.pressed ?? false) || // RB
    (pad.buttons[6]?.pressed ?? false) || // LT
    (pad.buttons[7]?.pressed ?? false); // RT
  return { fwd, back, left, right, action, boost, ...movement };
}

function blend(pad: PadAxes | null, kb: DigitalInput): PadAxes {
  const keyboardMovement = digitalMovement(kb);
  if (!pad) return { ...kb, ...keyboardMovement };
  const movement =
    kb.fwd || kb.back || kb.left || kb.right
      ? keyboardMovement
      : { moveX: pad.moveX, moveY: pad.moveY };
  return {
    fwd: pad.fwd || kb.fwd,
    back: pad.back || kb.back,
    left: pad.left || kb.left,
    right: pad.right || kb.right,
    action: pad.action || kb.action,
    boost: pad.boost || kb.boost,
    ...movement,
  };
}

export function pollP1(options: { arrowKeys?: boolean } = {}): PlayerInput {
  if (isStageInteractionBlocked()) {
    releasePlayerInput();
    return neutralInput();
  }
  const { p1 } = findPads();
  const pad = p1 ? readPad(p1) : null;
  const arrows = options.arrowKeys === true;
  const kb: DigitalInput = {
    fwd: p1Keys.has("w") || (arrows && p2Keys.has("arrowup")),
    back: p1Keys.has("s") || (arrows && p2Keys.has("arrowdown")),
    left: p1Keys.has("a") || (arrows && p2Keys.has("arrowleft")),
    right: p1Keys.has("d") || (arrows && p2Keys.has("arrowright")),
    action: p1Keys.has("e") || p1Keys.has(" "),
    boost: p1Keys.has("shift") || p1Keys.has("x"),
  };
  const m = blend(pad, kb);
  const actionEdge = m.action && !prevP1Action;
  prevP1Action = m.action;
  return { ...m, actionEdge, hasPad: p1 !== null };
}

export function pollP2(): PlayerInput {
  if (isStageInteractionBlocked()) {
    releasePlayerInput();
    return neutralInput();
  }
  const { p2 } = findPads();
  const pad = p2 ? readPad(p2) : null;
  const kb: DigitalInput = {
    fwd: p2Keys.has("arrowup"),
    back: p2Keys.has("arrowdown"),
    left: p2Keys.has("arrowleft"),
    right: p2Keys.has("arrowright"),
    action: p2Keys.has("enter"),
    boost: p2Keys.has("rshift"),
  };
  const m = blend(pad, kb);
  const actionEdge = m.action && !prevP2Action;
  prevP2Action = m.action;
  return { ...m, actionEdge, hasPad: p2 !== null };
}

export function hasP2Pad(): boolean {
  return findPads().p2 !== null;
}

/** Number of connected pads available to local multiplayer (0, 1, or 2). */
export function padCount(): number {
  const { p1, p2 } = findPads();
  return (p1 ? 1 : 0) + (p2 ? 1 : 0);
}

function neutralInput(): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    fwd: false,
    back: false,
    left: false,
    right: false,
    action: false,
    actionEdge: false,
    boost: false,
    hasPad: false,
  };
}

// 1P/2P toggle: pad-1 Y button (button 3) + keyboard "2".
let prevToggleY = false;
let key2Pending = false;
let toggleListenerInstalled = false;

function key2Listener(e: KeyboardEvent): void {
  // Ctrl/Cmd/Alt+2 are browser tab shortcuts, not the 1P/2P toggle.
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "2" && !isStageInteractionBlocked() && !isTypingTarget(e.target))
    key2Pending = true;
}

/** Install the "2" key listener (call from stage init regardless of 1P/2P). */
export function installToggleListener(): void {
  if (!toggleListenerInstalled) {
    window.addEventListener("keydown", key2Listener);
    toggleListenerInstalled = true;
  }
}

export function uninstallToggleListener(): void {
  if (toggleListenerInstalled) {
    window.removeEventListener("keydown", key2Listener);
    toggleListenerInstalled = false;
  }
  prevToggleY = false;
  key2Pending = false;
}

/**
 * Returns true on frames where the user requested a 1P/2P toggle:
 *   - Pad-1 Y button rising edge, OR
 *   - "2" key pressed (one shot per press, repeats ignored).
 */
export function pollToggleEdge(): boolean {
  if (isStageInteractionBlocked()) {
    releasePlayerInput();
    return false;
  }
  const { p1 } = findPads();
  const yHeld = p1?.buttons[3]?.pressed ?? false;
  const yEdge = yHeld && !prevToggleY;
  prevToggleY = yHeld;

  const keyEdge = key2Pending;
  key2Pending = false;

  return yEdge || keyEdge;
}
