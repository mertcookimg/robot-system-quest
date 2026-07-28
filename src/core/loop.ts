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
import * as intro from "./intro";
import * as lessonModal from "./lesson_modal";
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
      gamepad.poll();

      // Navpad runs even with no gamepad (keyboard-only). Polled outside
      // gamepad.poll() so it gets called every frame.
      if (isNavpadActive()) {
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
      // Pause stage logic while a gating modal is open (intro / lesson).
      // Drawing still happens so the canvas isn't frozen visually, but
      // update() is skipped so timers and physics don't advance until
      // the player presses START / dismisses the popup.
      const gated = intro.isShown() || lessonModal.isOpen();
      if (!gated && !crash.consumeHitStop(dt)) {
        stage.update(dt);
      }
      stage.draw();
      topicMonitor.render(ui.topic);
      ambient.tick(dt);
    } catch (err) {
      console.error("[tick] error:", err);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
