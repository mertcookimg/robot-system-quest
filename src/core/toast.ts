// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Lightweight toast notifications (pinned to a container, auto-removed).

let container: HTMLElement | null = null;

export function setupToast(el: HTMLElement): void {
  container = el;
}

export function toast(title: string, body: string, ms = 4000): void {
  if (!container) return;
  const div = document.createElement("div");
  div.className = "toast";
  div.innerHTML = `<div class="toast-title">${title}</div><div class="toast-body">${body}</div>`;
  container.appendChild(div);
  setTimeout(() => div.remove(), ms);
}
