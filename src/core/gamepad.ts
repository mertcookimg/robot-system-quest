// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Gamepad polling. Same priority chain as the keyboard dispatcher: lesson
// modal first, then stage menu, then all-clear, then clear overlay, then
// blockpad / navpad routing, then drive keys. Edge detection (`prev*`) is
// crucial so a held button doesn't fire repeatedly across frames.

import * as input from "./input";
import * as intro from "./intro";
import * as help from "./help";
import * as lessonModal from "./lesson_modal";
import * as allclear from "./allclear";
import * as clearOverlay from "./clear_overlay";
import * as stageMenu from "./stage_menu";
import * as crash from "./crash";
import { ui } from "./dom";
import { setStatusForGamepad } from "./status";
import { getLang } from "../i18n";
import { isBlockpadCapturingGamepad, pollBlockpad } from "../lib/blockpad";
import { isNavpadActive } from "../lib/navpad";
import {
  activateOverlayPad,
  deactivateOverlayPad,
  isOverlayListOpen,
  isOverlayPadActive,
  isOverlayPadAvailable,
  pollOverlayPad,
} from "../lib/overlaypad";
import * as terminalUi from "./terminal_ui";
import { sfx } from "./audio";
import { getCurrentId } from "./stage_manager";
import { isActive as isDirectPlayerInputActive } from "../lib/two_player";

const STICK_DEAD = 0.35;
const DRIVE_KEYS = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "shift",
  "x",
];

let prevButtons: boolean[] = [];
// Edge-tracking for composite (d-pad OR stick) directional inputs, which
// can't be derived from `prevButtons` alone. Keyed per consumer so a held
// stick doesn't fire repeatedly across frames.
type DirKey =
  | "clearLeft"
  | "clearRight" // clear overlay Restart/Next focus
  | "introLeft"
  | "introRight" // intro/home screen GAME/LESSON focus
  | "paletteUp"
  | "paletteDown"; // terminal quick palette scrolling
const prevDir: Record<DirKey, boolean> = {
  clearLeft: false,
  clearRight: false,
  introLeft: false,
  introRight: false,
  paletteUp: false,
  paletteDown: false,
};

/** True when the given d-pad button OR the stick axis passes the deadzone. */
function dpadOrStick(
  pad: Gamepad,
  btnIdx: number,
  axisIdx: number,
  dir: -1 | 1,
  dead = 0.4,
): boolean {
  const av = pad.axes[axisIdx] ?? 0;
  return (pad.buttons[btnIdx]?.pressed ?? false) || (dir < 0 ? av < -dead : av > dead);
}

/** Edge-detect a composite direction: true only on the press frame. */
function dirEdge(key: DirKey, held: boolean): boolean {
  const edge = held && !prevDir[key];
  prevDir[key] = held;
  return edge;
}

interface Deps {
  startGame: () => void;
  resetCurrentStage: () => void;
}
let deps: Deps | null = null;

export function setupGamepad(d: Deps): void {
  deps = d;
  window.addEventListener("gamepadconnected", (e) => {
    const lab = getLang() === "ja" ? "🎮 Gamepad 接続" : "🎮 Gamepad connected";
    setStatusForGamepad(`${lab}: ${e.gamepad.id}`);
  });
  window.addEventListener("gamepaddisconnected", () => {
    input.clearPad();
    prevButtons = [];
    for (const k of Object.keys(prevDir) as DirKey[]) prevDir[k] = false;
  });
}

function findPad(): Gamepad | null {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) return p;
  return null;
}

function pollClearOverlayPad(pad: Gamepad, aEdge: boolean, startEdge: boolean): void {
  if (dirEdge("clearLeft", dpadOrStick(pad, 14, 0, -1))) clearOverlay.setFocus("restart");
  if (dirEdge("clearRight", dpadOrStick(pad, 15, 0, +1))) clearOverlay.setFocus("next");
  if (aEdge || startEdge) clearOverlay.confirmFocus();
}

function setKey(k: string, held: boolean): void {
  input.setPadKey(k, held);
}

export function poll(): void {
  if (!deps) return;
  const pad = findPad();
  if (!pad) return;

  // 0. Intro / Home screen: ←→ pick GAME/LESSON, A or Start confirms.
  if (intro.isShown()) {
    const a = pad.buttons[0]?.pressed ?? false;
    const start = pad.buttons[9]?.pressed ?? false;
    if (dirEdge("introLeft", dpadOrStick(pad, 14, 0, -1))) intro.stepFocus(-1);
    if (dirEdge("introRight", dpadOrStick(pad, 15, 0, +1))) intro.stepFocus(+1);
    if (a && !(prevButtons[0] ?? false)) intro.confirm();
    if (start && !(prevButtons[9] ?? false)) intro.confirm();
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 1. Lesson modal: any of A / B / Start dismisses.
  if (lessonModal.isOpen()) {
    const aBtn = pad.buttons[0]?.pressed ?? false;
    const bBtn = pad.buttons[1]?.pressed ?? false;
    const startBtn = pad.buttons[9]?.pressed ?? false;
    const aEdge = aBtn && !(prevButtons[0] ?? false);
    const bEdge = bBtn && !(prevButtons[1] ?? false);
    const startEdge = startBtn && !(prevButtons[9] ?? false);
    if (aEdge || bEdge || startEdge) {
      lessonModal.dismiss(getCurrentId());
    }
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 2. Select button toggles the stage menu (disabled during intro).
  const selectPressed = pad.buttons[8]?.pressed ?? false;
  if (selectPressed && !(prevButtons[8] ?? false) && !intro.isShown()) {
    if (stageMenu.isOpen()) stageMenu.closeMenu();
    else stageMenu.openMenu();
  }

  if (stageMenu.isOpen()) {
    stageMenu.pollPad(pad);
    // Snapshot button state before returning (like every other early-return
    // path) so the Select edge-check above stays correct on the next frame —
    // otherwise prevButtons freezes and Select flickers the menu open/closed.
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 2b. L3 toggles the terminal quick palette — the text input is
  // keyboard-only, so this is how pad players run `ros2 ...` commands.
  if ((pad.buttons[10]?.pressed ?? false) && !(prevButtons[10] ?? false)) {
    sfx.click();
    terminalUi.togglePadPalette();
  }
  if (terminalUi.isPadPaletteOpen()) {
    for (const k of DRIVE_KEYS) input.setPadKey(k, false);
    if (dirEdge("paletteUp", dpadOrStick(pad, 12, 1, -1))) {
      sfx.hover();
      terminalUi.paletteMove(-1);
    }
    if (dirEdge("paletteDown", dpadOrStick(pad, 13, 1, +1))) {
      sfx.hover();
      terminalUi.paletteMove(+1);
    }
    const aPalEdge = (pad.buttons[0]?.pressed ?? false) && !(prevButtons[0] ?? false);
    const bPalEdge = (pad.buttons[1]?.pressed ?? false) && !(prevButtons[1] ?? false);
    if (aPalEdge) {
      sfx.click();
      terminalUi.paletteExec();
    }
    if (bPalEdge) {
      sfx.click();
      terminalUi.closePadPalette();
    }
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }
  prevDir.paletteUp = prevDir.paletteDown = false;

  // 2c. R3 toggles the help modal — header buttons are mouse-only, so this
  // keeps the controls reference reachable on a pad-only setup.
  if ((pad.buttons[11]?.pressed ?? false) && !(prevButtons[11] ?? false)) {
    sfx.click();
    if (help.isOpen()) help.close();
    else help.open();
  }

  const a = pad.buttons[0]?.pressed ?? false;
  const start = pad.buttons[9]?.pressed ?? false;
  const aEdge = a && !(prevButtons[0] ?? false);
  const startEdge = start && !(prevButtons[9] ?? false);

  // 3. All-clear screen: A or Start triggers restart.
  if (allclear.isOpen()) {
    if (aEdge || startEdge) {
      sfx.click();
      ui.allclearRestart.click();
    }
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 4. Clear overlay: navigate Restart/Next.
  if (clearOverlay.isOpen()) {
    pollClearOverlayPad(pad, aEdge, startEdge);
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 5. Block editor open and capturing the pad: forward to blockpad.
  if (isBlockpadCapturingGamepad()) {
    for (const k of DRIVE_KEYS) input.setPadKey(k, false);
    pollBlockpad(pad, () => sfx.click());
    // Snapshot the current button state so the next frame doesn't see
    // still-held buttons as fresh edges if blockpad releases the pad
    // (e.g. MOVE START toggle disables blockpad — without this snapshot
    // the held LT immediately re-fires the toggle in the drive section).
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 5b. Overlay pad active (custom HTML panels w/ sliders/dropdowns/buttons:
  // tf_puzzle, behavior_tree). Eats drive keys, still respects Start = reset.
  if (isOverlayPadActive()) {
    for (const k of DRIVE_KEYS) input.setPadKey(k, false);
    if (pollOverlayPad(pad, () => sfx.click())) {
      deactivateOverlayPad();
      setStatusForGamepad(
        getLang() === "ja" ? "🎮 ゲーム操作へ戻りました" : "🎮 Back to stage controls",
      );
    }
    // Don't let Start reset the stage while a select-list is open — the user
    // is in the middle of picking a value, treat it as a mode-local input.
    if (startEdge && !isOverlayListOpen()) {
      clearOverlay.close();
      crash.clearCrashOverlay();
      deps.resetCurrentStage();
    }
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 5c. Compact stage settings stay passive during normal play. A enters the
  // panel cursor, then B returns to driving.
  if (isOverlayPadAvailable() && aEdge && !isDirectPlayerInputActive()) {
    for (const k of DRIVE_KEYS) input.setPadKey(k, false);
    activateOverlayPad();
    sfx.click();
    setStatusForGamepad(
      getLang() === "ja"
        ? "🎮 SETTINGS — 十字キーで選択 / Aで決定 / Bで戻る"
        : "🎮 SETTINGS — D-pad to select / A confirm / B back",
    );
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 6. Navpad active (Nav2 stage): forward arrows but reset drive keys, allow Start = reset.
  if (isNavpadActive()) {
    for (const k of DRIVE_KEYS) input.setPadKey(k, false);
    if (startEdge) {
      clearOverlay.close();
      crash.clearCrashOverlay();
      deps.resetCurrentStage();
    }
    prevButtons = pad.buttons.map((b) => b.pressed);
    return;
  }

  // 7. Game drive keys.
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const dpUp = pad.buttons[12]?.pressed ?? false;
  const dpDown = pad.buttons[13]?.pressed ?? false;
  const dpLeft = pad.buttons[14]?.pressed ?? false;
  const dpRight = pad.buttons[15]?.pressed ?? false;
  const fwd = dpUp || ay < -STICK_DEAD;
  const back = dpDown || ay > STICK_DEAD;
  const left = dpLeft || ax < -STICK_DEAD;
  const right = dpRight || ax > STICK_DEAD;
  setKey("w", fwd);
  setKey("s", back);
  setKey("a", left);
  setKey("d", right);
  setKey("arrowup", fwd);
  setKey("arrowdown", back);
  setKey("arrowleft", left);
  setKey("arrowright", right);

  const boost =
    (pad.buttons[4]?.pressed ?? false) ||
    (pad.buttons[5]?.pressed ?? false) ||
    (pad.buttons[6]?.pressed ?? false) ||
    (pad.buttons[7]?.pressed ?? false);
  setKey("shift", boost);
  setKey("x", boost);

  if (aEdge) {
    input.clearAll(); // emergency stop (intro path is handled before drive layer)
  }
  if (pad.buttons[1]?.pressed && !(prevButtons[1] ?? false)) {
    help.close();
    clearOverlay.close();
    crash.clearCrashOverlay();
  }
  if (startEdge) {
    clearOverlay.close();
    allclear.hide();
    crash.clearCrashOverlay();
    deps.resetCurrentStage();
  }
  // LT (left trigger): exit MOVE-START mode in the feedforward / feedback
  // controller stages. The same button
  // toggles MOVE-START inside blockpad; we mirror the bind here so the user
  // can press it again when blockpad is disabled (during MOVE-START).
  if (pad.buttons[6]?.pressed && !(prevButtons[6] ?? false)) {
    const el = document.getElementById("be-move-start") as HTMLButtonElement | null;
    if (el) {
      el.click();
      sfx.click();
    }
  }

  prevButtons = pad.buttons.map((b) => b.pressed);
}
