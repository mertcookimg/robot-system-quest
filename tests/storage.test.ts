// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { getPose, loadGhostFor } from "../src/core/ghost";
import { loadProgress } from "../src/core/progress";
import { getTopTimes } from "../src/core/rankings";
import { StorageKeys, isRecord, loadJson, loadString, saveString } from "../src/core/storage";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const storage = new MemoryStorage();

function setGlobalStorage(value: Storage): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  storage.clear();
  setGlobalStorage(storage);
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("invalid progress data falls back and is removed", () => {
  storage.setItem(StorageKeys.progress, "null");

  assert.deepEqual(loadProgress(), {});
  assert.equal(storage.getItem(StorageKeys.progress), null);
});

test("invalid ranking entries fall back and are removed", () => {
  storage.setItem(StorageKeys.rankings, JSON.stringify({ delivery: [12.5, null] }));

  assert.deepEqual(getTopTimes("delivery"), []);
  assert.equal(storage.getItem(StorageKeys.rankings), null);
});

test("invalid ghost data falls back and is removed", () => {
  storage.setItem(StorageKeys.ghosts, "null");

  loadGhostFor("delivery");

  assert.equal(getPose(0), undefined);
  assert.equal(storage.getItem(StorageKeys.ghosts), null);
});

test("malformed JSON falls back and is removed", () => {
  storage.setItem("broken", "{");

  assert.deepEqual(
    loadJson("broken", [], (value): value is string[] => Array.isArray(value)),
    [],
  );
  assert.equal(storage.getItem("broken"), null);
});

test("unavailable storage does not throw", () => {
  const unavailable = {
    getItem(): string | null {
      throw new DOMException("denied", "SecurityError");
    },
    setItem(): void {
      throw new DOMException("denied", "SecurityError");
    },
    removeItem(): void {
      throw new DOMException("denied", "SecurityError");
    },
  } as Storage;
  setGlobalStorage(unavailable);

  assert.equal(loadString(StorageKeys.lang), null);
  assert.doesNotThrow(() => saveString(StorageKeys.lang, "ja"));
  assert.deepEqual(loadJson("blocked", {}, isRecord), {});
});
