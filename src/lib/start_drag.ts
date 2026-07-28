// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Helper that makes a START marker movable by both mouse dragging and the
// controller's MOVE-START mode. Intended for free-form experiment stages such
// as feedforward_controller and feedback_controller.
//
// Provides:
//   - Marker dragging via canvas mousedown/move/up events
//   - A "🤖 START position" toggle in the block editor's .be-actions
//   - START movement from WASD/arrow input in `g.keys` while the toggle is on
//   - START circle and direction-arrow rendering with hover/drag highlighting
//
// Usage:
//   const sd = setupStartDrag(g, START, { onChange: () => snapRobot() });
//   // update: sd.tick(dt);   // Move START only while MOVE-START is active.
//   // draw:   sd.draw(c);    // Draw the marker.
//   // dispose: sd.dispose();

import type { GameContext } from "../types";
import { setBlockpadGamepadDisabled } from "./blockpad";

export interface StartPose {
  x: number;
  y: number;
  theta: number;
}

export interface StartDragOptions {
  /** Robot radius, used to calculate clearance from canvas edges. Default: 14. */
  robotR?: number;
  /** Hit-test radius. Default: 22. */
  hitR?: number;
  /** Marker circle radius. Default: 18. */
  drawR?: number;
  /** Movement speed in MOVE-START mode, in px/s. Default: 240. */
  speed?: number;
  /** Returns true while the stage is running, when dragging and movement are disabled. */
  isRunning?: () => boolean;
  /** Called when START changes, for example to snap the robot position and theta. */
  onChange?: () => void;
  /** Optional status-bar text, expected to be an i18n key. */
  statusOn?: string;
  statusOff?: string;
  /** Toggle-button label. */
  labelOn?: string;
  labelOff?: string;
  /** Button title attribute. */
  titleOn?: string;
  titleOff?: string;
}

export interface StartDragHandle {
  /** Call in MOVE-START mode to move START by dt seconds. */
  tick(dt: number, w: number, h: number): void;
  /** Draws the marker; safe to call at all times. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Whether a mouse drag is in progress. */
  isDragging(): boolean;
  /** Whether MOVE-START mode is active. */
  isMoveMode(): boolean;
  /** Whether highlighted by hovering, dragging, or move mode. */
  isHot(): boolean;
  dispose(): void;
}

export function setupStartDrag(
  g: GameContext,
  start: StartPose,
  opts: StartDragOptions = {},
): StartDragHandle {
  const robotR = opts.robotR ?? 14;
  const hitR = opts.hitR ?? 22;
  const drawR = opts.drawR ?? 18;
  const speed = opts.speed ?? 240;
  const isRunning = opts.isRunning ?? (() => false);

  let dragging = false;
  let hover = false;
  let moveMode = false;
  let toggleBtn: HTMLButtonElement | null = null;

  // ---- canvas drag -----------------------------------------------------
  function canvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = g.canvas.getBoundingClientRect();
    const sx = g.canvas.width / rect.width;
    const sy = g.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function isOver(p: { x: number; y: number }): boolean {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    return dx * dx + dy * dy <= hitR * hitR;
  }
  function snapStart() {
    opts.onChange?.();
  }
  function onDown(e: MouseEvent) {
    if (e.button !== 0 || isRunning()) return;
    if (!isOver(canvasCoords(e))) return;
    dragging = true;
    g.canvas.style.cursor = "grabbing";
  }
  function onMove(e: MouseEvent) {
    const p = canvasCoords(e);
    if (dragging) {
      start.x = Math.max(robotR, Math.min(g.canvas.width - robotR, p.x));
      start.y = Math.max(robotR, Math.min(g.canvas.height - robotR, p.y));
      if (!isRunning()) snapStart();
      return;
    }
    const over = !isRunning() && isOver(p);
    if (over !== hover) {
      hover = over;
      g.canvas.style.cursor = over ? "grab" : "";
    }
  }
  function onUp() {
    if (dragging) {
      dragging = false;
      g.canvas.style.cursor = hover ? "grab" : "";
    }
  }
  g.canvas.addEventListener("mousedown", onDown);
  g.canvas.addEventListener("mousemove", onMove);
  g.canvas.addEventListener("mouseup", onUp);
  g.canvas.addEventListener("mouseleave", onUp);

  // ---- block-editor toggle button --------------------------------------
  function setupBtn() {
    const actions = document.querySelector(".be-actions");
    if (!actions) return;
    let btn = actions.querySelector<HTMLButtonElement>("#be-move-start");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "be-move-start";
      btn.className = "be-btn";
      actions.appendChild(btn);
    }
    const fresh = btn.cloneNode(true) as HTMLButtonElement;
    btn.replaceWith(fresh);
    toggleBtn = fresh;
    refreshBtn();
    toggleBtn.onclick = () => toggle();
  }
  function refreshBtn() {
    if (!toggleBtn) return;
    toggleBtn.textContent = moveMode
      ? (opts.labelOn ?? "✋ START 移動中 (LT)")
      : (opts.labelOff ?? "🤖 START 位置 (LT)");
    toggleBtn.title = moveMode
      ? (opts.titleOn ?? "もう一度押す or 🎮 LT で確定。WASD / 矢印 / パッドで動かす")
      : (opts.titleOff ?? "START 位置を動かす (🎮 LT でも切替)");
    toggleBtn.style.background = moveMode ? "rgba(251,191,36,0.20)" : "";
    toggleBtn.style.borderColor = moveMode ? "var(--warn)" : "";
    toggleBtn.style.color = moveMode ? "var(--warn)" : "";
  }
  function toggle() {
    moveMode = !moveMode;
    setBlockpadGamepadDisabled(moveMode);
    refreshBtn();
    if (moveMode && !isRunning()) snapStart();
    if (opts.statusOn && opts.statusOff) {
      g.setStatus(
        moveMode ? opts.statusOn : opts.statusOff,
        moveMode ? "var(--accent)" : "var(--ok)",
      );
    }
    g.sfx.click();
  }
  setupBtn();

  // ---- public handle ---------------------------------------------------
  return {
    tick(dt: number, w: number, h: number) {
      if (!moveMode || isRunning()) return;
      let dx = 0,
        dy = 0;
      const k = g.keys;
      if (k.has("a") || k.has("arrowleft")) dx -= 1;
      if (k.has("d") || k.has("arrowright")) dx += 1;
      if (k.has("w") || k.has("arrowup")) dy -= 1;
      if (k.has("s") || k.has("arrowdown")) dy += 1;
      if (dx === 0 && dy === 0) return;
      start.x = Math.max(robotR, Math.min(w - robotR, start.x + dx * speed * dt));
      start.y = Math.max(robotR, Math.min(h - robotR, start.y + dy * speed * dt));
      snapStart();
    },
    draw(ctx: CanvasRenderingContext2D) {
      const hot = (hover || dragging || moveMode) && !isRunning();
      ctx.save();
      const stroke = hot ? "rgba(251, 191, 36, 0.95)" : "rgba(125, 211, 252, 0.55)";
      ctx.strokeStyle = stroke;
      ctx.lineWidth = hot ? 2 : 1;
      ctx.setLineDash(hot ? [] : [4, 4]);
      ctx.beginPath();
      ctx.arc(start.x, start.y, drawR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Initial direction arrow (theta=0 points right). Add save+rotate to support rotation.
      ctx.beginPath();
      ctx.moveTo(start.x - 6, start.y);
      ctx.lineTo(start.x + 12, start.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(start.x + 12, start.y);
      ctx.lineTo(start.x + 7, start.y - 4);
      ctx.lineTo(start.x + 7, start.y + 4);
      ctx.closePath();
      ctx.fillStyle = stroke;
      ctx.fill();
      ctx.fillStyle = hot ? "#fbbf24" : "rgba(125, 211, 252, 0.65)";
      ctx.font = "700 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(hot ? "START · drag OK · →" : "START · → · drag to move", start.x, start.y - 24);
      ctx.restore();
    },
    isDragging() {
      return dragging;
    },
    isMoveMode() {
      return moveMode;
    },
    isHot() {
      return (hover || dragging || moveMode) && !isRunning();
    },
    dispose() {
      g.canvas.removeEventListener("mousedown", onDown);
      g.canvas.removeEventListener("mousemove", onMove);
      g.canvas.removeEventListener("mouseup", onUp);
      g.canvas.removeEventListener("mouseleave", onUp);
      g.canvas.style.cursor = "";
      if (toggleBtn?.parentNode) toggleBtn.parentNode.removeChild(toggleBtn);
      toggleBtn = null;
      setBlockpadGamepadDisabled(false);
    },
  };
}
