// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Shared by the shell and stages that read raw keyboard/gamepad input.
// No game DOM is required at module load, so Guide previews can import it.
let windowActive = true;

export function isPageInactive(): boolean {
  return !windowActive || document.hidden;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  return !!(target as Element | null)?.closest?.(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
}

export function ownsNativeKey(event: KeyboardEvent): boolean {
  if (isTypingTarget(event.target)) return true;
  return (
    (event.key === "Enter" || event.key === " ") &&
    !!(event.target as Element | null)?.closest?.("button, a[href], summary")
  );
}

export function isTerminalFocused(): boolean {
  return !!document.activeElement?.closest("#ros-terminal");
}

export function isStageInteractionBlocked(): boolean {
  return (
    isPageInactive() ||
    isTerminalFocused() ||
    !!document.querySelector(
      "#intro-screen.show, #lesson-modal.show, #help-modal.show, #clear-overlay.show, " +
        "#allclear-screen.show, body.stage-menu-open, #terminal-pad-palette",
    )
  );
}

export function setupInputGuard(release: () => void): () => void {
  windowActive = true;
  const blur = () => {
    windowActive = false;
    release();
  };
  const focus = () => {
    windowActive = true;
    release();
  };
  const visibility = () => {
    if (document.hidden) release();
  };
  const focusIn = (event: FocusEvent) => {
    if (isTypingTarget(event.target) || isTerminalFocused()) release();
  };
  window.addEventListener("blur", blur);
  window.addEventListener("focus", focus);
  document.addEventListener("visibilitychange", visibility);
  document.addEventListener("focusin", focusIn);
  return () => {
    window.removeEventListener("blur", blur);
    window.removeEventListener("focus", focus);
    document.removeEventListener("visibilitychange", visibility);
    document.removeEventListener("focusin", focusIn);
    windowActive = true;
  };
}
