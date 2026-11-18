// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Web Audio API based sound effects. All tones are synthesized at runtime,
// so the bundle ships with zero audio assets. The AudioContext is created only
// after a user gesture and resumed if the browser suspended it.

import { StorageKeys, loadString, saveString } from "./storage";

let ac: AudioContext | null = null;
let on = loadString(StorageKeys.audio) !== "off";

export interface SfxBank {
  pickup(): void;
  deliver(): void;
  clear(): void;
  bump(): void;
  click(): void;
  hover(): void;
  start(): void;
  victory(): void;
  crash(): void;
}

// Browsers start an AudioContext created before any user gesture in the
// "suspended" state and keep it silent until resume() is called after one.
// Track activation ourselves so the startup stage load (which plays a click)
// does not create a context that stays muted for the whole session.
let userActivated = false;

function hasUserActivation(): boolean {
  if (userActivated) return true;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
    .userActivation;
  return activation?.hasBeenActive === true;
}

function resumeIfSuspended(): void {
  if (ac?.state === "suspended") void ac.resume().catch(() => {});
}

function onUserGesture(): void {
  userActivated = true;
  resumeIfSuspended();
}

if (typeof window !== "undefined") {
  for (const type of ["pointerdown", "keydown", "touchend"]) {
    window.addEventListener(type, onUserGesture, { capture: true, passive: true });
  }
}

function ensureAudio(): AudioContext | null {
  if (!on) return null;
  if (!ac) {
    if (!hasUserActivation()) return null;
    try {
      ac = new AudioContext();
    } catch {
      return null;
    }
  }
  resumeIfSuspended();
  return ac;
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", gain = 0.06): void {
  const c = ensureAudio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + dur);
}

function arpeggio(
  freqs: number[],
  step = 0.07,
  type: OscillatorType = "triangle",
  gain = 0.07,
): void {
  freqs.forEach((f, i) => setTimeout(() => tone(f, 0.2, type, gain), i * step * 1000));
}

export const sfx: SfxBank = {
  pickup: () => tone(880, 0.08, "triangle", 0.05),
  deliver: () => arpeggio([523, 659, 784], 0.05, "triangle", 0.07),
  clear: () => arpeggio([523, 659, 784, 1046], 0.08, "sine", 0.06),
  bump: () => tone(110, 0.04, "sawtooth", 0.04),
  click: () => tone(1200, 0.025, "square", 0.02),
  hover: () => tone(1800, 0.018, "sine", 0.01),
  start: () => arpeggio([392, 523, 659, 784, 1046], 0.07, "triangle", 0.08),
  victory: () => {
    arpeggio([523, 659, 784, 1046, 1318, 1568], 0.09, "triangle", 0.07);
    setTimeout(() => arpeggio([523, 784, 1046], 0.0, "sine", 0.05), 700);
  },
  crash: () => {
    tone(220, 0.1, "sawtooth", 0.08);
    setTimeout(() => tone(140, 0.16, "sawtooth", 0.09), 70);
    setTimeout(() => tone(70, 0.22, "sawtooth", 0.07), 180);
  },
};

export function isAudioOn(): boolean {
  return on;
}

/**
 * Wire the audio toggle button. Clicking flips on/off, persists, and
 * eagerly creates the AudioContext on the click (counts as user gesture).
 */
export function setupAudio(toggleEl: HTMLElement): void {
  const sync = () => {
    toggleEl.textContent = on ? "ON" : "OFF";
    toggleEl.classList.toggle("muted", !on);
    const label = `Sound: ${on ? "ON" : "OFF"} — toggle / サウンド: ${on ? "ON" : "OFF"} — 切り替え`;
    toggleEl.title = label;
    toggleEl.setAttribute("aria-label", label);
    toggleEl.setAttribute("aria-pressed", String(on));
  };
  sync();
  toggleEl.addEventListener("click", () => {
    on = !on;
    sync();
    saveString(StorageKeys.audio, on ? "on" : "off");
    if (on) ensureAudio();
    sfx.click();
  });
}

/** Idempotent: ensures AudioContext exists (e.g. on intro start). */
export function startAudio(): void {
  ensureAudio();
}
