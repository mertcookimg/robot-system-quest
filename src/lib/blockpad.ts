// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Gamepad-driven cursor for the block editor (#block-editor).
// Lets the block editor in LESSON stages be driven by pad / mouse /
// keyboard simultaneously. Tracks the most-recently used input device
// (pad / mk = mouse-keyboard) and only shows the focus ring in pad mode.
// Stage code stays untouched: this layer just calls .click() on the
// existing DOM buttons to reuse their handlers.

const STICK_DEAD = 0.4;
const REPEAT_FIRST_MS = 380;
const REPEAT_INTERVAL_MS = 90;
const REPEAT_FAST_AFTER = 8;
const REPEAT_FAST_INTERVAL_MS = 40;

type Scope = "palette" | "program";
type InputMode = "pad" | "mk"; // mk = mouse / keyboard

const cur = {
  scope: "palette" as Scope,
  paletteIdx: 0,
  programIdx: 0,
  cellIdx: 0, // 0..N-1: param input, N: × (delete)
  editing: false,
};

const prev = {
  buttons: [] as boolean[],
  repeat: new Map<string, { lastFire: number; count: number }>(),
  cur: { scope: "palette" as Scope, paletteIdx: -1, programIdx: -1, cellIdx: -1, editing: false },
};

let mode: InputMode = "mk";
let listenersInstalled = false;
// Used when the block editor is visible but the pad must remain free for
// driving (teleop stages like edge_detection).
let gamepadDisabled = false;

export function isBlockpadActive(): boolean {
  const ed = document.getElementById("block-editor");
  return !!ed && ed.offsetParent !== null;
}

// True when blockpad is allowed to consume pad input (teleop disables this).
export function isBlockpadCapturingGamepad(): boolean {
  return !gamepadDisabled && isBlockpadActive();
}

export function setBlockpadGamepadDisabled(v: boolean) {
  if (gamepadDisabled === v) return;
  gamepadDisabled = v;
  if (v) clearAllHighlights();
}

function getPalette(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".be-palette-block")).filter(
    (b) => b.offsetParent !== null,
  );
}
function getProgramRows(): HTMLLIElement[] {
  const ol = document.getElementById("be-program") as HTMLOListElement | null;
  if (!ol) return [];
  return Array.from(ol.querySelectorAll<HTMLLIElement>("li.be-block"));
}
function getRowInputs(li: HTMLLIElement): HTMLInputElement[] {
  return Array.from(li.querySelectorAll<HTMLInputElement>('input[type="number"]'));
}
function getRowDeleteBtn(li: HTMLLIElement): HTMLButtonElement | null {
  return li.querySelector<HTMLButtonElement>("button.be-remove");
}
function getRowUpBtn(li: HTMLLIElement): HTMLButtonElement | null {
  return li.querySelector<HTMLButtonElement>("button.be-up");
}
function getRowDownBtn(li: HTMLLIElement): HTMLButtonElement | null {
  return li.querySelector<HTMLButtonElement>("button.be-down");
}
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function clampCursor() {
  const palette = getPalette();
  const rows = getProgramRows();
  if (palette.length === 0 && rows.length === 0) {
    cur.scope = "palette";
    cur.paletteIdx = 0;
    cur.editing = false;
    return;
  }
  if (cur.scope === "palette") {
    if (palette.length === 0) {
      cur.scope = "program";
      cur.programIdx = 0;
      cur.cellIdx = 0;
    } else {
      cur.paletteIdx = clamp(cur.paletteIdx, 0, palette.length - 1);
    }
  } else {
    if (rows.length === 0) {
      cur.scope = "palette";
      cur.paletteIdx = clamp(cur.paletteIdx, 0, Math.max(0, palette.length - 1));
      cur.editing = false;
    } else {
      cur.programIdx = clamp(cur.programIdx, 0, rows.length - 1);
      const inputs = getRowInputs(rows[cur.programIdx]);
      const maxCol = inputs.length;
      cur.cellIdx = clamp(cur.cellIdx, 0, maxCol);
      if (cur.editing && cur.cellIdx >= inputs.length) cur.editing = false;
    }
  }
}

function clearAllHighlights() {
  document.querySelectorAll(".bp-focus, .bp-editing").forEach((el) => {
    el.classList.remove("bp-focus", "bp-editing");
  });
}

function cursorChanged(): boolean {
  return (
    prev.cur.scope !== cur.scope ||
    prev.cur.paletteIdx !== cur.paletteIdx ||
    prev.cur.programIdx !== cur.programIdx ||
    prev.cur.cellIdx !== cur.cellIdx ||
    prev.cur.editing !== cur.editing
  );
}
function recordCursor() {
  prev.cur = { ...cur };
}

function applyHighlights() {
  clearAllHighlights();
  // In mk mode let native :focus / :hover handle visuals.
  if (mode !== "pad") return;

  const palette = getPalette();
  const rows = getProgramRows();
  const changed = cursorChanged();
  if (cur.scope === "palette" && palette[cur.paletteIdx]) {
    palette[cur.paletteIdx].classList.add("bp-focus");
    if (changed) palette[cur.paletteIdx].scrollIntoView({ block: "nearest", inline: "nearest" });
  } else if (cur.scope === "program" && rows[cur.programIdx]) {
    const li = rows[cur.programIdx];
    li.classList.add("bp-focus");
    const inputs = getRowInputs(li);
    if (cur.cellIdx < inputs.length) {
      inputs[cur.cellIdx].classList.add("bp-focus");
      if (cur.editing) inputs[cur.cellIdx].classList.add("bp-editing");
      if (changed) inputs[cur.cellIdx].scrollIntoView({ block: "nearest", inline: "nearest" });
    } else {
      const del = getRowDeleteBtn(li);
      if (del) {
        del.classList.add("bp-focus");
        if (changed) del.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }
  recordCursor();
}

function consumeRepeat(name: string, pressed: boolean, now: number): boolean {
  if (!pressed) {
    prev.repeat.delete(name);
    return false;
  }
  const r = prev.repeat.get(name);
  if (!r) {
    prev.repeat.set(name, { lastFire: now, count: 1 });
    return true;
  }
  const interval = r.count >= REPEAT_FAST_AFTER ? REPEAT_FAST_INTERVAL_MS : REPEAT_INTERVAL_MS;
  const wait = r.count === 1 ? REPEAT_FIRST_MS : interval;
  if (now - r.lastFire >= wait) {
    r.lastFire = now;
    r.count++;
    return true;
  }
  return false;
}

function moveCursorVertical(dir: -1 | 1) {
  // ↑↓ only moves within the current panel; ←→ switches panels.
  const palette = getPalette();
  const rows = getProgramRows();
  if (cur.scope === "palette") {
    const next = cur.paletteIdx + dir;
    if (next >= 0 && next < palette.length) cur.paletteIdx = next;
  } else {
    const next = cur.programIdx + dir;
    if (next >= 0 && next < rows.length) {
      cur.programIdx = next;
      const inputs = getRowInputs(rows[next]);
      cur.cellIdx = clamp(cur.cellIdx, 0, inputs.length);
    }
  }
  cur.editing = false;
}

function moveCursorHorizontal(dir: -1 | 1, keepEditing = false) {
  const palette = getPalette();
  const rows = getProgramRows();
  if (cur.scope === "palette") {
    // PROGRAM panel sits to the right of BLOCKS — → enters it.
    if (dir === 1 && rows.length > 0) {
      cur.scope = "program";
      cur.programIdx = clamp(cur.programIdx, 0, rows.length - 1);
      cur.cellIdx = 0;
      cur.editing = false;
    }
    return;
  }
  // program scope
  const li = rows[cur.programIdx];
  if (!li) return;
  const inputs = getRowInputs(li);
  const maxCol = inputs.length;

  if (keepEditing) {
    // Edit mode: cursor only moves between cells in the row. B exits.
    cur.cellIdx = clamp(cur.cellIdx + dir, 0, maxCol);
    if (cur.cellIdx >= inputs.length) cur.editing = false;
    return;
  }

  // Non-edit mode: pressing ← from cell 0 returns to BLOCKS.
  if (dir === -1 && cur.cellIdx === 0 && palette.length > 0) {
    cur.scope = "palette";
    cur.paletteIdx = clamp(cur.paletteIdx, 0, palette.length - 1);
    cur.editing = false;
    return;
  }
  cur.cellIdx = clamp(cur.cellIdx + dir, 0, maxCol);
  cur.editing = false;
}

function adjustValue(dir: -1 | 1, count: number) {
  const rows = getProgramRows();
  const li = rows[cur.programIdx];
  if (!li) return;
  const inputs = getRowInputs(li);
  const inp = inputs[cur.cellIdx];
  if (!inp) return;
  const step = parseFloat(inp.step || "0.1") || 0.1;
  const accel = count >= REPEAT_FAST_AFTER ? 5 : 1;
  const v = (parseFloat(inp.value) || 0) + dir * step * accel;
  inp.value = (Math.round(v * 1000) / 1000).toString();
  inp.dispatchEvent(new Event("input", { bubbles: true }));
}

function deleteCurrentRow(sfxClick?: () => void) {
  if (cur.scope !== "program") return;
  const rows = getProgramRows();
  const li = rows[cur.programIdx];
  if (!li) return;
  const del = getRowDeleteBtn(li);
  if (!del) return;
  del.click();
  sfxClick?.();
  const newRows = getProgramRows();
  if (newRows.length === 0) {
    cur.scope = "palette";
  } else {
    cur.programIdx = clamp(cur.programIdx, 0, newRows.length - 1);
    cur.cellIdx = 0;
  }
  cur.editing = false;
}

function pressActivate(sfxClick?: () => void) {
  if (cur.scope === "palette") {
    const palette = getPalette();
    const btn = palette[cur.paletteIdx];
    if (!btn) return;
    btn.click();
    sfxClick?.();
    const rows = getProgramRows();
    if (rows.length > 0) {
      cur.scope = "program";
      cur.programIdx = rows.length - 1;
      cur.cellIdx = 0;
      cur.editing = false;
    }
    return;
  }
  const rows = getProgramRows();
  const li = rows[cur.programIdx];
  if (!li) return;
  const inputs = getRowInputs(li);
  if (cur.cellIdx < inputs.length) {
    cur.editing = !cur.editing;
    sfxClick?.();
  } else {
    deleteCurrentRow(sfxClick);
  }
}

function pressBack() {
  if (cur.editing) {
    cur.editing = false;
    return;
  }
  if (cur.scope === "program") {
    cur.scope = "palette";
  }
}

function moveRow(dir: -1 | 1) {
  if (cur.scope !== "program") return;
  const rows = getProgramRows();
  const li = rows[cur.programIdx];
  if (!li) return;
  const btn = dir === -1 ? getRowUpBtn(li) : getRowDownBtn(li);
  btn?.click();
  cur.programIdx = clamp(cur.programIdx + dir, 0, rows.length - 1);
}

function clickById(id: string, sfxClick?: () => void) {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (!el) return;
  el.click();
  sfxClick?.();
}

export function pollBlockpad(pad: Gamepad, sfxClick?: () => void): void {
  const now = performance.now();
  clampCursor();

  const ax = pad.axes[0] ?? 0;
  const ay = pad.axes[1] ?? 0;
  const dpUp = (pad.buttons[12]?.pressed ?? false) || ay < -STICK_DEAD;
  const dpDown = (pad.buttons[13]?.pressed ?? false) || ay > STICK_DEAD;
  const dpLeft = (pad.buttons[14]?.pressed ?? false) || ax < -STICK_DEAD;
  const dpRight = (pad.buttons[15]?.pressed ?? false) || ax > STICK_DEAD;

  const upFire = consumeRepeat("up", dpUp, now);
  const downFire = consumeRepeat("down", dpDown, now);
  const leftFire = consumeRepeat("left", dpLeft, now);
  const rightFire = consumeRepeat("right", dpRight, now);

  // Any pad activity flips us back into pad mode.
  const anyDirection = upFire || downFire || leftFire || rightFire;
  const anyButton = pad.buttons.some((b, i) => b.pressed && !(prev.buttons[i] ?? false));
  if (anyDirection || anyButton) {
    if (mode !== "pad") {
      mode = "pad";
      // If an input had focus from mk mode, blur it so pad edit mode owns it.
      if (
        document.activeElement instanceof HTMLElement &&
        (document.activeElement as HTMLElement).closest(".be-block")
      ) {
        (document.activeElement as HTMLElement).blur();
      }
    }
  }

  if (cur.editing) {
    const r = prev.repeat.get("up") ?? prev.repeat.get("down");
    const cnt = r?.count ?? 1;
    if (upFire) adjustValue(+1, cnt);
    if (downFire) adjustValue(-1, cnt);
    if (leftFire) moveCursorHorizontal(-1, true);
    if (rightFire) moveCursorHorizontal(+1, true);
  } else {
    if (upFire) moveCursorVertical(-1);
    if (downFire) moveCursorVertical(+1);
    if (leftFire) moveCursorHorizontal(-1);
    if (rightFire) moveCursorHorizontal(+1);
  }

  const edge = (i: number) => (pad.buttons[i]?.pressed ?? false) && !(prev.buttons[i] ?? false);
  if (edge(0)) pressActivate(sfxClick); // A: add / toggle edit / confirm delete
  if (edge(1)) pressBack(); // B: leave edit / back to palette
  if (edge(2)) clickById("be-run", sfxClick); // X: RUN
  if (edge(3)) clickById("be-stop", sfxClick); // Y: STOP
  if (edge(4)) moveRow(-1); // LB: move row up
  if (edge(5)) moveRow(+1); // RB: move row down
  if (edge(6)) clickById("be-move-start", sfxClick); // LT: MOVE START toggle (optional, no-op if not present)
  if (edge(7)) clickById("be-practice", sfxClick); // RT: MISSION / PRACTICE toggle (optional)
  if (edge(9)) clickById("be-clear", sfxClick); // Start: CLEAR

  prev.buttons = pad.buttons.map((b) => b.pressed);
  applyHighlights();
}

// === Mouse / keyboard integration ===
// Touching the editor with mouse/keyboard switches to mk mode and syncs
// the pad cursor to whatever element was clicked, so a later pad grab
// resumes from the last mouse-touched position.

function syncCursorToElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return;
  const palette = getPalette();
  for (let i = 0; i < palette.length; i++) {
    if (palette[i].contains(target)) {
      cur.scope = "palette";
      cur.paletteIdx = i;
      cur.editing = false;
      return;
    }
  }
  const rows = getProgramRows();
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].contains(target)) continue;
    cur.scope = "program";
    cur.programIdx = i;
    cur.editing = false;
    const inputs = getRowInputs(rows[i]);
    for (let c = 0; c < inputs.length; c++) {
      if (inputs[c] === target || inputs[c].contains(target)) {
        cur.cellIdx = c;
        return;
      }
    }
    const del = getRowDeleteBtn(rows[i]);
    if (del && (del === target || del.contains(target))) {
      cur.cellIdx = inputs.length;
      return;
    }
    cur.cellIdx = 0;
    return;
  }
}

function switchToMK() {
  if (mode !== "mk") {
    mode = "mk";
    cur.editing = false;
    clearAllHighlights();
  }
}

// === Drag & drop row reordering ===
// Each stage's ↑/↓ buttons already swap entries in the program array and
// call refreshProgramUI(), so we can implement DnD by clicking those
// buttons N times to walk a row to its drop target.
// A MutationObserver applies `draggable` to dynamically created <li>s.

let dragSrcIdx: number | null = null;

function moveRowByButtons(fromIdx: number, steps: number) {
  if (steps === 0) return;
  const dir = steps > 0 ? 1 : -1;
  let curIdx = fromIdx;
  for (let i = 0; i < Math.abs(steps); i++) {
    const rows = getProgramRows();
    const li = rows[curIdx];
    if (!li) break;
    const btn = dir > 0 ? getRowDownBtn(li) : getRowUpBtn(li);
    if (!btn) break;
    btn.click();
    curIdx += dir;
  }
}

function clearDragVisuals(ol: HTMLOListElement) {
  ol.querySelectorAll(".bp-dragging, .bp-drag-over").forEach((el) => {
    el.classList.remove("bp-dragging", "bp-drag-over");
  });
}

function installDragForOl(ol: HTMLOListElement) {
  const ensureDraggable = () => {
    ol.querySelectorAll<HTMLLIElement>("li.be-block").forEach((li) => {
      if (li.getAttribute("draggable") !== "true") {
        li.setAttribute("draggable", "true");
      }
    });
  };
  ensureDraggable();
  const obs = new MutationObserver(ensureDraggable);
  obs.observe(ol, { childList: true, subtree: false });

  ol.addEventListener("dragstart", (e) => {
    const li = (e.target as HTMLElement).closest("li.be-block") as HTMLLIElement | null;
    if (!li) return;
    // Drags starting on input/button get cancelled so we don't break
    // text selection or button clicks.
    const orig = e.target as HTMLElement;
    if (orig instanceof HTMLInputElement || orig instanceof HTMLButtonElement) {
      e.preventDefault();
      return;
    }
    const rows = getProgramRows();
    dragSrcIdx = rows.indexOf(li);
    li.classList.add("bp-dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(dragSrcIdx));
    }
  });

  ol.addEventListener("dragover", (e) => {
    if (dragSrcIdx === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    const li = (e.target as HTMLElement).closest("li.be-block") as HTMLLIElement | null;
    ol.querySelectorAll(".bp-drag-over").forEach((el) => el.classList.remove("bp-drag-over"));
    if (li && !li.classList.contains("bp-dragging")) {
      li.classList.add("bp-drag-over");
    }
  });

  ol.addEventListener("drop", (e) => {
    if (dragSrcIdx === null) return;
    e.preventDefault();
    const li = (e.target as HTMLElement).closest("li.be-block") as HTMLLIElement | null;
    const rows = getProgramRows();
    let dstIdx = li ? rows.indexOf(li) : rows.length - 1;
    if (dstIdx < 0) dstIdx = rows.length - 1;
    const steps = dstIdx - dragSrcIdx;
    moveRowByButtons(dragSrcIdx, steps);
    // Sync pad cursor to the row that was just moved.
    cur.scope = "program";
    cur.programIdx = clamp(dragSrcIdx + steps, 0, getProgramRows().length - 1);
    cur.cellIdx = 0;
    cur.editing = false;
    dragSrcIdx = null;
    clearDragVisuals(ol);
  });

  ol.addEventListener("dragend", () => {
    dragSrcIdx = null;
    clearDragVisuals(ol);
  });
}

export function setupBlockpad() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  const inEditor = (target: EventTarget | null) => {
    const ed = document.getElementById("block-editor");
    return !!ed && target instanceof Node && ed.contains(target);
  };
  // Mouse click / focus: switch to mk mode and sync the cursor.
  document.addEventListener(
    "mousedown",
    (e) => {
      if (!inEditor(e.target)) return;
      switchToMK();
      syncCursorToElement(e.target);
    },
    true,
  );
  document.addEventListener(
    "focusin",
    (e) => {
      if (!inEditor(e.target)) return;
      switchToMK();
      syncCursorToElement(e.target);
    },
    true,
  );
  // Typing directly into an input keeps us in mk mode.
  document.addEventListener(
    "keydown",
    (e) => {
      if (!inEditor(e.target)) return;
      switchToMK();
    },
    true,
  );
  // Install drag-and-drop on the #be-program <ol>.
  const ol = document.getElementById("be-program") as HTMLOListElement | null;
  if (ol) installDragForOl(ol);
}

export function clearBlockpadHighlights() {
  clearAllHighlights();
  prev.buttons = [];
  prev.repeat.clear();
  cur.editing = false;
  mode = "mk";
}
