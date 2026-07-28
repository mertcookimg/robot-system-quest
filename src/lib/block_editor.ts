// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Helpers for stages that use the block editor (the right-side
// palette + program panel in LESSON stages). The actual DOM lives in
// index.html (#block-editor); each stage previously found and wired the
// palette, RUN/STOP/CLEAR buttons, and status badge by hand.
//
// This module collapses the common DOM lookups and wiring into a single
// `setupBlockEditor()` call. Stages retain full control of how to *render*
// their program (since each stage has different block kinds), and just
// pass `onRun` / `onStop` / `onClear` callbacks.

export interface BlockEditorRefs {
  editor: HTMLElement;
  programList: HTMLOListElement;
  statusBadge: HTMLElement;
  programHint: HTMLElement;
  runBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  paletteEl: HTMLElement;
  paletteHintEl: HTMLElement | null;
}

export function getBlockEditorRefs(): BlockEditorRefs {
  const $ = <T extends HTMLElement>(id: string): T => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} missing in DOM`);
    return el as T;
  };
  const editor = $<HTMLElement>("block-editor");
  return {
    editor,
    programList: $<HTMLOListElement>("be-program"),
    statusBadge: $<HTMLElement>("be-status"),
    programHint: $<HTMLElement>("be-program-hint"),
    runBtn: $<HTMLButtonElement>("be-run"),
    stopBtn: $<HTMLButtonElement>("be-stop"),
    clearBtn: $<HTMLButtonElement>("be-clear"),
    paletteEl: editor.querySelector<HTMLElement>(".be-palette")!,
    paletteHintEl: document.getElementById("be-palette-hint"),
  };
}

export interface PaletteBlock {
  /** data-add value used to (re)find the button. Also acts as the block kind id. */
  id: string;
  /** User-visible block name (label rendered top-left). */
  name: string;
  /** Args list (subtle text on the right of the palette block). */
  args: string;
  /** Click handler that should append a new block to the program. */
  onAdd: () => void;
}

/**
 * Hide every existing `.be-palette-block` and (re)create the listed ones,
 * setting the palette hint text. Returns the buttons in the order given.
 */
export function setupPalette(blocks: PaletteBlock[], hint: string): HTMLButtonElement[] {
  const refs = getBlockEditorRefs();
  refs.paletteEl.querySelectorAll<HTMLButtonElement>(".be-palette-block").forEach((b) => {
    b.style.display = "none";
  });

  const out: HTMLButtonElement[] = [];
  for (const b of blocks) {
    let btn = refs.paletteEl.querySelector<HTMLButtonElement>(
      `.be-palette-block[data-add="${b.id}"]`,
    );
    if (!btn) {
      btn = document.createElement("button");
      btn.className = "be-palette-block";
      btn.dataset.add = b.id;
      const n = document.createElement("span");
      n.className = "bp-name";
      n.textContent = b.name;
      const a = document.createElement("span");
      a.className = "bp-args";
      a.textContent = b.args;
      btn.appendChild(n);
      btn.appendChild(a);
      refs.paletteEl.insertBefore(btn, refs.paletteHintEl);
    }
    btn.style.display = "";
    // Replace listeners by cloning, so re-entering the stage doesn't stack handlers.
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    fresh.addEventListener("click", b.onAdd);
    out.push(fresh);
  }

  if (refs.paletteHintEl) refs.paletteHintEl.textContent = hint;
  return out;
}

export interface SetupBlockEditorOptions {
  /** Palette hint text shown under the block buttons. */
  paletteHint: string;
  /** Palette blocks (also defines the available block kinds). */
  paletteBlocks: PaletteBlock[];
  onRun: () => void;
  onStop: () => void;
  onClear: () => void;
}

export interface BlockEditorHandle extends BlockEditorRefs {
  /** Show the editor (sets editor.style.display = ""). */
  show(): void;
  /** Hide the editor (sets editor.style.display = "none"). */
  hide(): void;
  /** Set the badge text + class. `kind: ""` clears state classes. */
  setStatus(text: string, kind: "" | "running" | "success" | "error"): void;
}

/**
 * One-call setup: shows the editor, wires RUN/STOP/CLEAR, populates the
 * palette. Returns refs + small helpers. Stages still own their program
 * array and render it via `programList` directly.
 */
export function setupBlockEditor(opts: SetupBlockEditorOptions): BlockEditorHandle {
  const refs = getBlockEditorRefs();
  refs.editor.style.display = "";

  setupPalette(opts.paletteBlocks, opts.paletteHint);

  refs.runBtn.onclick = opts.onRun;
  refs.stopBtn.onclick = opts.onStop;
  refs.clearBtn.onclick = opts.onClear;

  return {
    ...refs,
    show: () => {
      refs.editor.style.display = "";
    },
    hide: () => {
      refs.editor.style.display = "none";
    },
    setStatus(text, kind) {
      refs.statusBadge.textContent = text;
      refs.statusBadge.classList.remove("running", "success", "error");
      if (kind) refs.statusBadge.classList.add(kind);
    },
  };
}
