// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Shared base for "camera mission" stages (edge_detection /
// object_detection): a teleop robot on a top-down map with walls and
// colored circular targets, plus a pseudo onboard camera (perspective
// floor projection) sampled from the world buffer.
//
// The base owns everything the two stages used to duplicate line by line:
//   - map / camera constants and the wall layout
//   - world painting + the cached pixel buffer
//   - camera capture (sky + floor projection + noise)
//   - world → camera projection and circle-vs-wall collision
//   - WASD / arrow / pad drive input and the DRIVE ↔ TUNE pad toggle
//   - physics stepping with bump feedback and the trail
//   - the whole top-down (left pane) rendering incl. timer + mode badge
//
// Stages keep what actually differs: their processing pipeline, capture
// rules, the right-hand panel, HUD lines, goal handling, and publishing.
import { W, H, type GameContext } from "../types";
import { theme, withA } from "../core/theme";

import { drawGrid, drawZone, drawRobotBody, drawRobotLabel, COLORS } from "./draw";
import { Trail } from "./trail";
import { Particles } from "./particles";
import { setBlockpadGamepadDisabled } from "./blockpad";
import { registerLang, t } from "../i18n";

export const PX_PER_M = 100;
export const ROBOT_R = 12;

// -- Map (left half of the canvas).
export const MAP_W = 520;
export const MAP_H = H;

// -- Pseudo camera (floor projection / POV).
export const IMG_W = 200;
export const IMG_H = 150;
export const HORIZON_Y = Math.floor(IMG_H * 0.4); // Above = sky, below = floor
export const FOCAL_LEN = 110; // Focal length in px — controls FOV
export const CAM_HEIGHT = 28; // Camera height (px-equivalent) — smaller = floor appears closer/wider
// View frustum overlay drawn on the top-down map.
const FRUSTUM_DEPTH = 220;
const FRUSTUM_HALF_W = (FRUSTUM_DEPTH * (IMG_W / 2)) / FOCAL_LEN;

// -- Start / Goal.
export const START = { x: 60, y: 60, theta: Math.PI / 2 }; // Faces straight down
export const GOAL = { x: MAP_W - 70, y: MAP_H - 70, r: 28 };

// -- Driving parameters.
export const FWD_SPEED = 0.55; // m/s, default
export const TURN_RATE = 1.6; // rad/s, default
export const BOOST_MUL = 1.5; // multiplier when shift is held

// -- Interior obstacles (rectangular walls).
export const WALLS: { x: number; y: number; w: number; h: number }[] = [
  // Outer perimeter (thin).
  { x: 0, y: 0, w: MAP_W, h: 4 },
  { x: 0, y: MAP_H - 4, w: MAP_W, h: 4 },
  { x: 0, y: 0, w: 4, h: MAP_H },
  { x: MAP_W - 4, y: 0, w: 4, h: MAP_H },
  // Inner pillars and walls.
  { x: 130, y: 110, w: 60, h: 18 },
  { x: 220, y: 80, w: 18, h: 90 },
  { x: 300, y: 160, w: 80, h: 18 },
  { x: 80, y: 290, w: 18, h: 90 },
  { x: 200, y: 380, w: 80, h: 18 },
  { x: 380, y: 240, w: 18, h: 80 },
  { x: 320, y: 380, w: 18, h: 80 },
];

registerLang({
  ja: {
    "camera_mission.mode.drive": "DRIVE モード — パッドで teleop (Y で TUNE)",
    "camera_mission.mode.tune": "TUNE モード — パッドでブロックエディタ操作 (Y で DRIVE)",
  },
  en: {
    "camera_mission.mode.drive": "DRIVE mode — pad teleops the robot (Y → TUNE)",
    "camera_mission.mode.tune": "TUNE mode — pad navigates block editor (Y → DRIVE)",
  },
});

/** A colored circular object placed on the floor for the camera to see. */
export interface CameraTarget {
  x: number;
  y: number;
  r: number;
  color: string;
  /** Short text painted on the floor and shown on reticles/bboxes. */
  label: string;
}

export interface CameraMissionOpts {
  targets: CameraTarget[];
  /** Optional yellow guide line painted on the floor (edge_detection). */
  linePath?: { x: number; y: number }[];
}

export type CameraMission = ReturnType<typeof createCameraMission>;

export function createCameraMission(opts: CameraMissionOpts) {
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail = new Trail({ max: 250, interval: 0.06 });
  const captured: boolean[] = opts.targets.map(() => false);
  let g!: GameContext;
  let bumpFlash = 0;
  // Gamepad toggle between DRIVE and TUNE (Y button).
  let tuneMode = false;
  let prevYBtn = false;

  // -- World canvas (repainted on reset: floor + line + walls + targets).
  const worldCanvas = document.createElement("canvas");
  worldCanvas.width = MAP_W;
  worldCanvas.height = MAP_H;
  const worldCtx = worldCanvas.getContext("2d", { willReadFrequently: true })!;
  let worldData: Uint8ClampedArray | null = null; // cached after paintWorld()

  // -- Camera offscreen (rewritten every frame).
  const camCanvas = document.createElement("canvas");
  camCanvas.width = IMG_W;
  camCanvas.height = IMG_H;
  const camCtx = camCanvas.getContext("2d", { willReadFrequently: true })!;

  /** Call from the stage's init(): binds the context and enters DRIVE mode. */
  function enter(ctx: GameContext) {
    g = ctx;
    tuneMode = false;
    prevYBtn = false;
    setBlockpadGamepadDisabled(true);
  }

  /** Call from the stage's dispose(): gives the pad back to the blockpad. */
  function leave() {
    setBlockpadGamepadDisabled(false);
  }

  /** Reset pose / trail / particles / bump — the per-RUN part. */
  function resetRun() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    particles.reset();
    trail.reset();
    bumpFlash = 0;
  }

  /** Full reset: also clears captures and repaints the world. */
  function reset() {
    resetRun();
    captured.fill(false);
    paintWorld();
  }

  function allCaptured(): boolean {
    return captured.every(Boolean);
  }
  function capturedCount(): number {
    return captured.filter(Boolean).length;
  }
  function goalReached(): boolean {
    return Math.hypot(robot.x - GOAL.x, robot.y - GOAL.y) < GOAL.r;
  }

  // ====================================================================
  // World render (on reset).
  // ====================================================================
  function paintWorld() {
    const c = worldCtx;
    // Floor.
    c.fillStyle = theme.floor;
    c.fillRect(0, 0, MAP_W, MAP_H);

    // Yellow line (route hint).
    if (opts.linePath && opts.linePath.length >= 2) {
      c.save();
      c.lineCap = "round";
      c.lineJoin = "round";
      c.strokeStyle = "rgba(0,0,0,0.35)";
      c.lineWidth = 18;
      drawLinePath(c, opts.linePath);
      c.strokeStyle = "#facc15";
      c.lineWidth = 12;
      drawLinePath(c, opts.linePath);
      c.strokeStyle = "rgba(255,255,255,0.18)";
      c.lineWidth = 2;
      drawLinePath(c, opts.linePath);
      c.restore();
    }

    // Walls / obstacles.
    for (const wall of WALLS) {
      c.fillStyle = "#3a4366";
      c.fillRect(wall.x, wall.y, wall.w, wall.h);
      c.strokeStyle = "rgba(110, 122, 156, 0.65)";
      c.lineWidth = 1;
      c.strokeRect(wall.x + 0.5, wall.y + 0.5, wall.w - 1, wall.h - 1);
      // Highlight (top and left edges).
      c.fillStyle = "rgba(255, 255, 255, 0.10)";
      c.fillRect(wall.x, wall.y, wall.w, 2);
      c.fillRect(wall.x, wall.y, 2, wall.h);
    }

    // Colored targets.
    for (const t of opts.targets) {
      // Shadow.
      c.fillStyle = "rgba(0,0,0,0.35)";
      c.beginPath();
      c.arc(t.x + 1, t.y + 2, t.r, 0, Math.PI * 2);
      c.fill();
      // Body.
      c.fillStyle = t.color;
      c.beginPath();
      c.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      c.fill();
      // Rim.
      c.strokeStyle = "rgba(255,255,255,0.4)";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(t.x, t.y, t.r, 0, Math.PI * 2);
      c.stroke();
      // Label drawn on the floor — appearing upside down from the bot is fine.
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.font = "700 8px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText(t.label, t.x, t.y + 3);
    }
    // Cache the entire pixel buffer for floor projection.
    worldData = worldCtx.getImageData(0, 0, MAP_W, MAP_H).data;
  }

  function drawLinePath(c: CanvasRenderingContext2D, p: { x: number; y: number }[]) {
    c.beginPath();
    c.moveTo(p[0].x, p[0].y);
    // Smooth join: quasi Catmull-Rom (quadraticCurveTo through midpoints).
    for (let i = 1; i < p.length - 1; i++) {
      const xc = (p[i].x + p[i + 1].x) / 2;
      const yc = (p[i].y + p[i + 1].y) / 2;
      c.quadraticCurveTo(p[i].x, p[i].y, xc, yc);
    }
    const last = p[p.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  // ====================================================================
  // Render the pseudo-camera frame (POV / floor projection).
  // Top half = sky, bottom half = floor under perspective projection.
  // Each pixel inverse-projects to world coords and samples the world buffer.
  // Returns the RGBA buffer for use as pipeline input.
  // ====================================================================
  function captureCamera(): Uint8ClampedArray {
    const id = camCtx.createImageData(IMG_W, IMG_H);
    const data = id.data;
    const cosT = Math.cos(robot.theta);
    const sinT = Math.sin(robot.theta);

    // Top half: sky, dark above and slightly brighter near the horizon.
    for (let yi = 0; yi < HORIZON_Y; yi++) {
      const t = yi / HORIZON_Y;
      const r = 4 + Math.floor(t * 14);
      const gg = 6 + Math.floor(t * 18);
      const bb = 14 + Math.floor(t * 28);
      for (let xi = 0; xi < IMG_W; xi++) {
        const j = (yi * IMG_W + xi) * 4;
        data[j] = r;
        data[j + 1] = gg;
        data[j + 2] = bb;
        data[j + 3] = 255;
      }
    }
    // Faint bright line at the horizon as a depth anchor.
    for (let xi = 0; xi < IMG_W; xi++) {
      const j = (HORIZON_Y * IMG_W + xi) * 4;
      data[j] = 60;
      data[j + 1] = 70;
      data[j + 2] = 92;
      data[j + 3] = 255;
    }

    // Bottom half: floor projection.
    // dy = yi - horizon (>0). Smaller dy = farther, larger dy = nearer.
    const fogR = 22,
      fogG = 28,
      fogB = 42; // distant fog color
    for (let yi = HORIZON_Y + 1; yi < IMG_H; yi++) {
      const dy = yi - HORIZON_Y;
      const distance = (FOCAL_LEN * CAM_HEIGHT) / dy; // world distance of this row
      const fog = Math.min(1, distance / 320);
      const blend = fog * 0.7;
      const distPerFocal = distance / FOCAL_LEN;
      // The forward translation for this row is constant per row.
      const fwdX = cosT * distance;
      const fwdY = sinT * distance;
      for (let xi = 0; xi < IMG_W; xi++) {
        const lat = (xi - IMG_W / 2) * distPerFocal;
        // World coords (canvas: +x=right, +y=down,
        // forward=(cos θ, sin θ), right=(-sin θ, cos θ)).
        const wx = robot.x + fwdX - sinT * lat;
        const wy = robot.y + fwdY + cosT * lat;
        const ix = wx | 0,
          iy = wy | 0;
        let r = fogR,
          gg = fogG,
          bb = fogB;
        if (worldData && ix >= 0 && ix < MAP_W && iy >= 0 && iy < MAP_H) {
          const k = (iy * MAP_W + ix) * 4;
          r = worldData[k];
          gg = worldData[k + 1];
          bb = worldData[k + 2];
        }
        // Distance fog.
        r = r * (1 - blend) + fogR * blend;
        gg = gg * (1 - blend) + fogG * blend;
        bb = bb * (1 - blend) + fogB * blend;
        // Noise.
        const n = (Math.random() - 0.5) * 32;
        const j = (yi * IMG_W + xi) * 4;
        data[j] = Math.max(0, Math.min(255, r + n));
        data[j + 1] = Math.max(0, Math.min(255, gg + n));
        data[j + 2] = Math.max(0, Math.min(255, bb + n));
        data[j + 3] = 255;
      }
    }

    camCtx.putImageData(id, 0, 0);
    return data;
  }

  // World coords → camera image coords (inverse of the floor projection).
  function projectToCamera(
    wx: number,
    wy: number,
  ): { xi: number; yi: number; depth: number; lateral: number } | null {
    const dx = wx - robot.x,
      dy = wy - robot.y;
    const cosT = Math.cos(robot.theta),
      sinT = Math.sin(robot.theta);
    const forward = cosT * dx + sinT * dy; // forward distance from robot
    const lateral = -sinT * dx + cosT * dy; // rightward offset
    if (forward < 30) return null; // too close or behind
    const yi = HORIZON_Y + (FOCAL_LEN * CAM_HEIGHT) / forward;
    const xi = IMG_W / 2 + (lateral * FOCAL_LEN) / forward;
    if (xi < 0 || xi >= IMG_W || yi < HORIZON_Y || yi >= IMG_H) return null;
    return { xi, yi, depth: forward, lateral };
  }

  // ====================================================================
  // Collision: AABB wall vs circle robot.
  // ====================================================================
  function canMoveTo(x: number, y: number): boolean {
    if (x < ROBOT_R || x > MAP_W - ROBOT_R || y < ROBOT_R || y > MAP_H - ROBOT_R) return false;
    for (const wall of WALLS) {
      const cx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
      const cy = Math.max(wall.y, Math.min(y, wall.y + wall.h));
      const dx = x - cx,
        dy = y - cy;
      if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
    }
    return true;
  }

  // ====================================================================
  // Input / physics.
  // ====================================================================

  /** Pad Y button toggles DRIVE ↔ TUNE. Call once per update. */
  function pollTuneToggle() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p) {
        pad = p;
        break;
      }
    }
    const yPressed = pad?.buttons[3]?.pressed ?? false;
    if (yPressed && !prevYBtn) {
      tuneMode = !tuneMode;
      setBlockpadGamepadDisabled(!tuneMode);
      g.sfx.click();
      g.setStatus(
        tuneMode ? t("camera_mission.mode.tune") : t("camera_mission.mode.drive"),
        tuneMode ? "var(--accent-2)" : "var(--accent)",
      );
    }
    prevYBtn = yPressed;
  }

  /** Drive keys (keyboard WASD/arrows or gamepad — both land in g.keys). */
  function readDrive(): { v: number; w: number } {
    let v = 0,
      w = 0;
    const keys = g.keys;
    if (keys.has("w") || keys.has("arrowup")) v += FWD_SPEED;
    if (keys.has("s") || keys.has("arrowdown")) v -= FWD_SPEED * 0.6;
    if (keys.has("a") || keys.has("arrowleft")) w -= TURN_RATE;
    if (keys.has("d") || keys.has("arrowright")) w += TURN_RATE;
    if (keys.has("shift") || keys.has("x")) v *= BOOST_MUL;
    return { v, w };
  }

  /** Decay the bump flash. Call once per update (before stepPhysics). */
  function decayBump(dt: number) {
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);
  }

  /**
   * Integrate motion with collision. On a wall hit: light feedback
   * (bump, no full crash/reset). Also advances the trail.
   * Returns true when the robot bumped.
   */
  function stepPhysics(v: number, w: number, dt: number): boolean {
    robot.theta += w * dt;
    const nx = robot.x + v * Math.cos(robot.theta) * dt * PX_PER_M;
    const ny = robot.y + v * Math.sin(robot.theta) * dt * PX_PER_M;
    let bumped = false;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else {
      bumped = true;
      bumpFlash = 0.4;
      g.shake(0.2);
      g.sfx.bump();
    }
    trail.update(dt, robot.x, robot.y);
    return bumped;
  }

  // ====================================================================
  // Top-down (left pane) rendering.
  // ====================================================================
  function drawTopDown(c: CanvasRenderingContext2D, elapsed: number) {
    c.drawImage(worldCanvas, 0, 0);
    drawGrid(c, MAP_W, MAP_H);

    // Captured targets get a ✓ overlay; uncaptured ones are highlighted.
    for (let i = 0; i < opts.targets.length; i++) {
      const t = opts.targets[i];
      if (captured[i]) {
        // Check mark + green ring.
        c.save();
        c.strokeStyle = COLORS.OK;
        c.lineWidth = 2.5;
        c.beginPath();
        c.moveTo(t.x - 6, t.y);
        c.lineTo(t.x - 2, t.y + 4);
        c.lineTo(t.x + 6, t.y - 5);
        c.stroke();
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(t.x, t.y, t.r + 4, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      } else {
        // Pulsing outer ring to signal "not captured yet".
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4 + i);
        c.save();
        c.strokeStyle = t.color;
        c.globalAlpha = 0.35 + 0.3 * pulse;
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(t.x, t.y, t.r + 6 + pulse * 3, 0, Math.PI * 2);
        c.stroke();
        c.restore();
      }
    }

    // Goal — glows strongly once everything is captured.
    drawZone(c, GOAL, allCaptured() ? COLORS.OK : "rgba(94,234,212,0.5)", "GOAL", elapsed);

    // Start marker.
    c.save();
    c.strokeStyle = "rgba(125,211,252,0.55)";
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(START.x, START.y, 18, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(125,211,252,0.7)";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("START", START.x, START.y - 24);
    c.restore();

    // Trail.
    if (trail.length > 1) {
      const samples = trail.samples();
      c.strokeStyle = "rgba(125,211,252,0.45)";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(samples[0].x, samples[0].y);
      for (let i = 1; i < samples.length; i++) c.lineTo(samples[i].x, samples[i].y);
      c.stroke();
    }

    // Ghost (best run replay).
    g.ghost.draw(c, elapsed, elapsed);

    // Camera view frustum drawn as a triangle on the top-down map.
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    c.fillStyle = "rgba(125,211,252,0.10)";
    c.strokeStyle = "rgba(125,211,252,0.35)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(FRUSTUM_DEPTH, -FRUSTUM_HALF_W);
    c.lineTo(FRUSTUM_DEPTH, FRUSTUM_HALF_W);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();

    // Robot.
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, elapsed);
    drawRobotLabel(c);
    c.restore();

    particles.draw(c);

    // Tiny custom timer (map top-right): drawTimer renders at the canvas
    // top-right which would clash with the camera panel here.
    c.save();
    c.fillStyle = withA(theme.scrim, 0.85);
    c.strokeStyle = "rgba(125, 211, 252, 0.3)";
    c.fillRect(MAP_W - 130, 12, 110, 26);
    c.strokeRect(MAP_W - 130, 12, 110, 26);
    c.fillStyle = "#7dd3fc";
    c.font = "600 12px ui-monospace, monospace";
    c.textAlign = "right";
    c.textBaseline = "middle";
    c.fillText(`${elapsed.toFixed(2)}s`, MAP_W - 28, 25);
    c.fillStyle = "#6e7a9c";
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("TIME", MAP_W - 122, 26);
    c.restore();

    // Mode badge (top-left): which input the pad is driving right now.
    c.save();
    const badgeColor = tuneMode ? "#c4b5fd" : "#7dd3fc";
    const badgeBg = tuneMode ? "rgba(196, 181, 253, 0.18)" : "rgba(125, 211, 252, 0.15)";
    c.fillStyle = badgeBg;
    c.strokeStyle = badgeColor;
    c.fillRect(12, 12, 156, 26);
    c.strokeRect(12, 12, 156, 26);
    c.fillStyle = badgeColor;
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(tuneMode ? "🎮 TUNE  (Y → DRIVE)" : "🎮 DRIVE  (Y → TUNE)", 20, 25);
    c.restore();
  }

  /** Fill the right pane background and draw the separator line. */
  function drawRightPanelFrame(c: CanvasRenderingContext2D) {
    c.fillStyle = theme.rightPane;
    c.fillRect(MAP_W, 0, W - MAP_W, H);
    c.strokeStyle = "rgba(35,44,77,0.7)";
    c.beginPath();
    c.moveTo(MAP_W, 0);
    c.lineTo(MAP_W, H);
    c.stroke();
  }

  return {
    robot,
    particles,
    trail,
    captured,
    camCanvas,
    enter,
    leave,
    reset,
    resetRun,
    paintWorld,
    captureCamera,
    projectToCamera,
    canMoveTo,
    pollTuneToggle,
    readDrive,
    decayBump,
    stepPhysics,
    drawTopDown,
    drawRightPanelFrame,
    allCaptured,
    capturedCount,
    goalReached,
    get tuneMode() {
      return tuneMode;
    },
  };
}
