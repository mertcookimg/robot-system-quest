// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Browsers keep an AudioContext created before any user gesture suspended.
// The startup stage load plays a click, so the context must wait for a
// gesture and be resumed instead of staying silent for the whole session.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: AudioContextState = "suspended";
  resumes = 0;
  currentTime = 0;
  destination = {};
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume(): Promise<void> {
    this.resumes++;
    this.state = "running";
    return Promise.resolve();
  }
  createGain() {
    return { gain: param(), connect: (target: unknown) => target };
  }
  createOscillator() {
    return {
      type: "sine",
      frequency: param(),
      connect: (target: unknown) => target,
      start() {},
      stop() {},
    };
  }
}

const saved = new Map<string, PropertyDescriptor | undefined>();
let audio: typeof import("../src/core/audio");

before(async () => {
  for (const [key, value] of Object.entries({
    window: new EventTarget(),
    AudioContext: FakeAudioContext,
  })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  audio = await import("../src/core/audio.ts");
});

after(() => {
  for (const [key, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("sounds before a user gesture do not create a context that stays suspended", () => {
  audio.sfx.click();
  audio.startAudio();
  assert.equal(FakeAudioContext.instances.length, 0);
});

test("the first gesture enables sound and a suspended context is resumed", () => {
  window.dispatchEvent(new Event("pointerdown"));
  audio.sfx.click();
  assert.equal(FakeAudioContext.instances.length, 1);
  const context = FakeAudioContext.instances[0];
  assert.equal(context.resumes, 1);
  assert.equal(context.state, "running");

  // A browser may suspend the context again (e.g. background tab).
  context.state = "suspended";
  window.dispatchEvent(new Event("keydown"));
  assert.equal(context.resumes, 2);
  assert.equal(context.state, "running");
  assert.equal(FakeAudioContext.instances.length, 1, "The context is created only once");
});
