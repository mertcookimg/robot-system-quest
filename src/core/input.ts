// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Input merge layer: keyboard + gamepad both write into separate sets, and
// the public `keys` set is their union. The split prevents one device from
// "releasing" a key that the other still holds (e.g. keyboard W held while a
// gamepad poll arrives that doesn't see the dpad pressed).

const kbKeys = new Set<string>();
const padKeys = new Set<string>();
const merged = new Set<string>();

export function getKeys(): ReadonlySet<string> {
  return merged;
}

export function setKbKey(key: string, held: boolean): void {
  if (held) kbKeys.add(key);
  else kbKeys.delete(key);
}

export function setPadKey(key: string, held: boolean): void {
  if (held) padKeys.add(key);
  else padKeys.delete(key);
}

export function clearKb(): void {
  kbKeys.clear();
}

export function clearPad(): void {
  padKeys.clear();
}

export function clearAll(): void {
  kbKeys.clear();
  padKeys.clear();
}

/** Recompute the public `keys` view. Must be called once per frame. */
export function syncKeys(): void {
  merged.clear();
  kbKeys.forEach((k) => merged.add(k));
  padKeys.forEach((k) => merged.add(k));
}
