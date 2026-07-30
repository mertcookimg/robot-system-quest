// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Makes existing canvas mouse interactions work reliably with direct touch.
// Pointer capture keeps a drag alive even when the finger leaves the canvas,
// which is required by wiring, goal placement, arm, and image-processing stages.

const TOUCH_MOUSE_SOURCE = 42;

/** Keep a canvas-space hit radius finger-friendly after responsive scaling. */
export function canvasInteractionRadius(
  canvas: HTMLCanvasElement,
  defaultRadius: number,
  minimumCssRadius: number,
): number {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    !window.matchMedia("(any-pointer: coarse)").matches
  ) {
    return defaultRadius;
  }
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return defaultRadius;
  const canvasPerCssPixel = Math.max(canvas.width / rect.width, canvas.height / rect.height);
  return Math.max(defaultRadius, minimumCssRadius * canvasPerCssPixel);
}

function dispatchMouse(
  canvas: HTMLCanvasElement,
  type: "mousedown" | "mousemove" | "mouseup" | "mouseleave",
  event: PointerEvent,
): void {
  canvas.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 0,
      buttons: type === "mouseup" || type === "mouseleave" ? 0 : 1,
      detail: TOUCH_MOUSE_SOURCE,
      view: window,
    }),
  );
}

export function setupCanvasTouch(canvas: HTMLCanvasElement): void {
  canvas.classList.add("touch-interactive");
  let activePointer: number | null = null;

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" || activePointer !== null) return;
      event.preventDefault();
      activePointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      // Cursor-driven stages must see the current tap position before acting.
      dispatchMouse(canvas, "mousemove", event);
      dispatchMouse(canvas, "mousedown", event);
    },
    { passive: false },
  );

  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerId !== activePointer) return;
      event.preventDefault();
      dispatchMouse(canvas, "mousemove", event);
    },
    { passive: false },
  );

  const finish = (event: PointerEvent, cancelled: boolean) => {
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    dispatchMouse(canvas, cancelled ? "mouseleave" : "mouseup", event);
    activePointer = null;
  };
  canvas.addEventListener("pointerup", (event) => finish(event, false), { passive: false });
  canvas.addEventListener("pointercancel", (event) => finish(event, true), { passive: false });
  canvas.addEventListener("lostpointercapture", (event) => {
    if (event.pointerId === activePointer) {
      dispatchMouse(canvas, "mouseleave", event);
      activePointer = null;
    }
  });
}
