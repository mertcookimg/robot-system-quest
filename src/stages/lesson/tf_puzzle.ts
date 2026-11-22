// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { cssStageColor, stageColor } from "../../lib/stage_colors";

// tf_puzzle: TF Frame Puzzle
// The LiDAR is physically mounted offset from the robot center.
// The player must guess the base_link → laser TF (tx, ty, yaw) via sliders.
// Wrong values → scan points scatter off the walls. Correct values →
// scan points snap to the walls.
// Clear when ≥95% of rays match a wall.
import { type Stage, type GameContext } from "../../types";
import { theme, themeColor, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";
import { drawHint, drawTimer, drawRobotBody, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { t, tx, onLangChange } from "../../i18n";

// World layout
const WORLD_X = 16;
const WORLD_Y = 50;
const WORLD_W = 552;
const WORLD_H = 360;

const N_RAYS = 72;
const MAX_RANGE = 280;

const ROBOT_POS = {
  x: WORLD_X + WORLD_W / 2,
  y: WORLD_Y + WORLD_H / 2,
  theta: 0,
};

// Walls (ground truth, in world frame): 4 perimeter walls + interior obstacles.
const walls = [
  // outer perimeter — fully closes the room so every ray hits some wall
  { x: WORLD_X, y: WORLD_Y, w: WORLD_W, h: 12 },
  { x: WORLD_X, y: WORLD_Y + WORLD_H - 12, w: WORLD_W, h: 12 },
  { x: WORLD_X, y: WORLD_Y, w: 12, h: WORLD_H },
  { x: WORLD_X + WORLD_W - 12, y: WORLD_Y, w: 12, h: WORLD_H },
  // internal obstacles (interior walls add variety to the LiDAR scan)
  { x: WORLD_X + 80, y: WORLD_Y + 70, w: 110, h: 14 },
  { x: WORLD_X + 200, y: WORLD_Y + 84, w: 14, h: 80 },
  { x: WORLD_X + 380, y: WORLD_Y + 70, w: 110, h: 14 },
  { x: WORLD_X + 380, y: WORLD_Y + 84, w: 14, h: 80 },
  { x: WORLD_X + 80, y: WORLD_Y + 270, w: 110, h: 14 },
  { x: WORLD_X + 200, y: WORLD_Y + 200, w: 14, h: 80 },
  { x: WORLD_X + 380, y: WORLD_Y + 270, w: 110, h: 14 },
  { x: WORLD_X + 380, y: WORLD_Y + 200, w: 14, h: 80 },
];

// True physical mount of the LiDAR (relative to base_link).
// The player has to recover these numbers.
const TRUE_MOUNT = { tx: 14, ty: 8, yaw: -22 }; // px, px, degrees (canvas convention)
/** Mount scale used when the transform is published in metres. */
const PX_PER_M = 100;

/**
 * The sliders use the canvas frame (y down, clockwise-positive yaw). ROS
 * frames follow REP-103 (x forward, y left, counter-clockwise-positive yaw),
 * so the published transform negates y and yaw.
 */
function rosTransform(tf: TFParams): { x: number; y: number; yawDeg: number } {
  return { x: tf.tx / PX_PER_M, y: -tf.ty / PX_PER_M, yawDeg: -tf.yaw };
}

/** /tf_static text: the REP-103 transform, plus the slider values it came from. */
function formatTfStatic(tf: TFParams): string {
  const ros = rosTransform(tf);
  const half = (ros.yawDeg * Math.PI) / 360;
  const fixed = (n: number, digits: number) => (n === 0 ? 0 : n).toFixed(digits);
  return (
    `tf2_msgs/msg/TFMessage transform: frame_id=base_link child_frame_id=laser ` +
    `translation:(x=${fixed(ros.x, 2)} y=${fixed(ros.y, 2)} z=0.00) ` +
    `rotation:(z=${fixed(Math.sin(half), 3)} w=${Math.cos(half).toFixed(3)}) yaw=${fixed(ros.yawDeg, 0)}° ` +
    `[sliders tx=${tf.tx}px ty=${tf.ty}px yaw=${tf.yaw}°]`
  );
}

const TARGET_MATCH = 0.95;
const MATCH_TOL_PX = 5;

interface TFParams {
  tx: number;
  ty: number;
  yaw: number;
}

export function makeTfPuzzle(): Stage {
  let g!: GameContext;
  let elapsed = 0;
  let pubAcc = 0;
  let cleared = false;
  const particles = new Particles();

  // Player's slider values (the guessed base_link → laser TF).
  const playerTF: TFParams = { tx: 0, ty: 0, yaw: 0 };

  let overlayPanel: HTMLElement | null = null;
  let offPanelLanguage = () => {};

  function reset() {
    elapsed = 0;
    pubAcc = 0;
    cleared = false;
    particles.reset();
    playerTF.tx = 0;
    playerTF.ty = 0;
    playerTF.yaw = 0;
    if (overlayPanel) {
      const inputs = overlayPanel.querySelectorAll("input[type=range]");
      const vals = overlayPanel.querySelectorAll(".slider-val");
      inputs.forEach((inp, i) => {
        (inp as HTMLInputElement).value = "0";
        if (vals[i]) (vals[i] as HTMLElement).textContent = i < 2 ? "0 px" : "0°";
      });
    }
    g.ghost.startRecording();
    g.setStatus(t("tf_puzzle.tip"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    const editorEl = document.getElementById("block-editor");
    if (editorEl) editorEl.style.display = "none";
    setupOverlay();
    reset();
  }

  function dispose() {
    offPanelLanguage();
    unregisterOverlayPad();
    if (overlayPanel?.parentNode) overlayPanel.parentNode.removeChild(overlayPanel);
    overlayPanel = null;
    if (g?.overlay) g.overlay.style.cssText = "";
  }

  function setupOverlay() {
    // Placing this inside canvas-wrap overlaps the Clear overlay's Retry/Next controls,
    // so insert it immediately after canvas-wrap, alongside block-editor, as in behavior_tree.
    g.overlay.innerHTML = "";
    g.overlay.style.cssText = "";
    const panel = document.createElement("section");
    panel.id = "tf-puzzle-panel";
    panel.className = "stage-tool-panel tf-puzzle-panel";
    panel.style.cssText =
      "width:min(800px, 100%); margin:10px auto 0; padding:10px 14px; background:rgba(var(--scrim-rgb), 0.92);" +
      "border:1px solid light-dark(rgba(7, 95, 147,0.5), rgba(125, 211, 252, 0.5)); border-radius:8px; display:flex; flex-wrap:wrap; gap:10px; align-items:center;" +
      "font-family:ui-monospace,monospace; font-size:14px; color:light-dark(#172b4d, #edf3ff);";

    const make = (
      key: keyof TFParams,
      label: string,
      unit: string,
      min: number,
      max: number,
      step: number,
    ) => {
      const wrap = document.createElement("label");
      wrap.className = "tf-puzzle-control";
      wrap.dataset.opadRow = "1";
      wrap.style.cssText =
        "display:flex; align-items:center; gap:6px; color:light-dark(#425570, #c2cfe3); padding:4px 6px;";
      const txt = document.createElement("span");
      txt.textContent = label;
      txt.style.color = cssStageColor("#075f93");
      txt.style.fontWeight = "700";
      const inp = document.createElement("input");
      inp.className = "tf-puzzle-slider";
      inp.type = "range";
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(playerTF[key]);
      inp.style.cssText =
        "width:110px; min-height:44px; accent-color:light-dark(#075f93, #7dd3fc);";
      const val = document.createElement("span");
      val.className = "slider-val";
      val.textContent = `${playerTF[key]} ${unit}`;
      val.style.cssText = "min-width:48px; color:light-dark(#172b4d, #edf3ff); font-weight:700;";
      inp.addEventListener("input", () => {
        playerTF[key] = parseFloat(inp.value);
        val.textContent = `${playerTF[key]} ${unit}`;
      });
      wrap.appendChild(txt);
      wrap.appendChild(inp);
      wrap.appendChild(val);
      return wrap;
    };
    panel.appendChild(make("tx", "tx", "px", -30, 30, 1));
    panel.appendChild(make("ty", "ty", "px", -30, 30, 1));
    panel.appendChild(make("yaw", "yaw", "°", -90, 90, 1));

    const reminder = document.createElement("span");
    reminder.className = "tf-puzzle-reminder";
    reminder.style.cssText =
      "color:light-dark(#425570, #c2cfe3); font-size:14px; line-height:1.5; flex-basis:100%;";
    const localize = () => {
      reminder.textContent = tx(
        "base_link → laser を合わせよう / R リセット。🎮 方向キーで選択 · Aで編集 · 編集中は方向キーで調整",
        "Align base_link → laser / R Reset. 🎮 D-pad selects · A edits · D-pad adjusts while editing",
      );
    };
    localize();
    offPanelLanguage = onLangChange(localize);
    panel.appendChild(reminder);

    const canvasWrap = document.getElementById("canvas-wrap");
    if (canvasWrap?.parentNode) {
      canvasWrap.parentNode.insertBefore(panel, canvasWrap.nextSibling);
    } else {
      document.body.appendChild(panel);
    }
    overlayPanel = panel;
    registerOverlayPad(panel);
  }

  // ── geometry helpers ──
  function isPointInWall(x: number, y: number): boolean {
    for (const w of walls) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) return true;
    }
    return false;
  }
  function castRay(ox: number, oy: number, angle: number): number {
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    for (let d = 0; d <= MAX_RANGE; d += 2) {
      const x = ox + dx * d,
        y = oy + dy * d;
      if (x < WORLD_X || x > WORLD_X + WORLD_W) return d;
      if (y < WORLD_Y || y > WORLD_Y + WORLD_H) return d;
      if (isPointInWall(x, y)) return d;
    }
    return MAX_RANGE;
  }
  function nearestWallDist(x: number, y: number): number {
    let best = Infinity;
    for (const w of walls) {
      const cx = Math.max(w.x, Math.min(x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(y, w.y + w.h));
      const dx = x - cx,
        dy = y - cy;
      const d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    return best;
  }

  // True LiDAR pose in world frame
  function trueLidarPose(): { x: number; y: number; theta: number } {
    const cosR = Math.cos(ROBOT_POS.theta),
      sinR = Math.sin(ROBOT_POS.theta);
    return {
      x: ROBOT_POS.x + cosR * TRUE_MOUNT.tx - sinR * TRUE_MOUNT.ty,
      y: ROBOT_POS.y + sinR * TRUE_MOUNT.tx + cosR * TRUE_MOUNT.ty,
      theta: ROBOT_POS.theta + (TRUE_MOUNT.yaw * Math.PI) / 180,
    };
  }

  // local laser-frame point (lx, ly) → world frame using player TF + robot pose
  function laserToWorld(lx: number, ly: number): { x: number; y: number } {
    const playerYaw = (playerTF.yaw * Math.PI) / 180;
    const cosY = Math.cos(playerYaw),
      sinY = Math.sin(playerYaw);
    const bx = playerTF.tx + cosY * lx - sinY * ly;
    const by = playerTF.ty + sinY * lx + cosY * ly;
    const cosR = Math.cos(ROBOT_POS.theta),
      sinR = Math.sin(ROBOT_POS.theta);
    return {
      x: ROBOT_POS.x + cosR * bx - sinR * by,
      y: ROBOT_POS.y + sinR * bx + cosR * by,
    };
  }

  // Run scan once, return per-ray reconstructed point + match flag
  interface RayResult {
    lx: number;
    ly: number;
    recX: number;
    recY: number;
    matched: boolean;
  }
  function runScan(): RayResult[] {
    const result: RayResult[] = [];
    const tp = trueLidarPose();
    for (let i = 0; i < N_RAYS; i++) {
      const localAng = (i / N_RAYS) * Math.PI * 2;
      const worldAng = tp.theta + localAng;
      const d = castRay(tp.x, tp.y, worldAng);
      if (d >= MAX_RANGE) continue;
      const lx = d * Math.cos(localAng);
      const ly = d * Math.sin(localAng);
      const w = laserToWorld(lx, ly);
      const matched = nearestWallDist(w.x, w.y) <= MATCH_TOL_PX;
      result.push({ lx, ly, recX: w.x, recY: w.y, matched });
    }
    return result;
  }

  let lastScan: RayResult[] = [];

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

    lastScan = runScan();
    const matchedCount = lastScan.filter((r) => r.matched).length;
    const score = lastScan.length > 0 ? matchedCount / lastScan.length : 0;

    // Keep the winning transform visible too; completion stops later updates.
    pubAcc += dt;
    if (pubAcc >= 0.2 || score >= TARGET_MATCH) {
      pubAcc = 0;
      g.publish("/tf_static", formatTfStatic(playerTF));
      g.publish(
        "/scan",
        `sensor_msgs/msg/LaserScan summary hits:${lastScan.length}/${N_RAYS} ranges_px:[${lastScan.map((ray) => Math.hypot(ray.lx, ray.ly).toFixed(1)).join(",")}]`,
      );
    }

    if (score >= TARGET_MATCH) {
      cleared = true;
      particles.burst(ROBOT_POS.x, ROBOT_POS.y, "#087764", 36, 240);
      g.shake(0.5);
      g.setStatus(t("tf_puzzle.status.complete"), "var(--ok)");
      const stars = elapsed < 30 ? 3 : elapsed < 60 ? 2 : 1;
      const stats =
        `tx       <b>${playerTF.tx}</b> px (truth: ${TRUE_MOUNT.tx})<br>` +
        `ty       <b>${playerTF.ty}</b> px (truth: ${TRUE_MOUNT.ty})<br>` +
        `yaw      <b>${playerTF.yaw}°</b> (truth: ${TRUE_MOUNT.yaw}°)<br>` +
        `Time     <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
      return;
    }

    g.setHud([
      `mode:    TF puzzle (base_link → laser)`,
      `tf:      tx=${playerTF.tx}  ty=${playerTF.ty}  yaw=${playerTF.yaw}°`,
      `match:   ${(score * 100).toFixed(0)}% / ${(TARGET_MATCH * 100).toFixed(0)}%  (${matchedCount}/${lastScan.length} rays)`,
      `hint:    ロボに描かれた青い LiDAR の位置と向きを当てる`,
    ]);
  }

  // ── DRAW ──
  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);

    // World background
    ctx.fillStyle = withA(theme.scrim, 0.6);
    ctx.fillRect(WORLD_X, WORLD_Y, WORLD_W, WORLD_H);
    ctx.strokeStyle = themeColor(theme.fgDim, stageColor("rgba(7, 95, 147,0.3)"));
    ctx.lineWidth = 1;
    ctx.strokeRect(WORLD_X, WORLD_Y, WORLD_W, WORLD_H);

    // Walls (truth)
    for (const w of walls) {
      ctx.fillStyle = stageColor("#8298b4");
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = themeColor(theme.fgDim, stageColor("rgba(88, 106, 130,0.6)"));
      ctx.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }

    // Reconstructed hit points using player's TF
    drawReconstructedHits(ctx);

    // Robot (with true LiDAR icon + player's ghost)
    drawRobot(ctx);

    // TF tree panel (right top)
    drawTfTree(ctx);
    // Score panel (right middle)
    drawScorePanel(ctx);

    drawTimer(ctx, elapsed);
    drawHint(ctx, t("tf_puzzle.hint"));

    particles.draw(ctx);
  }

  function drawReconstructedHits(ctx: CanvasRenderingContext2D) {
    ctx.save();
    // A surface-colored rim separates scan hits from the wall underneath.
    ctx.strokeStyle = theme.canvasBg;
    ctx.lineWidth = 1.5;
    for (const r of lastScan) {
      ctx.fillStyle = themeColor(
        r.matched ? theme.ok : theme.danger,
        stageColor(r.matched ? "rgba(8, 119, 100,0.88)" : "rgba(190, 41, 73,0.88)"),
      );
      ctx.beginPath();
      ctx.arc(r.recX, r.recY, 2.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRobot(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.translate(ROBOT_POS.x, ROBOT_POS.y);
    ctx.rotate(ROBOT_POS.theta);

    // Shared pixel-art robot, matching the other stages.
    drawRobotBody(ctx, 0, elapsed);

    // ── TRUE LiDAR mount marker (always visible — this is the physical truth) ──
    const truYawRad = (TRUE_MOUNT.yaw * Math.PI) / 180;
    ctx.save();
    ctx.translate(TRUE_MOUNT.tx, TRUE_MOUNT.ty);
    ctx.rotate(truYawRad);
    // halo
    ctx.fillStyle = stageColor("rgba(7, 95, 147,0.25)");
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = stageColor("#075f93");
    ctx.strokeStyle = stageColor("#f1f5fb");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // forward arrow
    ctx.strokeStyle = stageColor("#075f93");
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.restore();

    // ── Player's TF guess (ghost) ──
    const plYawRad = (playerTF.yaw * Math.PI) / 180;
    ctx.save();
    ctx.translate(playerTF.tx, playerTF.ty);
    ctx.rotate(plYawRad);
    ctx.strokeStyle = stageColor("rgba(109, 66, 181,0.85)");
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(11, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.restore();

    // Labels
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = stageColor("#075f93");
    ctx.fillText("● truth (physical mount)", ROBOT_POS.x + 24, ROBOT_POS.y - 18);
    ctx.fillStyle = stageColor("#6d42b5");
    ctx.fillText("◌ your TF (sliders)", ROBOT_POS.x + 24, ROBOT_POS.y - 6);
  }

  function drawTfTree(ctx: CanvasRenderingContext2D) {
    const px = 588,
      py = 64;
    const pw = 200,
      ph = 196;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = themeColor(theme.fgDim, "rgba(255,255,255,0.25)");
    ctx.fillRect(px - 6, py - 22, pw + 12, ph);
    ctx.strokeRect(px - 6, py - 22, pw + 12, ph);

    ctx.fillStyle = stageColor("#075f93");
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("TF TREE", px, py - 6);

    const frames = [
      { name: "map", y: py + 14, hi: false },
      { name: "odom", y: py + 50, hi: false },
      { name: "base_link", y: py + 86, hi: false },
      { name: "laser", y: py + 134, hi: true },
    ];
    for (const f of frames) {
      ctx.fillStyle = stageColor(f.hi ? "#925b00" : "#e4edf8");
      ctx.fillRect(px + 30, f.y - 11, 120, 22);
      ctx.strokeStyle = f.hi
        ? theme.warn
        : themeColor(theme.accent, stageColor("rgba(7, 95, 147,0.4)"));
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 30, f.y - 11, 120, 22);
      ctx.fillStyle = stageColor(f.hi ? "#f1f5fb" : "#172b4d");
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText(f.name, px + 90, f.y + 4);
    }
    // arrows
    ctx.lineWidth = 1.5;
    for (let i = 0; i < frames.length - 1; i++) {
      const yFrom = frames[i].y + 11;
      const yTo = frames[i + 1].y - 11;
      const isTarget = i === frames.length - 2;
      ctx.strokeStyle = isTarget
        ? theme.warn
        : themeColor(theme.accent, stageColor("rgba(7, 95, 147,0.6)"));
      ctx.beginPath();
      ctx.moveTo(px + 90, yFrom);
      ctx.lineTo(px + 90, yTo);
      ctx.stroke();
      // arrowhead
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(px + 90, yTo);
      ctx.lineTo(px + 86, yTo - 5);
      ctx.lineTo(px + 94, yTo - 5);
      ctx.fill();
    }
    // current TF values next to the highlighted arrow
    ctx.fillStyle = stageColor("#925b00");
    ctx.font = "700 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    const midY = (frames[2].y + frames[3].y) / 2;
    ctx.fillText(`tx=${playerTF.tx}`, px + 158, midY - 8);
    ctx.fillText(`ty=${playerTF.ty}`, px + 158, midY + 2);
    ctx.fillText(`yaw=${playerTF.yaw}°`, px + 158, midY + 12);

    ctx.restore();
  }

  function drawScorePanel(ctx: CanvasRenderingContext2D) {
    const px = 588,
      py = 286;
    const pw = 200,
      ph = 154;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = themeColor(theme.fgDim, "rgba(255,255,255,0.25)");
    ctx.fillRect(px - 6, py - 22, pw + 12, ph);
    ctx.strokeRect(px - 6, py - 22, pw + 12, ph);

    ctx.fillStyle = stageColor("#075f93");
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("SCAN ALIGNMENT", px, py - 6);

    const matched = lastScan.filter((r) => r.matched).length;
    const total = lastScan.length || 1;
    const score = matched / total;
    // bar
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.fillRect(px, py + 6, pw - 12, 14);
    ctx.fillStyle = stageColor(
      score >= TARGET_MATCH ? "#087764" : score >= 0.6 ? "#925b00" : "#be2949",
    );
    ctx.fillRect(px, py + 6, (pw - 12) * score, 14);
    ctx.strokeStyle = themeColor(theme.accent, stageColor("rgba(7, 95, 147,0.5)"));
    ctx.strokeRect(px, py + 6, pw - 12, 14);
    ctx.fillStyle = stageColor("#172b4d");
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${(score * 100).toFixed(0)}%`, px, py + 50);
    ctx.fillStyle = stageColor("#425570");
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`target: ${(TARGET_MATCH * 100).toFixed(0)}%`, px + 76, py + 50);
    ctx.fillStyle = stageColor("#425570");
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`${matched} / ${total} rays on wall`, px, py + 66);

    // legend
    ctx.fillStyle = stageColor("#087764");
    ctx.beginPath();
    ctx.arc(px + 4, py + 92, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = stageColor("#425570");
    ctx.fillText("matched", px + 14, py + 95);
    ctx.fillStyle = stageColor("#be2949");
    ctx.beginPath();
    ctx.arc(px + 84, py + 92, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = stageColor("#425570");
    ctx.fillText("scattered", px + 94, py + 95);

    // status
    ctx.fillStyle = stageColor(cleared ? "#087764" : "#075f93");
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText(cleared ? "✓ TF locked" : "adjust sliders", px, py + 116);
    ctx.restore();
  }

  return {
    id: "tf_puzzle",
    name: "TF Puzzle",
    lesson: "TF Frames",
    lessonCmd: "ros2 topic echo /tf_static",
    ros2: {
      title: tx(
        "TF — センサーの取り付け位置をTransformで表す",
        "TF — describe a sensor mount with a transform",
      ),
      summary:
        "ロボットの各部品（LiDAR / camera / wheel）は、base_linkに対して固定された相対的な位置と向きを持ちます。ROS 2では、これをTF Tree（map → odom → base_link → laser ...）で表します。" +
        "このステージは、base_link → laserのTransformを推定するパズルです。設定が間違っていると、スキャン点が壁から外れて表示されます。",
      msgTypes: [
        "geometry_msgs/msg/TransformStamped",
        "sensor_msgs/msg/LaserScan",
        "tf2_msgs/msg/TFMessage",
      ],
      cli: ["ros2 topic echo /tf_static", "ros2 topic echo /scan", "ros2 node info /static_tf_pub"],
      python: `import math
from geometry_msgs.msg import TransformStamped
from rclpy.node import Node
from tf2_ros import StaticTransformBroadcaster
from tf_transformations import quaternion_from_euler

# 静的 TF を 1 回だけ publish するノード
# ゲーム画面は y が下向き・yaw は時計回りが正。ROS (REP-103) は
# x 前方・y 左・yaw 反時計回りが正なので、y と yaw の符号が逆になる:
#   x = tx / 100,  y = -ty / 100,  yaw = -yaw
class StaticTfPub(Node):
    def __init__(self):
        super().__init__("static_tf_pub")
        self.b = StaticTransformBroadcaster(self)
        t = TransformStamped()
        t.header.stamp = self.get_clock().now().to_msg()
        t.header.frame_id = "base_link"
        t.child_frame_id = "laser"
        t.transform.translation.x = 0.14   # m  (tx = 14 px: 前方)
        t.transform.translation.y = -0.08  # m  (ty = 8 px: ロボットの右側)
        q = quaternion_from_euler(0.0, 0.0, math.radians(22))  # 左へ 22°
        t.transform.rotation.x = q[0]
        t.transform.rotation.y = q[1]
        t.transform.rotation.z = q[2]
        t.transform.rotation.w = q[3]
        self.b.sendTransform(t)`,
      realWorld: tx(
        '実機ロボットのセンサー取り付け位置は、URDFまたはstatic_transform_publisherを使ってTF Treeへ登録します。誤ったTransformは、SLAMやNav2の認識・走行にずれを生じさせます。このステージは平面上のtx / ty / yawに絞っていますが、URDFの<origin xyz="..." rpy="..."/>では3次元の位置と姿勢を設定します。',
        "On a physical robot, sensor mounts are registered in the TF tree through URDF or static_transform_publisher. Incorrect transforms can distort perception and navigation. This stage focuses on planar tx, ty, and yaw, while URDF's <origin xyz=... rpy=.../> describes full 3D position and orientation.",
      ),
      state: {
        nodes: ["/lidar_node", "/static_tf_pub", "/robot"],
        topics: [
          { name: "/tf_static", type: "tf2_msgs/msg/TFMessage", pub: ["/static_tf_pub"] },
          { name: "/scan", type: "sensor_msgs/msg/LaserScan", pub: ["/lidar_node"] },
        ],
      },
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
  order: 10,
  diagram: `
<svg viewBox="0 0 420 130" role="img" aria-label="set the base_link to laser TF correctly so scan points snap onto walls">
  <defs>
    <marker id="ld-tf-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="light-dark(#075f93, rgba(125, 211, 252, 0.7))"/>
    </marker>
    <marker id="ld-tf-arrow-hi" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="light-dark(#925b00, #fbbf24)"/>
    </marker>
  </defs>
  <!-- Left: TF tree -->
  <g font-family="ui-monospace, monospace" text-anchor="middle">
    <text x="20" y="18" fill="light-dark(#075f93, #7dd3fc)" font-size="9" font-weight="700" text-anchor="start">TF TREE</text>
    <rect x="20" y="26" width="80" height="18" rx="3" fill="light-dark(#e4edf8, #293c5d)" stroke="light-dark(#075f93, rgba(125, 211, 252, 0.4))"/>
    <text x="60" y="38" fill="light-dark(#172b4d, #edf3ff)" font-size="9" font-weight="700">map</text>
    <line x1="60" y1="44" x2="60" y2="52" stroke="light-dark(#075f93, rgba(125, 211, 252, 0.6))" stroke-width="1.4" marker-end="url(#ld-tf-arrow)"/>
    <rect x="20" y="54" width="80" height="18" rx="3" fill="light-dark(#e4edf8, #293c5d)" stroke="light-dark(#075f93, rgba(125, 211, 252, 0.4))"/>
    <text x="60" y="66" fill="light-dark(#172b4d, #edf3ff)" font-size="9" font-weight="700">odom</text>
    <line x1="60" y1="72" x2="60" y2="80" stroke="light-dark(#075f93, rgba(125, 211, 252, 0.6))" stroke-width="1.4" marker-end="url(#ld-tf-arrow)"/>
    <rect x="20" y="82" width="80" height="18" rx="3" fill="light-dark(#e4edf8, #293c5d)" stroke="light-dark(#075f93, rgba(125, 211, 252, 0.4))"/>
    <text x="60" y="94" fill="light-dark(#172b4d, #edf3ff)" font-size="9" font-weight="700">base_link</text>
    <line x1="60" y1="100" x2="60" y2="110" stroke="light-dark(#925b00, #fbbf24)" stroke-width="2" marker-end="url(#ld-tf-arrow-hi)"/>
    <rect x="20" y="112" width="80" height="14" rx="3" fill="light-dark(#925b00, #fbbf24)"/>
    <text x="60" y="122" fill="var(--on-accent)" font-size="9" font-weight="700">laser</text>
  </g>
  <!-- Middle label: tx / ty / yaw -->
  <g font-family="ui-monospace, monospace">
    <text x="116" y="100" fill="light-dark(#925b00, #fbbf24)" font-size="9" font-weight="700">tx</text>
    <text x="116" y="110" fill="light-dark(#925b00, #fbbf24)" font-size="9" font-weight="700">ty</text>
    <text x="116" y="120" fill="light-dark(#925b00, #fbbf24)" font-size="9" font-weight="700">yaw</text>
    <text x="148" y="115" fill="light-dark(#425570, #c2cfe3)" font-size="8">tune ↑</text>
  </g>
  <!-- Right: robot top-down with sensor mount + scattered scan points -->
  <g>
    <rect x="218" y="18" width="190" height="100" rx="6" fill="rgba(var(--scrim-rgb), 0.6)" stroke="light-dark(#586a82, rgba(125, 211, 252, 0.3))"/>
    <rect x="232" y="32" width="14" height="38" fill="light-dark(#8298b4, #4a6080)"/>
    <rect x="232" y="32" width="80" height="14" fill="light-dark(#8298b4, #4a6080)"/>
    <rect x="380" y="32" width="14" height="74" fill="light-dark(#8298b4, #4a6080)"/>
    <rect x="280" y="92" width="100" height="14" fill="light-dark(#8298b4, #4a6080)"/>
    <!-- robot body -->
    <circle cx="305" cy="68" r="14" fill="light-dark(#f1f5fb, #131f35)" stroke="light-dark(#925b00, #fbbf24)" stroke-width="2"/>
    <polygon points="318,68 313,64 313,72" fill="light-dark(#925b00, #fbbf24)"/>
    <!-- LiDAR truth (cyan, halo) -->
    <circle cx="316" cy="72" r="6" fill="light-dark(rgba(7, 95, 147,0.25), rgba(125, 211, 252, 0.25))"/>
    <circle cx="316" cy="72" r="3" fill="light-dark(#075f93, #7dd3fc)" stroke="light-dark(#f1f5fb, #131f35)" stroke-width="0.8"/>
    <line x1="316" y1="72" x2="324" y2="69" stroke="light-dark(#075f93, #7dd3fc)" stroke-width="1.4"/>
    <!-- Player's TF guess (offset, dashed purple) -->
    <circle cx="308" cy="64" r="4" fill="none" stroke="light-dark(#6d42b5, #c4b5fd)" stroke-width="1.4" stroke-dasharray="2 2"/>
    <line x1="308" y1="64" x2="316" y2="62" stroke="light-dark(#6d42b5, #c4b5fd)" stroke-width="1.2" stroke-dasharray="2 2"/>
    <!-- matched scan dots on walls -->
    <g fill="light-dark(#087764, #5eead4)" stroke="var(--canvas-bg)" stroke-width="1.5" paint-order="stroke">
      <circle cx="245" cy="38" r="1.7"/>
      <circle cx="295" cy="38" r="1.7"/>
      <circle cx="386" cy="58" r="1.7"/>
      <circle cx="386" cy="82" r="1.7"/>
      <circle cx="320" cy="98" r="1.7"/>
    </g>
    <!-- scattered scan dots in the open -->
    <g fill="light-dark(#be2949, #fda4af)">
      <circle cx="278" cy="50" r="1.7"/>
      <circle cx="358" cy="68" r="1.7"/>
      <circle cx="290" cy="80" r="1.7"/>
      <circle cx="340" cy="56" r="1.7"/>
    </g>
    <text x="313" y="14" text-anchor="middle" fill="light-dark(#425570, #c2cfe3)" font-family="ui-monospace, monospace" font-size="8">overlay your TF onto the cyan LiDAR</text>
  </g>
</svg>
`,
  lessonModal: {
    title: {
      ja: "TF — センサーの取り付け位置をTransformで表す",
      en: "TF — describe a sensor mount with a transform",
    },
    learn: {
      ja: "ROS 2では、ロボットの各部品（base_link / laser / camera）の相対的な位置と向きをTF Treeで表します。LiDARがどこにどの向きで取り付けられているかをbase_link → laserのTransformで定義する仕組みです。これが間違っていると、SLAMやNav2も正しく動作しません。",
      en: "In ROS2, each robot part (base_link / laser / camera) has a fixed relative pose, expressed in a TF tree. Where and how a LiDAR is mounted is declared as the base_link → laser transform — get it wrong and SLAM and Nav2 silently break.",
    },
    goal: {
      ja: "ロボットに描かれた青いLiDAR（正解）の位置と向きを観察し、tx / ty / yawのスライダーでbase_link → laserのTFを再現しましょう。LiDARのスキャン点が壁と95%以上一致すればクリアです。",
      en: "Look at the cyan LiDAR icon drawn on the robot (the physical truth) and tune the tx / ty / yaw sliders so your base_link → laser TF matches it. Reach 95% scan-to-wall alignment to clear.",
    },
    first: {
      ja: "画面下のスライダーを動かし、紫の点線（設定したTF）を青いLiDAR（正解）に重ねます。設定が間違っているとスキャン点が赤くなり、壁から外れて表示されます。",
      en: "Drag the sliders below to move the dashed purple ring (your TF) onto the cyan LiDAR (truth). Wrong values colour the scan points red and scatter them off the walls.",
    },
  },
  strings: {
    ja: {
      hint: "下のスライダーで tx / ty / yaw を調整 / 95% 一致でクリア",
      "status.complete": "TF LOCKED — base_link → laser が一致",
      tip: "ロボに付いている青い LiDAR の位置を tx / ty / yaw スライダーで当てよう — base_link → laser を当てれば壁にスキャンが張り付く",
    },
    en: {
      hint: "Tune tx / ty / yaw with the sliders below / 95% match to clear",
      "status.complete": "TF LOCKED — base_link → laser is correct",
      tip: "Match the LiDAR's mount on the robot using the tx / ty / yaw sliders — get base_link → laser right and the scan snaps onto the walls",
    },
  },
  build: makeTfPuzzle,
});
