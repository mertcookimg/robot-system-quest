// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// object_detection: Simulated OBJ Detection
// Same teleop base as edge_detection (Camera + Teleop).
// No real ML: bbox / class / confidence are synthesized from ground-truth
// object positions. The point is to convey lesson 7/yl: the feel of
// tuning confidence thresholds and model size.
//
// The teleop + pseudo-camera plumbing lives in lib/camera_mission — this
// file keeps only the simulated detector and its right-hand panel.
import { type Stage, type GameContext } from "../../types";

import { defineStage } from "../../core/stage_def";
import { drawHint, COLORS, clearBackground } from "../../lib/draw";
import { setupBlockProgram, type BlockProgramHandle } from "../../lib/block_program";
import {
  createCameraMission,
  type CameraTarget,
  PX_PER_M,
  MAP_W,
  IMG_W,
  IMG_H,
  HORIZON_Y,
  FOCAL_LEN,
} from "../../lib/camera_mission";
import { formatPose } from "../../lib/hud";
import { t, tx, onLangChange } from "../../i18n";

const TOPIC_CMD = "/cmd_vel";
const TOPIC_DETECTION_IMG = "/obj_detection/image";
const TOPIC_DETECTION_OBJ = "/obj_detection/objects";

// Detection target objects, each labeled with a COCO-80-style class.
const OBJECTS: CameraTarget[] = [
  { x: 200, y: 230, r: 14, color: "#fb7185", label: "ball" },
  { x: 320, y: 240, r: 14, color: "#5eead4", label: "bottle" },
  { x: 410, y: 180, r: 16, color: "#c4b5fd", label: "person" },
  { x: 130, y: 410, r: 14, color: "#fbbf24", label: "cone" },
  { x: 280, y: 100, r: 12, color: "#86efac", label: "box" },
];

// Model size (n / s / m / l / x — larger = more accurate but slower).
const MODELS = ["det_n", "det_s", "det_m", "det_l", "det_x"];
const MODEL_CONF_MUL = [0.55, 0.7, 0.82, 0.92, 1.0]; // larger model → higher base confidence
const MODEL_MS_BASE = [3, 8, 22, 48, 85]; // ms / frame (pseudo)
// Names that show up as false positives (sample COCO classes).
const FAKE_CLASSES = ["dog", "chair", "tv", "laptop", "book", "cup", "cat", "backpack"];

type Block =
  | { kind: "obj"; model: number } // 0..4
  | { kind: "confidence_filter"; threshold: number };

function defaultBlock(kind: Block["kind"]): Block {
  if (kind === "obj") return { kind, model: 0 };
  return { kind: "confidence_filter", threshold: 0.5 };
}

interface Detection {
  cls: string;
  conf: number;
  bbox: { x: number; y: number; w: number; h: number };
  isReal: boolean;
  objIdx?: number;
  color?: string;
}

export function makeObjectDetection(): Stage {
  let g!: GameContext;
  const mission = createCameraMission({ targets: OBJECTS });
  const { robot, particles, captured } = mission;
  let program: Block[] = [];
  let isRunning = false;
  let elapsed = 0;
  let pubAcc = 0;
  let runCount = 0;
  let cleared = false;

  let detections: Detection[] = [];
  let lastV = 0,
    lastW = 0;
  let lastModel = 0;
  let lastThreshold = 0.5;
  let lastSimMs = 0;

  let editorEl: HTMLElement | null = null;
  let statusBadgeEl: HTMLElement | null = null;
  let bp: BlockProgramHandle | null = null;
  let readoutEl: HTMLElement | null = null;
  let viewEl: HTMLElement | null = null;
  let offReadoutLanguage = () => {};

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
    const modelBlock = [...program].reverse().find((block) => block.kind === "obj");
    const filterBlock = [...program].reverse().find((block) => block.kind === "confidence_filter");
    lastModel =
      modelBlock?.kind === "obj" ? Math.max(0, Math.min(4, Math.round(modelBlock.model))) : 0;
    lastThreshold =
      filterBlock?.kind === "confidence_filter"
        ? Math.max(0, Math.min(1, filterBlock.threshold))
        : 0;
    lastSimMs = 0;
    detections = [];
    g.ghost.startRecording();
    setStatusBadge("idle", "");
    g.setStatus(t("object_detection.tip"), "");
    refreshProgramUI();
    refreshReadout();
  }

  function detectionMessage() {
    return {
      objects: detections.map((d) => ({
        class: d.cls,
        conf: Number(d.conf.toFixed(2)),
        bbox: [d.bbox.x, d.bbox.y, d.bbox.w, d.bbox.h].map(Math.round),
      })),
    };
  }

  function setupReadout() {
    const canvasWrap = g.canvas.closest<HTMLElement>(".canvas-wrap");
    if (!canvasWrap?.parentNode) return;
    const view = document.createElement("div");
    view.className = "object-detection-view";
    canvasWrap.before(view);
    view.appendChild(canvasWrap);
    viewEl = view;
    const panel = document.createElement("section");
    panel.className = "object-detection-readout";
    panel.setAttribute("aria-labelledby", "object-detection-readout-title");
    panel.innerHTML = `
      <h3 id="object-detection-readout-title"></h3>
      <dl class="object-detection-metrics">
        ${["model", "threshold", "captured", "latency", "linear", "angular"]
          .map((key) => `<div><dt data-label="${key}"></dt><dd data-value="${key}"></dd></div>`)
          .join("")}
      </dl>
      <p class="object-detection-list-label"></p>
      <ul class="object-detection-list"></ul>
      <details class="object-detection-json">
        <summary></summary>
        <pre></pre>
      </details>
    `;
    view.appendChild(panel);
    readoutEl = panel;
    const localize = () => {
      panel.querySelector("h3")!.textContent = tx("検出結果", "Detection results");
      const labels: Record<string, string> = {
        model: tx("モデル", "Model"),
        threshold: tx("信頼度の閾値", "Confidence threshold"),
        captured: tx("見つけた物体", "Objects found"),
        latency: tx("処理時間（疑似）", "Latency (simulated)"),
        linear: tx("前進速度", "Linear speed"),
        angular: tx("回転速度", "Angular speed"),
      };
      panel.querySelectorAll<HTMLElement>("[data-label]").forEach((label) => {
        label.textContent = labels[label.dataset.label!];
      });
      panel.querySelector(".object-detection-list-label")!.textContent = tx(
        "画像の番号 / クラス / 信頼度",
        "Image number / class / confidence",
      );
      panel.querySelector("summary")!.textContent = tx("検出JSONを見る", "View detection JSON");
      refreshReadout();
    };
    localize();
    offReadoutLanguage = onLangChange(localize);
  }

  function refreshReadout() {
    if (!readoutEl) return;
    const values: Record<string, string> = {
      model: MODELS[lastModel],
      threshold: lastThreshold.toFixed(2),
      captured: `${mission.capturedCount()} / ${OBJECTS.length}`,
      latency: `${lastSimMs.toFixed(1)} ms`,
      linear: `${lastV.toFixed(2)} m/s`,
      angular: `${lastW.toFixed(2)} rad/s`,
    };
    readoutEl.querySelectorAll<HTMLElement>("[data-value]").forEach((element) => {
      element.textContent = values[element.dataset.value!];
    });
    const list = readoutEl.querySelector("ul")!;
    list.replaceChildren();
    if (!detections.length) {
      const empty = document.createElement("li");
      empty.className = "object-detection-empty";
      empty.textContent = tx("検出なし", "No detections");
      list.appendChild(empty);
    }
    detections.forEach((d, index) => {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${index + 1} ${d.cls}`;
      const confidence = document.createElement("strong");
      confidence.textContent = d.conf.toFixed(2);
      row.append(name, confidence);
      list.appendChild(row);
    });
    readoutEl.querySelector("pre")!.textContent = JSON.stringify(detectionMessage(), null, 2);
  }

  // -- Pseudo object inference.
  // Build bbox from ground-truth pose, derive confidence from distance,
  // angle, and model size. Inject occasional low-confidence false positives
  // so threshold tuning actually matters.
  function runYLInference(model: number): { dets: Detection[]; ms: number } {
    const dets: Detection[] = [];
    const modelMul = MODEL_CONF_MUL[model];

    // real detections
    for (let i = 0; i < OBJECTS.length; i++) {
      const obj = OBJECTS[i];
      const proj = mission.projectToCamera(obj.x, obj.y);
      if (!proj) continue;
      const projR = (obj.r * FOCAL_LEN) / proj.depth;
      if (projR < 4) continue;
      // bbox: tight rectangle around the circle plus a small margin.
      const bw = projR * 2.2;
      const bh = projR * 2.2;
      // confidence: distance (closer = higher) × centerness × model bonus.
      const distFactor = Math.min(1, 220 / proj.depth);
      const angFactor = Math.max(0, 1 - Math.abs(proj.lateral / Math.max(40, proj.depth)) * 0.8);
      const baseConf = 0.55 + 0.3 * distFactor + 0.15 * angFactor;
      const noise = (Math.random() - 0.5) * 0.06;
      const conf = Math.max(0.05, Math.min(0.99, baseConf * modelMul + noise));
      dets.push({
        cls: obj.label,
        conf,
        bbox: { x: proj.xi - bw / 2, y: proj.yi - bh / 2, w: bw, h: bh },
        isReal: true,
        objIdx: i,
        color: obj.color,
      });
    }

    // ~30% chance to inject one false positive.
    if (Math.random() < 0.35) {
      const bw = 22 + Math.random() * 36;
      const bh = 22 + Math.random() * 36;
      const fx = Math.random() * (IMG_W - bw);
      const fy = HORIZON_Y + Math.random() * Math.max(1, IMG_H - HORIZON_Y - bh);
      // FP confidence stays low (0.18..0.55).
      const fconf = 0.18 + Math.random() * 0.37;
      dets.push({
        cls: FAKE_CLASSES[Math.floor(Math.random() * FAKE_CLASSES.length)],
        conf: fconf,
        bbox: { x: fx, y: fy, w: bw, h: bh },
        isReal: false,
        color: "#94a3b8",
      });
    }

    return {
      dets,
      ms: MODEL_MS_BASE[model] + (Math.random() - 0.5) * 4,
    };
  }

  function runPipeline() {
    mission.captureCamera(); // for visuals only — pipeline itself uses ground truth

    let model = 0;
    let threshold = 1.0; // no setting → reject everything
    let hasYL = false;
    let hasFilter = false;
    for (const b of program) {
      if (b.kind === "obj") {
        model = Math.max(0, Math.min(4, Math.round(b.model)));
        hasYL = true;
      } else if (b.kind === "confidence_filter") {
        threshold = Math.max(0, Math.min(1, b.threshold));
        hasFilter = true;
      }
    }
    lastModel = model;
    lastThreshold = hasFilter ? threshold : 0;

    if (!hasYL) {
      detections = [];
      lastSimMs = 0;
      return;
    }

    const { dets, ms } = runYLInference(model);
    lastSimMs = ms;
    detections = hasFilter ? dets.filter((d) => d.conf >= threshold) : dets;

    // Capture: record objects that are real AND pass the threshold.
    for (const d of detections) {
      if (d.isReal && d.objIdx !== undefined && !captured[d.objIdx]) {
        captured[d.objIdx] = true;
        const obj = OBJECTS[d.objIdx];
        particles.burst(obj.x, obj.y, obj.color, 18, 180);
        g.sfx.pickup();
        g.shake(0.15);
      }
    }
  }

  // ── Init / Dispose / Program UI
  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    statusBadgeEl = document.getElementById("be-status");
    if (editorEl) editorEl.style.display = "";
    mission.enter(ctx);
    setupReadout();

    if (program.length === 0 && runCount === 0) {
      // Default: small model + slightly low threshold → FPs slip through
      // and some reals fall under threshold → tuning is required.
      program = [
        { kind: "obj", model: 0 },
        { kind: "confidence_filter", threshold: 0.45 },
      ];
    }

    bp = setupBlockProgram<Block>({
      program,
      paletteHint: t("object_detection.palette_hint"),
      blockKinds: [
        {
          kind: "obj",
          label: "detect",
          args: "model 0=n..4=x",
          defaults: () => defaultBlock("obj"),
          params: (b) =>
            b.kind === "obj" ? [{ key: "model", value: b.model, step: 1, unit: "0..4" }] : [],
        },
        {
          kind: "confidence_filter",
          label: "confidence_filter",
          args: "threshold 0..1",
          defaults: () => defaultBlock("confidence_filter"),
          params: (b) =>
            b.kind === "confidence_filter"
              ? [{ key: "threshold", value: b.threshold, step: 0.05, unit: "0..1" }]
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
    offReadoutLanguage();
    if (viewEl) {
      const canvasWrap = viewEl.querySelector(".canvas-wrap");
      if (canvasWrap) viewEl.before(canvasWrap);
      viewEl.remove();
    }
    viewEl = null;
    readoutEl = null;
  }

  function refreshProgramUI() {
    bp?.refresh();
  }

  function onRun() {
    runCount++;
    mission.resetRun();
    elapsed = 0;
    pubAcc = 0;
    cleared = false;
    isRunning = true;
    captured.fill(false);
    detections = [];
    lastSimMs = 0;
    lastV = lastW = 0;
    g.ghost.startRecording();
    setStatusBadge("running", "running");
    g.setStatus(t("object_detection.run_msg"), "var(--accent)");
    refreshProgramUI();
    refreshReadout();
  }

  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    lastV = 0;
    lastW = 0;
    setStatusBadge("stopped", "");
    g.setStatus(t("object_detection.stop"), "var(--warn)");
    refreshProgramUI();
    refreshReadout();
  }

  // ── Update
  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    mission.decayBump(dt);
    mission.pollTuneToggle();

    const { v, w } = mission.readDrive();
    lastV = v;
    lastW = w;

    if (!isRunning && (v !== 0 || w !== 0)) {
      isRunning = true;
      setStatusBadge("running", "running");
      g.setStatus(t("object_detection.run_msg2"), "var(--accent)");
    }
    if (isRunning) elapsed += dt;
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    runPipeline();

    pubAcc += dt;
    if (pubAcc > 0.1) {
      pubAcc = 0;
      g.publish(
        TOPIC_CMD,
        `geometry_msgs/msg/Twist linear.x:${v.toFixed(2)} angular.z:${w.toFixed(2)}`,
      );
      g.publish(
        TOPIC_DETECTION_IMG,
        `sensor_msgs/msg/Image ${IMG_W}x${IMG_H} bgr8 + N=${detections.length} bboxes`,
      );
      // The readable result panel and pseudo ROS message share the same values.
      g.publish(TOPIC_DETECTION_OBJ, `std_msgs/msg/String  ${JSON.stringify(detectionMessage())}`);
      refreshReadout();
    }

    // Physics + collision.
    if (mission.stepPhysics(v, w, dt)) {
      lastV = 0;
      lastW = 0;
    }

    // Goal check.
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
          `objects <b>${mission.capturedCount()} / ${OBJECTS.length}</b><br>` +
          `model  <b>${MODELS[lastModel]}</b><br>` +
          `threshold <b>${lastThreshold.toFixed(2)}</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 350);
      } else {
        const remaining = OBJECTS.length - mission.capturedCount();
        g.setStatus(t("object_detection.remaining", { n: remaining }), "var(--warn)");
      }
    }

    g.setHud([
      `mode:    teleop + simulated detector`,
      `pose:    ${formatPose(robot, { pxPerM: PX_PER_M })}`,
      `model:   ${MODELS[lastModel]}  threshold:${lastThreshold.toFixed(2)}`,
      `objects: ${mission.capturedCount()} / ${OBJECTS.length} captured  (det:${detections.length})`,
      `latency: ${lastSimMs.toFixed(1)} ms / frame (sim)`,
    ]);
  }

  // ── Draw
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    // Left: top-down map (world, objects, goal, trail, ghost, robot, …).
    mission.drawTopDown(c, elapsed);

    // ------ Right pane: camera + detections ------
    drawRightPanel(c);

    drawHint(c, t("object_detection.hint"));
  }

  function drawRightPanel(c: CanvasRenderingContext2D) {
    const x0 = MAP_W + 20;
    c.save();
    mission.drawRightPanelFrame(c);

    c.fillStyle = "#7dd3fc";
    c.font = "700 16px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("CAMERA + DETECTOR", x0, 22);

    // INPUT camera image.
    c.drawImage(mission.camCanvas, x0, 32);
    c.strokeStyle = "rgba(35,44,77,0.9)";
    c.strokeRect(x0 - 1, 31, IMG_W + 2, IMG_H + 2);

    // Draw bboxes on the camera image.
    for (const [index, d] of detections.entries()) {
      const col = d.color || "#7dd3fc";
      c.save();
      c.strokeStyle = col;
      c.lineWidth = d.isReal ? 1.6 : 1;
      c.globalAlpha = d.isReal ? 0.95 : 0.7;
      c.strokeRect(x0 + d.bbox.x, 32 + d.bbox.y, d.bbox.w, d.bbox.h);
      // Match each box to the unscaled HTML result, without tiny repeated text.
      const label = String(index + 1);
      c.font = "700 16px ui-monospace, monospace";
      const tw = c.measureText(label).width;
      c.globalAlpha = d.isReal ? 0.85 : 0.55;
      c.fillStyle = col;
      c.fillRect(x0 + d.bbox.x, 32 + d.bbox.y - 19, tw + 8, 19);
      c.fillStyle = COLORS.BG_DARK;
      c.globalAlpha = 1;
      c.textAlign = "left";
      c.fillText(label, x0 + d.bbox.x + 4, 32 + d.bbox.y - 3);
      c.restore();
    }

    c.restore();
  }

  return {
    id: "object_detection",
    name: "Object Detection",
    lesson: "Object Detection",
    lessonCmd: "ros2 topic echo /obj_detection/objects",
    ros2: {
      title: tx("物体検出シミュレーション", "Simulated Object Detection"),
      summary:
        "一般的なObject Detection Nodeの動作を再現したステージです。実際のNeural Networkは実行せず、" +
        "正解データからBounding Box・Class・Confidenceを生成します。" +
        "このシミュレーションでは、model sizeをnからxへ上げるほど基準ConfidenceとLatencyが増える設定です。" +
        "実機での精度・Confidence・処理速度は、モデル、学習データ、入力、Hardwareによって変わります。" +
        "confidence_filterのthresholdを調整し、誤検出を除きながらすべてのClassを検出するとクリアです。" +
        "検出結果は/obj_detection/objectsへJSON形式で擬似的にpublishします。",
      msgTypes: ["sensor_msgs/msg/Image", "std_msgs/msg/String", "geometry_msgs/msg/Twist"],
      state: {
        nodes: ["/teleop", "/robot_node", "/object_detector"],
        topics: [
          {
            name: TOPIC_CMD,
            type: "geometry_msgs/msg/Twist",
            pub: ["/teleop"],
            sub: ["/robot_node"],
          },
          { name: TOPIC_DETECTION_IMG, type: "sensor_msgs/msg/Image", pub: ["/object_detector"] },
          { name: TOPIC_DETECTION_OBJ, type: "std_msgs/msg/String", pub: ["/object_detector"] },
        ],
      },
      cli: [
        "ros2 topic echo /obj_detection/objects",
        "ros2 topic hz /obj_detection/image",
        "ros2 topic info /obj_detection/objects",
      ],
      python: `from cv_bridge import CvBridge
import json
bridge = CvBridge()

class ObjectDetectorNode(Node):
    def __init__(self):
        super().__init__("object_detector")
        # 任意の物体検出モデルをロード (例)
        self.model = load_detector("det_n")
        self.conf = 0.5
        self.sub = self.create_subscription(Image, "/image_raw", self.cb, 10)
        self.pub_img = self.create_publisher(Image, "/obj_detection/image", 10)
        self.pub_obj = self.create_publisher(String, "/obj_detection/objects", 10)
    def cb(self, msg):
        img = bridge.imgmsg_to_cv2(msg, "bgr8")
        results = self.model(img, conf=self.conf)
        # bbox + class を JSON で publish
        objs = [{"class": cls, "conf": float(p)} for (cls, p, _bbox) in results]
        self.pub_obj.publish(String(data=json.dumps({"objects": objs})))`,
      realWorld: tx(
        "実機の物体検出では、モデルの大きさ、推論速度、精度の間にトレードオフが生じることがあります。ただし、大きいモデルが常に高精度・高Confidenceになるとは限りません。このステージでは、thresholdと処理時間の関係を単純化して体験します。",
        "Real object detection can involve trade-offs among model size, inference speed, and accuracy, but a larger model is not guaranteed to be more accurate or more confident. This stage provides a simplified way to explore thresholds and processing time.",
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
  order: 15,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="Example confidence scores and threshold; confidence filter accepts detections at or above the threshold">
  <!-- camera image -->
  <rect x="14" y="14" width="190" height="88" rx="4" fill="#0c1124" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="22" y="100" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9">/image_raw</text>
  <!-- mock objects in image -->
  <circle cx="58" cy="58" r="14" fill="#fbbf24" opacity="0.85"/>
  <rect x="108" y="38" width="22" height="38" fill="#5eead4" opacity="0.85"/>
  <circle cx="170" cy="62" r="11" fill="#c4b5fd" opacity="0.85"/>
  <!-- bounding boxes (detector output) -->
  <rect x="40" y="42" width="38" height="32" fill="none" stroke="#5eead4" stroke-width="1.5" stroke-dasharray="3 2"/>
  <rect x="40" y="32" width="44" height="11" fill="#5eead4"/>
  <text x="42" y="40" fill="#0c1124" font-family="ui-monospace, monospace" font-size="8" font-weight="700">ball 0.92</text>
  <rect x="100" y="32" width="38" height="50" fill="none" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="3 2"/>
  <rect x="100" y="22" width="42" height="11" fill="#fbbf24"/>
  <text x="102" y="30" fill="#0c1124" font-family="ui-monospace, monospace" font-size="8" font-weight="700">box 0.55</text>
  <rect x="155" y="48" width="32" height="30" fill="none" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="3 2"/>
  <rect x="155" y="38" width="38" height="11" fill="#fb7185"/>
  <text x="157" y="46" fill="#0c1124" font-family="ui-monospace, monospace" font-size="8" font-weight="700">cone 0.42</text>
  <!-- threshold bar (right) -->
  <rect x="226" y="20" width="180" height="78" rx="6" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="316" y="38" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">conf_filter</text>
  <rect x="240" y="56" width="152" height="12" rx="2" fill="#0c1124"/>
  <rect x="240" y="56" width="76" height="12" rx="2" fill="#5eead4" opacity="0.4"/>
  <rect x="316" y="56" width="76" height="12" rx="2" fill="#5eead4"/>
  <line x1="316" y1="50" x2="316" y2="74" stroke="#fbbf24" stroke-width="2"/>
  <text x="316" y="48" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="9">thr=0.5</text>
  <text x="240" y="84" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">0.0</text>
  <text x="394" y="84" text-anchor="end" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">1.0</text>
  <text x="316" y="94" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9">conf ≥ thr → accept</text>
  <text x="210" y="113" text-anchor="middle" fill="#9aa6c8" font-family="system-ui, sans-serif" font-size="8">数値は例 / EXAMPLE VALUES</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "物体検出 — DetectorとConfidence Filter",
      en: "Object detection — detector + confidence filter",
    },
    learn: {
      ja: "物体検出器（Object Detector）は、画像に写っている物体のクラス名と信頼度をBounding Boxとともに出力します。confidence_filterで閾値以上の検出だけを残し、model sizeとthresholdのトレードオフを学びます。",
      en: "An object detector outputs each detected object's class label, confidence, and bounding box. confidence_filter keeps only detections at or above the threshold. Tune model size vs threshold to balance precision and recall.",
    },
    goal: {
      ja: "modelとthresholdを調整してすべてのクラスを検出し、GOALに到達しましょう。",
      en: "Tune model and threshold to detect every class, then reach GOAL.",
    },
    first: {
      ja: "detectブロックのmodelとconfidence_filterのthresholdを調整して、▶ RUNを押しましょう。",
      en: "Set model on the detect block and threshold on confidence_filter, then press ▶ RUN.",
    },
  },
  strings: {
    ja: {
      hint: "このシミュレーションでは、model大 → 処理時間と基準Confidenceが上昇 / threshold高 → 誤検出と検出数が減少",
      palette_hint: "detect（model）→ confidence_filter（threshold）で物体を検出",
      remaining: "残り{n}個のClassを検出してください",
      run_msg: "遠隔操作中 — 検出器ですべてのClassを見つけてGOALへ",
      run_msg2: "遠隔操作中 — 検出器で物体を捉えてください",
      stop: "停止",
      tip: "物体検出器ですべてのClassを検出 → すべて検出したらGOALへ",
    },
    en: {
      hint: "In this simulation: larger model → more latency and higher base confidence / higher threshold may reduce FP but increase misses",
      palette_hint: "detect(model) → confidence_filter(threshold) detection pipeline",
      remaining: "{n} class(es) remaining",
      run_msg: "Teleop active — find all classes with the detector and reach GOAL",
      run_msg2: "Teleop active — capture objects with the detector",
      stop: "Stopped",
      tip: "Detect each class with the object detector → capture all → GOAL",
    },
  },
  build: makeObjectDetection,
});
