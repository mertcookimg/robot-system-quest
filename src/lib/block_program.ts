// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Helper for assembling the palette, program list, RUN/STOP/CLEAR buttons,
// refreshProgramUI, and numeric parameter inputs from a single declaration.
// These were previously repeated in every block-editor stage (feedforward,
// feedback, and others).
//
// Builds program-list rendering and the parameter-editing UI on top of the
// existing `lib/block_editor.ts` palette and run/stop/clear button wiring.
//
// Usage:
//   interface MyBlock { kind: "go_straight"; distance: number; velocity: number }
//
//   const bp = setupBlockProgram<MyBlock>({
//     program,                              // Pass a mutable array.
//     paletteHint: "Subscribe to /odom...",
//     blockKinds: [{
//       kind: "go_straight",
//       label: "go_straight",
//       args: "distance, velocity",
//       defaults: () => ({ kind: "go_straight", distance: 1.0, velocity: 0.3 }),
//       params: (b) => [
//         { key: "distance", value: b.distance, step: 0.1, unit: "m" },
//         { key: "velocity", value: b.velocity, step: 0.1, unit: "m/s" },
//       ],
//     }],
//     isRunning: () => isRunning,
//     runIdx:    () => runIdx,
//     onRun:     () => onRun(),
//     onStop:    () => onStop(),
//   });
//
//   // Call bp.refresh() to redraw after the running state changes.
//   // Call bp.dispose() during cleanup.

import { setupBlockEditor, type PaletteBlock } from "./block_editor";
import { t } from "../i18n";

export interface BlockParamSpec {
  /** Field name in B (for example, "distance"). A string supports discriminated unions. */
  key: string;
  value: number;
  step?: number; // default 0.1
  unit?: string; // default ""
}

export interface BlockKindSpec<B> {
  /** Discriminator value; must match B["kind"]. */
  kind: string;
  label: string;
  args: string;
  defaults: () => B;
  params: (b: B) => BlockParamSpec[];
}

export interface BlockProgramOpts<B> {
  /** Mutable array modified directly when blocks are added, removed, or reordered. */
  program: B[];
  blockKinds: BlockKindSpec<B>[];
  paletteHint?: string;
  isRunning?: () => boolean;
  runIdx?: () => number;
  onRun?: () => void;
  onStop?: () => void;
  /** When omitted, clears the program and refreshes it. */
  onClear?: () => void;
  /** Called whenever the program is added to, removed from, reordered, edited, or cleared. */
  onChange?: () => void;
  /**
   * When true, displays every block as active while running.
   * Intended for stages such as image_processing that evaluate the entire
   * program live instead of executing it one step at a time.
   */
  activeWhenRunning?: boolean;
  /** Maximum number of program blocks. Further additions are ignored and call onLimit. */
  maxBlocks?: number;
  /** Called on an attempted addition after maxBlocks is reached, typically to show a warning. */
  onLimit?: () => void;
}

export interface BlockProgramHandle {
  /** Call after changing the program to redraw the list DOM. */
  refresh(): void;
  dispose(): void;
}

export function setupBlockProgram<B extends { kind: string }>(
  opts: BlockProgramOpts<B>,
): BlockProgramHandle {
  const programListEl = document.getElementById("be-program") as HTMLOListElement | null;
  if (!programListEl) {
    return { refresh: () => {}, dispose: () => {} };
  }

  const programHintEl = document.getElementById("be-program-hint");
  const isRunning = opts.isRunning ?? (() => false);
  const runIdx = opts.runIdx ?? (() => -1);
  const changed = () => opts.onChange?.();

  function refresh(): void {
    if (!programListEl) return;
    programListEl.innerHTML = "";
    opts.program.forEach((b, i) => {
      const li = document.createElement("li");
      li.className = "be-block";
      if (isRunning() && (opts.activeWhenRunning || i === runIdx())) li.classList.add("active");
      if (isRunning() && !opts.activeWhenRunning && i < runIdx()) li.classList.add("done");

      const no = document.createElement("span");
      no.className = "be-blockno";
      li.appendChild(no);
      const fn = document.createElement("span");
      fn.className = "be-fn";
      fn.textContent = b.kind;
      li.appendChild(fn);
      const open = document.createElement("span");
      open.className = "be-paren";
      open.textContent = "(";
      li.appendChild(open);

      const spec = opts.blockKinds.find((k) => k.kind === b.kind);
      const params = spec ? spec.params(b) : [];
      params.forEach((p, idx) => {
        const field = document.createElement("label");
        field.className = "be-param";
        const paramName = document.createElement("span");
        paramName.className = "be-param-name";
        paramName.textContent = p.key;
        field.appendChild(paramName);

        const inp = document.createElement("input");
        inp.type = "number";
        inp.step = String(p.step ?? 0.1);
        inp.value = String(p.value);
        inp.setAttribute("aria-label", p.key);
        inp.title = p.key;
        // `input` event fires both for keyboard typing AND for the
        // synthesized event blockpad dispatches when the gamepad nudges
        // a value. `change` alone misses the latter (it only fires on
        // blur / Enter), so values updated via pad would silently revert
        // when RUN was pressed.
        const commit = () => {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v)) {
            (b as Record<string, unknown>)[p.key] = v;
            changed();
          }
        };
        inp.addEventListener("input", commit);
        inp.addEventListener("change", commit);
        field.appendChild(inp);
        if (p.unit) {
          const u = document.createElement("span");
          u.className = "be-unit";
          u.textContent = p.unit;
          field.appendChild(u);
        }
        li.appendChild(field);
        if (idx < params.length - 1) {
          const c = document.createElement("span");
          c.className = "be-comma";
          c.textContent = ",";
          li.appendChild(c);
        }
      });

      const close = document.createElement("span");
      close.className = "be-paren";
      close.textContent = ")";
      li.appendChild(close);

      // up / down / delete
      const actions = document.createElement("span");
      actions.className = "be-block-actions";
      const up = document.createElement("button");
      up.className = "be-up";
      up.textContent = "↑";
      up.title = t("block.btn.up");
      up.onclick = () => {
        if (i > 0) {
          [opts.program[i - 1], opts.program[i]] = [opts.program[i], opts.program[i - 1]];
          refresh();
          changed();
        }
      };
      actions.appendChild(up);
      const down = document.createElement("button");
      down.className = "be-down";
      down.textContent = "↓";
      down.title = t("block.btn.down");
      down.onclick = () => {
        if (i < opts.program.length - 1) {
          [opts.program[i], opts.program[i + 1]] = [opts.program[i + 1], opts.program[i]];
          refresh();
          changed();
        }
      };
      actions.appendChild(down);
      const rm = document.createElement("button");
      rm.className = "be-remove";
      rm.textContent = "×";
      rm.title = t("block.btn.remove");
      rm.onclick = () => {
        opts.program.splice(i, 1);
        refresh();
        changed();
      };
      actions.appendChild(rm);
      li.appendChild(actions);

      programListEl!.appendChild(li);
    });
    if (programHintEl) {
      programHintEl.textContent =
        opts.program.length === 0
          ? t("block.program.empty_short")
          : t("block.program.count", { n: opts.program.length });
    }
  }

  // Wire the palette and RUN/STOP/CLEAR controls through block_editor.
  const palette: PaletteBlock[] = opts.blockKinds.map((k) => ({
    id: k.kind,
    name: k.label,
    args: k.args,
    onAdd: () => {
      if (opts.maxBlocks !== undefined && opts.program.length >= opts.maxBlocks) {
        opts.onLimit?.();
        return;
      }
      opts.program.push(k.defaults());
      refresh();
      changed();
    },
  }));

  setupBlockEditor({
    paletteHint: opts.paletteHint ?? "",
    paletteBlocks: palette,
    onRun: () => opts.onRun?.(),
    onStop: () => opts.onStop?.(),
    onClear: () => {
      if (opts.onClear) opts.onClear();
      else opts.program.length = 0;
      refresh();
      changed();
    },
  });

  refresh();

  return {
    refresh,
    dispose() {
      if (programListEl) programListEl.innerHTML = "";
    },
  };
}
