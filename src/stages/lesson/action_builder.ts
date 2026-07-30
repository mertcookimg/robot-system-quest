// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// action: Action Builder — basics of the ROS 2 Action interface.
// The client sends a Goal, the server processes it over a long period
// while emitting periodic Feedback, then returns a final Result.
// Compared to Service: long-running, streams progress, and cancellable.
import { W, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { drawHint, drawRobotBody, drawRobotLabel, COLORS, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { canvasInteractionRadius } from "../../lib/canvas_touch";
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
  { id: "client", name: "nav_client", desc: "", x: 50, y: 80, w: 280, h: 140 },
  { id: "server", name: "nav_server", desc: "", x: 470, y: 80, w: 280, h: 140 },
];

const PORTS: Port[] = [
  {
    id: "c_act",
    nodeId: "client",
    kind: "out",
    topic: "/navigate_to_pose",
    msgType: "nav2_msgs/action/NavigateToPose",
    offX: 280,
    offY: 90,
  },
  {
    id: "s_act",
    nodeId: "server",
    kind: "in",
    topic: "/navigate_to_pose",
    msgType: "nav2_msgs/action/NavigateToPose",
    offX: 0,
    offY: 90,
  },
];

const REQUIRED: { from: string; to: string }[] = [{ from: "c_act", to: "s_act" }];

const TYPE_COLORS: Record<string, string> = {
  "nav2_msgs/action/NavigateToPose": "#c4b5fd",
};

const ROBOT_START_X = 100;
const ROBOT_GOAL_X = 700;
const ROBOT_Y = 410;

export function makeAction(): Stage {
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

  // Pad / keyboard navigation.
  let focusedPortIdx = 0;
  const inpPrev = { left: false, right: false, up: false, down: false, a: false, b: false };
  let lastMouseAt = 0;
  let lastPadAt = 0;

  let onMouseDown: ((e: MouseEvent) => void) | null = null;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;
  let onMouseUp: ((e: MouseEvent) => void) | null = null;
  let onMouseLeave: (() => void) | null = null;

  function portAbsPos(p: Port) {
    const node = NODES.find((n) => n.id === p.nodeId)!;
    return { x: node.x + p.offX, y: node.y + p.offY };
  }
  function portAt(x: number, y: number): Port | null {
    const hitRadius = canvasInteractionRadius(g.canvas, 24, 24);
    for (const p of PORTS) {
      const pos = portAbsPos(p);
      const dx = x - pos.x,
        dy = y - pos.y;
      if (dx * dx + dy * dy < hitRadius * hitRadius) return p;
    }
    return null;
  }
  function wireAt(x: number, y: number): number {
    const hitRadius = canvasInteractionRadius(g.canvas, 14, 20);
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
  function checkAllValid(): boolean {
    return REQUIRED.every((req) =>
      wires.some((w) => w.fromPortId === req.from && w.toPortId === req.to && w.valid),
    );
  }
  function canvasCoords(e: MouseEvent) {
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
      if (p && p.kind === "out") {
        dragFrom = p;
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
      if (p && p.kind === "in") tryConnect(p);
      else dragFrom = null;
    };
    onMouseLeave = () => {
      dragFrom = null;
    };
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

  function tryConnect(toPort: Port) {
    if (!dragFrom || toPort.kind !== "in") return;
    if (wires.some((w) => w.fromPortId === dragFrom!.id && w.toPortId === toPort.id)) {
      dragFrom = null;
      return;
    }
    const valid = dragFrom.msgType === toPort.msgType && dragFrom.topic === toPort.topic;
    let errorReason: string | undefined;
    if (!valid) {
      if (dragFrom.msgType !== toPort.msgType) errorReason = "ACTION TYPE MISMATCH";
      else errorReason = "ACTION NAME MISMATCH";
    }
    wires.push({ fromPortId: dragFrom.id, toPortId: toPort.id, valid, errorReason });
    g.sfx.click();
    if (valid) g.shake(0.1);
    else g.sfx.bump();
    dragFrom = null;
  }

  function pollPuzzleNav() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
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
    if (edge.left || edge.right || edge.up || edge.down || edge.a || edge.b) {
      lastPadAt = performance.now();
    }
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
      if (!dragFrom && fp.kind === "out") {
        dragFrom = fp;
        g.sfx.click();
      } else if (dragFrom && fp.kind === "in") tryConnect(fp);
    }
    if (edge.b) {
      if (dragFrom) {
        dragFrom = null;
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
      particles.burst(400, 280, "#c4b5fd", 24);
      g.setStatus(t("action_builder.status.success"), "var(--ok)");
    } else if (!valid && allValid) {
      g.setStatus(t("action_builder.status.incomplete"), "var(--warn)");
    }
    allValid = valid;

    if (allValid) {
      // Actions progress continuously — the robot drifts toward the GOAL
      // while feedback messages stream at a high rate.
      robotX += 70 * dt;
      pubAcc += dt;
      if (pubAcc > 0.3) {
        pubAcc = 0;
        const progress = (robotX - ROBOT_START_X) / (ROBOT_GOAL_X - ROBOT_START_X);
        g.publish(
          "/navigate_to_pose/_action/feedback",
          `nav2_msgs/action/NavigateToPose.Feedback distance_remaining: ${((1 - progress) * 6).toFixed(2)}m`,
        );
      }
      if (robotX >= ROBOT_GOAL_X) {
        cleared = true;
        g.publish(
          "/navigate_to_pose/_action/result",
          `nav2_msgs/action/NavigateToPose.Result {result: SUCCEEDED}`,
        );
        particles.burst(ROBOT_GOAL_X, ROBOT_Y, "#c4b5fd", 36);
        g.shake(0.4);
        const stars = elapsed < 25 ? 3 : elapsed < 50 ? 2 : 1;
        const stats = `Time   <b>${elapsed.toFixed(2)} s</b><br>` + `result <b>SUCCEEDED</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 350);
      }
    }

    g.setHud([
      `mode:    action goal/feedback/result`,
      `wires:   ${wires.length}  (valid ${wires.filter((w) => w.valid).length})`,
      `progress: ${allValid ? `${Math.floor(((robotX - ROBOT_START_X) / (ROBOT_GOAL_X - ROBOT_START_X)) * 100)}%` : "—"}`,
      `tip:     ${t("action_builder.tip_hud")}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    c.fillStyle = "#c4b5fd";
    c.font = "700 18px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("action_builder.title"), 40, 32);
    c.fillStyle = "#9aa6c8";
    c.font = "12px ui-monospace, monospace";
    c.fillText(t("action_builder.subtitle"), 40, 52);

    c.strokeStyle = "rgba(35,44,77,0.7)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(40, 290);
    c.lineTo(W - 40, 290);
    c.stroke();

    for (const w of wires) {
      const p1 = portAbsPos(PORTS.find((p) => p.id === w.fromPortId)!);
      const p2 = portAbsPos(PORTS.find((p) => p.id === w.toPortId)!);
      drawWire(c, p1.x, p1.y, p2.x, p2.y, w);
    }
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
    for (const node of NODES) drawNode(c, node);
    for (const p of PORTS) drawPort(c, p);

    c.fillStyle = theme.canvasPanel;
    c.fillRect(40, 320, W - 80, 160);
    c.strokeStyle = "rgba(35,44,77,0.7)";
    c.strokeRect(40, 320, W - 80, 160);
    c.fillStyle = "#9aa6c8";
    c.font = "12px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("action_builder.sim_label"), 50, 340);

    // Progress bar.
    if (allValid) {
      const progress = Math.min(1, (robotX - ROBOT_START_X) / (ROBOT_GOAL_X - ROBOT_START_X));
      c.fillStyle = withA(theme.scrim, 0.85);
      c.fillRect(60, 360, 200, 18);
      c.strokeStyle = "rgba(196,181,253,0.5)";
      c.strokeRect(60, 360, 200, 18);
      c.fillStyle = "#c4b5fd";
      c.fillRect(60, 360, 200 * progress, 18);
      c.fillStyle = theme.canvasPanel;
      c.font = "700 11px ui-monospace, monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(`${Math.floor(progress * 100)}%`, 160, 369);
    }

    // GOAL
    c.fillStyle = "rgba(94, 234, 212, 0.15)";
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

    c.save();
    c.translate(robotX, ROBOT_Y);
    drawRobotBody(c, 0, elapsed);
    drawRobotLabel(c);
    c.restore();

    particles.draw(c);

    c.save();
    const badgeColor = allValid ? COLORS.OK : "#fbbf24";
    c.fillStyle = withA(theme.scrim, 0.85);
    c.fillRect(W - 240, 296, 200, 32);
    c.strokeStyle = badgeColor;
    c.strokeRect(W - 240, 296, 200, 32);
    c.fillStyle = badgeColor;
    c.font = "700 13px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(allValid ? "✓ action connected" : "✗ no action link", W - 228, 312);
    c.restore();

    drawHint(c, t("action_builder.hint"));
  }

  function drawNode(c: CanvasRenderingContext2D, n: NodeCard) {
    c.save();
    c.fillStyle = "#0e1426";
    c.strokeStyle = "rgba(196, 181, 253, 0.4)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(n.x, n.y, n.w, n.h, 8);
    c.fill();
    c.stroke();
    c.fillStyle = "rgba(196, 181, 253, 0.18)";
    c.fillRect(n.x + 1, n.y + 1, n.w - 2, 31);
    c.fillStyle = "#c4b5fd";
    c.font = "700 16px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(n.name, n.x + 14, n.y + 16);
    c.fillStyle = "#c8d0e4";
    c.font = "13px ui-monospace, monospace";
    c.fillText(t(`action_builder.node.${n.id}`), n.x + 14, n.y + 50);
    c.restore();
  }

  function drawPort(c: CanvasRenderingContext2D, p: Port) {
    const pos = portAbsPos(p);
    const isHover = portAt(mouseX, mouseY) === p;
    const isDrag = dragFrom === p;
    const isFocused = isPadMode() && PORTS[focusedPortIdx]?.id === p.id;
    const typeColor = TYPE_COLORS[p.msgType] || "#94a3b8";
    c.save();
    const baseRadius = canvasInteractionRadius(g.canvas, 8, 10);
    const r = isHover || isDrag || isFocused ? baseRadius + 2 : baseRadius;
    if (isHover || isDrag) {
      c.fillStyle = typeColor + "55";
      c.beginPath();
      c.arc(pos.x, pos.y, r + 4, 0, Math.PI * 2);
      c.fill();
    }
    if (isFocused) {
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4);
      c.strokeStyle = "#fbbf24";
      c.lineWidth = 2.5;
      c.globalAlpha = 0.5 + 0.5 * pulse;
      c.beginPath();
      c.arc(pos.x, pos.y, r + 6, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = typeColor;
    c.beginPath();
    c.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    c.fill();
    if (p.kind === "in") {
      c.fillStyle = "#0e1426";
      c.beginPath();
      c.arc(pos.x, pos.y, r - 3, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#0e1426";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(p.kind === "out" ? "▶" : "◀", pos.x, pos.y);

    c.textBaseline = "middle";
    if (p.kind === "out") {
      c.textAlign = "right";
      c.font = "700 15px ui-monospace, monospace";
      c.fillStyle = typeColor;
      c.fillText(p.topic, pos.x - 18, pos.y - 9);
      c.fillStyle = "#8e98ba";
      c.font = "11px ui-monospace, monospace";
      c.fillText(p.msgType, pos.x - 18, pos.y + 11);
    } else {
      c.textAlign = "left";
      c.font = "700 15px ui-monospace, monospace";
      c.fillStyle = typeColor;
      c.fillText(p.topic, pos.x + 18, pos.y - 9);
      c.fillStyle = "#8e98ba";
      c.font = "11px ui-monospace, monospace";
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
    const color = w === null ? "#9aa6c8" : valid ? COLORS.OK : COLORS.DANGER;
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.beginPath();
    const cpx = (x1 + x2) / 2;
    c.moveTo(x1, y1);
    c.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
    c.stroke();

    // Action: Goal (once) → Feedback (continuous) → Result (last).
    if (w && valid && allValid) {
      // Goal (first frame): when elapsed < 1.0 send a quick A → B pulse.
      if (elapsed < 1.0) {
        const t = Math.min(1, elapsed);
        const xi = bezierAt(x1, cpx, cpx, x2, t);
        const yi = bezierAt(y1, y1, y2, y2, t);
        c.fillStyle = "#5eead466";
        c.beginPath();
        c.arc(xi, yi, 10, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#5eead4";
        c.beginPath();
        c.arc(xi, yi, 6, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#5eead4";
        c.font = "700 9px ui-monospace, monospace";
        c.textAlign = "center";
        c.fillText("GOAL", xi, yi - 14);
      } else {
        // Feedback: stream multiple B → A pulses on a short period.
        for (let k = 0; k < 3; k++) {
          const phase = (elapsed * 0.7 + k * 0.33) % 1;
          const t = 1 - phase;
          const xi = bezierAt(x1, cpx, cpx, x2, t);
          const yi = bezierAt(y1, y1, y2, y2, t);
          c.fillStyle = "#fbbf24" + "66";
          c.beginPath();
          c.arc(xi, yi, 8, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = "#fbbf24";
          c.beginPath();
          c.arc(xi, yi, 4, 0, Math.PI * 2);
          c.fill();
        }
        // Label.
        c.fillStyle = "#fbbf24";
        c.font = "700 9px ui-monospace, monospace";
        c.textAlign = "center";
        c.fillText("FEEDBACK", (x1 + x2) / 2, (y1 + y2) / 2 - 16);
      }
    }
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
    id: "action_builder",
    name: "Action Builder",
    lesson: "Action Goal",
    lessonCmd: "ros2 action list",
    ros2: {
      title: tx(
        "Action — 長時間処理 + 進捗 + キャンセル",
        "Action — long-running tasks + progress + cancellation",
      ),
      summary:
        "ROS2 の Action は長く時間のかかる処理 (ナビ、把持、移動、撮影連射 等) のための仕組み。" +
        "Client が Goal を送ると Server が処理を始め、定期的に Feedback を流し、終わったら Result を返す。" +
        "Service との違い: 長時間 / 途中経過あり / 途中キャンセル可能。" +
        "action 名 + action 型 が両方一致しないと繋がらない。",
      msgTypes: ["nav2_msgs/action/NavigateToPose"],
      cli: [
        "ros2 action list",
        "ros2 action info /navigate_to_pose",
        "ros2 action send_goal /navigate_to_pose nav2_msgs/action/NavigateToPose ...",
      ],
      python: `# Action Client
from rclpy.action import ActionClient
client = ActionClient(node, NavigateToPose, "/navigate_to_pose")
client.wait_for_server()

goal_msg = NavigateToPose.Goal()
# goal_msg.pose.pose.position.x = 5.0
future = client.send_goal_async(goal_msg, feedback_callback=on_feedback)

def on_feedback(fb):
    node.get_logger().info(f"remaining: {fb.feedback.distance_remaining:.2f}")`,
      realWorld: tx(
        "Nav2 や MoveIt 2 では、完了まで時間のかかる処理に Action が使われます。Goal の受付、途中経過の Feedback、完了時の Result、キャンセル要求を扱える点が Service との大きな違いです。",
        "Nav2 and MoveIt 2 use Actions for tasks that take time to finish. Compared with Services, Actions add goal handling, progress feedback, a final result, and cancellation requests.",
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
  order: 3,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="action goal once, feedback streams continuously, result at the end">
  <defs>
    <marker id="ld-action-arrow-goal" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-action-arrow-fb" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
    <marker id="ld-action-arrow-res" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fb7185"/>
    </marker>
  </defs>
  <!-- client -->
  <rect x="8" y="14" width="138" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="77" y="36" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">client</text>
  <text x="77" y="98" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">Action Client</text>
  <!-- server with progress bar working -->
  <rect x="274" y="14" width="138" height="92" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="343" y="36" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">server</text>
  <rect x="290" y="50" width="106" height="10" rx="2" fill="#0c1124" stroke="#232c4d" stroke-width="0.5"/>
  <rect x="291" y="51" width="0" height="8" rx="1" fill="#fbbf24">
    <animate attributeName="width" values="0;104;0" keyTimes="0;0.85;1" dur="3s" repeatCount="indefinite"/>
  </rect>
  <text x="343" y="76" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">working...</text>
  <text x="343" y="98" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">Action Server</text>
  <!-- Goal arrow + 1 dot -->
  <line x1="146" y1="32" x2="272" y2="32" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-action-arrow-goal)"/>
  <text x="209" y="26" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Goal (1 回)</text>
  <circle r="3" fill="#5eead4">
    <animateMotion dur="3s" repeatCount="indefinite" path="M 148 32 L 270 32"/>
  </circle>
  <!-- Feedback arrow + multiple streaming dots -->
  <line x1="272" y1="64" x2="146" y2="64" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-action-arrow-fb)"/>
  <text x="209" y="58" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Feedback (連続)</text>
  <circle r="2.5" fill="#fbbf24">
    <animateMotion dur="1.4s" repeatCount="indefinite" path="M 270 64 L 148 64"/>
  </circle>
  <circle r="2.5" fill="#fbbf24" opacity="0.85">
    <animateMotion dur="1.4s" repeatCount="indefinite" begin="0.45s" path="M 270 64 L 148 64"/>
  </circle>
  <circle r="2.5" fill="#fbbf24" opacity="0.7">
    <animateMotion dur="1.4s" repeatCount="indefinite" begin="0.9s" path="M 270 64 L 148 64"/>
  </circle>
  <!-- Result arrow + 1 dot at end -->
  <line x1="272" y1="92" x2="146" y2="92" stroke="#fb7185" stroke-width="2" marker-end="url(#ld-action-arrow-res)"/>
  <text x="209" y="106" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Result (1 回)</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Action — Goal / Feedback / Result",
      en: "Action — Goal / Feedback / Result",
    },
    learn: {
      ja: "Action は時間のかかる処理用。Goal を送り、進捗を Feedback で連続受信、最後に Result が返ります。途中キャンセルもできます。",
      en: "Actions are for long-running tasks: send a Goal, receive continuous Feedback, then a final Result. They can be cancelled mid-way.",
    },
    goal: {
      ja: "Client と Server を action 名と型で繋ぎ、Goal → Feedback (連続) → Result の流れを完成させましょう。",
      en: "Wire the Client and Server with a matching action name and type so the Goal → Feedback → Result flow runs.",
    },
    first: {
      ja: "出力ポートをドラッグして入力ポートに繋ぎます。action 名と action 型が両方一致して初めて接続できます。",
      en: "Drag from an output port to an input port. The link only forms when action name and action type both match.",
    },
  },
  strings: {
    ja: {
      hint: "action 名 + action 型 が一致して繋がる / Goal → Feedback (連続) → Result の流れ",
      "node.client": "Goal pose を action server に送る",
      "node.server": "/navigate_to_pose で目標まで進路 + 進捗報告",
      sim_label: "ROBOT SIMULATION  (action 進行中は連続前進 + feedback 配信)",
      "status.incomplete": "配線が不完全 — action 名と型を一致させて",
      "status.success": "Action 接続成立 — Goal 送信、Feedback 連続受信中",
      subtitle: "長時間処理 + 進捗報告。Service と違いキャンセル可能、途中経過あり",
      tip_hud: "action 名 + action 型 が両方一致しないと繋がらない",
      title: "Action Builder — Goal 送信 → Feedback → Result",
    },
    en: {
      hint: "action name + type must match / Goal → continuous Feedback → Result",
      "node.client": "Sends a Goal pose to the action server",
      "node.server": "Navigates to goal and streams feedback",
      sim_label: "ROBOT SIMULATION  (continuous motion + feedback while action is running)",
      "status.incomplete": "Graph incomplete — match action name and type",
      "status.success": "Action connected — goal sent, feedback streaming",
      subtitle:
        "Long-running tasks with progress. Cancellable, with intermediate updates (unlike Service)",
      tip_hud: "action name + action type must both match for the link to form",
      title: "Action Builder — Goal → Feedback → Result",
    },
  },
  build: makeAction,
});
