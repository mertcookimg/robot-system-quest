// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// service: Service Builder — basics of the request/reply pattern.
// A client sends an on-demand request and handles the server's response.
// Unlike Pub/Sub: on-demand request/response.
import { W, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { drawHint, drawRobotBody, drawRobotLabel, COLORS, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { canvasInteractionRadius } from "../../lib/canvas_touch";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import { onLangChange, t, tx } from "../../i18n";

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
  { id: "client", name: "lamp_client", desc: "", x: 50, y: 80, w: 280, h: 140 },
  { id: "server", name: "lamp_server", desc: "", x: 470, y: 80, w: 280, h: 140 },
];

const PORTS: Port[] = [
  {
    id: "c_call",
    nodeId: "client",
    kind: "out",
    topic: "/toggle_lamp",
    msgType: "std_srvs/srv/Trigger",
    offX: 280,
    offY: 90,
  },
  {
    id: "s_srv",
    nodeId: "server",
    kind: "in",
    topic: "/toggle_lamp",
    msgType: "std_srvs/srv/Trigger",
    offX: 0,
    offY: 90,
  },
];

const REQUIRED: { from: string; to: string }[] = [{ from: "c_call", to: "s_srv" }];

const TYPE_COLORS: Record<string, string> = {
  "std_srvs/srv/Trigger": "#fbbf24",
};

const ROBOT_START_X = 100;
const ROBOT_GOAL_X = 700;
const ROBOT_Y = 410;

export function makeService(): Stage {
  let g!: GameContext;
  const wires: WireData[] = [];
  const particles = new Particles();
  let dragFrom: Port | null = null;
  let mouseX = 0,
    mouseY = 0;
  let robotX = ROBOT_START_X;
  let elapsed = 0;
  let cleared = false;
  let allValid = false;
  let lampOn = false; // visual indicator that toggles per service call
  let serviceCalls = 0;
  let serviceAnimUntil = 0;
  let controls: OverlayPanelHandle | null = null;
  let disposeLangSync: (() => void) | null = null;

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
  function canvasCoords(e: MouseEvent) {
    const rect = g.canvas.getBoundingClientRect();
    const sx = g.canvas.width / rect.width;
    const sy = g.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
    controls = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("service_builder.call_prompt"),
          choices: [{ key: "call", label: () => t("service_builder.call_button") }],
          active: () => "",
          onSelect: () => callService(),
        },
      ],
      { placement: "dock" },
    );
    disposeLangSync = onLangChange(() => controls?.refresh());
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
    disposeLangSync?.();
    disposeLangSync = null;
    controls?.dispose();
    controls = null;
  }

  function reset() {
    wires.length = 0;
    particles.reset();
    dragFrom = null;
    robotX = ROBOT_START_X;
    elapsed = 0;
    cleared = false;
    allValid = false;
    lampOn = false;
    serviceCalls = 0;
    serviceAnimUntil = 0;
    focusedPortIdx = 0;
    inpPrev.left = inpPrev.right = inpPrev.up = inpPrev.down = inpPrev.a = inpPrev.b = false;
    lastMouseAt = 0;
    lastPadAt = 0;
    g.ghost.startRecording();
    g.setStatus(t("puzzle.status.connect"), "");
  }

  function callService() {
    if (cleared) return;
    if (!allValid) {
      g.sfx.bump();
      g.setStatus(t("service_builder.status.connect_first"), "var(--warn)");
      return;
    }

    lampOn = !lampOn;
    serviceCalls += 1;
    serviceAnimUntil = elapsed + 1.2;
    robotX = Math.min(ROBOT_GOAL_X, robotX + 80);
    particles.burst(robotX, ROBOT_Y, lampOn ? COLORS.WARN : COLORS.ACCENT, 12, 100);
    g.sfx.click();
    g.setStatus(t("service_builder.status.response"), "var(--ok)");

    if (robotX >= ROBOT_GOAL_X) {
      cleared = true;
      particles.burst(ROBOT_GOAL_X, ROBOT_Y, COLORS.OK, 30);
      g.shake(0.4);
      const stars = elapsed < 25 ? 3 : elapsed < 50 ? 2 : 1;
      const stats =
        `Time   <b>${elapsed.toFixed(2)} s</b><br>` + `service calls <b>${serviceCalls}</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 350);
    }
  }

  function selectPort(port: Port) {
    dragFrom = port;
    g.sfx.click();
    g.setStatus(t("service_builder.status.select_other"), "var(--accent)");
  }

  function cancelSelection() {
    if (!dragFrom) return;
    dragFrom = null;
    g.setStatus(t("puzzle.status.connect"), "");
  }

  function tryConnect(otherPort: Port) {
    if (!dragFrom || otherPort.id === dragFrom.id) return;
    if (otherPort.kind === dragFrom.kind) {
      selectPort(otherPort);
      return;
    }
    const fromPort = dragFrom.kind === "out" ? dragFrom : otherPort;
    const toPort = dragFrom.kind === "in" ? dragFrom : otherPort;
    if (wires.some((w) => w.fromPortId === fromPort.id && w.toPortId === toPort.id)) {
      dragFrom = null;
      return;
    }
    const valid = fromPort.msgType === toPort.msgType && fromPort.topic === toPort.topic;
    let errorReason: string | undefined;
    if (!valid) {
      if (fromPort.msgType !== toPort.msgType) errorReason = "TYPE MISMATCH";
      else errorReason = "SERVICE NAME MISMATCH";
    }
    wires.push({ fromPortId: fromPort.id, toPortId: toPort.id, valid, errorReason });
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
      particles.burst(400, 280, COLORS.WARN, 24);
      g.setStatus(t("service_builder.status.success"), "var(--ok)");
    } else if (!valid && allValid) {
      g.setStatus(t("service_builder.status.incomplete"), "var(--warn)");
    }
    allValid = valid;

    g.setHud([
      `mode:    service request/response`,
      `wires:   ${wires.length}  (valid ${wires.filter((w) => w.valid).length})`,
      `calls:   ${serviceCalls}`,
      `lamp:    ${lampOn ? "ON" : "OFF"}`,
      `tip:     ${t("service_builder.tip_hud")}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    c.fillStyle = "#fbbf24";
    c.font = "700 18px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("service_builder.title"), 40, 32);
    c.fillStyle = "#9aa6c8";
    c.font = "12px ui-monospace, monospace";
    c.fillText(t("service_builder.subtitle"), 40, 52);

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

    // Robot simulation
    c.fillStyle = theme.canvasPanel;
    c.fillRect(40, 320, W - 80, 160);
    c.strokeStyle = "rgba(35,44,77,0.7)";
    c.strokeRect(40, 320, W - 80, 160);
    c.fillStyle = "#9aa6c8";
    c.font = "12px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(t("service_builder.sim_label"), 50, 340);

    // Lamp readout.
    c.fillStyle = withA(theme.scrim, 0.85);
    c.fillRect(60, 360, 100, 36);
    c.strokeStyle = lampOn ? COLORS.WARN : "rgba(110, 122, 156, 0.4)";
    c.lineWidth = 2;
    c.strokeRect(60, 360, 100, 36);
    c.fillStyle = lampOn ? COLORS.WARN : theme.floor;
    c.beginPath();
    c.arc(80, 378, 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = lampOn ? theme.canvasPanel : "#6e7a9c";
    c.font = "700 13px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(lampOn ? "LAMP ON" : "LAMP OFF", 100, 378);

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

    // robot
    c.save();
    c.translate(robotX, ROBOT_Y);
    drawRobotBody(c, 0, elapsed);
    drawRobotLabel(c);
    c.restore();

    particles.draw(c);

    // Status badge.
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
    c.fillText(allValid ? "✓ service connected" : "✗ no service link", W - 228, 312);
    c.restore();

    drawHint(c, t("service_builder.hint"));
  }

  function drawNode(c: CanvasRenderingContext2D, n: NodeCard) {
    c.save();
    c.fillStyle = "#0e1426";
    c.strokeStyle = "rgba(251, 191, 36, 0.4)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(n.x, n.y, n.w, n.h, 8);
    c.fill();
    c.stroke();
    c.fillStyle = "rgba(251, 191, 36, 0.18)";
    c.fillRect(n.x + 1, n.y + 1, n.w - 2, 31);
    c.fillStyle = "#fbbf24";
    c.font = "700 16px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(n.name, n.x + 14, n.y + 16);
    c.fillStyle = "#c8d0e4";
    c.font = "13px ui-monospace, monospace";
    c.fillText(t(`service_builder.node.${n.id}`), n.x + 14, n.y + 50);
    c.restore();
  }

  function drawPort(c: CanvasRenderingContext2D, p: Port) {
    const pos = portAbsPos(p);
    const isHover = portAt(mouseX, mouseY) === p;
    const isDrag = dragFrom === p;
    const isFocused = isPadMode() && PORTS[focusedPortIdx]?.id === p.id;
    const typeColor = TYPE_COLORS[p.msgType] || "#94a3b8";
    c.save();
    const baseRadius = canvasInteractionRadius(g.canvas, 9, 12);
    const r = isHover || isDrag || isFocused ? baseRadius + 3 : baseRadius;
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
      c.font = "12px ui-monospace, monospace";
      c.fillText(p.msgType, pos.x - 18, pos.y + 11);
    } else {
      c.textAlign = "left";
      c.font = "700 15px ui-monospace, monospace";
      c.fillStyle = typeColor;
      c.fillText(p.topic, pos.x + 18, pos.y - 9);
      c.fillStyle = "#8e98ba";
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
    const color = w === null ? "#9aa6c8" : valid ? COLORS.OK : COLORS.DANGER;
    c.save();
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.beginPath();
    const cpx = (x1 + x2) / 2;
    c.moveTo(x1, y1);
    c.bezierCurveTo(cpx, y1, cpx, y2, x2, y2);
    c.stroke();

    // Animate one request/response round trip only after an explicit call.
    if (w && valid && elapsed < serviceAnimUntil) {
      const phase = Math.max(0, Math.min(1, 1 - (serviceAnimUntil - elapsed) / 1.2));
      let xi: number, yi: number, dotColor: string;
      if (phase < 0.5) {
        // request: A → B
        const t = phase * 2;
        xi = bezierAt(x1, cpx, cpx, x2, t);
        yi = bezierAt(y1, y1, y2, y2, t);
        dotColor = "#fbbf24"; // request = orange
      } else {
        // response: B → A
        const t = 1 - (phase - 0.5) * 2;
        xi = bezierAt(x1, cpx, cpx, x2, t);
        yi = bezierAt(y1, y1, y2, y2, t);
        dotColor = "#7dd3fc"; // response = cyan
      }
      c.fillStyle = dotColor + "66";
      c.beginPath();
      c.arc(xi, yi, 9, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = dotColor;
      c.beginPath();
      c.arc(xi, yi, 5, 0, Math.PI * 2);
      c.fill();
      // Label.
      c.fillStyle = dotColor;
      c.font = "700 9px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText(phase < 0.5 ? "REQ" : "RES", xi, yi - 12);
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
    id: "service_builder",
    name: "Service Builder",
    lesson: "Service Call",
    lessonCmd: "ros2 service list",
    ros2: {
      title: tx(
        "Service — Client/Server で request → response",
        "Service — request → response between Client and Server",
      ),
      summary:
        "ROS 2 の Service は on-demand の request-response パターン。" +
        "通常、1 つの service 名に 1 つの Server を用意し、複数の Client から呼び出せます。" +
        "Pub/Sub と違って『今すぐ何かをして結果を聞く』用途 (例: lamp on/off, take_picture, reset_odom)。" +
        "Service 名 + srv 型 が両方一致しないと繋がらない。",
      msgTypes: ["std_srvs/srv/Trigger", "std_srvs/srv/SetBool"],
      cli: [
        "ros2 service list",
        "ros2 service type /toggle_lamp",
        "ros2 service call /toggle_lamp std_srvs/srv/Trigger {}",
      ],
      realWorld: tx(
        "実機 ROS2: ros2 service list で利用可能なサービス確認 → ros2 service call でテスト。Lifecycle/Param/各種ツールの大半が裏で Service を使う。",
        "Real ROS2: list available services with ros2 service list, then test them via ros2 service call. Most of Lifecycle, Param, and the various tools rely on Service under the hood.",
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
  order: 2,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="press a button, the server toggles a lamp and replies">
  <defs>
    <marker id="ld-service-arrow-req" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-service-arrow-res" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
    <radialGradient id="ld-service-lamp-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#fef3c7" stop-opacity="1"/>
      <stop offset="60%" stop-color="#fbbf24" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <!-- left: client with big push button -->
  <rect x="8" y="14" width="148" height="92" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="32" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="11" font-weight="700">client</text>
  <circle cx="82" cy="68" r="22" fill="#7f1d1d" stroke="#fb7185" stroke-width="2"/>
  <circle cx="82" cy="66" r="17" fill="#fb7185"/>
  <text x="82" y="70" text-anchor="middle" fill="#fff" font-family="ui-monospace, monospace" font-size="10" font-weight="700">PRESS</text>
  <text x="82" y="100" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">Service Client</text>
  <!-- right: server with lamp -->
  <rect x="264" y="14" width="148" height="92" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="32" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="11" font-weight="700">server</text>
  <!-- lamp glow -->
  <circle cx="338" cy="60" r="22" fill="url(#ld-service-lamp-glow)"/>
  <circle cx="338" cy="60" r="11" fill="#fef3c7" stroke="#fbbf24" stroke-width="1.5"/>
  <rect x="332" y="71" width="12" height="6" rx="1" fill="#9aa6c8"/>
  <rect x="334" y="77" width="8" height="4" fill="#6e7a9c"/>
  <text x="338" y="100" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">lamp_server</text>
  <!-- request -->
  <line x1="156" y1="48" x2="262" y2="48" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-service-arrow-req)"/>
  <text x="210" y="42" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/toggle_lamp</text>
  <!-- response -->
  <line x1="262" y1="80" x2="156" y2="80" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-service-arrow-res)"/>
  <text x="210" y="98" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="10">success: true</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Service — request/response で 1 回だけ呼ぶ",
      en: "Service — request/response, one call at a time",
    },
    learn: {
      ja: "Service は ROS 2 の request/response 通信です。通常、1 つの service 名に 1 つの Server を用意し、複数の Client が request を送れます。Server が利用可能で処理が完了すれば response を返しますが、Client 側では未接続やタイムアウトも考慮します。service 名と srv 型が一致する必要があります。node の中から呼ぶ場合は、executor と callback の構成に注意し、必要に応じて call_async (非同期呼び出し) を使います。",
      en: "A Service is ROS 2 request/response communication. Normally one server owns a service name, while multiple clients may send requests. A server returns a response when it is available and completes the request, so clients must still handle unavailability and timeouts. Service name and srv type must match. Inside a node, consider the executor and callback arrangement and use an asynchronous call when appropriate.",
    },
    goal: {
      ja: "Client node と Server node を正しい service 名と srv 型で繋ぎ、CALL を押して request → response を1回ずつ実行しましょう。",
      en: "Wire the Client node to the Server node with a matching service name and srv type, then press CALL to perform one request → response exchange at a time.",
    },
    first: {
      ja: "左右どちらかのポートをタップし、もう片方をタップします。接続後は画面下の CALL を押すたびに、1組の request/response が発生します。",
      en: "Tap either port, then tap the other one. Once connected, each press of CALL below the canvas performs one request/response exchange.",
    },
  },
  strings: {
    ja: {
      hint: "左右を順にタップ（順不同）/ 反対側へ半分ほどドラッグでも自動接続",
      "node.client": "ボタン → /toggle_lamp を Service call",
      "node.server": "/toggle_lamp の Service Server (応答)",
      sim_label: "ROBOT SIMULATION  (service call ごとに 1 step 進む)",
      "status.incomplete": "配線が不完全 — service 名と型を一致させて",
      "status.success": "Service 接続成立 — CALL を押して request を送信",
      "status.connect_first": "先に Client と Server を接続してください",
      "status.response": "Response 受信 — success: true",
      "status.select_other": "ポートを選択中 — 反対側のポートをタップ",
      subtitle: "Pub/Sub と違う on-demand の request / response",
      tip_hud: "接続後、CALL 1回につき request/response が1往復",
      title: "Service Builder — Client → Server に request を送る",
      call_prompt: "Service request",
      call_button: "CALL",
    },
    en: {
      hint: "Tap both ports in either order / drag about halfway to auto-connect",
      "node.client": "Button press → service call to /toggle_lamp",
      "node.server": "/toggle_lamp service server (replies)",
      sim_label: "ROBOT SIMULATION  (advances one step per service call)",
      "status.incomplete": "Graph incomplete — match service name and srv type",
      "status.success": "Service connected — press CALL to send a request",
      "status.connect_first": "Connect the Client and Server first",
      "status.response": "Response received — success: true",
      "status.select_other": "Port selected — tap the port on the other side",
      subtitle: "Unlike Pub/Sub: on-demand request / response",
      tip_hud: "After connecting, each CALL performs one request/response exchange",
      title: "Service Builder — send a request from Client → Server",
      call_prompt: "Service request",
      call_button: "CALL",
    },
  },
  build: makeService,
});
