// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Main requestAnimationFrame loop. Polls input, ticks the current stage,
// renders the topic monitor + ambient layer.

import * as input from "./input";
import * as gamepad from "./gamepad";
import * as topicMonitor from "./topic_monitor";
import * as ambient from "./ambient";
import * as crash from "./crash";
import * as stageManager from "./stage_manager";
import { isStageInteractionBlocked } from "../lib/input_guard";
import { releaseStageInputs } from "./input_reset";
import { beginCanvasReadoutFrame, endCanvasReadoutFrame } from "../lib/canvas_readout";
import { ui } from "./dom";
import { isNavpadActive, pollNavpad } from "../lib/navpad";

const MAX_DT = 0.05;

export function startLoop(): void {
  let last = performance.now();
  function tick(): void {
    const now = performance.now();
    const dt = Math.min(MAX_DT, (now - last) / 1000);
    last = now;

    // Wrap stage ticks in try/catch — a single throwing stage shouldn't
    // freeze the canvas or desync overlays. The rAF is requeued either way.
    try {
      const wasGated = isStageInteractionBlocked();
      gamepad.poll();

      // A press used to close a dialog is consumed for this whole frame.
      const gated = wasGated || isStageInteractionBlocked();
      if (gated) releaseStageInputs();

      // Navpad runs even with no gamepad (keyboard-only). Polled outside
      // gamepad.poll() so it gets called every frame.
      if (!gated && isNavpadActive()) {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        let pad: Gamepad | null = null;
        for (const p of pads) {
          if (p) {
            pad = p;
            break;
          }
        }
        pollNavpad(pad);
      }

      input.syncKeys();

      const stage = stageManager.getCurrent();
      // Menus, help, completion and terminal interaction pause timers/physics
      // as well as raw per-stage gamepad readers. Drawing remains available.
      if (!gated && !crash.consumeHitStop(dt)) {
        stage.update(dt);
      }
      beginCanvasReadoutFrame();
      try {
        stage.draw();
      } finally {
        endCanvasReadoutFrame();
      }
      topicMonitor.render(ui.topic);
      ambient.tick(dt);
    } catch (err) {
      console.error("[tick] error:", err);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
