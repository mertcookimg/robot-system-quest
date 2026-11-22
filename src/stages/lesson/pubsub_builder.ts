// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { stageColor } from "../../lib/stage_colors";
import { drawWrappedText } from "../../lib/canvas_text";

// pubsub: Pub/Sub Basics — feel the core ROS 2 concept via a puzzle.
// Drag a wire from an output port (right side) to an input port (left side).
// Both topic name and msgType must match for the wire to stick — that's
// the ROS contract.
// Once everything is wired correctly, pseudo-publishing starts and the
// robot drives toward the GOAL.
import { W, type Stage, type GameContext } from "../../types";
import { theme, themeColor, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { drawHint, drawRobotBody, drawRobotLabel, COLORS, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { canvasInteractionRadius } from "../../lib/canvas_touch";
import { readStageGamepads } from "../../lib/stage_gamepads";
import { t, tx } from "../../i18n";

interface Port {
  id: string;
  nodeId: string;
  kind: "in" | "out";
  topic: string;
  msgType: string;
  offX: number;
  offY: number;
}

interface NodeCard {
  id: string;
  name: string;
  desc: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WireData {
  fromPortId: string;
  toPortId: string;
  valid: boolean;
  errorReason?: string;
}

const NODES: NodeCard[] = [
  { id: "controller", name: "command_node", desc: "", x: 50, y: 80, w: 280, h: 140 },
  { id: "motor", name: "robot_node", desc: "", x: 470, y: 80, w: 280, h: 140 },
];

// Minimal 1 publisher + 1 subscriber setup — a single wire conveys the
// essence of Pub/Sub.
const PORTS: Port[] = [
  {
    id: "c_out",
    nodeId: "controller",
    kind: "out",
    topic: "/cmd_vel",
    msgType: "geometry_msgs/msg/Twist",
    offX: 280,
    offY: 90,
  },
  {
    id: "m_in_cmd",
    nodeId: "motor",
    kind: "in",
    topic: "/cmd_vel",
    msgType: "geometry_msgs/msg/Twist",
    offX: 0,
    offY: 90,
  },
];

const REQUIRED: { from: string; to: string }[] = [{ from: "c_out", to: "m_in_cmd" }];

const TYPE_COLORS: Record<string, string> = {
  "geometry_msgs/msg/Twist": "#075f93",
  "nav_msgs/msg/Odometry": "#6d42b5",
};

const ROBOT_START_X = 100;
const ROBOT_GOAL_X = 700;
const ROBOT_Y = 410;

export function makePubsub(): Stage {
  let g!: GameContext;
  const wires: WireData[] = [];
  const particles = new Particles();
  let dragFrom: Port | null = null;
  let mouseX = 0,
    mouseY = 0;
  let robotX = ROBOT_START_X;
  let elapsed = 0;
  let pubAcc = 0;
  let cleared = false;
  let allValid = false;

  // Pad / keyboard navigation (works without a mouse).
  let focusedPortIdx = 0;
  const inpPrev = { left: false, right: false, up: false, down: false, a: false, b: false };
  let lastMouseAt = 0;
  let lastPadAt = 0;

  let onMouseDown: ((e: MouseEvent) => void) | null = null;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;
  let onMouseUp: ((e: MouseEvent) => void) | null = null;
  let onMouseLeave: (() => void) | null = null;

  function portAbsPos(p: Port): { x: number; y: number } {
    const node = NODES.find((n) => n.id === p.nodeId)!;
    return { x: node.x + p.offX, y: node.y + p.offY };
  }

  function portAt(x: number, y: number): Port | null {
    const hitRadius = canvasInteractionRadius(g.canvas, 28, 28);
    for (const p of PORTS) {
      const pos = portAbsPos(p);
      const dx = x - pos.x,
        dy = y - pos.y;
      if (dx * dx + dy * dy < hitRadius * hitRadius) return p;
    }
    return null;
  }

  function wireAt(x: number, y: number): number {
    const hitRadius = canvasInteractionRadius(g.canvas, 16, 24);
    for (let i = 0; i < wires.length; i++) {
      const w = wires[i];
      const p1 = portAbsPos(PORTS.find((p) => p.id === w.fromPortId)!);
      const p2 = portAbsPos(PORTS.find((p) => p.id === w.toPortId)!);
      for (let t = 0.1; t <= 0.9; t += 0.1) {
        const cpx = (p1.x + p2.x) / 2;
        const xi = bezierAt(p1.x, cpx, cpx, p2.x, t);
        const yi = bezierAt(p1.y, p1.y, p2.y, p2.y, t);
        const dx = x - xi,
          dy = y - yi;
        if (dx * dx + dy * dy < hitRadius * hitRadius) return i;
      }
    }
    return -1;
  }

  function snapTarget(from: Port, x: number, y: number): Port | null {
    const maxSideways = canvasInteractionRadius(g.canvas, 48, 32);
    for (const target of PORTS) {
      if (target.kind === from.kind) continue;
      const a = portAbsPos(from);
      const b = portAbsPos(target);
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const lengthSq = vx * vx + vy * vy;
      const progress = ((x - a.x) * vx + (y - a.y) * vy) / lengthSq;
      const sideways = Math.abs((x - a.x) * vy - (y - a.y) * vx) / Math.sqrt(lengthSq);
      if (progress >= 0.42 && sideways <= maxSideways) return target;
    }
    return null;
  }

  function checkAllValid(): boolean {
    return REQUIRED.every((req) =>
      wires.some((w) => w.fromPortId === req.from && w.toPortId === req.to && w.valid),
    );
  }

  function canvasCoords(e: MouseEvent): { x: number; y: number } {
    const rect = g.canvas.getBoundingClientRect();
    const sx = g.canvas.width / rect.width;
    const sy = g.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();

    onMouseDown = (e) => {
      if (cleared) return;
      const { x, y } = canvasCoords(e);
      const p = portAt(x, y);
      if (p) {
        if (dragFrom && dragFrom.id !== p.id) tryConnect(p);
        else if (!dragFrom) selectPort(p);
        return;
      }
      if (dragFrom) {
        cancelSelection();
        return;
      }
      const wIdx = wireAt(x, y);
      if (wIdx >= 0) {
        wires.splice(wIdx, 1);
        g.sfx.click();
      }
    };
    onMouseMove = (e) => {
      const { x, y } = canvasCoords(e);
      mouseX = x;
      mouseY = y;
      lastMouseAt = performance.now();
    };
    onMouseUp = (e) => {
      if (!dragFrom) return;
      const { x, y } = canvasCoords(e);
      const p = portAt(x, y);
      if (p && p.id !== dragFrom.id) tryConnect(p);
      else {
        const target = snapTarget(dragFrom, x, y);
        if (target) tryConnect(target);
      }
    };
    onMouseLeave = () => cancelSelection();
    g.canvas.addEventListener("mousedown", onMouseDown);
    g.canvas.addEventListener("mousemove", onMouseMove);
    g.canvas.addEventListener("mouseup", onMouseUp);
    g.canvas.addEventListener("mouseleave", onMouseLeave);
  }

  function dispose() {
    if (onMouseDown) g.canvas.removeEventListener("mousedown", onMouseDown);
    if (onMouseMove) g.canvas.removeEventListener("mousemove", onMouseMove);
    if (onMouseUp) g.canvas.removeEventListener("mouseup", onMouseUp);
    if (onMouseLeave) g.canvas.removeEventListener("mouseleave", onMouseLeave);
    onMouseDown = onMouseMove = onMouseUp = onMouseLeave = null;
  }

  function reset() {
    wires.length = 0;
    particles.reset();
    dragFrom = null;
    robotX = ROBOT_START_X;
    elapsed = 0;
    pubAcc = 0;
    cleared = false;
    allValid = false;
    focusedPortIdx = 0;
    inpPrev.left = inpPrev.right = inpPrev.up = inpPrev.down = inpPrev.a = inpPrev.b = false;
    lastMouseAt = 0;
    lastPadAt = 0;
    g.ghost.startRecording();
    g.setStatus(t("puzzle.status.connect"), "");
  }

  function selectPort(port: Port) {
    dragFrom = port;
    g.sfx.click();
    g.setStatus(t("pubsub_builder.status.select_other"), "var(--accent)");
  }

  function cancelSelection() {
    if (!dragFrom) return;
    dragFrom = null;
    g.setStatus(t("puzzle.status.connect"), "");
  }

  // Commit a connection in either selection order (shared by touch / mouse / pad).
  function tryConnect(otherPort: Port) {
    if (!dragFrom || otherPort.id === dragFrom.id) return;
    if (otherPort.kind === dragFrom.kind) {
      selectPort(otherPort);
      return;
    }
    const fromPort = dragFrom.kind === "out" ? dragFrom : otherPort;
    const toPort = dragFrom.kind === "in" ? dragFrom : otherPort;
    const exists = wires.some((w) => w.fromPortId === fromPort.id && w.toPortId === toPort.id);
    if (!exists) {
      const valid = fromPort.msgType === toPort.msgType && fromPort.topic === toPort.topic;
      let errorReason: string | undefined;
      if (!valid) {
        if (fromPort.msgType !== toPort.msgType) errorReason = "TYPE MISMATCH";
        else errorReason = "TOPIC MISMATCH";
      }
      wires.push({ fromPortId: fromPort.id, toPortId: toPort.id, valid, errorReason });
      g.sfx.click();
      if (valid) g.shake(0.1);
      else g.sfx.bump();
    }
    dragFrom = null;
  }

  // Pad + keyboard handle port focus and A/B confirm/cancel.
  function pollPuzzleNav() {
    const pads = readStageGamepads();
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p) {
        pad = p;
        break;
      }
    }
    const STICK_DEAD = 0.4;
    const ax = pad?.axes[0] ?? 0;
    const ay = pad?.axes[1] ?? 0;
    const inp = {
      left: (pad?.buttons[14]?.pressed ?? false) || ax < -STICK_DEAD || g.keys.has("arrowleft"),
      right: (pad?.buttons[15]?.pressed ?? false) || ax > STICK_DEAD || g.keys.has("arrowright"),
      up: (pad?.buttons[12]?.pressed ?? false) || ay < -STICK_DEAD || g.keys.has("arrowup"),
      down: (pad?.buttons[13]?.pressed ?? false) || ay > STICK_DEAD || g.keys.has("arrowdown"),
      a: (pad?.buttons[0]?.pressed ?? false) || g.keys.has("enter"),
      b: (pad?.buttons[1]?.pressed ?? false) || g.keys.has("backspace"),
    };
    const edge = {
      left: inp.left && !inpPrev.left,
      right: inp.right && !inpPrev.right,
      up: inp.up && !inpPrev.up,
      down: inp.down && !inpPrev.down,
      a: inp.a && !inpPrev.a,
      b: inp.b && !inpPrev.b,
    };
    inpPrev.left = inp.left;
    inpPrev.right = inp.right;
    inpPrev.up = inp.up;
    inpPrev.down = inp.down;
    inpPrev.a = inp.a;
    inpPrev.b = inp.b;

    const anyEdge = edge.left || edge.right || edge.up || edge.down || edge.a || edge.b;
    if (anyEdge) lastPadAt = performance.now();

    if (edge.left || edge.up) {
      focusedPortIdx = (focusedPortIdx - 1 + PORTS.length) % PORTS.length;
      g.sfx.click();
    }
    if (edge.right || edge.down) {
      focusedPortIdx = (focusedPortIdx + 1) % PORTS.length;
      g.sfx.click();
    }
    if (edge.a) {
      const fp = PORTS[focusedPortIdx];
      if (!dragFrom) selectPort(fp);
      else if (dragFrom.id !== fp.id) tryConnect(fp);
    }
    if (edge.b) {
      if (dragFrom) {
        cancelSelection();
        g.sfx.click();
      } else {
        const fp = PORTS[focusedPortIdx];
        const idx = wires.findIndex((w) => w.fromPortId === fp.id || w.toPortId === fp.id);
        if (idx >= 0) {
          wires.splice(idx, 1);
          g.sfx.click();
        }
      }
    }
  }

  function isPadMode(): boolean {
    return lastPadAt > lastMouseAt;
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

    pollPuzzleNav();

    const valid = checkAllValid();
    if (valid && !allValid) {
      g.shake(0.3);
      particles.burst(400, 280, COLORS.OK, 24);
      g.setStatus(t("pubsub_builder.status.success"), "var(--ok)");
    } else if (!valid && allValid) {
      g.setStatus(t("pubsub_builder.status.incomplete"), "var(--warn)");
    }
    allValid = valid;

    if (allValid) {
      robotX += 80 * dt;
      pubAcc += dt;
      if (pubAcc > 0.2) {
        pubAcc = 0;
        g.publish("/cmd_vel", `geometry_msgs/msg/Twist linear.x:0.50 angular.z:0.00`);
        g.publish(
          "/odom",
          `nav_msgs/msg/Odometry x:${(robotX / 100).toFixed(2)} y:4.10 theta:0.00`,
        );
      }
      if (robotX >= ROBOT_GOAL_X) {
        cleared = true;
        particles.burst(ROBOT_GOAL_X, ROBOT_Y, COLORS.OK, 30);
        g.shake(0.4);
        const stars = elapsed < 25 ? 3 : elapsed < 50 ? 2 : 1;
        const stats =
          `Time   <b>${elapsed.toFixed(2)} s</b><br>` +
          `wires  <b>${wires.length}</b><br>` +
          `valid  <b>${wires.filter((w) => w.valid).length}</b>`;
        const timeSeconds = elapsed;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats, { timeSeconds });
        }, 350);
      }
    }

    g.setHud([
      `mode:    pub/sub graph`,
      `wires:   ${wires.length}  (valid ${wires.filter((w) => w.valid).length})`,
      `status:  ${allValid ? "all topics connected" : "incomplete graph"}`,
      `tip:     ${t("pubsub_builder.tip_hud")}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    // Title.
    c.fillStyle = stageColor("#075f93");
    c.font = "700 18px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("pubsub_builder.title"), 40, 32);
    c.fillStyle = stageColor("#425570");
    c.font = "12px ui-monospace, monospace";
    c.fillText(t("pubsub_builder.subtitle"), 40, 52);

    // Graph divider.
    c.strokeStyle = stageColor("rgba(170, 188, 212,0.7)");
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(40, 290);
    c.lineTo(W - 40, 290);
    c.stroke();

    // Wires (background layer).
    for (const w of wires) {
      const p1 = portAbsPos(PORTS.find((p) => p.id === w.fromPortId)!);
      const p2 = portAbsPos(PORTS.find((p) => p.id === w.toPortId)!);
      drawWire(c, p1.x, p1.y, p2.x, p2.y, w);
    }
    // In-progress wire — endpoint = focused port (pad) or mouse pos (mouse).
    if (dragFrom) {
      const p1 = portAbsPos(dragFrom);
      let endX = mouseX,
        endY = mouseY;
      if (isPadMode()) {
        const focused = PORTS[focusedPortIdx];
        if (focused && focused.id !== dragFrom.id) {
          const fpos = portAbsPos(focused);
          endX = fpos.x;
          endY = fpos.y;
        }
      }
      drawWire(c, p1.x, p1.y, endX, endY, null);
    }
    // Nodes on top.
    for (const node of NODES) drawNode(c, node);
    for (const p of PORTS) drawPort(c, p);

    // ── ROBOT SIMULATION ──
    c.fillStyle = theme.canvasPanel;
    c.fillRect(40, 320, W - 80, 160);
    c.strokeStyle = stageColor("rgba(170, 188, 212,0.7)");
    c.strokeRect(40, 320, W - 80, 160);
    c.fillStyle = stageColor("#425570");
    c.font = "12px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("pubsub_builder.sim_label"), 50, 340);

    // GOAL
    c.fillStyle = stageColor("rgba(8, 119, 100, 0.15)");
    c.beginPath();
    c.arc(ROBOT_GOAL_X, ROBOT_Y, 30, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = COLORS.OK;
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(ROBOT_GOAL_X, ROBOT_Y, 30, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = COLORS.OK;
    c.font = "700 13px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("GOAL", ROBOT_GOAL_X, ROBOT_Y - 40);

    // robot
    c.save();
    c.translate(robotX, ROBOT_Y);
    drawRobotBody(c, 0, elapsed);
    drawRobotLabel(c);
    c.restore();

    particles.draw(c);

    // Status badge.
    c.save();
    const badgeColor = allValid ? COLORS.OK : "#925b00";
    c.fillStyle = withA(theme.scrim, 0.85);
    c.fillRect(W - 240, 296, 200, 32);
    c.strokeStyle = stageColor(badgeColor);
    c.strokeRect(W - 240, 296, 200, 32);
    c.fillStyle = stageColor(badgeColor);
    c.font = "700 13px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(allValid ? "✓ all topics connected" : "✗ incomplete graph", W - 228, 312);
    c.restore();

    drawHint(c, t("pubsub_builder.hint"));
  }

  function drawNode(c: CanvasRenderingContext2D, n: NodeCard) {
    c.save();
    c.fillStyle = stageColor("#e8eff7");
    c.strokeStyle = themeColor(theme.accent, stageColor("rgba(7, 95, 147,0.4)"));
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(n.x, n.y, n.w, n.h, 8);
    c.fill();
    c.stroke();
    // Title bar (height 32).
    c.fillStyle = themeColor(withA(theme.accent, 0.08), stageColor("rgba(7, 95, 147,0.22)"));
    c.fillRect(n.x + 1, n.y + 1, n.w - 2, 31);
    c.fillStyle = stageColor("#075f93");
    c.font = "700 16px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(n.name, n.x + 14, n.y + 16);
    // Description.
    c.fillStyle = stageColor("#425570");
    c.font = "13px ui-monospace, monospace";
    drawWrappedText(c, t(`pubsub_builder.node.${n.id}`), n.x + 14, n.y + 45, n.w - 28, 15);
    c.restore();
  }

  function drawPort(c: CanvasRenderingContext2D, p: Port) {
    const pos = portAbsPos(p);
    const isHover = portAt(mouseX, mouseY) === p;
    const isDrag = dragFrom === p;
    const isFocused = isPadMode() && PORTS[focusedPortIdx]?.id === p.id;
    const typeColor = TYPE_COLORS[p.msgType] || "#586a82";
    c.save();
    // Outer ring (color = type); highlighted ports grow slightly + glow.
    const baseRadius = canvasInteractionRadius(g.canvas, 9, 12);
    const r = isHover || isDrag || isFocused ? baseRadius + 3 : baseRadius;
    if (isHover || isDrag) {
      c.fillStyle = stageColor(typeColor + "55"); // translucent glow
      c.beginPath();
      c.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      c.fill();
    }
    if (isFocused) {
      // Pad / keyboard focus: yellow pulsing ring.
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4);
      c.strokeStyle = stageColor("#925b00");
      c.lineWidth = 2.5;
      c.globalAlpha = 0.8 + 0.2 * pulse;
      c.beginPath();
      c.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = stageColor(typeColor);
    c.beginPath();
    c.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    c.fill();
    // Inner: input ports are hollow, output ports are filled.
    if (p.kind === "in") {
      c.fillStyle = stageColor("#e8eff7");
      c.beginPath();
      c.arc(pos.x, pos.y, r - 3, 0, Math.PI * 2);
      c.fill();
    }
    // Keep the arrow visible on both the hollow input and filled output.
    c.fillStyle = p.kind === "in" ? stageColor(typeColor) : theme.onAccent;
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(p.kind === "out" ? "▶" : "◀", pos.x, pos.y);

    // Label sits inside the node (left for out, right for in).
    c.textBaseline = "middle";
    if (p.kind === "out") {
      c.textAlign = "right";
      c.font = "700 15px ui-monospace, monospace";
      c.fillStyle = stageColor(typeColor);
      c.fillText(p.topic, pos.x - 18, pos.y - 9);
      c.fillStyle = stageColor("#586a82");
      c.font = "12px ui-monospace, monospace";
      c.fillText(p.msgType, pos.x - 18, pos.y + 11);
    } else {
      c.textAlign = "left";
      c.font = "700 15px ui-monospace, monospace";
      c.fillStyle = stageColor(typeColor);
      c.fillText(p.topic, pos.x + 18, pos.y - 9);
      c.fillStyle = stageColor("#586a82");
      c.font = "12px ui-monospace, monospace";
      c.fillText(p.msgType, pos.x + 18, pos.y + 11);
    }
    c.restore();
  }

  function drawWire(
    c: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    w: WireData | null,
  ) {
    const valid = w?.valid ?? true;
    const color = w === null ? "#425570" : valid ? COLORS.OK : COLORS.DANGER;
    c.save();
    c.strokeStyle = stageColor(color);
    c.lineWidth = 2.5;
    c.beginPath();
    const cpx = (x1 + x2) / 2;
    c.moveTo(x1, y1);
    c.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
    c.stroke();

    // Message dot (only rendered when all wires are valid).
    if (w && valid && allValid) {
      const phase = (elapsed * 1.4) % 1;
      const xi = bezierAt(x1, cpx, cpx, x2, phase);
      const yi = bezierAt(y1, y1, y2, y2, phase);
      c.fillStyle = stageColor("#925b00");
      c.beginPath();
      c.arc(xi, yi, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = stageColor("rgba(146, 91, 0, 0.4)");
      c.beginPath();
      c.arc(xi, yi, 9, 0, Math.PI * 2);
      c.fill();
    }
    // error
    if (w && !valid) {
      c.fillStyle = COLORS.DANGER;
      c.font = "700 10px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText(w.errorReason || "MISMATCH", (x1 + x2) / 2, (y1 + y2) / 2 - 6);
    }
    c.restore();
  }

  function bezierAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
  }

  return {
    id: "pubsub_builder",
    name: "Pub/Sub Builder",
    lesson: "Pub/Sub Basics",
    lessonCmd: "ros2 topic echo /cmd_vel",
    ros2: {
      title: tx("Pub/Sub — NodeをTopicでつなぐ", "Pub/Sub — link nodes via topics"),
      summary:
        "ROS 2では、独立したNodeがTopicを介してMessageをやり取りします。" +
        "このレッスンでは、Topic名とMessage型の一致を確認します。" +
        "実機で通信するにはQoSにも互換性が必要です。" +
        "すべて正しく接続すると擬似的なpublishが始まり、ロボットが動き出します。",
      msgTypes: ["geometry_msgs/msg/Twist", "nav_msgs/msg/Odometry"],
      cli: [
        "ros2 node list",
        "ros2 topic list",
        "ros2 topic info /cmd_vel",
        "ros2 topic echo /cmd_vel",
      ],
      state: {
        nodes: ["/command_node", "/robot_node"],
        topics: [
          {
            name: "/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/command_node"],
            sub: ["/robot_node"],
          },
          { name: "/odom", type: "nav_msgs/msg/Odometry", pub: ["/robot_node"] },
        ],
      },
      realWorld: tx(
        "実機のROS 2では、Launch Fileで複数のNodeを起動し、rqt_graphで接続を可視化できます。通信できない場合は、Topic名とMessage型に加えてQoSの互換性も確認します。",
        "Real ROS 2: bring up nodes via launch files, then visualize the graph in rqt_graph. If data does not flow, check the topic name, message type, and QoS compatibility.",
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
  order: 1,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="publisher to subscriber via topic">
  <defs>
    <marker id="ld-arrow-cyan" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="light-dark(#087764, #5eead4)"/>
    </marker>
  </defs>
  <!-- left: command_node (Publisher) -->
  <rect x="8" y="26" width="148" height="68" rx="8" fill="light-dark(#edf3fb, #223149)" stroke="light-dark(#075f93, #7dd3fc)" stroke-width="1.5"/>
  <text x="82" y="56" text-anchor="middle" fill="light-dark(#075f93, #7dd3fc)" font-family="ui-monospace, monospace" font-size="12" font-weight="700">command_node</text>
  <text x="82" y="78" text-anchor="middle" fill="light-dark(#425570, #c2cfe3)" font-family="ui-monospace, monospace" font-size="10">Publisher</text>
  <!-- right: robot_node (Subscriber) with simple robot glyph -->
  <rect x="264" y="26" width="148" height="68" rx="8" fill="light-dark(#edf3fb, #223149)" stroke="light-dark(#6d42b5, #c4b5fd)" stroke-width="1.5"/>
  <text x="338" y="50" text-anchor="middle" fill="light-dark(#6d42b5, #c4b5fd)" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot_node</text>
  <g transform="translate(326,60)">
    <rect x="0" y="0" width="24" height="18" rx="3" fill="none" stroke="light-dark(#6d42b5, #c4b5fd)" stroke-width="1.5"/>
    <circle cx="6" cy="8" r="1.8" fill="light-dark(#6d42b5, #c4b5fd)"/>
    <circle cx="18" cy="8" r="1.8" fill="light-dark(#6d42b5, #c4b5fd)"/>
  </g>
  <text x="338" y="92" text-anchor="middle" fill="light-dark(#425570, #c2cfe3)" font-family="ui-monospace, monospace" font-size="10">Subscriber</text>
  <!-- arrow with flowing message -->
  <line x1="156" y1="60" x2="262" y2="60" stroke="light-dark(#087764, #5eead4)" stroke-width="2" marker-end="url(#ld-arrow-cyan)"/>
  <circle r="3.5" fill="light-dark(#925b00, #fbbf24)">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 158 60 L 258 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="light-dark(#087764, #5eead4)" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/cmd_vel</text>
  <text x="210" y="80" text-anchor="middle" fill="light-dark(#586a82, #a4b5cd)" font-family="ui-monospace, monospace" font-size="9">geometry_msgs/msg/Twist</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Pub/Sub — Topicでメッセージを配信する",
      en: "Pub/Sub — publish messages over a topic",
    },
    learn: {
      ja: "ROS 2では、プログラムの単位であるNode同士が、Topicという名前付きの通信路でMessageをやり取りします。送信側をPublisher、受信側をSubscriberと呼びます。同じTopic名とMessage型を使い、互換性のあるQoSを持つSubscriptionがMessageを受信します。このレッスンでは、Topic名と型の一致を確認します。",
      en: "In ROS 2, nodes exchange messages over named channels called topics. A sending node is a Publisher and a receiving node is a Subscriber. A Subscription receives messages when it uses the same topic name and message type with compatible QoS. This lesson checks the topic name and type.",
    },
    goal: {
      ja: "command_node（Publisher）とrobot_node（Subscriber）をTopic /cmd_velでつなぎましょう。正しく接続するとTwistメッセージが自動で配信され、ロボットがGOALまで進みます。",
      en: "Wire command_node (Publisher) to robot_node (Subscriber) over /cmd_vel. A valid connection starts automatic Twist publishing and drives the robot to the GOAL.",
    },
    first: {
      ja: "左右どちらかのポートをタップしてから、もう一方をタップします。ポート間を直接ドラッグしても接続できます。Topic名とMessage型が一致すると有効な接続になります。",
      en: "Tap either port, then tap the other one. You can also drag directly between them. The link becomes valid when the topic name and message type both match.",
    },
  },
  strings: {
    ja: {
      hint: "左右のポートを順不同でタップ / 反対側へ半分ほどドラッグしても自動接続",
      "node.controller": "接続後に/cmd_velを自動publish",
      "node.motor": "/cmd_velをsubscribe → モーターを駆動",
      sim_label: "ROBOT SIMULATION（Graphの完成後に自動で起動）",
      "status.incomplete": "配線が不完全 — 必要な接続を見直してください",
      "status.success": "接続完成 — Messageが流れ、ロボットが動き始めました",
      "status.select_other": "ポートを選択中 — 反対側のポートをタップ",
      subtitle: "左右のポートを順不同でタップ / 半分ほどドラッグすると自動接続",
      tip_hud: "このレッスン：Message型とTopic名 / 実機：QoSの互換性も必要",
      title: "Pub/Sub Builder — NodeをTopicでつなぐ",
    },
    en: {
      hint: "Tap both ports in either order / drag about halfway to auto-connect",
      "node.controller": "Auto-publishes /cmd_vel once connected",
      "node.motor": "Subscribes /cmd_vel → drives the motors",
      sim_label: "ROBOT SIMULATION  (auto-starts when the graph is complete)",
      "status.incomplete": "Graph incomplete — review required connections",
      "status.success": "Wires complete — messages flowing, robot moving",
      "status.select_other": "Port selected — tap the port on the other side",
      subtitle: "Tap both ports in either order, or drag about halfway to auto-connect",
      tip_hud: "This lesson: type + topic / real ROS 2: compatible QoS too",
      title: "Pub/Sub Builder — link nodes via topics",
    },
  },
  build: makePubsub,
});
