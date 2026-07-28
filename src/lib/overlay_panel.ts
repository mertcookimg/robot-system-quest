// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Tiny DSL for the stage HTML overlay panel (#stage-overlay). A handful of
// LESSON stages need a small bottom-of-canvas control strip with sliders or
// labels (mapping_mission, image_processing, ...). The construction is
// otherwise the same boilerplate every time:
//   1. Clear g.overlay
//   2. Set inline styles to make it cover the canvas with a transparent layer
//   3. Build a panel <div>, position it absolutely
//   4. Append <input type="range"> + <label> trios
// This module collapses all that into a declarative API.

import { registerOverlayPad, unregisterOverlayPad } from "./overlaypad";

export interface SliderControl {
  kind: "slider";
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  /** Initial value. Read once on creation. */
  value: number;
  onInput(v: number): void;
}

export interface NoteControl {
  kind: "note";
  text: string;
}

export interface ChoiceOption {
  key: string;
  /** Pass a thunk when the label must follow language switches (see refresh()). */
  label: string | (() => string);
}

/**
 * A titled group of mutually-exclusive buttons (1P/2P, difficulty, ...).
 * Labels, the active key, and visibility are re-read on `refresh()` so a
 * stage can wire `onLangChange(() => panel.refresh())` for live re-labeling.
 */
export interface ChoiceControl {
  kind: "choice";
  /** Section title shown before the buttons. */
  label: string | (() => string);
  choices: ChoiceOption[];
  /** Key of the currently active choice. */
  active: () => string;
  onSelect(key: string): void;
  /** Render a "|" divider before this section. */
  dividerBefore?: boolean;
  /** Hide the whole section (incl. its divider) when it returns false. */
  visible?: () => boolean;
}

export type Control = SliderControl | NoteControl | ChoiceControl;

export interface OverlayPanelOptions {
  /** Where to anchor the panel (CSS top/bottom/left/right). Default: bottom-left 10px. */
  anchor?: { top?: string; bottom?: string; left?: string; right?: string };
  /** Put controls below the canvas instead of covering the play field. */
  placement?: "overlay" | "dock";
}

export interface OverlayPanelHandle {
  /** Re-apply labels / active states / visibility of choice controls. */
  refresh(): void;
  /** Remove the panel and clear the overlay's inline styles. */
  dispose(): void;
}

const DEFAULT_ANCHOR = { left: "10px", bottom: "10px" } as const;

/**
 * Build a small parameter panel inside `overlay`. Returns a handle whose
 * `dispose()` reverses every effect (clears innerHTML, resets cssText).
 */
export function makeOverlayPanel(
  overlay: HTMLElement,
  controls: Control[],
  opts: OverlayPanelOptions = {},
): OverlayPanelHandle {
  overlay.innerHTML = "";
  const docked = opts.placement === "dock";
  const dock = docked ? document.getElementById("stage-controls-dock") : null;
  const host = dock ?? overlay;

  if (docked && dock) {
    overlay.style.cssText = "";
    dock.replaceChildren();
    dock.hidden = false;
  } else {
    overlay.style.cssText = "position:absolute; inset:0; display:block; pointer-events:none;";
  }

  const anchor = { ...DEFAULT_ANCHOR, ...opts.anchor };
  const anchorCss = Object.entries(anchor)
    .map(([k, v]) => `${k}:${v}`)
    .join("; ");

  const panel = document.createElement("div");
  panel.className = "overlay-control-panel";
  panel.style.cssText =
    `${docked ? "position:relative; width:100%;" : `position:absolute; ${anchorCss};`}` +
    " padding:8px 12px; background:rgba(var(--scrim-rgb), 0.92);" +
    " border:1px solid rgba(125,211,252,0.5); border-radius:8px;" +
    " display:flex; gap:14px; align-items:center; flex-wrap:wrap;" +
    " font-family:ui-monospace,monospace; font-size:11px; color:#eef2ff;" +
    " pointer-events:auto; z-index:5;";

  const refreshers: Array<() => void> = [];
  for (const c of controls) {
    if (c.kind === "slider") panel.appendChild(makeSlider(c));
    else if (c.kind === "note") panel.appendChild(makeNote(c));
    else {
      const { el, refresh } = makeChoice(c);
      panel.appendChild(el);
      refreshers.push(refresh);
    }
  }

  host.appendChild(panel);
  // Keep normal driving active until pad A explicitly enters SETTINGS.
  registerOverlayPad(panel, false);

  return {
    refresh(): void {
      for (const r of refreshers) r();
    },
    dispose(): void {
      unregisterOverlayPad(panel);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
      overlay.style.cssText = "";
      if (dock) {
        dock.replaceChildren();
        dock.hidden = true;
      }
    },
  };
}

function makeSlider(c: SliderControl): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "overlay-slider";
  wrap.style.cssText = "display:flex; align-items:center; gap:6px; color:#9aa6c8;";

  const txt = document.createElement("span");
  txt.textContent = c.label;
  txt.style.color = "#7dd3fc";
  txt.style.fontWeight = "700";

  const inp = document.createElement("input");
  inp.type = "range";
  inp.min = String(c.min);
  inp.max = String(c.max);
  inp.step = String(c.step);
  inp.value = String(c.value);
  inp.style.cssText = "width:80px; accent-color:#7dd3fc;";

  const val = document.createElement("span");
  val.textContent = `${c.value}${c.unit ? " " + c.unit : ""}`;
  val.style.cssText = "min-width:54px; color:#eef2ff; font-weight:700;";

  inp.addEventListener("input", () => {
    const v = parseFloat(inp.value);
    val.textContent = `${v}${c.unit ? " " + c.unit : ""}`;
    c.onInput(v);
  });

  wrap.appendChild(txt);
  wrap.appendChild(inp);
  wrap.appendChild(val);
  return wrap;
}

function makeNote(c: NoteControl): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "overlay-note";
  span.style.cssText = "color:#9aa6c8;";
  span.textContent = c.text;
  return span;
}

const CHOICE_BTN_STYLE = [
  "border:1px solid rgba(125,211,252,0.35)",
  "background:rgba(125,211,252,0.06)",
  "color:#9aa6c8",
  "border-radius:6px",
  "padding:6px 10px",
  "font-family:inherit",
  "font-size:11px",
  "cursor:pointer",
  "outline:none",
].join(";");

function resolveLabel(l: string | (() => string)): string {
  return typeof l === "function" ? l() : l;
}

function makeChoice(c: ChoiceControl): { el: HTMLSpanElement; refresh: () => void } {
  const wrap = document.createElement("span");
  wrap.className = "overlay-choice";
  wrap.style.cssText = "display:flex; gap:10px; align-items:center;";

  if (c.dividerBefore) {
    const divider = document.createElement("span");
    divider.className = "overlay-divider";
    divider.textContent = "|";
    divider.style.cssText = "color:#3a4870; margin:0 4px;";
    wrap.appendChild(divider);
  }

  const title = document.createElement("span");
  title.style.cssText = "color:#7dd3fc; font-weight:700;";
  wrap.appendChild(title);

  const btns = new Map<string, HTMLButtonElement>();
  for (const opt of c.choices) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.cssText = CHOICE_BTN_STYLE;
    b.onclick = () => c.onSelect(opt.key);
    btns.set(opt.key, b);
    wrap.appendChild(b);
  }

  const refresh = () => {
    title.textContent = resolveLabel(c.label);
    const activeKey = c.active();
    for (const opt of c.choices) {
      const b = btns.get(opt.key)!;
      const active = opt.key === activeKey;
      b.textContent = resolveLabel(opt.label);
      b.style.borderColor = active ? "var(--accent)" : "rgba(125,211,252,0.35)";
      b.style.background = active ? "rgba(125,211,252,0.18)" : "rgba(125,211,252,0.06)";
      b.style.color = active ? "var(--accent)" : "#9aa6c8";
      b.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (c.visible) wrap.style.display = c.visible() ? "flex" : "none";
  };
  refresh();
  return { el: wrap, refresh };
}
