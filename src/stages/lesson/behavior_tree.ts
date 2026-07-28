// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// behavior_tree: Behavior Tree Editor — teaches the BT concepts used by Nav2.
// The player arranges four "if condition → action" rules and a default action
// to build a policy that guides the robot to the goal.
//
// Internal BT structure:
//   Selector
//   ├─ Sequence(Cond1, Action1)
//   ├─ Sequence(Cond2, Action2)
//   ├─ Sequence(Cond3, Action3)
//   ├─ Sequence(Cond4, Action4)
//   └─ ActionDefault
//
// In ROS 2 learning terms, this is the smallest behaviortree.cpp unit. Order
// matters because the Selector evaluates top-down and runs the first successful child.
import { type Stage, type GameContext } from "../../types";
import { drawHint, drawTimer, drawRobotBody, COLORS, clearBackground } from "../../lib/draw";
import { canMoveTo as inWalls, type Aabb } from "../../lib/walls";
import { Trail } from "../../lib/trail";
import { Particles } from "../../lib/particles";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { t, tx } from "../../i18n";
import { defineStage } from "../../core/stage_def";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";

// World layout: top-down robot maze on the left, BT visualization on the right.
const WORLD_X0 = 10;
const WORLD_Y0 = 10;
const WORLD_W = 480;
const WORLD_H = 380;
const TREE_X0 = 510;
const TREE_Y0 = 10;
const TREE_W = 280;
const TREE_H = 380;

const ROBOT_R = 12;
const SCAN_RANGE = 130;
const FORWARD_SPEED = 90; // px/s
const TURN_SPEED = 1.8; // rad/s

// The HTML rule editor covers the lower half of the screen, so START and GOAL
// stay in the upper half at y < 280. Because the reactive BT treats a wall
// collision as an immediate crash, place only one inner wall away from the
// robot's natural arc and visualize it as an upper obstacle.
// The puzzle focuses on using priority and goal_left/right to steer toward GOAL.
const START = { x: WORLD_X0 + 60, y: WORLD_Y0 + 220, theta: 0 };
const GOAL = { x: WORLD_X0 + 410, y: WORLD_Y0 + 90, r: 22 };

const walls: Aabb[] = [
  // perimeter
  { x: WORLD_X0, y: WORLD_Y0, w: WORLD_W, h: 4 },
  { x: WORLD_X0, y: WORLD_Y0 + WORLD_H - 4, w: WORLD_W, h: 4 },
  { x: WORLD_X0, y: WORLD_Y0, w: 4, h: WORLD_H },
  { x: WORLD_X0 + WORLD_W - 4, y: WORLD_Y0, w: 4, h: WORLD_H },
  // Path obstacle 1: blocks the northeast line, forcing a southern detour via obstacle_close.
  { x: WORLD_X0 + 170, y: WORLD_Y0 + 130, w: 40, h: 100 },
  // Path obstacle 2: blocks another northeast approach, forcing a second southern detour.
  { x: WORLD_X0 + 300, y: WORLD_Y0 + 60, w: 40, h: 90 },
];

type Condition =
  | "at_goal"
  | "obstacle_close"
  | "obstacle_left"
  | "obstacle_right"
  | "clear_ahead"
  | "goal_left"
  | "goal_right";

type Action = "forward" | "turn_left" | "turn_right" | "stop";

const CONDITIONS: { id: Condition; label: string }[] = [
  { id: "at_goal", label: "at_goal" },
  { id: "obstacle_close", label: "obstacle_close" },
  { id: "obstacle_left", label: "obstacle_left" },
  { id: "obstacle_right", label: "obstacle_right" },
  { id: "clear_ahead", label: "clear_ahead" },
  { id: "goal_left", label: "goal_left" },
  { id: "goal_right", label: "goal_right" },
];

const ACTIONS: { id: Action; label: string }[] = [
  { id: "forward", label: "forward" },
  { id: "turn_left", label: "turn_left" },
  { id: "turn_right", label: "turn_right" },
  { id: "stop", label: "stop" },
];

interface Rule {
  cond: Condition | null;
  action: Action | null;
}
const RULE_COUNT = 4;

export function makeBtEditor(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const trail = new Trail({ max: 200 });
  const particles = new Particles();
  let elapsed = 0;
  let cleared = false;
  let isRunning = false;
  let bumpFlash = 0;
  let runCount = 0;
  // -1 = no rule matched (using default), 0..3 = rule index that fired this tick
  let activeRule = -1;
  let activeAction: Action = "stop";
  const sensors = {
    front: SCAN_RANGE,
    left: SCAN_RANGE,
    right: SCAN_RANGE,
    dist_to_goal: 1000,
    angle_to_goal: 0, // Relative angle from the robot heading, in [-π, π].
  };
  const GOAL_ANGLE_THR = (20 * Math.PI) / 180; // Classify goal_left/right outside ±20°.
  let pubAcc = 0;

  let rules: Rule[] = [
    { cond: null, action: null },
    { cond: null, action: null },
    { cond: null, action: null },
    { cond: null, action: null },
  ];
  let defaultAction: Action = "forward";

  let panelEl: HTMLElement | null = null;
  let statusEl: HTMLSpanElement | null = null;

  // ============================================================
  // BT execution
  // ============================================================
  function castRay(angleOffset: number): number {
    const a = robot.theta + angleOffset;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const step = 3;
    for (let d = 0; d <= SCAN_RANGE; d += step) {
      const px = robot.x + dx * d;
      const py = robot.y + dy * d;
      if (!inWalls(walls, px, py, 1)) return d;
    }
    return SCAN_RANGE;
  }

  function updateSensors() {
    sensors.front = castRay(0);
    sensors.left = castRay(-Math.PI / 2);
    sensors.right = castRay(Math.PI / 2);
    const dx = robot.x - GOAL.x;
    const dy = robot.y - GOAL.y;
    sensors.dist_to_goal = Math.hypot(dx, dy);
    // Relative angle indicating whether the goal is left or right of the robot's heading.
    const goalAngleWorld = Math.atan2(GOAL.y - robot.y, GOAL.x - robot.x);
    let rel = goalAngleWorld - robot.theta;
    while (rel > Math.PI) rel -= 2 * Math.PI;
    while (rel < -Math.PI) rel += 2 * Math.PI;
    sensors.angle_to_goal = rel;
  }

  // Goal test: inside when the robot's edge overlaps the goal circle, including ROBOT_R.
  const GOAL_REACH = GOAL.r + ROBOT_R;

  function evalCondition(c: Condition): boolean {
    switch (c) {
      case "at_goal":
        return sensors.dist_to_goal < GOAL_REACH;
      case "obstacle_close":
        return sensors.front < 50;
      case "obstacle_left":
        return sensors.left < 60;
      case "obstacle_right":
        return sensors.right < 60;
      case "clear_ahead":
        return sensors.front > 100;
      case "goal_left":
        return sensors.angle_to_goal < -GOAL_ANGLE_THR;
      case "goal_right":
        return sensors.angle_to_goal > GOAL_ANGLE_THR;
    }
  }

  function tickBT(): { v: number; w: number } {
    activeRule = -1;
    activeAction = defaultAction;
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.cond && r.action && evalCondition(r.cond)) {
        activeAction = r.action;
        activeRule = i;
        break;
      }
    }
    switch (activeAction) {
      case "forward":
        return { v: FORWARD_SPEED, w: 0 };
      case "turn_left":
        return { v: 0, w: -TURN_SPEED };
      case "turn_right":
        return { v: 0, w: TURN_SPEED };
      case "stop":
        return { v: 0, w: 0 };
    }
  }

  // ============================================================
  // Lifecycle
  // ============================================================
  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    trail.reset();
    particles.reset();
    elapsed = 0;
    cleared = false;
    isRunning = false;
    bumpFlash = 0;
    activeRule = -1;
    activeAction = "stop";
    pubAcc = 0;
    g.ghost.startRecording();
    setStatus(t("behavior_tree.status.idle"), "");
    refreshPanel();
  }

  function init(ctx: GameContext) {
    g = ctx;
    if (runCount === 0) {
      // Default sample rules: priority = stop at goal > avoid obstacle > face goal > forward.
      // Typical simple reactive BT, evaluated in priority order.
      rules = [
        { cond: "at_goal", action: "stop" },
        { cond: "obstacle_close", action: "turn_right" },
        { cond: "goal_left", action: "turn_left" },
        { cond: "goal_right", action: "turn_right" },
      ];
      defaultAction = "forward";
    }
    setupPanel();
    reset();
  }

  function dispose() {
    unregisterOverlayPad();
    if (panelEl?.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
    statusEl = null;
    g.overlay.style.cssText = "";
    g.overlay.innerHTML = "";
  }

  function setStatus(msg: string, kind: "" | "running" | "success" | "error") {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color =
      kind === "success"
        ? "var(--ok)"
        : kind === "running"
          ? "var(--accent)"
          : kind === "error"
            ? "var(--danger)"
            : "var(--fg-dim)";
  }

  // ============================================================
  // Rule editor panel (under canvas)
  // ============================================================
  function setupPanel() {
    // Keep the panel outside canvas-wrap, alongside block-editor, so it does
    // not interfere with the Clear overlay.
    g.overlay.innerHTML = "";
    g.overlay.style.cssText = "";

    const panel = document.createElement("section");
    panel.id = "bt-rule-editor";
    panel.className = "stage-tool-panel bt-rule-editor";
    panel.style.cssText =
      "width:min(800px, 100%); margin:10px auto 0; padding:10px 14px;" +
      "background:rgba(var(--scrim-rgb), 0.92);" +
      "border:1px solid rgba(125,211,252,0.5); border-radius:8px;" +
      "font-family:ui-monospace,monospace; font-size:11px; color:#eef2ff;" +
      "display:grid; grid-template-columns: auto 1fr auto auto auto; gap:4px 10px; align-items:center;";

    // Header row
    panel.appendChild(headerCell("RULE"));
    panel.appendChild(headerCell("CONDITION → ACTION"));
    panel.appendChild(headerCell(""));
    panel.appendChild(headerCell(""));
    panel.appendChild(headerCell(""));

    for (let i = 0; i < RULE_COUNT; i++) {
      const idx = i;
      const num = document.createElement("span");
      num.textContent = String(i + 1);
      num.style.cssText = "color:#7dd3fc; font-weight:700;";
      panel.appendChild(num);

      const ruleWrap = document.createElement("span");
      ruleWrap.className = "bt-rule-row";
      ruleWrap.dataset.opadRow = "1";
      ruleWrap.style.cssText = "display:flex; gap:6px; align-items:center; padding:3px 4px;";
      const ifLabel = document.createElement("span");
      ifLabel.textContent = "if";
      ifLabel.style.color = "#9aa6c8";
      const condSel = makeSelect(
        [{ id: "", label: "—" }, ...CONDITIONS],
        rules[idx].cond ?? "",
        (v) => {
          rules[idx].cond = (v as Condition) || null;
        },
      );
      const arrow = document.createElement("span");
      arrow.textContent = "→";
      arrow.style.color = "#9aa6c8";
      const actSel = makeSelect(
        [{ id: "", label: "—" }, ...ACTIONS],
        rules[idx].action ?? "",
        (v) => {
          rules[idx].action = (v as Action) || null;
        },
      );
      ruleWrap.appendChild(ifLabel);
      ruleWrap.appendChild(condSel);
      ruleWrap.appendChild(arrow);
      ruleWrap.appendChild(actSel);
      panel.appendChild(ruleWrap);

      // Spacer columns
      for (let column = 0; column < 3; column++) {
        const spacer = document.createElement("span");
        spacer.className = "bt-spacer";
        panel.appendChild(spacer);
      }
    }

    // Default row
    const defLabel = document.createElement("span");
    defLabel.textContent = "—";
    defLabel.style.color = "#9aa6c8";
    panel.appendChild(defLabel);

    const defWrap = document.createElement("span");
    defWrap.className = "bt-rule-row bt-default-row";
    defWrap.dataset.opadRow = "1";
    defWrap.style.cssText = "display:flex; gap:6px; align-items:center; padding:3px 4px;";
    const defText = document.createElement("span");
    defText.textContent = "default →";
    defText.style.color = "#9aa6c8";
    const defSel = makeSelect(ACTIONS, defaultAction, (v) => {
      defaultAction = v as Action;
    });
    defWrap.appendChild(defText);
    defWrap.appendChild(defSel);
    panel.appendChild(defWrap);

    // Buttons (RUN / STOP / RESET)
    const runBtn = document.createElement("button");
    runBtn.className = "bt-action";
    styleBtn(runBtn, "#5eead4");
    runBtn.textContent = "▶ RUN";
    runBtn.onclick = () => onRun();
    panel.appendChild(runBtn);

    const stopBtn = document.createElement("button");
    stopBtn.className = "bt-action";
    styleBtn(stopBtn, "#fbbf24");
    stopBtn.textContent = "STOP";
    stopBtn.onclick = () => onStop();
    panel.appendChild(stopBtn);

    const resetBtn = document.createElement("button");
    resetBtn.className = "bt-action";
    styleBtn(resetBtn, "#9aa6c8");
    resetBtn.textContent = "RESET";
    resetBtn.onclick = () => reset();
    panel.appendChild(resetBtn);

    // Status row
    const statusBox = document.createElement("div");
    statusBox.className = "bt-status";
    statusBox.style.cssText =
      "grid-column: 1 / -1; padding-top:6px; border-top:1px solid rgba(125,211,252,0.2);" +
      "font-size:10px; color:#9aa6c8;";
    const status = document.createElement("span");
    status.textContent = t("behavior_tree.status.idle");
    statusEl = status;
    statusBox.appendChild(status);
    const padHint = document.createElement("span");
    padHint.className = "bt-pad-hint";
    padHint.style.cssText = "float:right; color:#fbbf24;";
    padHint.innerHTML = "🎮 ↑↓ 項目 · A 一覧を開く / ボタン実行 · B 取消";
    statusBox.appendChild(padHint);
    panel.appendChild(statusBox);

    // Insert immediately after canvas-wrap, alongside block-editor.
    const canvasWrap = document.getElementById("canvas-wrap");
    if (canvasWrap?.parentNode) {
      canvasWrap.parentNode.insertBefore(panel, canvasWrap.nextSibling);
    } else {
      document.body.appendChild(panel);
    }
    panelEl = panel;
    registerOverlayPad(panel);
  }

  function headerCell(text: string): HTMLSpanElement {
    const s = document.createElement("span");
    s.className = "bt-header-cell";
    s.textContent = text;
    s.style.cssText = "color:#7dd3fc; font-size:9px; font-weight:700; letter-spacing:0.05em;";
    return s;
  }

  function makeSelect<T extends string>(
    options: { id: T; label: string }[],
    value: T,
    onChange: (v: T) => void,
  ): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.className = "bt-rule-select";
    sel.style.cssText =
      "padding:4px 6px; background:#0c1124; color:#eef2ff;" +
      "border:1px solid #2c3554; border-radius:4px; font-family:inherit; font-size:11px;";
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = o.label;
      if (o.id === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value as T));
    return sel;
  }

  function styleBtn(b: HTMLButtonElement, color: string) {
    b.style.cssText =
      `padding:4px 10px; background:${color}; color:#0c1124; border:none; border-radius:4px;` +
      "font-family:inherit; font-size:11px; font-weight:700; cursor:pointer;";
  }

  function refreshPanel() {
    /* no-op: dropdowns drive state directly */
  }

  // ============================================================
  // RUN / STOP
  // ============================================================
  function onRun() {
    // Validate: at least one rule must have both cond + action
    const valid = rules.some((r) => r.cond && r.action);
    if (!valid) {
      setStatus(t("behavior_tree.status.no_rules"), "error");
      return;
    }
    runCount++;
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    trail.reset();
    particles.reset();
    elapsed = 0;
    cleared = false;
    bumpFlash = 0;
    isRunning = true;
    pubAcc = 0;
    g.ghost.startRecording();
    setStatus(t("behavior_tree.status.running"), "running");
    g.sfx.click();
  }
  function onStop() {
    if (!isRunning) return;
    isRunning = false;
    setStatus(t("behavior_tree.status.stopped"), "");
  }

  // ============================================================
  // Update
  // ============================================================
  function update(dt: number) {
    particles.update(dt);
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);
    if (cleared || !isRunning) return;

    elapsed += dt;
    updateSensors();

    const cmd = tickBT();
    const nx = robot.x + cmd.v * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.v * Math.sin(robot.theta) * dt;
    if (inWalls(walls, nx, ny, ROBOT_R)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.v !== 0) {
      bumpFlash = 1;
      isRunning = false;
      setStatus(t("behavior_tree.status.crash"), "error");
      g.sfx.bump();
      g.shake(0.4);
      return;
    }
    robot.theta += cmd.w * dt;
    trail.update(dt, robot.x, robot.y);
    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    // Goal check: clear when the robot's edge touches the goal circle.
    // Evaluate immediately on entry instead of requiring the robot to stop;
    // clear even when velocity has not reached zero (cmd.v !== 0).
    if (sensors.dist_to_goal < GOAL_REACH) {
      cleared = true;
      isRunning = false;
      particles.burst(robot.x, robot.y, COLORS.OK, 36);
      g.shake(0.5);
      g.sfx.deliver();
      setStatus(t("behavior_tree.status.success"), "success");
      const stars = elapsed < 8 ? 3 : elapsed < 14 ? 2 : 1;
      const stats =
        `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
        `Rules     <b>${rules.filter((r) => r.cond && r.action).length} / ${RULE_COUNT}</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
      return;
    }

    // Pseudo publish at 5 Hz
    pubAcc += dt;
    if (pubAcc > 1 / 5) {
      pubAcc = 0;
      g.publish(
        "/bt/active_node",
        activeRule >= 0
          ? `Rule${activeRule + 1}: ${rules[activeRule].cond} → ${rules[activeRule].action}`
          : `default: ${defaultAction}`,
      );
      g.publish("/cmd_vel", `linear=${cmd.v.toFixed(0)} angular=${cmd.w.toFixed(2)}`);
    }

    g.setHud([
      `bt_active:  ${activeRule >= 0 ? "Rule " + (activeRule + 1) : "default"}`,
      `action:     ${activeAction}`,
      `front:      ${sensors.front.toFixed(0)} px`,
      `left:       ${sensors.left.toFixed(0)} px`,
      `right:      ${sensors.right.toFixed(0)} px`,
      `to_goal:    ${sensors.dist_to_goal.toFixed(0)} px`,
    ]);
  }

  // ============================================================
  // Draw
  // ============================================================
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    drawWorld(c);
    drawTree(c);

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("behavior_tree.hint"));
  }

  function drawWorld(c: CanvasRenderingContext2D) {
    // Workspace background
    c.fillStyle = "rgba(15, 22, 48, 0.6)";
    c.fillRect(WORLD_X0, WORLD_Y0, WORLD_W, WORLD_H);

    // Walls
    for (const w of walls) {
      c.fillStyle = "rgba(35, 44, 77, 0.85)";
      c.strokeStyle = "rgba(110, 122, 156, 0.55)";
      c.lineWidth = 1;
      c.fillRect(w.x, w.y, w.w, w.h);
      c.strokeRect(w.x + 0.5, w.y + 0.5, w.w - 1, w.h - 1);
    }

    // Goal
    const pulse = 0.7 + 0.3 * Math.sin(elapsed * 3);
    c.save();
    c.strokeStyle = "rgba(94, 234, 212, 0.85)";
    c.fillStyle = "rgba(94, 234, 212, 0.18)";
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(GOAL.x, GOAL.y, GOAL.r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.globalAlpha = 0.5 * pulse;
    c.beginPath();
    c.arc(GOAL.x, GOAL.y, GOAL.r * (1.2 + 0.2 * pulse), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = "#5eead4";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("GOAL", GOAL.x, GOAL.y - GOAL.r - 6);
    c.restore();

    // Start marker
    c.save();
    c.strokeStyle = "rgba(125, 211, 252, 0.6)";
    c.lineWidth = 1;
    c.setLineDash([3, 3]);
    c.beginPath();
    c.arc(START.x, START.y, ROBOT_R + 4, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.restore();

    // Trail
    trail.draw(c, 0.55);

    // Sensor rays (only when running)
    if (isRunning) {
      c.save();
      c.strokeStyle = "rgba(125, 211, 252, 0.45)";
      c.lineWidth = 1;
      drawRay(c, robot, 0, sensors.front);
      drawRay(c, robot, -Math.PI / 2, sensors.left);
      drawRay(c, robot, Math.PI / 2, sensors.right);
      c.restore();
    }

    // Particles
    particles.draw(c);

    // Ghost
    g.ghost.draw(c, elapsed, elapsed);

    // Robot
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, elapsed);
    c.restore();
  }

  function drawRay(
    c: CanvasRenderingContext2D,
    pose: { x: number; y: number; theta: number },
    off: number,
    dist: number,
  ) {
    const a = pose.theta + off;
    c.beginPath();
    c.moveTo(pose.x, pose.y);
    c.lineTo(pose.x + Math.cos(a) * dist, pose.y + Math.sin(a) * dist);
    c.stroke();
  }

  function drawTree(c: CanvasRenderingContext2D) {
    // Frame
    c.fillStyle = "rgba(15, 22, 48, 0.6)";
    c.fillRect(TREE_X0, TREE_Y0, TREE_W, TREE_H);
    c.strokeStyle = "rgba(125, 211, 252, 0.3)";
    c.lineWidth = 1;
    c.strokeRect(TREE_X0 + 0.5, TREE_Y0 + 0.5, TREE_W - 1, TREE_H - 1);

    c.fillStyle = "#7dd3fc";
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("BEHAVIOR TREE", TREE_X0 + TREE_W / 2, TREE_Y0 + 16);

    // Root: Selector
    const rootX = TREE_X0 + TREE_W / 2;
    const rootY = TREE_Y0 + 40;
    drawNode(c, rootX, rootY, 80, 22, "Selector", "#c4b5fd", false);

    // Each rule = Sequence with [Cond, Action]; default = Action
    const branchY = rootY + 50;
    const slotW = TREE_W / (RULE_COUNT + 1);
    for (let i = 0; i < RULE_COUNT; i++) {
      const cx = TREE_X0 + slotW * (i + 0.5);
      const r = rules[i];
      const fired = isRunning && activeRule === i;
      // Connection from root
      c.strokeStyle = fired ? "#fbbf24" : "rgba(125, 211, 252, 0.3)";
      c.lineWidth = fired ? 2 : 1;
      c.beginPath();
      c.moveTo(rootX, rootY + 11);
      c.lineTo(cx, branchY - 11);
      c.stroke();
      // Sequence node
      const valid = !!(r.cond && r.action);
      drawNode(
        c,
        cx,
        branchY,
        slotW - 8,
        18,
        "Seq " + (i + 1),
        valid ? "#5eead4" : "#3a4366",
        fired,
      );
      // Cond + Action below
      const condY = branchY + 28;
      drawLeaf(c, cx, condY, slotW - 14, r.cond ?? "—", "#fbbf24");
      const actY = condY + 22;
      drawLeaf(c, cx, actY, slotW - 14, r.action ?? "—", "#7dd3fc");
    }

    // Default
    const defX = TREE_X0 + slotW * (RULE_COUNT + 0.5);
    const defFired = isRunning && activeRule === -1;
    c.strokeStyle = defFired ? "#fbbf24" : "rgba(125, 211, 252, 0.3)";
    c.lineWidth = defFired ? 2 : 1;
    c.beginPath();
    c.moveTo(rootX, rootY + 11);
    c.lineTo(defX, branchY - 11);
    c.stroke();
    drawLeaf(c, defX, branchY, slotW - 8, "default", "#9aa6c8");
    drawLeaf(c, defX, branchY + 28, slotW - 14, defaultAction, "#7dd3fc");

    // Legend
    c.font = "9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillStyle = "#9aa6c8";
    c.fillText("● cond   ● action   ─ pri →", TREE_X0 + 10, TREE_Y0 + TREE_H - 12);

    // Active rule callout
    if (isRunning) {
      c.fillStyle = "#fbbf24";
      c.font = "700 10px ui-monospace, monospace";
      c.textAlign = "right";
      c.fillText(
        activeRule >= 0 ? `▶ Rule ${activeRule + 1} firing` : "▶ default firing",
        TREE_X0 + TREE_W - 10,
        TREE_Y0 + TREE_H - 12,
      );
    }
  }

  function drawNode(
    c: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    h: number,
    label: string,
    color: string,
    highlight: boolean,
  ) {
    c.save();
    c.fillStyle = highlight ? "rgba(251, 191, 36, 0.18)" : "rgba(15, 22, 48, 0.85)";
    c.strokeStyle = highlight ? "#fbbf24" : color;
    c.lineWidth = highlight ? 2 : 1.4;
    c.beginPath();
    if (typeof c.roundRect === "function") c.roundRect(cx - w / 2, cy - h / 2, w, h, 4);
    else c.rect(cx - w / 2, cy - h / 2, w, h);
    c.fill();
    c.stroke();
    c.fillStyle = highlight ? "#fbbf24" : color;
    c.font = "700 10px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(label, cx, cy);
    c.restore();
  }

  function drawLeaf(
    c: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    label: string,
    color: string,
  ) {
    // Split labels on "_" when they do not fit; shrink the font if neither line fits.
    const idx = label.indexOf("_");
    const lines =
      idx > 0 && idx < label.length - 1 ? [label.slice(0, idx), label.slice(idx + 1)] : [label];
    const isMulti = lines.length > 1;
    const boxH = isMulti ? 22 : 16;
    c.save();
    c.fillStyle = "rgba(15, 22, 48, 0.6)";
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    if (typeof c.roundRect === "function") c.roundRect(cx - w / 2, cy - boxH / 2, w, boxH, 3);
    else c.rect(cx - w / 2, cy - boxH / 2, w, boxH);
    c.fill();
    c.stroke();
    c.fillStyle = color;
    // Gradually reduce the font size to fit the box width.
    const longest = Math.max(...lines.map((s) => s.length));
    const fontPx = longest <= 7 ? 9 : longest <= 9 ? 8 : 7;
    c.font = `${fontPx}px ui-monospace, monospace`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    if (isMulti) {
      c.fillText(lines[0], cx, cy - 5);
      c.fillText(lines[1], cx, cy + 5);
    } else {
      c.fillText(lines[0], cx, cy);
    }
    c.restore();
  }

  return {
    id: "behavior_tree",
    name: "Behavior Tree",
    lesson: "Behavior Tree",
    lessonCmd: "ros2 node info /bt_navigator",
    ros2: defineRos2Concept({
      title: tx("Behavior Tree — Nav2 流の意思決定", "Behavior Tree — Nav2-style decision making"),
      summary:
        "Nav2 では BehaviorTree.CPP の Control / Action / Condition Node を組み合わせて" +
        "ナビゲーションの判断を表現します。このLessonで Selector と呼ぶ優先分岐は、" +
        "BehaviorTree.CPP の Fallback に相当します。",
      msgTypes: ["nav2_msgs/action/NavigateToPose"],
      cli: ["ros2 node info /bt_navigator", "ros2 action info /navigate_to_pose"],
      python: `# behaviortree.cpp は C++ ですが Python wrapper の py_trees も同じ思想:
import py_trees as pt

root = pt.composites.Selector("root", memory=False)
goal = pt.composites.Sequence("goal", memory=False, children=[
    pt.behaviours.CheckBlackboardVariable("at_goal"),
    pt.behaviours.Stop(),
])
avoid = pt.composites.Sequence("avoid", memory=False, children=[
    pt.behaviours.CheckBlackboardVariable("obstacle_close"),
    pt.behaviours.TurnRight(),
])
default = pt.behaviours.Forward()
root.add_children([goal, avoid, default])`,
      realWorld: tx(
        "Nav2 の BT Navigator は BehaviorTree.CPP を使い、XML で定義したナビゲーション処理を実行します。Node 間の値は blackboard で共有できます。",
        "Nav2's BT Navigator uses BehaviorTree.CPP to execute navigation behaviors defined in XML. Nodes can share values through a blackboard.",
      ),
      state: state({
        nodes: ["/bt_engine", "/sensor_node"],
        topics: [
          topic("/bt/active_node", "std_msgs/msg/String", { pub: ["/bt_engine"] }),
          topic("/cmd_vel", "geometry_msgs/msg/Twist", { pub: ["/bt_engine"] }),
          topic("/scan", "sensor_msgs/msg/LaserScan", {
            pub: ["/sensor_node"],
            sub: ["/bt_engine"],
          }),
        ],
      }),
    }),
    init,
    update,
    draw,
    reset,
    dispose,
  };
}

export default defineStage({
  mode: "lesson",
  order: 16,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="Selector with conditional branches">
  <defs>
    <marker id="ld-bt-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#c4b5fd"/>
    </marker>
  </defs>
  <!-- Selector root -->
  <rect x="178" y="10" width="64" height="22" rx="5" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="210" y="25" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="10" font-weight="700">Selector</text>
  <!-- Branches -->
  <line x1="210" y1="32" x2="80"  y2="56" stroke="#c4b5fd" stroke-width="1" marker-end="url(#ld-bt-arrow)"/>
  <line x1="210" y1="32" x2="210" y2="56" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-bt-arrow)"/>
  <line x1="210" y1="32" x2="340" y2="56" stroke="#c4b5fd" stroke-width="1" marker-end="url(#ld-bt-arrow)"/>
  <!-- Sequence 1: at_goal → stop -->
  <rect x="14" y="58" width="132" height="18" rx="3" fill="#181f3a" stroke="#5eead4" stroke-width="1"/>
  <text x="80" y="71" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="9" font-weight="700">Seq: at_goal → stop</text>
  <!-- Sequence 2 (firing) -->
  <rect x="144" y="58" width="132" height="18" rx="3" fill="rgba(251,191,36,0.18)" stroke="#fbbf24" stroke-width="2"/>
  <text x="210" y="71" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="9" font-weight="700">Seq: obstacle → turn</text>
  <!-- Default -->
  <rect x="274" y="58" width="132" height="18" rx="3" fill="#181f3a" stroke="#7dd3fc" stroke-width="1"/>
  <text x="340" y="71" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">default: forward</text>
  <!-- Caption -->
  <text x="210" y="98" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">Selector evaluates children top-down; first success wins</text>
  <text x="210" y="112" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">↑ priority order</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Behavior Tree — 優先順位付きルールでロボを動かす",
      en: "Behavior Tree — drive the robot with priority-ordered rules",
    },
    learn: {
      ja: "Nav2 は BehaviorTree.CPP の Control / Action / Condition Node を組み合わせて意思決定を表現します。本ステージは、BehaviorTree.CPP の Fallback に相当する優先分岐を Selector と表記し、「if 条件 → action」のルール 4 つとデフォルト action を上から順に評価します。",
      en: "Nav2 combines BehaviorTree.CPP Control, Action, and Condition nodes to express decisions. This stage labels a priority branch as Selector—the equivalent of a BehaviorTree.CPP Fallback—and evaluates four condition→action rules plus a default from top to bottom.",
    },
    goal: {
      ja: "ルールを並べて、ロボがスタートからゴールまで衝突せずに到達する policy を組みましょう。`at_goal → stop` を入れておくと到達後にちゃんと止まり、Selector の優先順位の意味も体感できます。",
      en: "Build a rule list that drives the robot from start to goal without crashing. Adding `at_goal → stop` is a good way to feel the Selector priority — the robot halts right when it arrives instead of orbiting the goal.",
    },
    first: {
      ja: "RULE 1 で `at_goal → stop`、RULE 2 で `obstacle_close → turn_right`、default を `forward` にしてみましょう。RUN を押すと BT が動き始めます。",
      en: "Try RULE 1 = `at_goal → stop`, RULE 2 = `obstacle_close → turn_right`, default = `forward`. Press RUN to start the BT.",
    },
  },
  strings: {
    ja: {
      "status.idle": "ルールを組んで RUN — 上から評価され、最初に当てはまるルールが実行される",
      "status.running": "BT 実行中 — 黄色いハイライトが今の active rule",
      "status.stopped": "停止 — RUN で再開、RESET で位置リセット",
      "status.crash": "衝突 — ルールを修正して再 RUN",
      "status.success": "GOAL 到達 — BT による policy 完成",
      "status.no_rules": "× ルールが空 — 少なくとも 1 つは cond/action を設定して",
      hint: "RULE は上から優先で評価。`at_goal → stop` を入れると到達と同時に止まる",
    },
    en: {
      "status.idle": "Build rules then press RUN — evaluated top-down, first match wins",
      "status.running": "BT running — the yellow highlight shows the active rule",
      "status.stopped": "Stopped — press RUN to resume, RESET to start over",
      "status.crash": "Crashed — fix the rules and run again",
      "status.success": "Reached GOAL — BT policy works!",
      "status.no_rules": "× rules are empty — set at least one cond/action pair",
      hint: "Rules are evaluated top-down. Add `at_goal → stop` to halt right at the goal",
    },
  },
  build: makeBtEditor,
});
