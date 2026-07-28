// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Two-tier gamepad-driven stage menu (Select to open):
//   - "tab" level   → ←→ pick GAME/LESSON, A confirms and descends to "stage"
//   - "stage" level → ←→ pick a pill, A loads it
// ↑ rises tab from stage. ↓ descends. B closes.

import { sfx } from "./audio";
import { ui } from "./dom";
import * as input from "./input";
import * as modes from "./modes";
import { clearBlockpadHighlights } from "../lib/blockpad";

let open = false;
let level: "tab" | "stage" = "stage";
let tabIdx = 0;
let focusIdx = 0;

const TAB_MODES: modes.Mode[] = ["game", "lesson"];

interface Deps {
  getCurrentStageId: () => string;
  loadStage: (id: string) => void;
}
let deps: Deps | null = null;

export function isOpen(): boolean {
  return open;
}

function refreshFocus(): void {
  document.querySelectorAll(".stage-pill.gp-focus, .mode-tab.gp-focus").forEach((el) => {
    el.classList.remove("gp-focus");
  });
  if (!open) return;
  if (level === "tab") {
    const targetMode = TAB_MODES[tabIdx];
    ui.modeTabs.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((b) => {
      if (b.dataset.mode === targetMode) b.classList.add("gp-focus");
    });
  } else {
    const pills = ui.stageSelector.querySelectorAll<HTMLButtonElement>(".stage-pill");
    const pill = pills[focusIdx];
    if (pill) {
      pill.classList.add("gp-focus");
      pill.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }
}

export function openMenu(targetMode?: modes.Mode): void {
  if (!deps) return;
  // Optional pre-select a tab (called by the GAME / LESSON tab click).
  if (targetMode && targetMode !== modes.getMode()) modes.setModeView(targetMode);
  open = true;
  const ids = modes.modeIds(modes.getMode());
  level = "stage";
  focusIdx = Math.max(0, ids.indexOf(deps.getCurrentStageId()));
  tabIdx = TAB_MODES.indexOf(modes.getMode());
  document.body.classList.add("stage-menu-open");
  // Drop residual held keys from both input streams.
  input.clearAll();
  clearBlockpadHighlights();
  prevPad = makePrev();
  sfx.click();
  refreshFocus();
}

/** Number of grid columns the .stage-selector currently renders. */
function gridCols(): number {
  const firstPill = ui.stageSelector.querySelector<HTMLElement>(".stage-pill");
  if (!firstPill) return 1;
  const selRect = ui.stageSelector.getBoundingClientRect();
  const firstRect = firstPill.getBoundingClientRect();
  const cs = window.getComputedStyle(ui.stageSelector);
  const cols = cs.gridTemplateColumns.split(" ").filter(Boolean).length;
  if (cols > 1) return cols;
  return Math.max(1, Math.round(selRect.width / Math.max(1, firstRect.width)));
}

/**
 * Vertical step that handles both layers:
 *   - tab level   → descend to stage on +1 (no-op on -1)
 *   - stage level → walk one row in the grid; from the top row, -1 climbs
 *                   back up to the tab level.
 */
export function stepVertical(d: -1 | 1): void {
  if (level === "tab") {
    if (d > 0) levelDown();
    return;
  }
  const ids = modes.modeIds(modes.getMode());
  if (ids.length === 0) return;
  const cols = gridCols();
  const next = focusIdx + d * cols;
  if (next >= 0 && next < ids.length) {
    focusIdx = next;
    refreshFocus();
    sfx.click();
  } else if (d < 0) {
    // Top row → climb to tab level
    levelUp();
  } else {
    // Past the bottom row → snap to last pill
    if (focusIdx !== ids.length - 1) {
      focusIdx = ids.length - 1;
      refreshFocus();
      sfx.click();
    }
  }
}

export function closeMenu(): void {
  if (!open) return;
  open = false;
  document.body.classList.remove("stage-menu-open");
  document.querySelectorAll(".stage-pill.gp-focus, .mode-tab.gp-focus").forEach((el) => {
    el.classList.remove("gp-focus");
  });
  prevPad = makePrev();
  clearBlockpadHighlights();
}

export function stepHorizontal(d: -1 | 1): void {
  if (level === "tab") {
    tabIdx = (tabIdx + d + TAB_MODES.length) % TAB_MODES.length;
  } else {
    const ids = modes.modeIds(modes.getMode());
    if (ids.length === 0) return;
    focusIdx = (focusIdx + d + ids.length) % ids.length;
  }
  refreshFocus();
  sfx.click();
}

export function levelUp(): void {
  if (level === "stage") {
    level = "tab";
    tabIdx = TAB_MODES.indexOf(modes.getMode());
    refreshFocus();
    sfx.click();
  }
}

export function levelDown(): void {
  if (level === "tab") {
    level = "stage";
    refreshFocus();
    sfx.click();
  }
}

export function confirm(): void {
  if (!deps) return;
  if (level === "tab") {
    const target = TAB_MODES[tabIdx];
    if (target !== modes.getMode()) modes.setModeView(target);
    level = "stage";
    focusIdx = 0;
    refreshFocus();
    sfx.click();
  } else {
    const ids = modes.modeIds(modes.getMode());
    const id = ids[focusIdx];
    closeMenu();
    if (id && id !== deps.getCurrentStageId()) deps.loadStage(id);
  }
}

interface PadEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  a: boolean;
  b: boolean;
}
function makePrev(): PadEdges {
  return { up: false, down: false, left: false, right: false, a: false, b: false };
}
let prevPad = makePrev();

export function pollPad(pad: Gamepad): void {
  const STICK = 0.4;
  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const left = (pad.buttons[14]?.pressed ?? false) || ax < -STICK;
  const right = (pad.buttons[15]?.pressed ?? false) || ax > STICK;
  const up = (pad.buttons[12]?.pressed ?? false) || ay < -STICK;
  const down = (pad.buttons[13]?.pressed ?? false) || ay > STICK;
  const a = pad.buttons[0]?.pressed ?? false;
  const b = pad.buttons[1]?.pressed ?? false;

  if (left && !prevPad.left) stepHorizontal(-1);
  if (right && !prevPad.right) stepHorizontal(+1);
  if (up && !prevPad.up) stepVertical(-1);
  if (down && !prevPad.down) stepVertical(+1);
  if (a && !prevPad.a) confirm();
  if (b && !prevPad.b) closeMenu();

  prevPad = { left, right, up, down, a, b };
}

export function setupStageMenu(d: Deps): void {
  deps = d;
  // Click outside the popup or the mode tabs closes the menu.
  document.addEventListener("mousedown", (e) => {
    if (!open) return;
    const target = e.target as Element | null;
    if (!target) return;
    if (target.closest(".stage-selector")) return;
    if (target.closest(".mode-tabs")) return;
    closeMenu();
  });
}
