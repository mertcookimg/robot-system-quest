// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// tf_puzzle: TF Frame Puzzle
// The LiDAR is physically mounted offset from the robot center.
// The player must guess the base_link → laser TF (tx, ty, yaw) via sliders.
// Wrong values → scan points scatter off the walls. Correct values →
// scan points snap to the walls.
// Clear when ≥95% of rays match a wall.
import { type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";
import { drawHint, drawTimer, drawRobotBody, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { t, tx } from "../../i18n";

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
const TRUE_MOUNT = { tx: 14, ty: 8, yaw: -22 }; // px, px, degrees

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
  let cleared = false;
  const particles = new Particles();

  // Player's slider values (the guessed base_link → laser TF).
  const playerTF: TFParams = { tx: 0, ty: 0, yaw: 0 };

  let overlayPanel: HTMLElement | null = null;

  function reset() {
    elapsed = 0;
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
      "border:1px solid rgba(125,211,252,0.5); border-radius:8px; display:flex; gap:14px; align-items:center;" +
      "font-family:ui-monospace,monospace; font-size:11px; color:#eef2ff;";

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
        "display:flex; align-items:center; gap:6px; color:#9aa6c8; padding:4px 6px;";
      const txt = document.createElement("span");
      txt.textContent = label;
      txt.style.color = "#7dd3fc";
      txt.style.fontWeight = "700";
      const inp = document.createElement("input");
      inp.className = "tf-puzzle-slider";
      inp.type = "range";
      inp.min = String(min);
      inp.max = String(max);
      inp.step = String(step);
      inp.value = String(playerTF[key]);
      inp.style.cssText = "width:110px; accent-color:#7dd3fc;";
      const val = document.createElement("span");
      val.className = "slider-val";
      val.textContent = `${playerTF[key]} ${unit}`;
      val.style.cssText = "min-width:48px; color:#eef2ff; font-weight:700;";
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
    reminder.style.cssText = "color:#9aa6c8; font-size:10px; line-height:1.4;";
    reminder.innerHTML =
      "base_link → laser を当てよう / R リセット<br>" +
      "<span style='color:#fbbf24;'>🎮 ←→ ↑↓</span> スライダー選択 · " +
      "<span style='color:#fbbf24;'>A</span> 編集 ON/OFF · 編集中は <span style='color:#5eead4;'>←→ ↑↓</span> で値調整";
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

    if (score >= TARGET_MATCH) {
      cleared = true;
      particles.burst(ROBOT_POS.x, ROBOT_POS.y, "#5eead4", 36, 240);
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

    g.publish(
      "/tf_static",
      `geometry_msgs/msg/TransformStamped frame_id=base_link child_frame_id=laser ` +
        `tx=${playerTF.tx}px ty=${playerTF.ty}px yaw=${playerTF.yaw}°`,
    );

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
    ctx.strokeStyle = "rgba(125,211,252,0.3)";
    ctx.lineWidth = 1;
    ctx.strokeRect(WORLD_X, WORLD_Y, WORLD_W, WORLD_H);

    // Walls (truth)
    for (const w of walls) {
      ctx.fillStyle = "#3a4366";
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.strokeStyle = "rgba(110,122,156,0.6)";
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
    for (const r of lastScan) {
      ctx.fillStyle = r.matched ? "rgba(94,234,212,0.88)" : "rgba(251,113,133,0.88)";
      ctx.beginPath();
      ctx.arc(r.recX, r.recY, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
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
    ctx.fillStyle = "rgba(125,211,252,0.25)";
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    // body
    ctx.fillStyle = "#7dd3fc";
    ctx.strokeStyle = "#0c1124";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // forward arrow
    ctx.strokeStyle = "#7dd3fc";
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
    ctx.strokeStyle = "rgba(196,181,253,0.85)";
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
    ctx.fillStyle = "#7dd3fc";
    ctx.fillText("● truth (physical mount)", ROBOT_POS.x + 24, ROBOT_POS.y - 18);
    ctx.fillStyle = "#c4b5fd";
    ctx.fillText("◌ your TF (sliders)", ROBOT_POS.x + 24, ROBOT_POS.y - 6);
  }

  function drawTfTree(ctx: CanvasRenderingContext2D) {
    const px = 588,
      py = 64;
    const pw = 200,
      ph = 196;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(px - 6, py - 22, pw + 12, ph);
    ctx.strokeRect(px - 6, py - 22, pw + 12, ph);

    ctx.fillStyle = "#7dd3fc";
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
      ctx.fillStyle = f.hi ? "#fbbf24" : "#1f2a4a";
      ctx.fillRect(px + 30, f.y - 11, 120, 22);
      ctx.strokeStyle = f.hi ? "#fbbf24" : "rgba(125,211,252,0.4)";
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 30, f.y - 11, 120, 22);
      ctx.fillStyle = f.hi ? "#0c1124" : "#eef2ff";
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
      ctx.strokeStyle = isTarget ? "#fbbf24" : "rgba(125,211,252,0.6)";
      ctx.beginPath();
      ctx.moveTo(px + 90, yFrom);
      ctx.lineTo(px + 90, yTo);
      ctx.stroke();
      // arrowhead
      ctx.fillStyle = isTarget ? "#fbbf24" : "rgba(125,211,252,0.6)";
      ctx.beginPath();
      ctx.moveTo(px + 90, yTo);
      ctx.lineTo(px + 86, yTo - 5);
      ctx.lineTo(px + 94, yTo - 5);
      ctx.fill();
    }
    // current TF values next to the highlighted arrow
    ctx.fillStyle = "#fbbf24";
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
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(px - 6, py - 22, pw + 12, ph);
    ctx.strokeRect(px - 6, py - 22, pw + 12, ph);

    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("SCAN ALIGNMENT", px, py - 6);

    const matched = lastScan.filter((r) => r.matched).length;
    const total = lastScan.length || 1;
    const score = matched / total;
    // bar
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.fillRect(px, py + 6, pw - 12, 14);
    ctx.fillStyle = score >= TARGET_MATCH ? "#5eead4" : score >= 0.6 ? "#fbbf24" : "#fb7185";
    ctx.fillRect(px, py + 6, (pw - 12) * score, 14);
    ctx.strokeStyle = "rgba(125,211,252,0.5)";
    ctx.strokeRect(px, py + 6, pw - 12, 14);
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`${(score * 100).toFixed(0)}%`, px, py + 50);
    ctx.fillStyle = "#9aa6c8";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`target: ${(TARGET_MATCH * 100).toFixed(0)}%`, px + 76, py + 50);
    ctx.fillStyle = "#9aa6c8";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillText(`${matched} / ${total} rays on wall`, px, py + 66);

    // legend
    ctx.fillStyle = "#5eead4";
    ctx.beginPath();
    ctx.arc(px + 4, py + 92, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText("matched", px + 14, py + 95);
    ctx.fillStyle = "#fb7185";
    ctx.beginPath();
    ctx.arc(px + 84, py + 92, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText("scattered", px + 94, py + 95);

    // status
    ctx.fillStyle = cleared ? "#5eead4" : "#7dd3fc";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillText(cleared ? "✓ TF locked" : "adjust sliders", px, py + 116);
    ctx.restore();
  }

  return {
    id: "tf_puzzle",
    name: "TF Puzzle",
    lesson: "TF Frames",
    lessonCmd: "ros2 run tf2_ros static_transform_publisher",
    ros2: {
      title: tx(
        "TF — sensor のマウントを transform で表す",
        "TF — describe a sensor mount with a transform",
      ),
      summary:
        "ロボの各部品 (LiDAR / camera / wheel) は base_link に対して固定された相対位置を持つ。これを TF tree (map → odom → base_link → laser ...) で表すのが ROS2 の流儀。" +
        "本ステージは base_link → laser の transform を当てるパズル。間違っているとスキャン点が壁から外れて散らばる。",
      msgTypes: [
        "geometry_msgs/msg/TransformStamped",
        "sensor_msgs/msg/LaserScan",
        "tf2_msgs/msg/TFMessage",
      ],
      cli: [
        "ros2 run tf2_ros tf2_echo base_link laser",
        "ros2 run rqt_tf_tree rqt_tf_tree",
        "ros2 run tf2_ros static_transform_publisher --x 0.14 --y 0.08 --yaw -0.38 \\\n  --frame-id base_link --child-frame-id laser",
      ],
      python: `# 静的 TF を 1 回だけ publish するノード
class StaticTfPub(Node):
    def __init__(self):
        super().__init__("static_tf_pub")
        self.b = StaticTransformBroadcaster(self)
        t = TransformStamped()
        t.header.frame_id = "base_link"
        t.child_frame_id = "laser"
        t.transform.translation.x = 0.14   # m (本ゲームの tx に対応)
        t.transform.translation.y = 0.08
        t.transform.rotation = quat_from_euler(0, 0, math.radians(-22))
        self.b.sendTransform(t)`,
      realWorld: tx(
        '実機ロボのセンサ取り付け位置は URDF または static_transform_publisher で TF tree に登録します。誤った transform は SLAM や Nav2 の認識・走行にずれを生じさせます。本ステージは平面上の tx / ty / yaw に絞っていますが、URDF の <origin xyz="..." rpy="..."/> では 3 次元の位置と姿勢を設定します。',
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
      <polygon points="0 0, 9 3.5, 0 7" fill="rgba(125,211,252,0.7)"/>
    </marker>
    <marker id="ld-tf-arrow-hi" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#fbbf24"/>
    </marker>
  </defs>
  <!-- Left: TF tree -->
  <g font-family="ui-monospace, monospace" text-anchor="middle">
    <text x="20" y="18" fill="#7dd3fc" font-size="9" font-weight="700" text-anchor="start">TF TREE</text>
    <rect x="20" y="26" width="80" height="18" rx="3" fill="#1f2a4a" stroke="rgba(125,211,252,0.4)"/>
    <text x="60" y="38" fill="#eef2ff" font-size="9" font-weight="700">map</text>
    <line x1="60" y1="44" x2="60" y2="52" stroke="rgba(125,211,252,0.6)" stroke-width="1.4" marker-end="url(#ld-tf-arrow)"/>
    <rect x="20" y="54" width="80" height="18" rx="3" fill="#1f2a4a" stroke="rgba(125,211,252,0.4)"/>
    <text x="60" y="66" fill="#eef2ff" font-size="9" font-weight="700">odom</text>
    <line x1="60" y1="72" x2="60" y2="80" stroke="rgba(125,211,252,0.6)" stroke-width="1.4" marker-end="url(#ld-tf-arrow)"/>
    <rect x="20" y="82" width="80" height="18" rx="3" fill="#1f2a4a" stroke="rgba(125,211,252,0.4)"/>
    <text x="60" y="94" fill="#eef2ff" font-size="9" font-weight="700">base_link</text>
    <line x1="60" y1="100" x2="60" y2="110" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-tf-arrow-hi)"/>
    <rect x="20" y="112" width="80" height="14" rx="3" fill="#fbbf24"/>
    <text x="60" y="122" fill="#0c1124" font-size="9" font-weight="700">laser</text>
  </g>
  <!-- Middle label: tx / ty / yaw -->
  <g font-family="ui-monospace, monospace">
    <text x="116" y="100" fill="#fbbf24" font-size="9" font-weight="700">tx</text>
    <text x="116" y="110" fill="#fbbf24" font-size="9" font-weight="700">ty</text>
    <text x="116" y="120" fill="#fbbf24" font-size="9" font-weight="700">yaw</text>
    <text x="148" y="115" fill="#9aa6c8" font-size="8">tune ↑</text>
  </g>
  <!-- Right: robot top-down with sensor mount + scattered scan points -->
  <g>
    <rect x="218" y="18" width="190" height="100" rx="6" fill="rgba(8, 12, 28, 0.6)" stroke="rgba(125,211,252,0.3)"/>
    <rect x="232" y="32" width="14" height="38" fill="#3a4366"/>
    <rect x="232" y="32" width="80" height="14" fill="#3a4366"/>
    <rect x="380" y="32" width="14" height="74" fill="#3a4366"/>
    <rect x="280" y="92" width="100" height="14" fill="#3a4366"/>
    <!-- robot body -->
    <circle cx="305" cy="68" r="14" fill="#0c1124" stroke="#fbbf24" stroke-width="2"/>
    <polygon points="318,68 313,64 313,72" fill="#fbbf24"/>
    <!-- LiDAR truth (cyan, halo) -->
    <circle cx="316" cy="72" r="6" fill="rgba(125,211,252,0.25)"/>
    <circle cx="316" cy="72" r="3" fill="#7dd3fc" stroke="#0c1124" stroke-width="0.8"/>
    <line x1="316" y1="72" x2="324" y2="69" stroke="#7dd3fc" stroke-width="1.4"/>
    <!-- Player's TF guess (offset, dashed purple) -->
    <circle cx="308" cy="64" r="4" fill="none" stroke="#c4b5fd" stroke-width="1.4" stroke-dasharray="2 2"/>
    <line x1="308" y1="64" x2="316" y2="62" stroke="#c4b5fd" stroke-width="1.2" stroke-dasharray="2 2"/>
    <!-- matched scan dots on walls -->
    <g fill="#5eead4">
      <circle cx="245" cy="38" r="1.7"/>
      <circle cx="295" cy="38" r="1.7"/>
      <circle cx="386" cy="58" r="1.7"/>
      <circle cx="386" cy="82" r="1.7"/>
      <circle cx="320" cy="98" r="1.7"/>
    </g>
    <!-- scattered scan dots in the open -->
    <g fill="#fb7185">
      <circle cx="278" cy="50" r="1.7"/>
      <circle cx="358" cy="68" r="1.7"/>
      <circle cx="290" cy="80" r="1.7"/>
      <circle cx="340" cy="56" r="1.7"/>
    </g>
    <text x="313" y="14" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">overlay your TF onto the cyan LiDAR</text>
  </g>
</svg>
`,
  lessonModal: {
    title: {
      ja: "TF — sensor のマウントを transform で表す",
      en: "TF — describe a sensor mount with a transform",
    },
    learn: {
      ja: "ROS2 ではロボの各部品 (base_link / laser / camera) の相対位置を TF tree で表します。LiDAR がどこに何度向きでマウントされているかを base_link → laser の transform で宣言する仕組みで、これが間違うと SLAM や Nav2 がすべて狂います。",
      en: "In ROS2, each robot part (base_link / laser / camera) has a fixed relative pose, expressed in a TF tree. Where and how a LiDAR is mounted is declared as the base_link → laser transform — get it wrong and SLAM and Nav2 silently break.",
    },
    goal: {
      ja: "ロボに描かれた青い LiDAR (truth) の位置と向きを観察し、tx / ty / yaw のスライダーで base_link → laser の TF を当てましょう。LiDAR スキャン点の 95% が壁と一致したらクリア。",
      en: "Look at the cyan LiDAR icon drawn on the robot (the physical truth) and tune the tx / ty / yaw sliders so your base_link → laser TF matches it. Reach 95% scan-to-wall alignment to clear.",
    },
    first: {
      ja: "画面下のスライダーを動かして紫の点線サークル (your TF) を青の LiDAR (truth) に重ねます。間違っているとスキャン点が赤くなって壁から外れて散らばります。",
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
