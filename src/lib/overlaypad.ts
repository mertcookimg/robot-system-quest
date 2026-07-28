// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Generic gamepad cursor for stage-built HTML overlay panels (sliders,
// dropdowns, buttons). Stages with custom panels (tf_puzzle, behavior_tree)
// register the panel root on init() and unregister() on dispose(); the
// gamepad poll routes pad input here when the panel is on screen.
//
// Default mapping (when no list / slider edit is active):
//   D-pad ↑/↓ ←/→ — navigate between items (any direction)
//   A             — slider: enter edit mode / select: open list / button: click
//   B             — close menu (no-op here at top level)
//
// While a select dropdown list is expanded:
//   D-pad ↑/↓ — move highlight in the list
//   A         — commit selected option
//   B         — cancel without changing
//
// While a slider is in edit mode:
//   D-pad ←/→ ↑/↓ — adjust value (one step per press, repeat-aware)
//   A             — exit edit mode (commit)
//   B             — exit edit mode

const STICK_DEAD = 0.4;
const REPEAT_FIRST_MS = 360;
const REPEAT_INTERVAL_MS = 80;
const REPEAT_FAST_AFTER = 6;
const REPEAT_FAST_INTERVAL_MS = 35;

let container: HTMLElement | null = null;
let capturing = false;
let focusIdx = 0;
let lastFocusedEl: HTMLElement | null = null;
let lastFocusedRow: HTMLElement | null = null;

// Expanded-select-list state. When expandedSel is non-null, all pad input
// is routed to the floating list instead of the underlying panel.
let expandedSel: HTMLSelectElement | null = null;
let expandedListEl: HTMLElement | null = null;
let expandedIdx = 0;

// Slider edit-mode state. When editingSlider is non-null, ←→↑↓ all adjust
// that slider's value instead of navigating between items.
let editingSlider: HTMLInputElement | null = null;
const prev: Record<string, boolean> = {};
const heldSince: Record<string, number> = {};
const lastFire: Record<string, number> = {};
const fireCount: Record<string, number> = {};

/**
 * Register a panel for gamepad navigation. Full-screen lesson editors capture
 * immediately; compact in-game panels can register passively.
 */
export function registerOverlayPad(panel: HTMLElement, active = true): void {
  container = panel;
  capturing = active;
  focusIdx = 0;
  ensureStyle();
  // Defer focus until the panel has actually been laid out, then bind
  // focus listeners so mouse clicks keep our cursor in sync.
  queueMicrotask(() => {
    if (container !== panel) return;
    const items = getItems();
    items.forEach((el, i) => {
      el.addEventListener("focus", () => {
        focusIdx = i;
        paintFocus(el);
      });
    });
    if (capturing) focusCurrent();
  });
}

export function unregisterOverlayPad(expected?: HTMLElement): void {
  if (expected && container !== expected) return;
  closeExpanded();
  exitSliderEdit();
  clearFocusPaint();
  container = null;
  capturing = false;
  focusIdx = 0;
  lastFocusedEl = null;
  lastFocusedRow = null;
  for (const k in prev) delete prev[k];
  for (const k in heldSince) delete heldSince[k];
  for (const k in lastFire) delete lastFire[k];
  for (const k in fireCount) delete fireCount[k];
}

function ensureStyle(): void {
  if (document.getElementById("opad-style")) return;
  const s = document.createElement("style");
  s.id = "opad-style";
  // Strong, high-contrast pad-focus indicator. Stages can mark a parent
  // element with [data-opad-row] to get a soft row-wide highlight too.
  s.textContent = `
    .opad-focus {
      outline: 3px solid #fbbf24 !important;
      outline-offset: 2px !important;
      box-shadow: 0 0 0 3px rgba(251,191,36,0.30), 0 0 18px rgba(251,191,36,0.55) !important;
      border-radius: 4px !important;
      position: relative !important;
      z-index: 2 !important;
    }
    input[type="range"].opad-focus { accent-color: #fbbf24 !important; }
    /* Add emphasis in slider-edit mode with a pulse and thicker border. */
    input[type="range"].opad-editing {
      outline: 3px solid #5eead4 !important;
      outline-offset: 3px !important;
      box-shadow: 0 0 0 4px rgba(94,234,212,0.30), 0 0 22px rgba(94,234,212,0.7) !important;
      accent-color: #5eead4 !important;
      animation: opad-pulse 1s ease-in-out infinite;
    }
    @keyframes opad-pulse {
      0%, 100% { filter: brightness(1.0); }
      50%      { filter: brightness(1.18); }
    }
    .opad-focus-row {
      background: rgba(251,191,36,0.10) !important;
      box-shadow: inset 0 0 0 1px rgba(251,191,36,0.45) !important;
      border-radius: 4px;
    }
    .opad-list {
      position: fixed; z-index: 9999;
      background: #0c1124; border: 2px solid #fbbf24; border-radius: 6px;
      padding: 4px 0; min-width: 160px; max-height: 280px; overflow-y: auto;
      font-family: ui-monospace, monospace; font-size: 12px; color: #eef2ff;
      box-shadow: 0 12px 36px rgba(0,0,0,0.55), 0 0 0 2px rgba(251,191,36,0.25);
    }
    .opad-list-row {
      padding: 7px 14px; cursor: pointer; white-space: nowrap;
    }
    .opad-list-row.hi {
      background: rgba(251,191,36,0.22); color: #fbbf24; font-weight: 700;
    }
    .opad-list-foot {
      padding: 5px 14px; border-top: 1px solid rgba(125,211,252,0.18);
      font-size: 10px; color: #9aa6c8;
    }
  `;
  document.head.appendChild(s);
}

function paintFocus(el: HTMLElement): void {
  if (lastFocusedEl && lastFocusedEl !== el) {
    lastFocusedEl.classList.remove("opad-focus");
  }
  if (lastFocusedRow) {
    lastFocusedRow.classList.remove("opad-focus-row");
    lastFocusedRow = null;
  }
  el.classList.add("opad-focus");
  lastFocusedEl = el;
  const row = el.closest<HTMLElement>("[data-opad-row]");
  if (row) {
    row.classList.add("opad-focus-row");
    lastFocusedRow = row;
  }
  // Bring it into view in case the panel scrolls.
  try {
    el.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
}

function clearFocusPaint(): void {
  if (lastFocusedEl) lastFocusedEl.classList.remove("opad-focus");
  if (lastFocusedRow) lastFocusedRow.classList.remove("opad-focus-row");
}

export function isOverlayPadActive(): boolean {
  if (!container || !capturing) return false;
  if (container.offsetParent === null) return false;
  return getItems().length > 0;
}

export function isOverlayPadAvailable(): boolean {
  if (!container || capturing) return false;
  if (container.offsetParent === null) return false;
  return getItems().length > 0;
}

/** Enter SETTINGS mode and consume the A press that opened it. */
export function activateOverlayPad(): void {
  if (!container) return;
  capturing = true;
  prev.a = true;
  focusCurrent();
}

/** Return the pad to normal stage controls without removing the panel. */
export function deactivateOverlayPad(): void {
  closeExpanded();
  exitSliderEdit();
  clearFocusPaint();
  capturing = false;
  const ae = document.activeElement;
  if (ae instanceof HTMLElement) ae.blur();
  for (const k in prev) delete prev[k];
  for (const k in heldSince) delete heldSince[k];
  for (const k in lastFire) delete lastFire[k];
  for (const k in fireCount) delete fireCount[k];
}

function getItems(): HTMLElement[] {
  if (!container) return [];
  const sel = 'input[type="range"], select, button';
  return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => el.offsetParent !== null && !(el as HTMLButtonElement).disabled,
  );
}

function focusCurrent(): void {
  const list = getItems();
  if (!list.length) return;
  if (focusIdx < 0) focusIdx = list.length - 1;
  if (focusIdx >= list.length) focusIdx = 0;
  const el = list[focusIdx];
  el.focus({ preventScroll: false });
  paintFocus(el);
}

function openExpanded(sel: HTMLSelectElement): void {
  closeExpanded();
  expandedSel = sel;
  expandedIdx = Math.max(0, sel.selectedIndex);
  const list = document.createElement("div");
  list.className = "opad-list";
  for (let i = 0; i < sel.options.length; i++) {
    const opt = sel.options[i];
    const row = document.createElement("div");
    row.className = "opad-list-row";
    row.dataset.idx = String(i);
    row.textContent = opt.label || opt.text || opt.value || "—";
    row.addEventListener("mouseenter", () => {
      expandedIdx = i;
      paintExpanded();
    });
    row.addEventListener("click", () => {
      expandedIdx = i;
      commitExpanded();
    });
    list.appendChild(row);
  }
  const foot = document.createElement("div");
  foot.className = "opad-list-foot";
  foot.textContent = "🎮 ↑↓ 選ぶ · A 決定 · B キャンセル";
  list.appendChild(foot);

  document.body.appendChild(list);
  expandedListEl = list;

  // Position above or below depending on viewport position.
  const r = sel.getBoundingClientRect();
  const lh = list.getBoundingClientRect().height;
  const openAbove = r.top + lh > window.innerHeight - 8;
  list.style.left = `${Math.max(8, Math.min(window.innerWidth - list.offsetWidth - 8, r.left))}px`;
  if (openAbove) list.style.top = `${Math.max(8, r.top - lh - 6)}px`;
  else list.style.top = `${r.bottom + 6}px`;

  paintExpanded();
}

function paintExpanded(): void {
  if (!expandedListEl) return;
  Array.from(expandedListEl.querySelectorAll<HTMLElement>(".opad-list-row")).forEach((row, i) => {
    row.classList.toggle("hi", i === expandedIdx);
  });
  const hi = expandedListEl.querySelector<HTMLElement>(".opad-list-row.hi");
  hi?.scrollIntoView({ block: "nearest" });
}

function moveExpanded(dir: -1 | 1): void {
  if (!expandedSel) return;
  const n = expandedSel.options.length;
  if (!n) return;
  expandedIdx = (expandedIdx + dir + n) % n;
  paintExpanded();
}

function commitExpanded(): void {
  if (!expandedSel) return;
  if (expandedSel.selectedIndex !== expandedIdx) {
    expandedSel.selectedIndex = expandedIdx;
    expandedSel.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeExpanded();
}

function closeExpanded(): void {
  if (expandedListEl?.parentNode) expandedListEl.parentNode.removeChild(expandedListEl);
  expandedListEl = null;
  expandedSel = null;
  expandedIdx = 0;
}

export function isOverlayListOpen(): boolean {
  return expandedSel !== null;
}

function adjust(el: HTMLElement, dir: -1 | 1): void {
  // Selects intentionally don't respond to ←/→ here — pad users must press A
  // to open the option list and commit a choice from there. Only range
  // sliders accept the lateral nudge.
  if (el instanceof HTMLInputElement && el.type === "range") {
    const step = parseFloat(el.step || "1") || 1;
    const min = parseFloat(el.min || "-Infinity");
    const max = parseFloat(el.max || "Infinity");
    const cur = parseFloat(el.value);
    const next = Math.max(min, Math.min(max, cur + dir * step));
    if (next === cur) return;
    el.value = String(next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

type FireKind = "edge" | "repeat" | null;

function shouldFire(key: string, held: boolean): FireKind {
  const wasHeld = prev[key] ?? false;
  prev[key] = held;
  if (!held) {
    delete heldSince[key];
    delete lastFire[key];
    delete fireCount[key];
    return null;
  }
  const now = performance.now();
  if (!wasHeld) {
    heldSince[key] = now;
    lastFire[key] = now;
    fireCount[key] = 1;
    return "edge";
  }
  const start = heldSince[key] ?? now;
  const last = lastFire[key] ?? 0;
  const count = fireCount[key] ?? 0;
  if (now - start < REPEAT_FIRST_MS) return null;
  const interval = count >= REPEAT_FAST_AFTER ? REPEAT_FAST_INTERVAL_MS : REPEAT_INTERVAL_MS;
  if (now - last < interval) return null;
  lastFire[key] = now;
  fireCount[key] = count + 1;
  return "repeat";
}

/** Poll the active panel. Returns true when B requests leaving SETTINGS. */
export function pollOverlayPad(pad: Gamepad, click: () => void): boolean {
  const list = getItems();
  if (!list.length && !expandedSel) return false;

  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const dpUp = pad.buttons[12]?.pressed ?? false;
  const dpDown = pad.buttons[13]?.pressed ?? false;
  const dpLeft = pad.buttons[14]?.pressed ?? false;
  const dpRight = pad.buttons[15]?.pressed ?? false;
  const up = dpUp || ay < -STICK_DEAD;
  const down = dpDown || ay > STICK_DEAD;
  const left = dpLeft || ax < -STICK_DEAD;
  const right = dpRight || ax > STICK_DEAD;
  const a = pad.buttons[0]?.pressed ?? false;
  const b = pad.buttons[1]?.pressed ?? false;

  // === Expanded select list mode ===
  if (expandedSel) {
    const upEv = shouldFire("up", up);
    if (upEv) {
      moveExpanded(-1);
      if (upEv === "edge") click();
    }
    const downEv = shouldFire("down", down);
    if (downEv) {
      moveExpanded(1);
      if (downEv === "edge") click();
    }
    // Drain ←→ so we don't accumulate held-state for the next mode change.
    shouldFire("left", left);
    shouldFire("right", right);
    const aEv = shouldFire("a", a);
    if (aEv === "edge") {
      commitExpanded();
      click();
    }
    const bEv = shouldFire("b", b);
    if (bEv === "edge") {
      closeExpanded();
      click();
    }
    return false;
  }

  // === Slider edit mode ===
  if (editingSlider) {
    const upEv = shouldFire("up", up);
    if (upEv) {
      adjust(editingSlider, +1);
      if (upEv === "edge") click();
    }
    const downEv = shouldFire("down", down);
    if (downEv) {
      adjust(editingSlider, -1);
      if (downEv === "edge") click();
    }
    const leftEv = shouldFire("left", left);
    if (leftEv) {
      adjust(editingSlider, -1);
      if (leftEv === "edge") click();
    }
    const rightEv = shouldFire("right", right);
    if (rightEv) {
      adjust(editingSlider, +1);
      if (rightEv === "edge") click();
    }
    const aEv = shouldFire("a", a);
    if (aEv === "edge") {
      exitSliderEdit();
      click();
    }
    const bEv = shouldFire("b", b);
    if (bEv === "edge") {
      exitSliderEdit();
      click();
    }
    return false;
  }

  // === Normal panel-cursor mode === (any of ↑↓←→ navigates between items)
  const upEv = shouldFire("up", up);
  if (upEv) {
    focusIdx = (focusIdx - 1 + list.length) % list.length;
    focusCurrent();
    if (upEv === "edge") click();
  }
  const downEv = shouldFire("down", down);
  if (downEv) {
    focusIdx = (focusIdx + 1) % list.length;
    focusCurrent();
    if (downEv === "edge") click();
  }
  const leftEv = shouldFire("left", left);
  if (leftEv) {
    focusIdx = (focusIdx - 1 + list.length) % list.length;
    focusCurrent();
    if (leftEv === "edge") click();
  }
  const rightEv = shouldFire("right", right);
  if (rightEv) {
    focusIdx = (focusIdx + 1) % list.length;
    focusCurrent();
    if (rightEv === "edge") click();
  }
  const aEv = shouldFire("a", a);
  if (aEv === "edge") {
    const el = list[Math.min(focusIdx, list.length - 1)];
    if (el instanceof HTMLInputElement && el.type === "range") {
      enterSliderEdit(el);
      click();
    } else if (el instanceof HTMLSelectElement) {
      openExpanded(el);
      click();
    } else if (el instanceof HTMLButtonElement) {
      el.click();
      click();
    }
  }
  const bEv = shouldFire("b", b);
  if (bEv === "edge") {
    click();
    return true;
  }
  return false;
}

function enterSliderEdit(el: HTMLInputElement): void {
  editingSlider = el;
  el.classList.add("opad-editing");
}
function exitSliderEdit(): void {
  if (editingSlider) editingSlider.classList.remove("opad-editing");
  editingSlider = null;
}

export function isOverlaySliderEditing(): boolean {
  return editingSlider !== null;
}
