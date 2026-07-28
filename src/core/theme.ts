// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// ─────────────────────────────────────────────────────────────────────────
//  THE ONE PLACE TO CHANGE BACKGROUND COLORS.
//
//  Every background / ground color in the app (page chrome, game canvas,
//  stage floor, panels, terminal, modal scrims) resolves to a token below.
//  Edit a value here and it applies everywhere — no more hunting through CSS
//  files and stage code.
//
//  How it reaches the rest of the app:
//    - CSS side: applyThemeVars() writes each token to a CSS custom property
//      on :root (--bg, --canvas-bg, --term-bg, …). Stylesheets read them via
//      var(--…). The values in 00-base.css :root are only pre-JS fallbacks.
//    - Canvas side: draw code reads the `theme` object directly
//      (ctx.fillStyle = theme.floor), and uses withA() for translucent fills.
//
//  Scope: this file owns the BACKGROUND family only. Accent / text / ok-warn-
//  danger colors still live in lib/draw.ts + the --accent etc. CSS vars.
// ─────────────────────────────────────────────────────────────────────────

export const theme = {
  // ── Page chrome (mirrored to --bg / --bg-2 / --panel / --panel-2) ──
  bg: "#000000", // body background
  bg2: "#000000", // secondary page background
  panel: "#000000", // panel surface
  panel2: "#181f3a", // raised panel surface

  // ── Game canvas ──
  canvasBg: "#000000", // the backdrop cleared behind every stage each frame
  canvasPanel: "#0a0f1f", // dark sub-panels drawn on the canvas (inspectors)
  rightPane: "#070b18", // right-hand pane on split-view stages
  floor: "#1a2138", // top-down map floor

  // ── Terminal ──
  termBg: "#000000", // terminal frame / header / input row
  termBodyBg: "#000000", // scrolling body (behind the log text)

  // ── Translucent dark base for modal backdrops + canvas HUD panels ──
  // Used with an alpha: rgba(var(--scrim-rgb), 0.85) in CSS, withA(theme.scrim,…)
  // on the canvas.
  scrim: "#080c1c",
};

export type Theme = typeof theme;

/** "#rrggbb" → "r, g, b" for use inside rgba(var(--scrim-rgb), α). */
function rgbTriple(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}

/** Compose an rgba() string from a theme hex + alpha (canvas use). */
export function withA(hex: string, alpha: number): string {
  return `rgba(${rgbTriple(hex)}, ${alpha})`;
}

/** Push the token values onto :root as CSS custom properties. */
export function applyThemeVars(): void {
  if (typeof document === "undefined") return;
  const r = document.documentElement.style;
  r.setProperty("--bg", theme.bg);
  r.setProperty("--bg-2", theme.bg2);
  r.setProperty("--panel", theme.panel);
  r.setProperty("--panel-2", theme.panel2);
  r.setProperty("--canvas-bg", theme.canvasBg);
  r.setProperty("--term-bg", theme.termBg);
  r.setProperty("--term-body-bg", theme.termBodyBg);
  r.setProperty("--scrim-rgb", rgbTriple(theme.scrim));
}

// Apply on import so the CSS variables are set no matter which module pulls
// the theme in first (draw.ts imports it very early via the stage registry).
applyThemeVars();
