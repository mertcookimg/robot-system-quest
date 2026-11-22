// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import { createCameraMission, MAP_W, MAP_H } from "../src/lib/camera_mission.ts";
import { theme, getTheme, setTheme } from "../src/core/theme.ts";
import type { GameContext } from "../src/types.ts";

test("light map colors do not alter the camera input used by detection lessons", () => {
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  const oldFloor = theme.floor;
  const oldTheme = getTheme();
  const random = Math.random;
  const canvases: Array<{ floor: string }> = [];
  const pixels = (width: number, height: number) => ({
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  });
  // A flat-floor raster is enough to exercise actual perspective sampling.
  // Ignore overlaid shapes; record each canvas's full-size background fill.
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: { dataset: {}, style: { setProperty() {} } },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement() {
        const canvas = { floor: "", width: 0, height: 0 };
        canvases.push(canvas);
        const state = {
          fillStyle: "",
          fillRect(x: number, y: number, width: number, height: number) {
            if (x === 0 && y === 0 && width === MAP_W && height === MAP_H)
              canvas.floor = this.fillStyle;
          },
          getImageData(_x: number, _y: number, width: number, height: number) {
            const image = pixels(width, height);
            const rgb = [1, 3, 5].map((offset) =>
              parseInt(canvas.floor.slice(offset, offset + 2), 16),
            );
            for (let i = 0; i < image.data.length; i += 4) image.data.set([...rgb, 255], i);
            return image;
          },
          createImageData: pixels,
        };
        const context = new Proxy(state, {
          get(target, key) {
            return Reflect.get(target, key) ?? (() => {});
          },
        });
        return Object.assign(canvas, { getContext: () => context });
      },
    },
  });
  Math.random = () => 0.5;
  try {
    setTheme("light");
    const mission = createCameraMission({
      targets: [{ x: 100, y: 100, r: 12, color: "#5eead4", label: "TARGET" }],
    });
    mission.enter({} as GameContext);
    theme.floor = "#e8eff7";
    mission.reset();
    const firstInput = mission.captureCamera().slice();
    assert.equal(canvases[0].floor, "#1a2138");
    assert.equal(canvases[1].floor, "#e8eff7");
    theme.floor = "#ffffff";
    mission.reset();
    assert.equal(canvases[1].floor, "#ffffff");
    assert.deepEqual(mission.captureCamera(), firstInput);
    assert.ok(firstInput.some((value, i) => i % 4 !== 3 && value > 0));
    mission.robot.x = 123;
    mission.captured[0] = true;
    const runningInput = mission.captureCamera().slice();
    setTheme("dark");
    assert.equal(canvases[1].floor, theme.floor, "An active cached map repaints on toggle");
    assert.equal(mission.robot.x, 123);
    assert.equal(mission.capturedCount(), 1);
    assert.deepEqual(mission.captureCamera(), runningInput);
    mission.leave();
    const disposedFloor = canvases[1].floor;
    setTheme("light");
    assert.equal(canvases[1].floor, disposedFloor, "Disposed stages remove the theme listener");
  } finally {
    setTheme(oldTheme);
    theme.floor = oldFloor;
    Math.random = random;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
