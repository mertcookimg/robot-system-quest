// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Prevent mobile long presses from opening browser save/download menus while
 * preserving native editing menus for form controls.
 */
export function setupTouchCalloutGuard(): void {
  const coarsePrimaryPointer = window.matchMedia("(hover: none) and (pointer: coarse)");

  document.addEventListener("contextmenu", (event) => {
    if (!coarsePrimaryPointer.matches) return;

    const target = event.target;
    if (target instanceof Element && target.closest(EDITABLE_SELECTOR)) return;

    event.preventDefault();
  });
}
