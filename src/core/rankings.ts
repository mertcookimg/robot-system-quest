// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Per-stage best-time leaderboard. Top 10 are persisted, top 5 surface in UI.

import { StorageKeys, isRecord, loadJson, saveJson } from "./storage";

type Rankings = Record<string, number[]>;

const MAX_KEEP = 10;

function isRankings(value: unknown): value is Rankings {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (times) =>
        Array.isArray(times) &&
        times.length <= MAX_KEEP &&
        times.every((time) => typeof time === "number" && Number.isFinite(time) && time > 0),
    )
  );
}

function load(): Rankings {
  return loadJson(StorageKeys.rankings, {}, isRankings);
}

export interface SaveResult {
  rank: number; // 1-based position of the just-saved time within the kept list
  isBest: boolean; // true if this is the new #1
}

export function saveTime(stageId: string, time: number): SaveResult {
  const all = load();
  const arr = all[stageId] ?? [];
  const wasEmpty = arr.length === 0;
  const prevBest = arr[0];
  arr.push(time);
  arr.sort((a, b) => a - b);
  all[stageId] = arr.slice(0, MAX_KEEP);
  saveJson(StorageKeys.rankings, all);
  return {
    rank: arr.indexOf(time) + 1,
    isBest: wasEmpty || time < prevBest,
  };
}

export function getTopTimes(stageId: string, n = 5): number[] {
  const all = load();
  return (all[stageId] ?? []).slice(0, n);
}

export function getBestTime(stageId: string): number | undefined {
  return getTopTimes(stageId, 1)[0];
}
