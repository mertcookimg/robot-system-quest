// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Generic toggle button helper for the block-editor's `.be-actions` row.
// Used for stage-specific modes like Practice / Mission, or any other
// 2-state switch the stage wants to expose.
//
// Usage:
//   const t = setupModeToggle("be-practice", {
//     onLabel:  "🔄 PRACTICE (RT)",
//     offLabel: "🎯 MISSION (RT)",
//     onColor:  "var(--accent)",
//     offColor: "",
//     onTitle:  "Practice mode — no clear screen",
//     offTitle: "Mission mode — clear when conditions are met",
//     onChange: (active) => { practiceMode = active; },
//   });
//   ...
//   t.dispose();

export interface ModeToggleOptions {
  /** Button id used by blockpad shortcuts (expected: RT=be-practice, LT=be-move-start). */
  // (handled via positional arg)
  onLabel: string;
  offLabel: string;
  onTitle?: string;
  offTitle?: string;
  /** Button border and text color while active. Default: var(--accent). */
  onColor?: string;
  /** Inactive color. Default: "" (the standard .be-btn style). */
  offColor?: string;
  /** Background. Default while active: rgba(125,211,252,0.18). */
  onBackground?: string;
  /** Called on a toggle with the new state. */
  onChange?: (active: boolean) => void;
  /** Optional sound-effect callback. */
  click?: () => void;
}

export interface ModeToggleHandle {
  isActive(): boolean;
  setActive(v: boolean): void;
  dispose(): void;
}

export function setupModeToggle(buttonId: string, opts: ModeToggleOptions): ModeToggleHandle {
  const actions = document.querySelector(".be-actions");
  if (!actions) {
    return { isActive: () => false, setActive: () => {}, dispose: () => {} };
  }
  let btn = actions.querySelector<HTMLButtonElement>(`#${buttonId}`);
  if (!btn) {
    btn = document.createElement("button");
    btn.id = buttonId;
    btn.className = "be-btn";
    actions.appendChild(btn);
  }
  // Replace listeners by cloning so re-entering a stage doesn't stack handlers.
  const fresh = btn.cloneNode(true) as HTMLButtonElement;
  btn.replaceWith(fresh);
  btn = fresh;

  let active = false;

  const refresh = () => {
    if (!btn) return;
    btn.textContent = active ? opts.onLabel : opts.offLabel;
    btn.title = (active ? opts.onTitle : opts.offTitle) ?? "";
    btn.style.background = active ? (opts.onBackground ?? "rgba(125,211,252,0.18)") : "";
    btn.style.borderColor = active ? (opts.onColor ?? "var(--accent)") : "";
    btn.style.color = active ? (opts.onColor ?? "var(--accent)") : (opts.offColor ?? "");
  };
  refresh();

  btn.onclick = () => {
    active = !active;
    refresh();
    opts.onChange?.(active);
    opts.click?.();
  };

  return {
    isActive: () => active,
    setActive: (v: boolean) => {
      if (active === v) return;
      active = v;
      refresh();
      opts.onChange?.(active);
    },
    dispose: () => {
      if (btn?.parentNode) btn.parentNode.removeChild(btn);
      btn = null;
    },
  };
}
