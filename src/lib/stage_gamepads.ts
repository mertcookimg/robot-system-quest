// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { isStageInteractionBlocked } from "./input_guard";

// Stage-local button edges must not replay a press already handled by a dialog.
// Keep the mask until release, including across stage initialization and Retry.
const consumed = new Map<number, { id: string; buttons: Set<number> }>();

function snapshot(): (Gamepad | null)[] {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const [index, entry] of consumed) {
    const pad = pads.find((candidate) => candidate?.index === index);
    if (!pad || !pad.connected || pad.id !== entry.id) {
      consumed.delete(index);
      continue;
    }
    for (const button of entry.buttons) {
      const state = pad.buttons[button];
      if (!state || (!state.pressed && state.value === 0)) entry.buttons.delete(button);
    }
    if (entry.buttons.size === 0) consumed.delete(index);
  }
  return pads;
}

/** Called by the shell whenever UI or another window owns stage input. */
export function consumeStageGamepadButtons(): void {
  for (const pad of snapshot()) {
    if (!pad?.connected) continue;
    const buttons = consumed.get(pad.index)?.buttons ?? new Set<number>();
    pad.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0) buttons.add(index);
    });
    if (buttons.size) consumed.set(pad.index, { id: pad.id, buttons });
  }
}

/** Keep controller metadata while UI captures input and consume held UI buttons. */
export function readStageGamepads(): (Gamepad | null)[] {
  const blocked = isStageInteractionBlocked();
  return snapshot().map((pad) => {
    if (!pad) return null;
    const entry = consumed.get(pad.index);
    if (!blocked && !entry) return pad;
    return {
      ...pad,
      id: pad.id,
      index: pad.index,
      connected: pad.connected,
      mapping: pad.mapping,
      timestamp: pad.timestamp,
      axes: blocked ? pad.axes.map(() => 0) : pad.axes,
      vibrationActuator: pad.vibrationActuator,
      buttons: pad.buttons.map((button, index) =>
        blocked || entry?.buttons.has(index)
          ? { pressed: false, touched: false, value: 0 }
          : button,
      ),
    };
  });
}
