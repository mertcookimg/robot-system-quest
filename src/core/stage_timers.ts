// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Timeouts created by a stage must not survive a stage transition. Keeping
// them in one registry lets loadStage() cancel delayed clear/crash callbacks
// before the next stage is initialized.

const pending = new Set<ReturnType<typeof setTimeout>>();

export type StageTimeout = ReturnType<typeof setTimeout>;

export function setStageTimeout(callback: () => void, delayMs: number): StageTimeout {
  const timeout = setTimeout(() => {
    pending.delete(timeout);
    callback();
  }, delayMs);
  pending.add(timeout);
  return timeout;
}

export function cancelStageTimeout(timeout: StageTimeout): void {
  clearTimeout(timeout);
  pending.delete(timeout);
}

export function clearStageTimeouts(): void {
  for (const timeout of pending) clearTimeout(timeout);
  pending.clear();
}
