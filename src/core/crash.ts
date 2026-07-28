// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// "Game over" overlay. A crash freezes stage updates briefly (hit-stop),
// shakes the screen, plays a stinger, and resets the stage after ~1.3s.

import { sfx } from "./audio";
import { cancelStageTimeout, setStageTimeout, type StageTimeout } from "./stage_timers";

interface Refs {
  overlay: HTMLElement;
  sub: HTMLElement;
  shake: () => void;
  onReset: () => void;
}

let refs: Refs | null = null;
let crashing = false;
let hitStop = 0;
let resetTimeout: StageTimeout | null = null;

export function setupCrash(r: Refs): void {
  refs = r;
}

export function isCrashing(): boolean {
  return crashing;
}

export function clearCrashOverlay(): void {
  if (resetTimeout !== null) {
    cancelStageTimeout(resetTimeout);
    resetTimeout = null;
  }
  if (!refs) return;
  refs.overlay.classList.remove("show");
  crashing = false;
  hitStop = 0;
}

export function trigger(reason?: string): void {
  if (!refs || crashing) return;
  crashing = true;
  hitStop = 0.15;
  refs.sub.textContent = reason ? `— ${reason} —` : "— restarting —";
  refs.overlay.classList.add("show");
  sfx.crash();
  refs.shake();
  resetTimeout = setStageTimeout(() => {
    resetTimeout = null;
    if (!refs) return;
    refs.overlay.classList.remove("show");
    refs.onReset();
    crashing = false;
  }, 1300);
}

/** Return the per-frame slice used by the main loop to gate stage updates. */
export function consumeHitStop(dt: number): boolean {
  if (hitStop <= 0) return false;
  hitStop = Math.max(0, hitStop - dt);
  return true;
}
