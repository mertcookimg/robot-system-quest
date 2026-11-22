// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Keep only the top dialog interactive, including dialogs nested in the scene.
// Restore the previous inert states before switching dialogs so completed lab
// panels and intentionally disabled controls retain their own state.
const dialogs: HTMLElement[] = [];
const background = new Map<HTMLElement, boolean>();
let observer: MutationObserver | undefined;

function restoreBackground(): void {
  for (const [element, inert] of background) element.inert = inert;
  background.clear();
}

function blockBackground(): void {
  const top = dialogs.filter((element) => element.isConnected).at(-1);
  if (!top) return;
  for (let branch: HTMLElement = top; branch.parentElement; branch = branch.parentElement) {
    for (const sibling of branch.parentElement.children) {
      if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
      background.set(sibling, sibling.inert);
      sibling.inert = true;
    }
    if (branch.parentElement === document.body) break;
  }
}

export function setDialogVisible(dialog: HTMLElement, visible: boolean): void {
  observer?.disconnect();
  restoreBackground();
  const index = dialogs.indexOf(dialog);
  if (index >= 0) dialogs.splice(index, 1);
  dialog.inert = !visible;
  dialog.setAttribute("aria-hidden", String(!visible));
  if (visible) dialogs.push(dialog);
  blockBackground();

  // Lazy stages and responsive layouts can add or move body-level controls
  // while Home/Help is open. They must inherit the same background isolation.
  const Observer = dialog.ownerDocument.defaultView?.MutationObserver;
  if (dialogs.length && Observer) {
    observer ??= new Observer(() => {
      restoreBackground();
      blockBackground();
    });
    observer.observe(dialog.ownerDocument.body, { childList: true });
  }
}

export function restoreDialogFocus(previous: HTMLElement | null, fallback?: HTMLElement): void {
  const available = (element: HTMLElement | null | undefined): element is HTMLElement =>
    !!element?.isConnected &&
    !element.matches(":disabled") &&
    !element.closest("[hidden], [inert]");
  const target = available(previous) ? previous : available(fallback) ? fallback : null;
  target?.focus({ preventScroll: true });
}
