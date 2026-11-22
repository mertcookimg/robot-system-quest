// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// ─────────────────────────────────────────────────────────────────────────
//  Shared light / dark palettes for CSS and Canvas 2D.
//
//  Page chrome, game canvases, stage floors, panels, terminals and modal
//  surfaces share the tokens below. Sensor pixels and scene artwork keep
//  their own colors independently of the interface palette.
//
//  How it reaches the rest of the app:
//    - CSS side: applyThemeVars() writes each token to a CSS custom property
//      on :root (--bg, --canvas-bg, --term-bg, …). Stylesheets read them via
//      var(--…). The values in 00-base.css :root are only pre-JS fallbacks.
//    - Canvas side: draw code reads the `theme` object directly
//      (ctx.fillStyle = theme.floor), and uses withA() for translucent fills.
//
//  Text and semantic colors are shared with lib/draw.ts so canvas labels and
//  HTML controls retain the same contrast against the light surfaces.
// ─────────────────────────────────────────────────────────────────────────

import { loadString, saveString, StorageKeys } from "./storage";

export type ThemeName = "light" | "dark";

const lightTheme = {
  // ── Page chrome (mirrored to --bg / --bg-2 / --panel / --panel-2) ──
  bg: "#f3f6fb", // body background
  bg2: "#eaf0f8", // secondary page background
  panel: "#ffffff", // panel surface
  panel2: "#edf3fb", // raised panel surface

  // ── Game canvas ──
  canvasBg: "#f8fafc", // the backdrop cleared behind every stage each frame
  canvasPanel: "#eef3fa", // sub-panels drawn on the canvas (inspectors)
  rightPane: "#f0f4fa", // right-hand pane on split-view stages
  floor: "#e8eff7", // top-down map floor

  // ── Terminal ──
  termBg: "#f1f5fb", // terminal frame / header / input row
  termBodyBg: "#ffffff", // scrolling body (behind the log text)

  // Translucent surfaces and the separate backdrop behind a modal.
  scrim: "#ffffff",
  backdrop: "#172b4d",

  fg: "#172b4d",
  fgMid: "#425570",
  fgDim: "#586a82",
  line: "#7487a0", // controls and essential boundaries: >= 3:1 on light surfaces
  lineSoft: "#d8e2ef",
  accent: "#075f93",
  accentDeep: "#075985",
  accent2: "#6d42b5",
  ok: "#087764",
  warn: "#925b00",
  danger: "#be2949",
  onAccent: "#ffffff",
};

export type Theme = typeof lightTheme;

const darkTheme: Theme = {
  bg: "#0f172a",
  bg2: "#131f35",
  panel: "#18243a",
  panel2: "#223149",
  canvasBg: "#111c30",
  canvasPanel: "#1b2940",
  rightPane: "#152238",
  floor: "#213149",
  termBg: "#131f35",
  termBodyBg: "#111c30",
  scrim: "#18243a",
  backdrop: "#020617",
  fg: "#edf3ff",
  fgMid: "#c2cfe3",
  fgDim: "#a4b5cd",
  line: "#7188a6",
  lineSoft: "#3b506d",
  accent: "#7dd3fc",
  accentDeep: "#38bdf8",
  accent2: "#c4b5fd",
  ok: "#5eead4",
  warn: "#fbbf24",
  danger: "#fda4af",
  onAccent: "#102035",
};

function savedTheme(): ThemeName {
  return loadString(StorageKeys.theme) === "dark" ? "dark" : "light";
}

let currentTheme: ThemeName = savedTheme();
// Preserve object identity: an already-running stage reads the new colors on
// its next frame without losing progress, controls, or simulation state.
export const theme: Theme = { ...(currentTheme === "dark" ? darkTheme : lightTheme) };
const listeners = new Set<(name: ThemeName) => void>();

export function getTheme(): ThemeName {
  return currentTheme;
}

/** Resolve scene-specific colors at draw time; sensor pixels stay literal. */
export function themeColor(light: string, dark: string): string {
  return currentTheme === "dark" ? dark : light;
}

function updateTheme(name: ThemeName): void {
  const changed = name !== currentTheme;
  currentTheme = name;
  Object.assign(theme, name === "dark" ? darkTheme : lightTheme);
  applyThemeVars();
  if (changed) for (const listener of listeners) listener(name);
}

export function setTheme(name: ThemeName): void {
  if (name !== "light" && name !== "dark") return;
  saveString(StorageKeys.theme, name);
  updateTheme(name);
}

/** Restore the saved choice on either entry page and on cross-tab changes. */
export function restoreTheme(): void {
  updateTheme(savedTheme());
}

export function onThemeChange(listener: (name: ThemeName) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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
  const root = document.documentElement;
  root.dataset.theme = currentTheme;
  const r = root.style;
  r.colorScheme = currentTheme;
  r.setProperty("--bg", theme.bg);
  r.setProperty("--bg-2", theme.bg2);
  r.setProperty("--panel", theme.panel);
  r.setProperty("--panel-2", theme.panel2);
  r.setProperty("--canvas-bg", theme.canvasBg);
  r.setProperty("--term-bg", theme.termBg);
  r.setProperty("--term-body-bg", theme.termBodyBg);
  r.setProperty("--scrim-rgb", rgbTriple(theme.scrim));
  r.setProperty("--backdrop-rgb", rgbTriple(theme.backdrop));
  r.setProperty("--fg", theme.fg);
  r.setProperty("--fg-mid", theme.fgMid);
  r.setProperty("--fg-dim", theme.fgDim);
  r.setProperty("--line", theme.line);
  r.setProperty("--line-soft", theme.lineSoft);
  r.setProperty("--accent", theme.accent);
  r.setProperty("--accent-deep", theme.accentDeep);
  r.setProperty("--accent-2", theme.accent2);
  r.setProperty("--ok", theme.ok);
  r.setProperty("--warn", theme.warn);
  r.setProperty("--danger", theme.danger);
  r.setProperty("--on-accent", theme.onAccent);
  r.setProperty("--accent-rgb", rgbTriple(theme.accent));
  r.setProperty("--accent-2-rgb", rgbTriple(theme.accent2));
  r.setProperty("--ok-rgb", rgbTriple(theme.ok));
  r.setProperty("--warn-rgb", rgbTriple(theme.warn));
  r.setProperty("--danger-rgb", rgbTriple(theme.danger));
  // The Guide shares the same palette with its own descriptive token names.
  r.setProperty("--cyan", theme.accent);
  r.setProperty("--cyan-rgb", rgbTriple(theme.accent));
  r.setProperty("--purple", theme.accent2);
  r.setProperty("--purple-rgb", rgbTriple(theme.accent2));
  r.setProperty("--mint", theme.ok);
  r.setProperty("--yellow", theme.warn);
  r.setProperty("--muted", theme.fgDim);
  r.setProperty("--line-bright", theme.line);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", currentTheme);
}

// Apply on import so the CSS variables are set no matter which module pulls
// the theme in first (draw.ts imports it very early via the stage registry).
applyThemeVars();
