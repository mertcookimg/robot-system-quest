// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// image_processing: Image Processing — Edge Threshold Tuning
// Mirrors robot_ros2_lecture / lesson 7 (Image Processing).
// Apply gaussian_blur → canny edge detection to a pseudo-camera frame
// (scene + noise) and clear the stage based on F1 score against the
// ground truth.
import { type Stage, type GameContext } from "../../types";
import { theme } from "../../core/theme";

import { drawHint, COLORS, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { toGray, gaussianBlur, cannyEdges, f1Score } from "../../lib/imgproc";
import { setupBlockProgram, type BlockProgramHandle } from "../../lib/block_program";
import { t, tx } from "../../i18n";
import { defineStage } from "../../core/stage_def";

// -- Pseudo camera resolution (perf vs legibility trade-off).
const IMG_W = 220;
const IMG_H = 160;

// -- Screen layout (4 panels: NOISY / CLEAN / DETECTED / GROUND TRUTH).
const PANEL_W = 174;
const PANEL_H = 127;
const PANEL_Y = 70;
const PANEL_X = [40, 230, 420, 610];
// Panel display size ÷ native image size.
const SCALE_X = PANEL_W / IMG_W;
const SCALE_Y = PANEL_H / IMG_H;

// -- Score thresholds (★ / ★★ / ★★★).
const STAR_THRESHOLDS = [0.55, 0.7, 0.82];

type Block =
  { kind: "gaussian_blur"; sigma: number } | { kind: "canny"; low: number; high: number };

function defaultBlock(kind: Block["kind"]): Block {
  if (kind === "gaussian_blur") return { kind, sigma: 1.0 };
  return { kind: "canny", low: 50, high: 120 };
}

// ====================================================================
// Scene generation.
// ====================================================================

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Scene {
  rgba: Uint8ClampedArray; // noisy camera input (RGBA)
  cleanRgba: Uint8ClampedArray; // noise-free original image (for comparison)
  gtEdges: Uint8Array; // ground-truth edges from the clean image
}

// Yellow curve + obstacles + noise: a "floor-as-seen-by-the-robot" scene.
function generateLegacyScene(seed: number): Scene {
  const w = IMG_W,
    h = IMG_H;
  const rand = mulberry32(seed);
  // Initialize RGBA buffer (floor gray).
  const rgba = new Uint8ClampedArray(w * h * 4);
  const cleanRgba = new Uint8ClampedArray(w * h * 4); // noise-free version (used to compute GT)
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    rgba[j] = cleanRgba[j] = 70;
    rgba[j + 1] = cleanRgba[j + 1] = 75;
    rgba[j + 2] = cleanRgba[j + 2] = 85;
    rgba[j + 3] = cleanRgba[j + 3] = 255;
  }

  // Shade the floor (darker top, lighter bottom = depth cue).
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const add = Math.floor(t * 30);
    for (let x = 0; x < w; x++) {
      const j = (y * w + x) * 4;
      rgba[j] += add;
      rgba[j + 1] += add;
      rgba[j + 2] += add;
      cleanRgba[j] += add;
      cleanRgba[j + 1] += add;
      cleanRgba[j + 2] += add;
    }
  }

  // Yellow line — gentle curve through the lower half of the frame.
  const cx = w / 2 + (rand() - 0.5) * 30;
  const amp = 25 + rand() * 15;
  const freq = 0.025 + rand() * 0.01;
  const phase = rand() * Math.PI * 2;
  const lineHalfWidth = 6;
  const drawLine = (buf: Uint8ClampedArray) => {
    for (let y = Math.floor(h * 0.45); y < h; y++) {
      const t = (y - h * 0.45) / (h - h * 0.45);
      const xCenter = cx + Math.sin(y * freq + phase) * amp * t;
      const halfW = lineHalfWidth + t * 2;
      for (
        let x = Math.max(0, Math.floor(xCenter - halfW));
        x < Math.min(w, Math.ceil(xCenter + halfW));
        x++
      ) {
        const dist = Math.abs(x - xCenter) / halfW;
        const alpha = Math.max(0, 1 - dist * dist);
        const j = (y * w + x) * 4;
        buf[j] = Math.min(255, buf[j] * (1 - alpha) + 240 * alpha);
        buf[j + 1] = Math.min(255, buf[j + 1] * (1 - alpha) + 200 * alpha);
        buf[j + 2] = Math.min(255, buf[j + 2] * (1 - alpha) + 50 * alpha);
      }
    }
  };
  drawLine(rgba);
  drawLine(cleanRgba);

  // Colorful objects (rects + circles). Spread hues so the RGB inspector
  // shows how dramatically R/G/B values differ across colors.
  const palette: [number, number, number][] = [
    [220, 70, 70], // red
    [80, 200, 110], // green
    [80, 130, 230], // blue
    [200, 90, 200], // magenta
    [90, 200, 220], // cyan
    [230, 150, 60], // orange
  ];
  // Rectangles (3).
  for (let n = 0; n < 3; n++) {
    const col = palette[Math.floor(rand() * palette.length)];
    const bx = 12 + Math.floor(rand() * (w - 60));
    const by = 12 + Math.floor(rand() * (h * 0.5));
    const bw = 22 + Math.floor(rand() * 28);
    const bh = 18 + Math.floor(rand() * 22);
    for (let y = by; y < Math.min(h, by + bh); y++) {
      for (let x = bx; x < Math.min(w, bx + bw); x++) {
        const j = (y * w + x) * 4;
        rgba[j] = cleanRgba[j] = col[0];
        rgba[j + 1] = cleanRgba[j + 1] = col[1];
        rgba[j + 2] = cleanRgba[j + 2] = col[2];
      }
    }
  }
  // Circles (2) — mixing shapes gives more diverse edges to detect.
  for (let n = 0; n < 2; n++) {
    const col = palette[Math.floor(rand() * palette.length)];
    const cx2 = 30 + Math.floor(rand() * (w - 60));
    const cy2 = 20 + Math.floor(rand() * (h * 0.4));
    const cr = 10 + Math.floor(rand() * 10);
    for (let y = Math.max(0, cy2 - cr); y <= Math.min(h - 1, cy2 + cr); y++) {
      for (let x = Math.max(0, cx2 - cr); x <= Math.min(w - 1, cx2 + cr); x++) {
        const dxc = x - cx2,
          dyc = y - cy2;
        if (dxc * dxc + dyc * dyc > cr * cr) continue;
        const j = (y * w + x) * 4;
        rgba[j] = cleanRgba[j] = col[0];
        rgba[j + 1] = cleanRgba[j + 1] = col[1];
        rgba[j + 2] = cleanRgba[j + 2] = col[2];
      }
    }
  }

  // Apply noise to rgba only; cleanRgba stays untouched.
  const noiseMag = 26;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    const n = (rand() - 0.5) * 2 * noiseMag;
    rgba[j] = Math.max(0, Math.min(255, rgba[j] + n));
    rgba[j + 1] = Math.max(0, Math.min(255, rgba[j + 1] + n));
    rgba[j + 2] = Math.max(0, Math.min(255, rgba[j + 2] + n));
  }

  // Ground-truth edges: Sobel + simple threshold on the clean image.
  const cleanGray = toGray(cleanRgba, w, h);
  const gtMag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = cleanGray[i - w - 1],
        b = cleanGray[i - w],
        c = cleanGray[i - w + 1];
      const d = cleanGray[i - 1],
        e = cleanGray[i + 1];
      const f = cleanGray[i + w - 1],
        gg = cleanGray[i + w],
        hh = cleanGray[i + w + 1];
      const gx = -a + c - 2 * d + 2 * e - f + hh;
      const gy = -a - 2 * b - c + f + 2 * gg + hh;
      gtMag[i] = Math.hypot(gx, gy);
    }
  }
  const gtEdges = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gtEdges[i] = gtMag[i] >= 60 ? 255 : 0;

  return { rgba, cleanRgba, gtEdges };
}

/** Render a robot-camera view of a warehouse instead of abstract test shapes. */
function generateScene(seed: number): Scene {
  // Keep the buffer-only renderer as a safe fallback for non-DOM test runners.
  if (typeof document === "undefined") return generateLegacyScene(seed);
  const w = IMG_W,
    h = IMG_H;
  const rand = mulberry32(seed);
  const camera = document.createElement("canvas");
  camera.width = w;
  camera.height = h;
  const c = camera.getContext("2d")!;
  const horizon = 68;

  // Warehouse shell: ceiling/wall and a floor fading toward the camera.
  const wall = c.createLinearGradient(0, 0, 0, horizon);
  wall.addColorStop(0, "#172938");
  wall.addColorStop(1, "#52616b");
  c.fillStyle = wall;
  c.fillRect(0, 0, w, horizon);
  const floor = c.createLinearGradient(0, horizon, 0, h);
  floor.addColorStop(0, "#596266");
  floor.addColorStop(1, "#171d20");
  c.fillStyle = floor;
  c.fillRect(0, horizon, w, h - horizon);

  c.fillStyle = "#0d1821";
  c.fillRect(0, 0, w, 9);
  c.fillRect(0, 31, w, 5);
  c.strokeStyle = "#2d4656";
  c.lineWidth = 3;
  for (const x of [10, 67, 153, 210]) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(110 + (x - 110) * 0.46, horizon);
    c.stroke();
  }

  // Windows, ceiling lights and their glow.
  for (const x of [41, 102, 163]) {
    c.fillStyle = "rgba(180, 234, 255, .18)";
    c.fillRect(x, 14, 31, 13);
    c.strokeStyle = "rgba(190, 240, 255, .45)";
    c.strokeRect(x, 14, 31, 13);
  }
  for (const x of [27, 110, 193]) {
    const glow = c.createRadialGradient(x, 37, 1, x, 37, 22);
    glow.addColorStop(0, "rgba(220, 250, 255, .44)");
    glow.addColorStop(1, "rgba(220, 250, 255, 0)");
    c.fillStyle = glow;
    c.fillRect(x - 22, 34, 44, 34);
    c.fillStyle = "#dffaff";
    c.fillRect(x - 7, 34, 14, 3);
  }

  // Storage racks with colored bins.
  const drawRack = (x: number) => {
    c.fillStyle = "#22313a";
    c.fillRect(x, 38, 43, 52);
    c.strokeStyle = "#9caeb4";
    c.lineWidth = 2;
    c.strokeRect(x, 38, 43, 52);
    const colors = ["#c96632", "#d9ad42", "#318898", "#9e5549"];
    for (let row = 0; row < 3; row++) {
      c.beginPath();
      c.moveTo(x, 55 + row * 17);
      c.lineTo(x + 43, 55 + row * 17);
      c.stroke();
      for (let col = 0; col < 2; col++) {
        c.fillStyle = colors[(row * 2 + col + Math.floor(rand() * 3)) % colors.length];
        c.fillRect(x + 4 + col * 20, 41 + row * 17, 16, 11);
      }
    }
  };
  drawRack(4);
  drawRack(173);

  // Floor seams converge at the vanishing point.
  c.strokeStyle = "rgba(196, 211, 214, .2)";
  c.lineWidth = 1;
  for (const x of [-48, 2, 56, 164, 218, 268]) {
    c.beginPath();
    c.moveTo(110, horizon);
    c.lineTo(x, h);
    c.stroke();
  }
  for (const y of [88, 111, 138]) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }

  // Yellow AGV guide line.
  const guideOffset = (rand() - 0.5) * 12;
  c.lineCap = "round";
  c.strokeStyle = "#f5c542";
  c.lineWidth = 7;
  c.beginPath();
  c.moveTo(108 + guideOffset, horizon);
  c.bezierCurveTo(104 + guideOffset, 95, 139 + guideOffset, 116, 124 + guideOffset, h + 4);
  c.stroke();
  c.strokeStyle = "rgba(255, 244, 180, .7)";
  c.lineWidth = 1.4;
  c.stroke();

  // Shipping crate in the middle distance.
  const crateX = 62 + Math.floor(rand() * 9);
  c.fillStyle = "rgba(0, 0, 0, .28)";
  c.fillRect(crateX + 5, 91, 40, 25);
  c.fillStyle = "#b86632";
  c.fillRect(crateX, 76, 38, 31);
  c.fillStyle = "#d88d48";
  c.beginPath();
  c.moveTo(crateX, 76);
  c.lineTo(crateX + 8, 70);
  c.lineTo(crateX + 45, 70);
  c.lineTo(crateX + 38, 76);
  c.closePath();
  c.fill();
  c.strokeStyle = "#66341d";
  c.lineWidth = 2;
  c.strokeRect(crateX, 76, 38, 31);
  c.beginPath();
  c.moveTo(crateX + 19, 76);
  c.lineTo(crateX + 19, 107);
  c.moveTo(crateX, 91);
  c.lineTo(crateX + 38, 91);
  c.stroke();

  // Mobile robot ahead: wheels, teal body, camera eyes and lidar.
  const robotX = 139 + Math.floor((rand() - 0.5) * 8);
  c.fillStyle = "rgba(0, 0, 0, .34)";
  c.beginPath();
  c.ellipse(robotX + 18, 120, 27, 8, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#17232c";
  c.fillRect(robotX - 2, 101, 7, 22);
  c.fillRect(robotX + 31, 101, 7, 22);
  const body = c.createLinearGradient(robotX, 88, robotX, 118);
  body.addColorStop(0, "#6fe0d8");
  body.addColorStop(1, "#247d8d");
  c.fillStyle = body;
  c.beginPath();
  c.roundRect(robotX, 88, 36, 30, 6);
  c.fill();
  c.strokeStyle = "#b9fff8";
  c.lineWidth = 1.5;
  c.stroke();
  c.fillStyle = "#13212a";
  c.fillRect(robotX + 7, 93, 22, 9);
  c.fillStyle = "#7dd3fc";
  c.fillRect(robotX + 10, 95, 5, 4);
  c.fillRect(robotX + 21, 95, 5, 4);
  c.fillStyle = "#24343d";
  c.fillRect(robotX + 15, 78, 6, 11);
  c.beginPath();
  c.ellipse(robotX + 18, 78, 11, 4, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "#7dd3fc";
  c.beginPath();
  c.ellipse(robotX + 18, 78, 10, 3, 0, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = "#5eead4";
  c.beginPath();
  c.arc(robotX + 30, 87, 2.2, 0, Math.PI * 2);
  c.fill();

  // Camera lens falloff makes the frame read as a sensor image.
  const vignette = c.createRadialGradient(w / 2, h / 2, 45, w / 2, h / 2, 145);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.48)");
  c.fillStyle = vignette;
  c.fillRect(0, 0, w, h);

  const cleanRgba = new Uint8ClampedArray(c.getImageData(0, 0, w, h).data);
  const rgba = new Uint8ClampedArray(cleanRgba);
  const noiseMag = 17;
  for (let i = 0; i < w * h; i++) {
    const j = i * 4;
    const scan = ((Math.floor(i / w) % 3) - 1) * 1.8;
    const n = (rand() - 0.5) * 2 * noiseMag + scan;
    rgba[j] = Math.max(0, Math.min(255, rgba[j] + n * 1.04));
    rgba[j + 1] = Math.max(0, Math.min(255, rgba[j + 1] + n));
    rgba[j + 2] = Math.max(0, Math.min(255, rgba[j + 2] + n * 0.94));
  }

  const cleanGray = toGray(cleanRgba, w, h);
  const gtMag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = cleanGray[i - w - 1],
        b = cleanGray[i - w],
        cc = cleanGray[i - w + 1];
      const d = cleanGray[i - 1],
        e = cleanGray[i + 1];
      const f = cleanGray[i + w - 1],
        gg = cleanGray[i + w],
        hh = cleanGray[i + w + 1];
      gtMag[i] = Math.hypot(-a + cc - 2 * d + 2 * e - f + hh, -a - 2 * b - cc + f + 2 * gg + hh);
    }
  }
  const gtEdges = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gtEdges[i] = gtMag[i] >= 72 ? 255 : 0;
  return { rgba, cleanRgba, gtEdges };
}

// ====================================================================
// Stage body.
// ====================================================================

export function makeImageProcessing(): Stage {
  let g!: GameContext;
  const particles = new Particles();

  let program: Block[] = [];
  let isRunning = false;
  let elapsed = 0;
  let runCount = 0;
  let cleared = false;

  let scene: Scene = generateScene(1);
  let detected: Uint8Array = new Uint8Array(IMG_W * IMG_H);
  let lastF1 = 0;
  let lastPipelineMs = 0;
  let needsRecompute = true;
  let dirtyAcc = 0; // debounce accumulator for parameter changes

  // Pixel inspector (hover over the INPUT panel to read pixel values).
  // -1 / -1 = no hover, display the image center by default.
  let inspectPx = -1;
  let inspectPy = -1;
  let mouseMoveHandler: ((e: MouseEvent) => void) | null = null;

  // Offscreen canvases used to scale-draw native image → display size.
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = IMG_W;
  tmpCanvas.height = IMG_H;
  const tmpCtx = tmpCanvas.getContext("2d")!;

  let editorEl: HTMLElement | null = null;
  let statusBadgeEl: HTMLElement | null = null;
  let bp: BlockProgramHandle | null = null;

  function setStatusBadge(text: string, kind: "" | "running" | "success" | "error") {
    if (!statusBadgeEl) return;
    statusBadgeEl.textContent = text;
    statusBadgeEl.classList.remove("running", "success", "error");
    if (kind) statusBadgeEl.classList.add(kind);
  }

  function reset() {
    particles.reset();
    elapsed = 0;
    cleared = false;
    isRunning = false;
    needsRecompute = true;
    setStatusBadge("idle", "");
    g.setStatus(t("image_processing.tip"), "");
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";

    if (program.length === 0 && runCount === 0) {
      // Default sample: naive settings — score still low.
      program = [
        { kind: "gaussian_blur", sigma: 0.2 },
        { kind: "canny", low: 15, high: 45 },
      ];
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("image_processing.palette_hint"),
      blockKinds: [
        {
          kind: "gaussian_blur",
          label: tx("① ノイズを減らす", "① reduce noise"),
          args: "gaussian_blur / sigma",
          defaults: () => defaultBlock("gaussian_blur"),
          params: (b) =>
            b.kind === "gaussian_blur"
              ? [{ key: "sigma", value: b.sigma, step: 0.1, unit: "σ" }]
              : [],
        },
        {
          kind: "canny",
          label: tx("② 輪郭を探す", "② find edges"),
          args: "canny / low, high",
          defaults: () => defaultBlock("canny"),
          params: (b) =>
            b.kind === "canny"
              ? [
                  { key: "low", value: b.low, step: 5, unit: "low" },
                  { key: "high", value: b.high, step: 5, unit: "high" },
                ]
              : [],
        },
      ],
      isRunning: () => isRunning,
      activeWhenRunning: true,
      onChange: () => {
        needsRecompute = true;
      },
      onRun: () => onRun(),
      onStop: () => onStop(),
      onClear: () => {
        onStop();
        program.length = 0;
      },
    });

    // Read pixel position from mouse hover on the NOISY / CLEAN panels.
    mouseMoveHandler = (e: MouseEvent) => {
      const rect = g.canvas.getBoundingClientRect();
      const sx = g.canvas.width / rect.width;
      const sy = g.canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * sx;
      const cy = (e.clientY - rect.top) * sy;
      // Which panel is hovered: 0 (noisy) or 1 (clean).
      let hoveredX = -1;
      for (const px of [PANEL_X[0], PANEL_X[1]]) {
        if (cx >= px && cx < px + PANEL_W && cy >= PANEL_Y && cy < PANEL_Y + PANEL_H) {
          hoveredX = px;
          break;
        }
      }
      if (hoveredX >= 0) {
        // Inverse-map display size → native image coordinates.
        inspectPx = Math.floor((cx - hoveredX) / SCALE_X);
        inspectPy = Math.floor((cy - PANEL_Y) / SCALE_Y);
        inspectPx = Math.max(0, Math.min(IMG_W - 1, inspectPx));
        inspectPy = Math.max(0, Math.min(IMG_H - 1, inspectPy));
      } else {
        inspectPx = inspectPy = -1;
      }
    };
    g.canvas.addEventListener("mousemove", mouseMoveHandler);

    refreshProgramUI();
    reset();
    runScene(); // initial display
  }

  function dispose() {
    if (editorEl) editorEl.style.display = "none";
    bp?.dispose();
    bp = null;
    if (mouseMoveHandler) {
      g.canvas.removeEventListener("mousemove", mouseMoveHandler);
      mouseMoveHandler = null;
    }
    inspectPx = inspectPy = -1;
  }

  // I/J/K/L or the right stick move the pixel inspector. Arrows/left stick
  // remain reserved for block-editor navigation.
  function pollInspectorInput(dt: number) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p) {
        pad = p;
        break;
      }
    }
    const STICK_DEAD = 0.18;
    let ax = pad?.axes[2] ?? 0;
    let ay = pad?.axes[3] ?? 0;
    const kx = (g.keys.has("l") ? 1 : 0) - (g.keys.has("j") ? 1 : 0);
    const ky = (g.keys.has("k") ? 1 : 0) - (g.keys.has("i") ? 1 : 0);
    if (kx || ky) {
      const kn = Math.hypot(kx, ky);
      ax = kx / kn;
      ay = ky / kn;
    }
    const mag = Math.hypot(ax, ay);
    if (mag < STICK_DEAD) return;
    // Set initial position (center).
    if (inspectPx < 0) {
      inspectPx = Math.floor(IMG_W / 2);
      inspectPy = Math.floor(IMG_H / 2);
    }
    const t = (mag - STICK_DEAD) / (1 - STICK_DEAD);
    const speedPxPerSec = t * t * 140; // max ~140 px/s
    inspectPx = Math.max(0, Math.min(IMG_W - 1, inspectPx + (ax / mag) * speedPxPerSec * dt));
    inspectPy = Math.max(0, Math.min(IMG_H - 1, inspectPy + (ay / mag) * speedPxPerSec * dt));
  }

  function refreshProgramUI() {
    bp?.refresh();
  }

  function runScene() {
    const t0 = performance.now();
    let gray = toGray(scene.rgba, IMG_W, IMG_H);
    let blurredApplied = false;
    let cannyApplied = false;
    for (const block of program) {
      if (block.kind === "gaussian_blur") {
        gray = gaussianBlur(gray, IMG_W, IMG_H, Math.max(0, block.sigma));
        blurredApplied = true;
      } else if (block.kind === "canny") {
        const low = Math.max(0, Math.min(block.low, block.high));
        const high = Math.max(low, block.high);
        detected = cannyEdges(gray, IMG_W, IMG_H, low, high);
        cannyApplied = true;
      }
    }
    if (!cannyApplied) {
      // If canny is empty render the panel with no edges (clearer for learners).
      detected = new Uint8Array(IMG_W * IMG_H);
    }
    lastF1 = f1Score(detected, scene.gtEdges, IMG_W, IMG_H);
    lastPipelineMs = performance.now() - t0;
    needsRecompute = false;
    void blurredApplied;

    // Clear check (live: any threshold ≥ 1★ unlocks clear).
    if (isRunning && !cleared && lastF1 >= STAR_THRESHOLDS[0]) {
      const stars = lastF1 >= STAR_THRESHOLDS[2] ? 3 : lastF1 >= STAR_THRESHOLDS[1] ? 2 : 1;
      cleared = true;
      isRunning = false;
      setStatusBadge("success", "success");
      const stats =
        `${tx("輪郭の一致度", "Edge Match")} <b>${Math.round(lastF1 * 100)}%</b><br>` +
        `F1 <b>${lastF1.toFixed(3)}</b><br>` +
        `pipeline <b>${lastPipelineMs.toFixed(1)} ms</b>`;
      g.shake(0.3);
      particles.burst(400, 250, COLORS.OK, 32);
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 350);
    }
  }

  function onRun() {
    if (program.length === 0) {
      g.setStatus(t("block.empty"), "var(--warn)");
      return;
    }
    runCount++;
    isRunning = true;
    cleared = false;
    setStatusBadge("running", "running");
    g.setStatus(t("image_processing.processing"), "var(--accent)");
    // Regenerate the scene with a new seed (challenge).
    scene = generateScene(Date.now() & 0xffffffff);
    runScene();
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    setStatusBadge("stopped", "");
    g.setStatus(t("image_processing.stop"), "var(--warn)");
    refreshProgramUI();
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

    pollInspectorInput(dt);

    // Live preview: debounce parameter changes before recomputing.
    if (needsRecompute) {
      dirtyAcc += dt;
      if (dirtyAcc >= 0.08) {
        dirtyAcc = 0;
        runScene();
      }
    } else {
      dirtyAcc = 0;
    }
    g.setHud([
      `mode:    image processing pipeline`,
      `${tx("一致度", "match")}:   ${Math.round(lastF1 * 100)}%  (F1 ${lastF1.toFixed(3)})`,
      `cost:    ${lastPipelineMs.toFixed(1)} ms / frame`,
      `blocks:  ${program.length}`,
    ]);
  }

  // ====================================================================
  // Render.
  // ====================================================================

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    // Title.
    c.fillStyle = "#7dd3fc";
    c.font = "700 14px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("Image Processing Pipeline", 40, 38);
    c.fillStyle = "#6e7a9c";
    c.font = "10px ui-monospace, monospace";
    c.fillText(
      tx(
        "カメラ画像 → ノイズを減らす → 輪郭を探す → お手本と比べる",
        "camera → reduce noise → find edges → compare",
      ),
      40,
      54,
    );

    // 4 panels: CLEAN / NOISY / DETECTED / GROUND TRUTH.
    drawPanel(c, PANEL_X[0], PANEL_Y, tx("元画像", "SOURCE"), () => {
      drawRgba(c, PANEL_X[0], PANEL_Y, scene.cleanRgba);
    });
    drawPanel(c, PANEL_X[1], PANEL_Y, tx("カメラ画像（ノイズあり）", "CAMERA (noisy)"), () => {
      drawRgba(c, PANEL_X[1], PANEL_Y, scene.rgba);
    });
    drawPanel(c, PANEL_X[2], PANEL_Y, tx("見つけた輪郭", "EDGES FOUND"), () => {
      drawEdgeMask(c, PANEL_X[2], PANEL_Y, detected, "#7dd3fc");
    });
    drawPanel(c, PANEL_X[3], PANEL_Y, tx("お手本", "TARGET"), () => {
      drawEdgeMask(c, PANEL_X[3], PANEL_Y, scene.gtEdges, "#5eead4");
    });

    // F1 score bar.
    drawF1Bar(c, 40, 260, 720, 36, lastF1);

    // Pixel inspector — reads a pixel on the INPUT panel (center if no hover).
    drawPixelInspector(c);

    // Parameter legend (placed below the inspector at y0+h = 418).
    c.fillStyle = "#9aa6c8";
    c.font = "11px ui-monospace, monospace";
    c.textAlign = "left";
    let lineY = 436;
    const params =
      program
        .map((b) =>
          b.kind === "gaussian_blur"
            ? `gaussian_blur(σ=${b.sigma.toFixed(2)})`
            : `canny(low=${b.low}, high=${b.high})`,
        )
        .join("  →  ") || "(no blocks — add gaussian_blur and canny from BLOCKS)";
    c.fillText(`pipeline:  ${params}`, 40, lineY);
    lineY += 16;
    c.fillStyle = "#6e7a9c";
    c.fillText(
      `cost: ${lastPipelineMs.toFixed(1)} ms/frame   resolution: ${IMG_W}×${IMG_H}`,
      40,
      lineY,
    );

    drawHint(c, t("image_processing.hint"));

    particles.draw(c);
  }

  function drawPixelInspector(c: CanvasRenderingContext2D) {
    // Sampled pixel (center if no hover). inspectPx/Py may be float
    // because the pad input is analog.
    const px = Math.floor(inspectPx >= 0 ? inspectPx : IMG_W / 2);
    const py = Math.floor(inspectPy >= 0 ? inspectPy : IMG_H / 2);
    const idx = (py * IMG_W + px) * 4;
    // With noise.
    const r = scene.rgba[idx];
    const g_ = scene.rgba[idx + 1];
    const b = scene.rgba[idx + 2];
    // Without noise (clean).
    const cR = scene.cleanRgba[idx];
    const cG = scene.cleanRgba[idx + 1];
    const cB = scene.cleanRgba[idx + 2];
    // Same coefficients as OpenCV cv2.cvtColor(BGR2GRAY).
    const gray = Math.round(0.299 * r + 0.587 * g_ + 0.114 * b);
    const cGray = Math.round(0.299 * cR + 0.587 * cG + 0.114 * cB);
    const isEdge = detected[py * IMG_W + px] > 0;
    const isGT = scene.gtEdges[py * IMG_W + px] > 0;

    // Crosshair on both NOISY and CLEAN panels (synced).
    c.save();
    c.strokeStyle = "#fbbf24";
    c.lineWidth = 1;
    for (const panelIdx of [0, 1]) {
      const markX = PANEL_X[panelIdx] + px * SCALE_X;
      const markY = PANEL_Y + py * SCALE_Y;
      c.beginPath();
      c.moveTo(markX - 6, markY);
      c.lineTo(markX + 6, markY);
      c.moveTo(markX, markY - 6);
      c.lineTo(markX, markY + 6);
      c.stroke();
      c.beginPath();
      c.arc(markX, markY, 7, 0, Math.PI * 2);
      c.stroke();
    }
    c.restore();

    // Zoomed inspector panel: noisy/clean side-by-side + zoom grid.
    c.save();
    const x0 = 40;
    const y0 = 308;
    const w = 720,
      h = 110;
    c.fillStyle = theme.canvasPanel;
    c.fillRect(x0, y0, w, h);
    c.strokeStyle = "rgba(35, 44, 77, 0.9)";
    c.strokeRect(x0, y0, w, h);

    // Label.
    c.fillStyle = "#7dd3fc";
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(`PIXEL INSPECTOR  (${px}, ${py})`, x0 + 10, y0 + 16);

    // -- Left section: CLEAN (true values, no noise) --
    const sx = x0 + 10;
    let yy = y0 + 26;
    c.font = "9px ui-monospace, monospace";
    c.fillStyle = "#6e7a9c";
    c.fillText("clean (no noise)", sx, yy);
    // swatch
    c.fillStyle = `rgb(${cR}, ${cG}, ${cB})`;
    c.fillRect(sx, yy + 4, 22, 22);
    c.strokeStyle = "rgba(255,255,255,0.4)";
    c.strokeRect(sx, yy + 4, 22, 22);
    // RGB numbers (colored).
    c.font = "700 11px ui-monospace, monospace";
    c.fillStyle = "#fb7185";
    c.fillText(`R=${String(cR).padStart(3, " ")}`, sx + 32, yy + 14);
    c.fillStyle = "#86efac";
    c.fillText(`G=${String(cG).padStart(3, " ")}`, sx + 32, yy + 26);
    c.fillStyle = "#7dd3fc";
    c.fillText(`B=${String(cB).padStart(3, " ")}`, sx + 32, yy + 38);
    // gray
    c.fillStyle = `rgb(${cGray}, ${cGray}, ${cGray})`;
    c.fillRect(sx + 100, yy + 4, 22, 22);
    c.strokeRect(sx + 100, yy + 4, 22, 22);
    c.fillStyle = "#9aa6c8";
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("gray", sx + 111, yy + 0);
    c.fillText(`${cGray}`, sx + 111, yy + 38);

    // -- Middle section: NOISY (camera input) --
    const mx = x0 + 160;
    c.font = "9px ui-monospace, monospace";
    c.fillStyle = "#6e7a9c";
    c.textAlign = "left";
    c.fillText("noisy (camera input)", mx, yy);
    c.fillStyle = `rgb(${r}, ${g_}, ${b})`;
    c.fillRect(mx, yy + 4, 22, 22);
    c.strokeStyle = "rgba(255,255,255,0.4)";
    c.strokeRect(mx, yy + 4, 22, 22);
    c.font = "700 11px ui-monospace, monospace";
    c.fillStyle = "#fb7185";
    c.fillText(`R=${String(r).padStart(3, " ")}`, mx + 32, yy + 14);
    c.fillStyle = "#86efac";
    c.fillText(`G=${String(g_).padStart(3, " ")}`, mx + 32, yy + 26);
    c.fillStyle = "#7dd3fc";
    c.fillText(`B=${String(b).padStart(3, " ")}`, mx + 32, yy + 38);
    c.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
    c.fillRect(mx + 100, yy + 4, 22, 22);
    c.strokeRect(mx + 100, yy + 4, 22, 22);
    c.fillStyle = "#9aa6c8";
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("gray", mx + 111, yy + 0);
    c.fillText(`${gray}`, mx + 111, yy + 38);

    // -- Noise delta + formula + canny/GT (middle-right) --
    const tx = x0 + 320;
    c.textAlign = "left";
    c.font = "9px ui-monospace, monospace";
    c.fillStyle = "#6e7a9c";
    c.fillText("noise = noisy − clean", tx, yy);
    c.font = "700 11px ui-monospace, monospace";
    c.fillStyle = "#fb7185";
    c.fillText(`ΔR=${signed(r - cR)}`, tx, yy + 14);
    c.fillStyle = "#86efac";
    c.fillText(`ΔG=${signed(g_ - cG)}`, tx, yy + 26);
    c.fillStyle = "#7dd3fc";
    c.fillText(`ΔB=${signed(b - cB)}`, tx, yy + 38);
    // formula
    c.fillStyle = "#9aa6c8";
    c.font = "9px ui-monospace, monospace";
    c.fillText(`gray = 0.299·R + 0.587·G + 0.114·B`, tx, yy + 56);
    // canny / GT
    c.font = "700 10px ui-monospace, monospace";
    c.fillStyle = isEdge ? COLORS.OK : "#6e7a9c";
    c.fillText(`canny: ${isEdge ? "EDGE" : "—"}`, tx, yy + 74);
    c.fillStyle = isGT ? "#5eead4" : "#6e7a9c";
    c.fillText(`GT:    ${isGT ? "EDGE" : "—"}`, tx + 78, yy + 74);

    // -- Right section: zoomed pixel grid (clean / noisy side-by-side) --
    // 7×7 cells × 11×11 px each = 77×77 panel; two panels juxtaposed to
    // compare clean vs noisy pixel by pixel.
    const gridX = x0 + w - 200;
    drawPixelGrid(c, gridX, y0 + 4, 7, 11, scene.cleanRgba, "clean");
    drawPixelGrid(c, gridX + 100, y0 + 4, 7, 11, scene.rgba, "noisy");

    c.restore();
  }

  function drawPixelGrid(
    c: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    nCells: number,
    cellSize: number,
    src: Uint8ClampedArray,
    label: string,
  ) {
    const px = Math.floor(inspectPx >= 0 ? inspectPx : IMG_W / 2);
    const py = Math.floor(inspectPy >= 0 ? inspectPy : IMG_H / 2);
    const half = (nCells - 1) >> 1;
    const total = nCells * cellSize;

    // Label.
    c.fillStyle = "#9aa6c8";
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(label, gx, gy + 9);

    const oy = gy + 14;

    // Background.
    c.fillStyle = COLORS.BG_DARK;
    c.fillRect(gx, oy, total, total);

    // Per-cell.
    for (let dy = -half; dy <= half; dy++) {
      const sy = py + dy;
      for (let dx = -half; dx <= half; dx++) {
        const sx = px + dx;
        let r = 8,
          g = 10,
          b = 18;
        if (sx >= 0 && sx < IMG_W && sy >= 0 && sy < IMG_H) {
          const i = (sy * IMG_W + sx) * 4;
          r = src[i];
          g = src[i + 1];
          b = src[i + 2];
        }
        const cellX = gx + (dx + half) * cellSize;
        const cellY = oy + (dy + half) * cellSize;
        c.fillStyle = `rgb(${r}, ${g}, ${b})`;
        c.fillRect(cellX, cellY, cellSize, cellSize);
      }
    }

    // Grid lines (emphasize pixel boundaries).
    c.strokeStyle = "rgba(255, 255, 255, 0.18)";
    c.lineWidth = 0.5;
    for (let i = 0; i <= nCells; i++) {
      c.beginPath();
      c.moveTo(gx + i * cellSize + 0.5, oy);
      c.lineTo(gx + i * cellSize + 0.5, oy + total);
      c.stroke();
      c.beginPath();
      c.moveTo(gx, oy + i * cellSize + 0.5);
      c.lineTo(gx + total, oy + i * cellSize + 0.5);
      c.stroke();
    }

    // Frame the center cell (= hover pixel) in yellow.
    const ccX = gx + half * cellSize;
    const ccY = oy + half * cellSize;
    c.strokeStyle = "#fbbf24";
    c.lineWidth = 2;
    c.strokeRect(ccX - 0.5, ccY - 0.5, cellSize + 1, cellSize + 1);

    // Outer frame.
    c.strokeStyle = "rgba(35, 44, 77, 0.9)";
    c.lineWidth = 1;
    c.strokeRect(gx - 0.5, oy - 0.5, total + 1, total + 1);
  }

  function signed(n: number): string {
    return (n >= 0 ? "+" : "") + n;
  }

  function drawPanel(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    body: () => void,
  ) {
    c.save();
    c.fillStyle = theme.canvasPanel;
    c.fillRect(x - 4, y - 22, PANEL_W + 8, PANEL_H + 30);
    c.strokeStyle = "rgba(35, 44, 77, 0.9)";
    c.lineWidth = 1;
    c.strokeRect(x - 4, y - 22, PANEL_W + 8, PANEL_H + 30);
    c.fillStyle = "#9aa6c8";
    c.font = "10px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(label, x, y - 6);
    c.restore();
    body();
  }

  function drawRgba(c: CanvasRenderingContext2D, dx: number, dy: number, rgba: Uint8ClampedArray) {
    // Render to tmpCanvas at native resolution, then scale to display size.
    const id = tmpCtx.createImageData(IMG_W, IMG_H);
    id.data.set(rgba);
    tmpCtx.putImageData(id, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmpCanvas, dx, dy, PANEL_W, PANEL_H);
    c.imageSmoothingEnabled = true;
  }

  function drawEdgeMask(
    c: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    mask: Uint8Array,
    color: string,
  ) {
    const id = tmpCtx.createImageData(IMG_W, IMG_H);
    const [r, gg, bb] = parseHex(color);
    for (let i = 0; i < IMG_W * IMG_H; i++) {
      const j = i * 4;
      const v = mask[i] > 0 ? 1 : 0;
      id.data[j] = v ? r : 8;
      id.data[j + 1] = v ? gg : 10;
      id.data[j + 2] = v ? bb : 18;
      id.data[j + 3] = 255;
    }
    tmpCtx.putImageData(id, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmpCanvas, dx, dy, PANEL_W, PANEL_H);
    c.imageSmoothingEnabled = true;
  }

  function parseHex(hex: string): [number, number, number] {
    const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    if (!m) return [255, 255, 255];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }

  function drawF1Bar(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    f1: number,
  ) {
    c.save();
    c.fillStyle = theme.canvasPanel;
    c.fillRect(x, y, w, h);
    c.strokeStyle = "#232c4d";
    c.strokeRect(x, y, w, h);
    // Fill.
    const filled = Math.max(0, Math.min(1, f1)) * w;
    const grad = c.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, "#fb7185");
    grad.addColorStop(0.55, "#fbbf24");
    grad.addColorStop(0.82, "#5eead4");
    grad.addColorStop(1, "#7dd3fc");
    c.fillStyle = grad;
    c.fillRect(x, y, filled, h);
    // Threshold marker.
    for (const th of STAR_THRESHOLDS) {
      const tx = x + th * w;
      c.strokeStyle = "rgba(255, 255, 255, 0.5)";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(tx, y);
      c.lineTo(tx, y + h);
      c.stroke();
    }
    // Label.
    c.fillStyle = "#eef2ff";
    c.font = "700 13px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(
      `${tx("輪郭の一致度", "EDGE MATCH")} ${Math.round(f1 * 100)}%`,
      x + w / 2,
      y + h / 2 + 4,
    );
    c.restore();
  }

  return {
    id: "image_processing",
    name: "Image Processing",
    lesson: "Image Processing",
    lessonCmd: "ros2 topic echo /robot/front_camera/image_raw",
    ros2: {
      title: "Image Processing — Edge Detection",
      summary:
        "OpenCV の cv2.cvtColor + cv2.GaussianBlur + cv2.Canny を疑似カメラ画像で再現（本ゲームの canny は Sobel + 二重閾値の簡易版で、細線化する非最大抑制 (NMS) は省略。実物より線が太めに出る）。" +
        "ノイズ込みのフレームから Ground Truth エッジをどれだけ正確に抽出できるかを F1 スコアで評価する。F1 は「取りこぼしの少なさ (再現率)」と「誤検出の少なさ (適合率)」を両立できているかの指標 (両者の調和平均、1.0 が満点)。" +
        "low / high 閾値の比 (1:2〜1:3 推奨) と blur の σ のバランス感覚が身に付く。",
      msgTypes: ["sensor_msgs/msg/Image", "sensor_msgs/msg/CompressedImage"],
      cli: [
        "ros2 topic echo /image_raw --once",
        "ros2 run image_view image_view image:=/image_raw",
        "ros2 topic info /robot/front_camera/image_raw",
      ],
      python: `# cv_bridge で sensor_msgs/msg/Image を OpenCV 画像に変換し edge 検出
import cv2
from cv_bridge import CvBridge
bridge = CvBridge()

def callback(self, msg):
    img = bridge.imgmsg_to_cv2(msg, "bgr8")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), sigmaX=1.0)
    edges = cv2.Canny(blur, 50, 150)
    cv2.imshow("edges", edges)
    cv2.waitKey(1)`,
      realWorld: tx(
        "robot 実機: /robot/front_camera/image_raw を購読し、edge map を別 topic で publish。閾値が低すぎる場合は床のテクスチャまで誤検出、高すぎると目標物が消える — まさに今の体験そのもの。",
        "On a real robot: subscribe to /robot/front_camera/image_raw and publish the edge map on a separate topic. Thresholds too low → floor texture is misdetected; too high → the target itself disappears. Exactly what you are experiencing now.",
      ),
    },
    init,
    update,
    draw,
    reset,
    dispose,
  };
}

export default defineStage({
  mode: "lesson",
  order: 13,
  diagram: `
<svg class="imgproc-guide" viewBox="0 0 434 158" role="img" aria-label="Camera image becomes cleaner, edges are detected, then compared with a target">
  <defs>
    <linearGradient id="ig-floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#52616b"/>
      <stop offset="1" stop-color="#151d22"/>
    </linearGradient>
    <linearGradient id="ig-robot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#73e3dc"/>
      <stop offset="1" stop-color="#247d8d"/>
    </linearGradient>
    <filter id="ig-soften">
      <feGaussianBlur stdDeviation="0.75"/>
    </filter>
    <clipPath id="ig-frame">
      <rect width="90" height="70" rx="5"/>
    </clipPath>
    <marker id="ig-arrow" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto">
      <path d="M0 0 7 3 0 6Z" fill="#5eead4"/>
    </marker>
    <g id="ig-warehouse">
      <rect width="90" height="34" fill="#263d4c"/>
      <rect y="34" width="90" height="36" fill="url(#ig-floor)"/>
      <path d="M45 34 8 70M45 34 82 70M0 49H90" fill="none" stroke="#8fa2aa" stroke-opacity=".24"/>
      <g fill="#202e36" stroke="#96aab2" stroke-width=".8">
        <rect x="3" y="17" width="20" height="30"/><rect x="67" y="17" width="20" height="30"/>
      </g>
      <g fill="none" stroke="#96aab2" stroke-width=".7">
        <path d="M3 27H23M3 37H23M67 27H87M67 37H87"/>
      </g>
      <g fill="#d58a42">
        <rect x="6" y="20" width="7" height="5"/><rect x="14" y="20" width="7" height="5"/>
        <rect x="70" y="30" width="7" height="5"/><rect x="78" y="20" width="7" height="5"/>
      </g>
      <path d="M46 34C45 46 55 53 50 72" fill="none" stroke="#f6c84c" stroke-width="3"/>
      <g transform="translate(54 39)">
        <rect x="-2" y="14" width="4" height="11" rx="2" fill="#17232c"/>
        <rect x="18" y="14" width="4" height="11" rx="2" fill="#17232c"/>
        <rect width="20" height="22" rx="4" fill="url(#ig-robot)" stroke="#b9fff8"/>
        <rect x="4" y="5" width="12" height="6" rx="1.5" fill="#13212a"/>
        <circle cx="7" cy="8" r="1.4" fill="#7dd3fc"/><circle cx="13" cy="8" r="1.4" fill="#7dd3fc"/>
        <path d="M10 0V-5M5-5H15" stroke="#7dd3fc"/>
      </g>
    </g>
  </defs>

  <g class="ig-card" transform="translate(2 16)">
    <rect width="98" height="112" rx="9" fill="#0b1221" stroke="#334669"/>
    <text x="10" y="14" fill="#7dd3fc" font-size="7" font-weight="700">01  CAMERA</text>
    <g transform="translate(4 22)" clip-path="url(#ig-frame)">
      <use href="#ig-warehouse"/>
      <g class="ig-noise" fill="#d9f7ff">
        <circle cx="8" cy="9" r=".8"/><circle cx="19" cy="30" r=".7"/><circle cx="29" cy="12" r=".6"/>
        <circle cx="42" cy="25" r=".8"/><circle cx="57" cy="16" r=".7"/><circle cx="74" cy="31" r=".8"/>
        <circle cx="84" cy="9" r=".6"/><circle cx="13" cy="57" r=".7"/><circle cx="36" cy="61" r=".8"/>
        <circle cx="61" cy="53" r=".6"/><circle cx="81" cy="64" r=".8"/>
      </g>
      <path class="ig-scan" d="M0 8H90" stroke="#7dd3fc" stroke-opacity=".55"/>
    </g>
    <text x="49" y="103" text-anchor="middle" fill="#91a1bd" font-size="7">NOISE IN IMAGE</text>
  </g>

  <g class="ig-card ig-card-delay-1" transform="translate(113 16)">
    <rect width="98" height="112" rx="9" fill="#0b1221" stroke="#536044"/>
    <text x="10" y="14" fill="#fbbf24" font-size="7" font-weight="700">02  GAUSSIAN BLUR</text>
    <g transform="translate(4 22)" clip-path="url(#ig-frame)">
      <g filter="url(#ig-soften)"><use href="#ig-warehouse"/></g>
      <rect class="ig-clean-sweep" width="90" height="70" fill="#fbbf24" fill-opacity=".08"/>
    </g>
    <text x="49" y="103" text-anchor="middle" fill="#fbbf24" font-size="7">REDUCE NOISE</text>
  </g>

  <g class="ig-card ig-card-delay-2" transform="translate(224 16)">
    <rect width="98" height="112" rx="9" fill="#071019" stroke="#315f64"/>
    <text x="10" y="14" fill="#5eead4" font-size="7" font-weight="700">03  CANNY</text>
    <g transform="translate(4 22)" clip-path="url(#ig-frame)" fill="none" stroke="#63efe0" stroke-width="1">
      <g opacity=".2">
        <path d="M0 34H90M45 34 8 70M45 34 82 70M0 49H90"/>
        <path d="M3 17H23V47H3ZM67 17H87V47H67ZM3 27H23M3 37H23M67 27H87M67 37H87"/>
        <path d="M46 34C45 46 55 53 50 72M54 53v-10q0-4 4-4h12q4 0 4 4v18q0 4-4 4H58q-4 0-4-4Z"/>
      </g>
      <path class="ig-edge ig-edge-a" d="M0 34H90M45 34 8 70M45 34 82 70M0 49H90"/>
      <path class="ig-edge ig-edge-b" d="M3 17H23V47H3ZM67 17H87V47H67ZM3 27H23M3 37H23M67 27H87M67 37H87"/>
      <path class="ig-edge ig-edge-c" d="M46 34C45 46 55 53 50 72M54 53v-10q0-4 4-4h12q4 0 4 4v18q0 4-4 4H58q-4 0-4-4Z"/>
    </g>
    <text x="49" y="103" text-anchor="middle" fill="#5eead4" font-size="7">FIND EDGES</text>
  </g>

  <g class="ig-card ig-card-delay-3" transform="translate(335 16)">
    <rect width="97" height="112" rx="9" fill="#0b1221" stroke="#4b4772"/>
    <text x="10" y="14" fill="#c4b5fd" font-size="7" font-weight="700">04  COMPARE</text>
    <g transform="translate(48 57)">
      <circle r="25" fill="#09101d" stroke="#273553" stroke-width="5"/>
      <circle class="ig-progress" r="25" fill="none" stroke="#5eead4" stroke-width="5" pathLength="100" stroke-dasharray="78 100"/>
      <text y="-1" text-anchor="middle" fill="#eafdfb" font-size="13" font-weight="800">78%</text>
      <text y="10" text-anchor="middle" fill="#8190aa" font-size="5.5">EDGE MATCH</text>
    </g>
    <text x="48" y="103" text-anchor="middle" fill="#c4b5fd" font-size="7">CLOSER TO TARGET</text>
  </g>

  <g stroke="#5eead4" stroke-width="1.5" marker-end="url(#ig-arrow)">
    <line x1="101" y1="72" x2="110" y2="72"/>
    <line x1="212" y1="72" x2="221" y2="72"/>
    <line x1="323" y1="72" x2="332" y2="72"/>
  </g>
  <g fill="#dffdfa">
    <circle r="2" cy="72"><animate attributeName="cx" values="101;110" dur=".75s" repeatCount="indefinite"/></circle>
    <circle r="2" cy="72"><animate attributeName="cx" values="212;221" dur=".75s" begin=".25s" repeatCount="indefinite"/></circle>
    <circle r="2" cy="72"><animate attributeName="cx" values="323;332" dur=".75s" begin=".5s" repeatCount="indefinite"/></circle>
  </g>
  <text x="217" y="149" text-anchor="middle" fill="#71809c" font-size="7.5" letter-spacing=".7">
    CLEAN THE IMAGE  →  FIND THE EDGES  →  CHECK THE RESULT
  </text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "カメラ画像から、物の輪郭を見つけよう",
      en: "Find object edges in a camera image",
    },
    learn: {
      ja: "カメラ画像には、照明やセンサーによる細かなノイズが混ざります。そのまま輪郭を探すと、ノイズまで線として検出してしまいます。そこで最初に gaussian_blur（ぼかし）で細かなノイズを減らし、その後に canny で明るさが大きく変わる場所を輪郭として探します。つまり「画像を整える → 輪郭を探す」という順番です。ゲーム画面の「輪郭の一致度」は、見つけた輪郭がお手本にどれだけ近いかを表します。内部では F1 スコアという採点方法を使いますが、まずは100%に近いほど良い、と考えれば大丈夫です。",
      en: "Camera images contain small amounts of noise from lighting and the sensor. If we search for edges immediately, that noise can also become unwanted lines. We therefore use gaussian_blur first to reduce fine noise, then canny to find places where brightness changes sharply. The order is simply “clean the image → find its edges.” Edge Match shows how closely your result resembles the target. It uses an F1 score internally, but for now you only need to know that closer to 100% is better.",
    },
    goal: {
      ja: "「見つけた輪郭」を「お手本」に近づけ、輪郭の一致度を55%より上にすればクリア。",
      en: "Match EDGES FOUND to TARGET and raise Edge Match above 55%.",
    },
    first: {
      ja: "①「ノイズを減らす gaussian_blur」→「輪郭を探す canny」の順を確認　② ▶ RUN　③ 数値を変えながら「見つけた輪郭」と「お手本」を見比べます。",
      en: "① Check “reduce noise: gaussian_blur” → “find edges: canny”  ② Press ▶ RUN  ③ Tune the values while comparing EDGES FOUND with TARGET.",
    },
  },
  strings: {
    ja: {
      hint: "INPUT上をマウス / IJKL / 🎮右スティックで画素選択 / blur σ ↑ ノイズ減 / canny比 1:2〜1:3",
      palette_hint: "① gaussian_blurでノイズを減らす → ② cannyで輪郭を探す",
      processing: "画像処理中 — 輪郭の一致度が55%を超えればクリア",
      stop: "停止 — RUN で再評価",
      tip: "blur と canny の閾値を調整してエッジを正確に抽出しよう (live preview)",
    },
    en: {
      hint: "Inspect INPUT with mouse / IJKL / pad right stick / raise blur σ for noise / canny ratio 1:2–1:3",
      palette_hint: "Stack blur → canny and tune thresholds (lesson 7 — image processing)",
      processing: "Processing — clear when F1 exceeds 0.55",
      stop: "Stopped — press RUN to re-evaluate",
      tip: "Tune blur and canny thresholds to extract edges accurately (live preview)",
    },
  },
  build: makeImageProcessing,
});
