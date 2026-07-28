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

const STICK_DEAD = 0.35;

const p1Keys = new Set<string>();
const p2Keys = new Set<string>();
let installed = false;

let prevP1Action = false;
let prevP2Action = false;

export interface PlayerInput {
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

/** Reset edge-detection (call on stage reset so a held button isn't mis-fired). */
export function resetEdges(): void {
  prevP1Action = false;
  prevP2Action = false;
}

function findPads(): { p1: Gamepad | null; p2: Gamepad | null } {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
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

interface PadAxes {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  action: boolean;
  boost: boolean;
}

function readPad(pad: Gamepad): PadAxes {
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const fwd = (pad.buttons[12]?.pressed ?? false) || ay < -STICK_DEAD;
  const back = (pad.buttons[13]?.pressed ?? false) || ay > STICK_DEAD;
  const left = (pad.buttons[14]?.pressed ?? false) || ax < -STICK_DEAD;
  const right = (pad.buttons[15]?.pressed ?? false) || ax > STICK_DEAD;
  const action =
    (pad.buttons[0]?.pressed ?? false) || // A / Cross
    (pad.buttons[2]?.pressed ?? false); // X / Square
  const boost =
    (pad.buttons[4]?.pressed ?? false) || // LB
    (pad.buttons[5]?.pressed ?? false) || // RB
    (pad.buttons[6]?.pressed ?? false) || // LT
    (pad.buttons[7]?.pressed ?? false); // RT
  return { fwd, back, left, right, action, boost };
}

function blend(pad: PadAxes | null, kb: PadAxes): PadAxes {
  if (!pad) return kb;
  return {
    fwd: pad.fwd || kb.fwd,
    back: pad.back || kb.back,
    left: pad.left || kb.left,
    right: pad.right || kb.right,
    action: pad.action || kb.action,
    boost: pad.boost || kb.boost,
  };
}

export function pollP1(): PlayerInput {
  const { p1 } = findPads();
  const pad = p1 ? readPad(p1) : null;
  const kb: PadAxes = {
    fwd: p1Keys.has("w"),
    back: p1Keys.has("s"),
    left: p1Keys.has("a"),
    right: p1Keys.has("d"),
    action: p1Keys.has("e") || p1Keys.has(" "),
    boost: p1Keys.has("shift") || p1Keys.has("x"),
  };
  const m = blend(pad, kb);
  const actionEdge = m.action && !prevP1Action;
  prevP1Action = m.action;
  return { ...m, actionEdge, hasPad: p1 !== null };
}

export function pollP2(): PlayerInput {
  const { p2 } = findPads();
  const pad = p2 ? readPad(p2) : null;
  const kb: PadAxes = {
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

// 1P/2P toggle: pad-1 Y button (button 3) + keyboard "2".
let prevToggleY = false;
let key2Pending = false;
let toggleListenerInstalled = false;

function isInInputField(): boolean {
  const ae = document.activeElement;
  return !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT"));
}

function key2Listener(e: KeyboardEvent): void {
  if (e.repeat) return;
  if (e.key === "2" && !isInInputField()) key2Pending = true;
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
  const { p1 } = findPads();
  const yHeld = p1?.buttons[3]?.pressed ?? false;
  const yEdge = yHeld && !prevToggleY;
  prevToggleY = yHeld;

  const keyEdge = key2Pending;
  key2Pending = false;

  return yEdge || keyEdge;
}
