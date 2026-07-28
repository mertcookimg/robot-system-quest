// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Centralized localStorage keys + tiny JSON helpers.
// Keep version suffixes in sync with the keys that already exist in users'
// browsers so we don't accidentally wipe progress. Bump the version only when
// the schema for that key changes.

export const StorageKeys = {
  rankings: "robot_quest_rankings_v2",
  ghosts: "robot_quest_ghosts_v2",
  progress: "robot_quest_progress_v5",
  lessonSeen: "robot_quest_lesson_seen_v1",
  audio: "robot_audio",
  ghostOn: "robot_ghost",
  mode: "robot_mode",
  lang: "robot_quest_lang_v1",
} as const;

export type StorageValidator<T> = (value: unknown) => value is T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function removeInvalidValue(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable (for example in a sandboxed iframe).
  }
}

export function loadJson<T>(key: string, fallback: T, isValid: StorageValidator<T>): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    if (isValid(value)) return value;
  } catch {
    // Malformed JSON or unavailable storage falls back safely.
  }
  removeInvalidValue(key);
  return fallback;
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled: silently drop.
  }
}

export function loadString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}
