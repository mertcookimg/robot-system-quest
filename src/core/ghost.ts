// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Best-run "ghost" replay: while the player runs a stage we sample their pose
// at RECORD_HZ. When they beat their previous best we persist the run, and on
// subsequent attempts the ghost is rendered alongside the live robot.

import { StorageKeys, isRecord, loadJson, saveJson, loadString, saveString } from "./storage";

export interface PoseSnap {
  t: number;
  x: number;
  y: number;
  theta: number;
}

type GhostStore = Record<string, PoseSnap[]>;

const RECORD_HZ = 15;
const MAX_SAMPLES = 1500;

function isPoseSnap(value: unknown): value is PoseSnap {
  return (
    isRecord(value) &&
    typeof value.t === "number" &&
    Number.isFinite(value.t) &&
    typeof value.x === "number" &&
    Number.isFinite(value.x) &&
    typeof value.y === "number" &&
    Number.isFinite(value.y) &&
    typeof value.theta === "number" &&
    Number.isFinite(value.theta)
  );
}

function isGhostStore(value: unknown): value is GhostStore {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (recording) =>
        Array.isArray(recording) && recording.length <= MAX_SAMPLES && recording.every(isPoseSnap),
    )
  );
}

let currentRecording: PoseSnap[] = [];
let activeGhost: PoseSnap[] = [];
let lastRecordT = -1;
let on = loadString(StorageKeys.ghostOn) !== "off";

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function isGhostOn(): boolean {
  return on;
}

export function setupGhostToggle(toggleEl: HTMLElement, onClick?: () => void): void {
  const sync = () => {
    toggleEl.textContent = on ? "ON" : "OFF";
    toggleEl.classList.toggle("muted", !on);
    const label = `Ghost replay: ${on ? "ON" : "OFF"} — toggle / ゴースト再生: ${on ? "ON" : "OFF"} — 切替`;
    toggleEl.title = label;
    toggleEl.setAttribute("aria-label", label);
    toggleEl.setAttribute("aria-pressed", String(on));
  };
  sync();
  toggleEl.addEventListener("click", () => {
    on = !on;
    sync();
    saveString(StorageKeys.ghostOn, on ? "on" : "off");
    onClick?.();
  });
}

export function startRecording(): void {
  currentRecording = [];
  lastRecordT = -1;
}

export function recordPose(t: number, x: number, y: number, theta: number): void {
  if (t - lastRecordT < 1 / RECORD_HZ) return;
  lastRecordT = t;
  currentRecording.push({ t, x, y, theta });
  if (currentRecording.length > MAX_SAMPLES) currentRecording.shift();
}

/** Returns interpolated pose at time t, or undefined if no replay loaded. */
export function getPose(t: number): { x: number; y: number; theta: number } | undefined {
  if (!on) return undefined;
  const rec = activeGhost;
  if (rec.length === 0) return undefined;
  if (t <= rec[0].t) return { x: rec[0].x, y: rec[0].y, theta: rec[0].theta };
  if (t >= rec[rec.length - 1].t) {
    const last = rec[rec.length - 1];
    return { x: last.x, y: last.y, theta: last.theta };
  }
  // Linear scan is fine: even at MAX_SAMPLES this is cheap, and frames are
  // monotonic in t so a binary search is overkill.
  for (let i = 0; i < rec.length - 1; i++) {
    if (rec[i + 1].t > t) {
      const a = rec[i];
      const b = rec[i + 1];
      const f = (t - a.t) / (b.t - a.t);
      return {
        x: a.x + (b.x - a.x) * f,
        y: a.y + (b.y - a.y) * f,
        theta: a.theta + angleDiff(a.theta, b.theta) * f,
      };
    }
  }
  return undefined;
}

export function hasReplay(): boolean {
  return on && activeGhost.length > 0;
}

export function loadGhostFor(stageId: string): void {
  const all = loadJson(StorageKeys.ghosts, {}, isGhostStore);
  activeGhost = all[stageId] ?? [];
}

/** Save the current run as the new replay for the stage. */
export function saveCurrentAsBest(stageId: string): void {
  if (currentRecording.length === 0) return;
  const all = loadJson(StorageKeys.ghosts, {}, isGhostStore);
  all[stageId] = currentRecording;
  saveJson(StorageKeys.ghosts, all);
  activeGhost = currentRecording.slice();
}

export function getCurrentRecordingLength(): number {
  return currentRecording.length;
}
