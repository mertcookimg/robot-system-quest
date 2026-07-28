// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Per-stage star rating (0..3). Stored as "highest ever achieved", never decreases.

import { StorageKeys, isRecord, loadJson, saveJson } from "./storage";

export type Progress = Record<string, { stars: number }>;

function isProgress(value: unknown): value is Progress {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.stars === "number" &&
        Number.isInteger(entry.stars) &&
        entry.stars >= 0 &&
        entry.stars <= 3,
    )
  );
}

export function loadProgress(): Progress {
  return loadJson(StorageKeys.progress, {}, isProgress);
}

/** Returns true when this is a new personal best for the stage. */
export function saveProgress(stageId: string, stars: number): boolean {
  const p = loadProgress();
  const cur = p[stageId]?.stars ?? 0;
  const next = Math.max(cur, stars);
  p[stageId] = { stars: next };
  saveJson(StorageKeys.progress, p);
  return stars > cur;
}

export function isAllCleared(stageIds: readonly string[]): boolean {
  const p = loadProgress();
  return stageIds.every((id) => (p[id]?.stars ?? 0) > 0);
}

export function totalStars(stageIds: readonly string[]): number {
  const p = loadProgress();
  return stageIds.reduce((acc, id) => acc + (p[id]?.stars ?? 0), 0);
}
