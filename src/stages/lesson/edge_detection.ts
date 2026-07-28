// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// edge_detection: Camera Line Follower
// Connects the blur → canny pipeline learned in image_processing to a
// pseudo-onboard camera and drives a line follower that steers on the
// centroid of the canny mask. Builds on lesson 7.
//
// The teleop + pseudo-camera plumbing (map, walls, camera capture,
// projection, physics, top-down rendering) lives in lib/camera_mission —
// this file keeps only what is specific to the canny capture gameplay.
import { type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import { drawHint, COLORS, clearBackground } from "../../lib/draw";
import { toGray, gaussianBlur, cannyEdges } from "../../lib/imgproc";
import { setupBlockProgram, type BlockProgramHandle } from "../../lib/block_program";
import {
  createCameraMission,
  type CameraTarget,
  PX_PER_M,
  MAP_W,
  IMG_W,
  IMG_H,
  FOCAL_LEN,
} from "../../lib/camera_mission";
import { formatPose } from "../../lib/hud";
import { t, tx } from "../../i18n";

const TOPIC_CMD = "/cmd_vel";
const TOPIC_IMG = "/image_raw";

// -- Yellow line waypoints (route hint).
const LINE_PATH: { x: number; y: number }[] = [
  { x: 60, y: 60 },
  { x: 60, y: 180 },
  { x: 150, y: 250 },
  { x: 270, y: 230 },
  { x: 360, y: 320 },
  { x: 450, y: 430 },
];

// -- Colored "observation targets" (decorative objects for canny).
const TARGETS: CameraTarget[] = [
  { x: 200, y: 230, r: 14, color: "#fb7185", label: "RED" },
  { x: 320, y: 240, r: 14, color: "#5eead4", label: "CYAN" },
  { x: 410, y: 180, r: 16, color: "#c4b5fd", label: "VIOLET" },
  { x: 130, y: 410, r: 14, color: "#fbbf24", label: "AMBER" },
  { x: 280, y: 100, r: 12, color: "#86efac", label: "GREEN" },
];

type Block =
  { kind: "gaussian_blur"; sigma: number } | { kind: "canny"; low: number; high: number };

function defaultBlock(kind: Block["kind"]): Block {
  if (kind === "gaussian_blur") return { kind, sigma: 1.0 };
  return { kind: "canny", low: 50, high: 120 };
}

export function makeCameraMission(): Stage {
  let g!: GameContext;
  const mission = createCameraMission({ targets: TARGETS, linePath: LINE_PATH });
  const { robot, particles, captured } = mission;
  let program: Block[] = [];
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let runCount = 0;
  let cleared = false;

  // Last pipeline result.
  let camRgba: Uint8ClampedArray = new Uint8ClampedArray(IMG_W * IMG_H * 4);
  let detected: Uint8Array = new Uint8Array(IMG_W * IMG_H);

  // For the last frame: target indices currently in-view + their score
  // ratios, used to render lock-on reticles.
  const targetSeen: { idx: number; xi: number; yi: number; r: number; score: number }[] = [];
  let lastV = 0,
    lastW = 0;
  let lastPipelineMs = 0;

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
    mission.reset();
    elapsed = 0;
    pubAcc = 0;
    cleared = false;
    isRunning = false;
    lastV = lastW = 0;
    targetSeen.length = 0;
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("edge_detection.tip"), "");
    refreshProgramUI();
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";
    mission.enter(ctx);

    if (program.length === 0 && runCount === 0) {
      // Default sample: slightly low σ → noisy but tunable to a working state.
      program = [
        { kind: "gaussian_blur", sigma: 0.6 },
        { kind: "canny", low: 35, high: 90 },
      ];
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("edge_detection.palette_hint"),
      blockKinds: [
        {
          kind: "gaussian_blur",
          label: "gaussian_blur",
          args: "sigma",
          defaults: () => defaultBlock("gaussian_blur"),
          params: (b) =>
            b.kind === "gaussian_blur"
              ? [{ key: "sigma", value: b.sigma, step: 0.1, unit: "σ" }]
              : [],
        },
        {
          kind: "canny",
          label: "canny",
          args: "low, high",
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
      onRun: () => onRun(),
      onStop: () => onStop(),
      onClear: () => {
        onStop();
        program.length = 0;
      },
    });

    reset();
    mission.captureCamera();
  }

  function dispose() {
    if (editorEl) editorEl.style.display = "none";
    bp?.dispose();
    bp = null;
    mission.leave();
  }

  function refreshProgramUI() {
    bp?.refresh();
  }

  // RUN/STOP exist as no-ops in teleop mode (used for timer reset).
  function onRun() {
    runCount++;
    mission.resetRun();
    elapsed = 0;
    pubAcc = 0;
    cleared = false;
    isRunning = true;
    lastV = lastW = 0;
    g.ghost.startRecording();
    setStatusBadge("running", "running");
    g.setStatus(t("edge_detection.run_msg"), "var(--accent)");
    refreshProgramUI();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    lastV = 0;
    lastW = 0;
    setStatusBadge("stopped", "");
    g.setStatus(t("edge_detection.stop"), "var(--warn)");
    refreshProgramUI();
  }

  // ====================================================================
  // Update each frame: capture → image processing → manual cmd_vel → physics.
  // ====================================================================
  function runImagePipeline() {
    camRgba = mission.captureCamera();
    const t0 = performance.now();
    let gray = toGray(camRgba, IMG_W, IMG_H);
    detected.fill(0);
    for (const block of program) {
      if (block.kind === "gaussian_blur") {
        gray = gaussianBlur(gray, IMG_W, IMG_H, Math.max(0, block.sigma));
      } else if (block.kind === "canny") {
        const low = Math.max(0, Math.min(block.low, block.high));
        const high = Math.max(low, block.high);
        detected = cannyEdges(gray, IMG_W, IMG_H, low, high);
      }
    }
    lastPipelineMs = performance.now() - t0;
    // For each target: project to camera and capture if canny mask shows edges.
    updateTargetCapture();
  }

  // Circle detection score:
  //   ring match rate × (1 - inner-density penalty).
  // Ring: sample N points along the projected radius; an edge within
  // ±2px counts as a hit (lenient).
  // Inside: edges densely covering r*0.55 disc penalize (noise filter).
  function captureScore(cx: number, cy: number, projR: number): number {
    // -- Ring match rate (lenient 5x5 neighborhood).
    const N = Math.max(24, Math.floor((2 * Math.PI * projR) / 1.2));
    let ringHits = 0;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const px = Math.round(cx + projR * Math.cos(a));
      const py = Math.round(cy + projR * Math.sin(a));
      let found = false;
      for (let dy = -2; dy <= 2 && !found; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= IMG_H) continue;
        const off = yy * IMG_W;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = px + dx;
          if (xx < 0 || xx >= IMG_W) continue;
          if (detected[off + xx]) {
            found = true;
            break;
          }
        }
      }
      if (found) ringHits++;
    }
    const ringRate = ringHits / N;

    // -- Interior edge density (penalty only for heavy noise).
    const innerR = projR * 0.55;
    const innerR2 = innerR * innerR;
    const ir = Math.max(1, Math.ceil(innerR));
    let inTotal = 0,
      inEdges = 0;
    for (let dy = -ir; dy <= ir; dy++) {
      const yy = Math.round(cy) + dy;
      if (yy < 0 || yy >= IMG_H) continue;
      const off = yy * IMG_W;
      for (let dx = -ir; dx <= ir; dx++) {
        if (dx * dx + dy * dy > innerR2) continue;
        const xx = Math.round(cx) + dx;
        if (xx < 0 || xx >= IMG_W) continue;
        inTotal++;
        if (detected[off + xx]) inEdges++;
      }
    }
    const inDensity = inTotal > 0 ? inEdges / inTotal : 0;
    // Penalty kicks in at density 0.4 and saturates at 0.7.
    const penalty = Math.max(0, Math.min(1, (inDensity - 0.4) * 3));

    return Math.max(0, ringRate * (1 - penalty));
  }

  const CAPTURE_THRESHOLD = 0.4; // 40% ring match captures the target
  const MIN_PROJ_R = 5;

  function updateTargetCapture() {
    targetSeen.length = 0;
    for (let i = 0; i < TARGETS.length; i++) {
      if (captured[i]) continue;
      const t = TARGETS[i];
      const proj = mission.projectToCamera(t.x, t.y);
      if (!proj) continue;
      const projR = (t.r * FOCAL_LEN) / proj.depth;
      // Skip targets too far away (projection too small).
      if (projR < MIN_PROJ_R) continue;
      const score = captureScore(proj.xi, proj.yi, projR);
      targetSeen.push({ idx: i, xi: proj.xi, yi: proj.yi, r: projR, score });
      if (score >= CAPTURE_THRESHOLD) {
        captured[i] = true;
        g.shake(0.18);
        particles.burst(t.x, t.y, t.color, 18, 180);
        g.sfx.pickup();
        g.publish("/scan_target", `captured ${t.label} (score ${score.toFixed(2)})`);
      }
    }
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    mission.decayBump(dt);
    mission.pollTuneToggle();

    const { v, w } = mission.readDrive();
    lastV = v;
    lastW = w;

    // Only count as "running" when moving — idle doesn't advance the timer.
    if (!isRunning && (v !== 0 || w !== 0)) {
      isRunning = true;
      setStatusBadge("running", "running");
      g.setStatus(t("edge_detection.run_msg2"), "var(--accent)");
    }
    if (isRunning) elapsed += dt;
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    // Image processing pipeline (every frame — edge map updates live).
    runImagePipeline();

    // Pseudo-publish /cmd_vel and /image_raw messages.
    pubAcc += dt;
    if (pubAcc > 0.1) {
      pubAcc = 0;
      g.publish(
        TOPIC_CMD,
        `geometry_msgs/msg/Twist linear.x:${v.toFixed(2)} angular.z:${w.toFixed(2)}`,
      );
      g.publish(
        TOPIC_IMG,
        `sensor_msgs/msg/Image ${IMG_W}x${IMG_H} bgr8 (pipeline ${lastPipelineMs.toFixed(1)}ms)`,
      );
    }

    // Physics + collision.
    if (mission.stepPhysics(v, w, dt)) {
      lastV = 0;
      lastW = 0;
    }

    // Goal: enter the GOAL zone with all targets captured.
    if (mission.goalReached()) {
      if (mission.allCaptured()) {
        isRunning = false;
        cleared = true;
        setStatusBadge("success", "success");
        g.shake(0.4);
        particles.burst(robot.x, robot.y, COLORS.OK, 36);
        const stars = elapsed < 30 ? 3 : elapsed < 50 ? 2 : 1;
        const stats =
          `Time   <b>${elapsed.toFixed(2)} s</b><br>` +
          `targets <b>${mission.capturedCount()} / ${TARGETS.length}</b><br>` +
          `pipeline <b>${lastPipelineMs.toFixed(1)} ms / frame</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 350);
      } else {
        // At least one target still uncaptured.
        const remaining = TARGETS.length - mission.capturedCount();
        g.setStatus(t("edge_detection.remaining", { n: remaining }), "var(--warn)");
      }
    }

    g.setHud([
      `mode:     teleop + image processing`,
      `pose:     ${formatPose(robot, { pxPerM: PX_PER_M })}`,
      `targets:  ${mission.capturedCount()} / ${TARGETS.length} captured`,
      `cmd_vel:  v=${v.toFixed(2)} m/s  w=${w.toFixed(2)} rad/s`,
      `pipeline: ${lastPipelineMs.toFixed(1)} ms / frame   image: ${IMG_W}×${IMG_H}`,
    ]);
  }

  // ====================================================================
  // Draw
  // ====================================================================
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    // Left: top-down map (world, targets, goal, trail, ghost, robot, …).
    mission.drawTopDown(c, elapsed);

    // ------ Right pane: camera + canny ------
    drawRightPanel(c);

    drawHint(c, t("edge_detection.hint"));
  }

  function drawRightPanel(c: CanvasRenderingContext2D) {
    const x0 = MAP_W + 20;
    c.save();
    mission.drawRightPanelFrame(c);
    c.fillStyle = "#7dd3fc";
    c.font = "700 12px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("CAMERA", x0, 22);
    c.fillStyle = "#6e7a9c";
    c.font = "9px ui-monospace, monospace";
    c.fillText(`${IMG_W}×${IMG_H} bgr8`, x0 + 80, 22);

    // Input camera image.
    c.drawImage(mission.camCanvas, x0, 32);
    c.strokeStyle = "rgba(35,44,77,0.9)";
    c.strokeRect(x0 - 1, 31, IMG_W + 2, IMG_H + 2);

    // Targets in view get a lock-on reticle and a score-progress bar.
    for (const seen of targetSeen) {
      const t = TARGETS[seen.idx];
      const cx = x0 + seen.xi;
      const cy = 32 + seen.yi;
      const rr = Math.max(8, seen.r * 1.4);
      // Ring (color = target color, thickness = score).
      c.strokeStyle = t.color;
      c.lineWidth = 1 + seen.score * 2.5;
      c.globalAlpha = 0.75;
      c.beginPath();
      c.arc(cx, cy, rr, 0, Math.PI * 2);
      c.stroke();
      // Score bar (under the ring).
      c.globalAlpha = 1;
      c.fillStyle = "rgba(0,0,0,0.5)";
      c.fillRect(cx - rr, cy + rr + 2, rr * 2, 4);
      c.fillStyle = t.color;
      c.fillRect(cx - rr, cy + rr + 2, rr * 2 * seen.score, 4);
      // Label.
      c.fillStyle = t.color;
      c.font = "700 9px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText(t.label, cx, cy - rr - 3);
    }

    // Progress counter overlaid on the camera image.
    const capN = mission.capturedCount();
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.fillRect(x0 + 6, 32 + IMG_H - 22, 100, 16);
    c.fillStyle = capN === TARGETS.length ? COLORS.OK : "#fbbf24";
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(`SCANNED ${capN} / ${TARGETS.length}`, x0 + 10, 32 + IMG_H - 10);

    // DETECTED label.
    c.fillStyle = "#7dd3fc";
    c.font = "700 12px ui-monospace, monospace";
    c.fillText("DETECTED (canny)", x0, 32 + IMG_H + 26);

    // canny mask
    drawEdgeMask(c, x0, 32 + IMG_H + 36, detected, IMG_W, IMG_H);
    c.strokeRect(x0 - 1, 32 + IMG_H + 35, IMG_W + 2, IMG_H + 2);

    // Mirror the reticles onto the canny mask too.
    for (const seen of targetSeen) {
      const t = TARGETS[seen.idx];
      const cx = x0 + seen.xi;
      const cy = 32 + IMG_H + 36 + seen.yi;
      const rr = Math.max(8, seen.r * 1.4);
      c.strokeStyle = t.color;
      c.lineWidth = 1.2;
      c.globalAlpha = 0.6;
      c.beginPath();
      c.arc(cx, cy, rr, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }

    // cmd_vel readout.
    const yCmd = 32 + (IMG_H + 36) * 2 + 10;
    c.textAlign = "left";
    c.fillStyle = "#9aa6c8";
    c.font = "11px ui-monospace, monospace";
    c.fillText(`cmd_vel:`, x0, yCmd);
    c.fillStyle = "#eef2ff";
    c.fillText(`v=${lastV.toFixed(2)}`, x0 + 60, yCmd);
    c.fillText(`w=${lastW.toFixed(2)}`, x0 + 130, yCmd);
    c.fillStyle = "#6e7a9c";
    c.font = "10px ui-monospace, monospace";
    c.fillText(`pipeline ${lastPipelineMs.toFixed(1)} ms`, x0, yCmd + 18);
    c.restore();
  }

  function drawEdgeMask(
    c: CanvasRenderingContext2D,
    dx: number,
    dy: number,
    mask: Uint8Array,
    w: number,
    h: number,
  ) {
    const id = c.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      const v = mask[i] > 0 ? 1 : 0;
      id.data[j] = v ? 125 : 8;
      id.data[j + 1] = v ? 211 : 10;
      id.data[j + 2] = v ? 252 : 18;
      id.data[j + 3] = 255;
    }
    c.putImageData(id, dx, dy);
  }

  return {
    id: "edge_detection",
    name: "Edge Detection",
    lesson: "Image Processing Mission",
    lessonCmd: "ros2 topic echo /image_raw",
    ros2: {
      title: tx(
        "Camera + Teleop — 走らせながら Image Processing を観察",
        "Camera + Teleop — observe Image Processing while driving",
      ),
      summary:
        "lesson7 (Canny) の実機運用を体感するステージ。WASD / 矢印 / ゲームパッドで遠隔操作しながら、" +
        "/image_raw 相当の疑似カメラ画像に GaussianBlur + Canny を流し続ける。" +
        "床のライン・色付きターゲット・壁を視点 / 距離 / 角度を変えて見てみると、" +
        "edge map がどう変わるかが直感的に理解できる。" +
        "ゴールへ到達するだけならパラメータ無関係 — 画像処理は教材として常時表示。",
      msgTypes: ["sensor_msgs/msg/Image", "geometry_msgs/msg/Twist"],
      cli: ["ros2 topic hz /image_raw", "ros2 topic echo /cmd_vel", "ros2 topic info /image_raw"],
      python: `import cv2
from cv_bridge import CvBridge
bridge = CvBridge()

# /image_raw を subscribe しつつ /cmd_vel は teleop_twist_keyboard などから出す。
# このノードは「Canny の出力を画面表示する」だけのオブザーバ。
def image_cb(self, msg):
    img  = bridge.imgmsg_to_cv2(msg, "bgr8")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), sigmaX=1.0)
    edges = cv2.Canny(blur, 50, 120)
    cv2.imshow("edges", edges)
    cv2.waitKey(1)`,
      realWorld: tx(
        "robot 実機: コントローラで teleop しつつ rviz で /image_raw と Canny 出力を眺める。色・テクスチャ・距離で edge の見え方が変わる感覚は、自律走行の前段として重要。",
        "On a real robot: teleop with a controller while watching /image_raw and the Canny output in rviz. Building intuition for how edges shift with color, texture, and distance is essential groundwork before autonomous driving.",
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
  order: 14,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="robot with camera FoV pointing at colored targets">
  <!-- background scene -->
  <rect x="6" y="6" width="408" height="108" rx="8" fill="rgba(8, 12, 28, 0.5)" stroke="#232c4d"/>
  <!-- camera FoV (frustum) -->
  <polygon points="62,60 414,18 414,102" fill="rgba(125,211,252,0.08)" stroke="#7dd3fc" stroke-width="1" stroke-dasharray="3 2"/>
  <!-- colored targets inside -->
  <circle cx="170" cy="50" r="9" fill="#fb7185"/>
  <circle cx="170" cy="50" r="13" fill="none" stroke="#5eead4" stroke-width="1.2" opacity="0.85" stroke-dasharray="2 1"/>
  <circle cx="240" cy="78" r="9" fill="#5eead4"/>
  <circle cx="240" cy="78" r="13" fill="none" stroke="#5eead4" stroke-width="1.2" opacity="0.85" stroke-dasharray="2 1"/>
  <circle cx="310" cy="42" r="9" fill="#c4b5fd"/>
  <circle cx="310" cy="42" r="13" fill="none" stroke="#5eead4" stroke-width="1.2" opacity="0.85" stroke-dasharray="2 1"/>
  <circle cx="350" cy="80" r="9" fill="#fbbf24"/>
  <circle cx="380" cy="56" r="9" fill="#86efac"/>
  <!-- robot with camera lens -->
  <rect x="32" y="48" width="30" height="24" rx="3" fill="#181f3a" stroke="#7dd3fc" stroke-width="2"/>
  <circle cx="40" cy="58" r="2" fill="#7dd3fc"/>
  <circle cx="54" cy="58" r="2" fill="#7dd3fc"/>
  <rect x="59" y="56" width="6" height="10" fill="#7dd3fc"/>
  <text x="48" y="92" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9">robot</text>
  <text x="48" y="104" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">+ camera</text>
  <!-- annotation -->
  <text x="408" y="115" text-anchor="end" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">teleop + canny capture</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "カメラミッション — teleop + canny で 5 色を捕獲",
      en: "Camera mission — teleop + canny on 5 colors",
    },
    learn: {
      ja: "teleop で走行しながらカメラ画像を blur → canny にかけ、視野に入った 5 色のターゲットを edge 抽出で capture します。",
      en: "Drive with teleop while the camera image flows through blur → canny. Capture all 5 color targets framed in view via edge detection.",
    },
    goal: {
      ja: "5 色のターゲット全てを canny edge で捉えて capture し、GOAL に到達しましょう。",
      en: "Capture all 5 color targets with canny edges and reach GOAL.",
    },
    first: {
      ja: "WASD で走り、Y キーで TUNE モードに切り替え blur / canny の閾値を調整しましょう。",
      en: "Drive with WASD; press Y to switch to TUNE mode and adjust the blur / canny thresholds.",
    },
  },
  strings: {
    ja: {
      hint: "全色ターゲットを camera 視野に入れて canny で edge を捉えると capture → 全部集めて GOAL へ",
      palette_hint: "WASD/矢印で走行。blur → canny で右パネルに edge map がリアルタイム表示",
      remaining: "残り {n} 個 — canny で全色を捉えて",
      run_msg: "teleop 中 — WASD/矢印/パッドで GOAL を目指せ",
      run_msg2: "teleop 中 — GOAL を目指せ",
      stop: "停止",
      tip: "各色付きターゲットを canny で検出 → 全部 capture したら GOAL",
    },
    en: {
      hint: "Frame each color target in the camera and let canny detect its edges → capture all → GOAL",
      palette_hint: "Drive with WASD/arrows. The right panel shows the live blur → canny edge map",
      remaining: "{n} target(s) left — capture with canny edges",
      run_msg: "Teleop active — drive with WASD/arrows/pad to GOAL",
      run_msg2: "Teleop active — head for GOAL",
      stop: "Stopped",
      tip: "Detect each color target via canny → capture all → GOAL",
    },
  },
  build: makeCameraMission,
});
