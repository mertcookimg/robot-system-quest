// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// pick_place — a timed conveyor sorting game that turns the arm lessons into
// a complete manipulation task: approach, grasp, lift, transport and release.
import { W, H, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { clearBackground, drawGrid, drawHint, drawTimer } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { ARM, drawArm, drawWorkspace, fk, ik, slew } from "../../lib/arm";
import * as armpad from "../../lib/armpad";
import { formatSeconds } from "../../lib/hud";
import { withA } from "../../core/theme";
import { t, tx } from "../../i18n";

type ParcelKind = "cyan" | "amber" | "rose";

interface Parcel {
  kind: ParcelKind;
  x: number;
  y: number;
  angle: number;
}

const COLORS: Record<ParcelKind, string> = {
  cyan: "#5eead4",
  amber: "#fbbf24",
  rose: "#fb7185",
};

const LABELS: Record<ParcelKind, string> = { cyan: "A", amber: "B", rose: "C" };
const DOCKS: Record<ParcelKind, { x: number; y: number }> = {
  cyan: { x: 245, y: 235 },
  amber: { x: 400, y: 190 },
  rose: { x: 555, y: 235 },
};
const COURSE: ParcelKind[] = ["cyan", "rose", "amber", "cyan", "amber", "rose"];
const BELT = { x: 175, y: 326, w: 450, h: 54 };
const HOME = { x: 400, y: 260 };
const CURSOR_SPEED = 285;
const GRAB_R = 27;
const DROP_R = 42;

export function makePickPlace(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  let q1 = 0;
  let q2 = 0;
  let cursor = { ...HOME };
  let elbowUp = false;
  let parcel: Parcel | null = null;
  let held = false;
  let gripClosed = false;
  let delivered = 0;
  let combo = 0;
  let bestCombo = 0;
  let mistakes = 0;
  let elapsed = 0;
  let penalty = 0;
  let spawnDelay = 0;
  let beltPhase = 0;
  let edgeFlash = 0;
  let actionFlash = 0;
  let cleared = false;
  let prevAction = false;
  let prevE = false;

  function canvasCoords(e: MouseEvent) {
    const rect = g.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * g.canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * g.canvas.height) / rect.height,
    };
  }

  function onMouseMove(e: MouseEvent) {
    const p = canvasCoords(e);
    cursor.x = Math.max(0, Math.min(W, p.x));
    cursor.y = Math.max(0, Math.min(H, p.y));
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 0 && !cleared) useGripper();
  }

  function spawnParcel() {
    if (delivered >= COURSE.length) return;
    parcel = { kind: COURSE[delivered], x: BELT.x + 18, y: BELT.y + 20, angle: 0 };
    held = false;
    gripClosed = false;
    g.setStatus(
      t("pick_place.status.incoming", { label: LABELS[parcel.kind] }),
      COLORS[parcel.kind],
    );
  }

  function resetParcel(messageKey: string) {
    mistakes++;
    combo = 0;
    penalty += 2;
    held = false;
    gripClosed = false;
    parcel = null;
    spawnDelay = 0.8;
    actionFlash = 1;
    g.sfx.bump();
    g.shake();
    g.setStatus(t(messageKey), "var(--danger)");
  }

  function useGripper() {
    if (!parcel || spawnDelay > 0) return;
    const tip = fk(q1, q2).ee;
    if (held) {
      const dock = DOCKS[parcel.kind];
      if (Math.hypot(tip.x - dock.x, tip.y - dock.y) <= DROP_R) {
        const color = COLORS[parcel.kind];
        particles.burst(dock.x, dock.y, color, 34, 230);
        delivered++;
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        held = false;
        gripClosed = false;
        parcel = null;
        g.sfx.deliver();
        if (delivered >= COURSE.length) finish();
        else {
          spawnDelay = 0.7;
          g.setStatus(
            t("pick_place.status.sorted", { n: delivered, total: COURSE.length, combo }),
            "var(--ok)",
          );
        }
      } else {
        resetParcel("pick_place.status.wrong");
      }
      return;
    }

    if (Math.hypot(tip.x - parcel.x, tip.y - parcel.y) <= GRAB_R) {
      held = true;
      gripClosed = true;
      combo = Math.max(0, combo);
      g.sfx.pickup();
      g.setStatus(t("pick_place.status.held", { label: LABELS[parcel.kind] }), COLORS[parcel.kind]);
    } else {
      actionFlash = 1;
      g.sfx.click();
      g.setStatus(t("pick_place.status.miss_grab"), "var(--warn)");
    }
  }

  function reset() {
    cursor = { ...HOME };
    elbowUp = false;
    const seed = ik(cursor.x, cursor.y, elbowUp);
    q1 = seed.q1;
    q2 = seed.q2;
    parcel = null;
    held = false;
    gripClosed = false;
    delivered = 0;
    combo = 0;
    bestCombo = 0;
    mistakes = 0;
    elapsed = 0;
    penalty = 0;
    spawnDelay = 0.5;
    beltPhase = 0;
    edgeFlash = 0;
    actionFlash = 0;
    cleared = false;
    prevAction = false;
    prevE = false;
    armpad.reset();
    particles.reset();
    g.setStatus(t("pick_place.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    g.canvas.addEventListener("mousemove", onMouseMove);
    g.canvas.addEventListener("mousedown", onMouseDown);
    g.canvas.style.cursor = "none";
    reset();
  }

  function dispose() {
    g.canvas.removeEventListener("mousemove", onMouseMove);
    g.canvas.removeEventListener("mousedown", onMouseDown);
    g.canvas.style.cursor = "";
    armpad.reset();
  }

  function update(dt: number) {
    armpad.poll();
    particles.update(dt);
    beltPhase = (beltPhase + dt * 80) % 36;
    edgeFlash = Math.max(0, edgeFlash - dt * 2);
    actionFlash = Math.max(0, actionFlash - dt * 3);
    if (cleared) return;

    elapsed += dt;
    const k = g.keys;
    let dx = 0;
    let dy = 0;
    if (k.has("arrowleft") || k.has("a")) dx--;
    if (k.has("arrowright") || k.has("d")) dx++;
    if (k.has("arrowup") || k.has("w")) dy--;
    if (k.has("arrowdown") || k.has("s")) dy++;
    if (dx || dy) {
      const n = Math.hypot(dx, dy);
      cursor.x = Math.max(0, Math.min(W, cursor.x + (dx / n) * CURSOR_SPEED * dt));
      cursor.y = Math.max(0, Math.min(H, cursor.y + (dy / n) * CURSOR_SPEED * dt));
    }

    const eNow = k.has("e");
    if ((eNow && !prevE) || armpad.buttonEdge(5)) {
      elbowUp = !elbowUp;
      g.sfx.click();
    }
    prevE = eNow;

    const actionNow = k.has(" ") || k.has("enter");
    if ((actionNow && !prevAction) || armpad.buttonEdge(0)) useGripper();
    prevAction = actionNow;

    const sol = ik(cursor.x, cursor.y, elbowUp);
    if (!sol.reachable) edgeFlash = 1;
    const step = ARM.maxJointSpeed * dt;
    q1 = slew(q1, sol.q1, step);
    q2 = slew(q2, sol.q2, step);
    const tip = fk(q1, q2).ee;

    if (spawnDelay > 0) {
      spawnDelay -= dt;
      if (spawnDelay <= 0) spawnParcel();
    } else if (parcel) {
      if (held) {
        parcel.x = tip.x;
        parcel.y = tip.y + 15;
        parcel.angle += dt * 0.7;
      } else {
        parcel.x += (72 + delivered * 7) * dt;
        parcel.angle = Math.sin(elapsed * 4) * 0.05;
        if (parcel.x > BELT.x + BELT.w - 10) resetParcel("pick_place.status.escaped");
      }
    }

    g.setHud([
      `sorted:    ${delivered} / ${COURSE.length}`,
      `cargo:     ${parcel ? `${LABELS[parcel.kind]} / ${parcel.kind}` : "incoming..."}`,
      `gripper:   ${held ? "HOLDING" : "open"}`,
      `combo:     x${combo}   mistakes: ${mistakes}`,
      `time:      ${formatSeconds(elapsed)} + ${penalty.toFixed(0)}s penalty`,
    ]);
  }

  function finish() {
    cleared = true;
    const scoreTime = elapsed + penalty;
    const stars = mistakes === 0 && scoreTime < 38 ? 3 : mistakes <= 2 && scoreTime < 58 ? 2 : 1;
    g.setStatus(t("pick_place.status.clear"), "var(--ok)");
    g.awardStars(
      stars,
      `Sort time <b>${elapsed.toFixed(2)} s</b><br>` +
        `Penalty <b>+${penalty.toFixed(0)} s</b><br>` +
        `Mistakes <b>${mistakes}</b><br>` +
        `Best combo <b>x${bestCombo}</b>`,
    );
  }

  function drawBelt(c: CanvasRenderingContext2D) {
    c.fillStyle = "#11182c";
    c.strokeStyle = "#6e7a9c";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(BELT.x, BELT.y, BELT.w, BELT.h, 8);
    c.fill();
    c.stroke();
    c.save();
    c.beginPath();
    c.rect(BELT.x + 5, BELT.y + 5, BELT.w - 10, BELT.h - 10);
    c.clip();
    c.strokeStyle = withA("#7dd3fc", 0.28);
    c.lineWidth = 3;
    for (let x = BELT.x - 40 + beltPhase; x < BELT.x + BELT.w + 40; x += 36) {
      c.beginPath();
      c.moveTo(x, BELT.y + 7);
      c.lineTo(x + 23, BELT.y + BELT.h - 7);
      c.stroke();
    }
    c.restore();
    c.fillStyle = "#6e7a9c";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText("CONVEYOR  →", BELT.x + 10, BELT.y + BELT.h + 15);
  }

  function drawDock(c: CanvasRenderingContext2D, kind: ParcelKind) {
    const p = DOCKS[kind];
    const color = COLORS[kind];
    const pulse = 0.72 + 0.28 * Math.sin(elapsed * 4 + p.x);
    c.fillStyle = withA(color, 0.08 + pulse * 0.05);
    c.strokeStyle = withA(color, 0.75);
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(p.x - 38, p.y - 27, 76, 54, 9);
    c.fill();
    c.stroke();
    c.fillStyle = color;
    c.font = "800 18px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(LABELS[kind], p.x, p.y);
    c.font = "700 9px ui-monospace, monospace";
    c.fillText("DROP ZONE", p.x, p.y - 37);
  }

  function drawParcel(c: CanvasRenderingContext2D, p: Parcel) {
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.angle);
    const color = COLORS[p.kind];
    c.shadowColor = color;
    c.shadowBlur = held ? 12 : 5;
    c.fillStyle = color;
    c.strokeStyle = "#0a0f1f";
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(-14, -13, 28, 26, 4);
    c.fill();
    c.stroke();
    c.shadowBlur = 0;
    c.fillStyle = "#0a0f1f";
    c.font = "900 13px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(LABELS[p.kind], 0, 1);
    c.restore();
  }

  function drawGripper(c: CanvasRenderingContext2D) {
    const tip = fk(q1, q2).ee;
    const hot = actionFlash > 0;
    c.save();
    c.translate(tip.x, tip.y);
    c.strokeStyle = hot ? "#fb7185" : "#eef2ff";
    c.lineWidth = 3;
    const gap = gripClosed ? 5 : 11;
    c.beginPath();
    c.moveTo(-gap, 3);
    c.lineTo(-gap, 15);
    c.lineTo(-gap + 5, 18);
    c.moveTo(gap, 3);
    c.lineTo(gap, 15);
    c.lineTo(gap - 5, 18);
    c.stroke();
    c.restore();
  }

  function drawCursor(c: CanvasRenderingContext2D) {
    c.strokeStyle = edgeFlash > 0 ? "#fb7185" : withA("#fbbf24", 0.85);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cursor.x, cursor.y, 7, 0, Math.PI * 2);
    c.moveTo(cursor.x - 12, cursor.y);
    c.lineTo(cursor.x - 4, cursor.y);
    c.moveTo(cursor.x + 4, cursor.y);
    c.lineTo(cursor.x + 12, cursor.y);
    c.moveTo(cursor.x, cursor.y - 12);
    c.lineTo(cursor.x, cursor.y - 4);
    c.moveTo(cursor.x, cursor.y + 4);
    c.lineTo(cursor.x, cursor.y + 12);
    c.stroke();
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    drawWorkspace(c, edgeFlash);
    drawDock(c, "cyan");
    drawDock(c, "amber");
    drawDock(c, "rose");
    drawBelt(c);
    if (parcel) drawParcel(c, parcel);
    particles.draw(c);
    drawArm(c, q1, q2);
    drawGripper(c);
    drawCursor(c);
    drawTimer(c, elapsed + penalty, g.getBestTime());
    drawHint(c, t("pick_place.hint"));
  }

  return {
    id: "pick_place",
    name: "Pick & Place",
    lesson: "Grasping & Manipulation",
    lessonCmd:
      "ros2 action send_goal /gripper_controller/gripper_cmd control_msgs/action/GripperCommand '{command: {position: 0.0, max_effort: 20.0}}'",
    ros2: {
      title: tx("Pick & Place ・把持と搬送の一連動作", "Pick & Place — grasp and transport"),
      summary: tx(
        "把持は手先を物体へ動かすだけではない。接近、グリッパー閉、持ち上げ、搬送、解放を安全な順序で実行する操作シーケンスである。",
        "Manipulation is a sequence, not one pose: approach, close the gripper, lift, transport and release safely.",
      ),
      msgTypes: ["geometry_msgs/msg/PoseStamped", "control_msgs/action/GripperCommand"],
      cli: [
        "ros2 action list -t",
        "ros2 action send_goal /gripper_controller/gripper_cmd control_msgs/action/GripperCommand '{command: {position: 0.0, max_effort: 20.0}}'",
        "ros2 topic echo /joint_states",
      ],
      python: `# A real task normally sends these poses through MoveIt 2\nsequence = [approach_pose, grasp_pose, lift_pose, place_pose]\nfor pose in sequence:\n    move_group.set_pose_target(pose)\n    move_group.go(wait=True)\ngripper.close()`,
      realWorld: tx(
        "実機では MoveIt 2 の経路計画と GripperCommand actionを組み合わせ、衝突を避けながら同じシーケンスを実行する。",
        "A real robot combines MoveIt 2 planning with the GripperCommand action to execute the same sequence collision-free.",
      ),
      state: {
        nodes: ["/pick_place", "/move_group", "/gripper_controller"],
        topics: [
          {
            name: "/joint_states",
            type: "sensor_msgs/msg/JointState",
            pub: ["/arm_controller"],
            sub: ["/move_group"],
          },
          {
            name: "/target_pose",
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/pick_place"],
            sub: ["/move_group"],
          },
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
  order: 19,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="robot arm sorts coloured parcels from a conveyor into matching zones">
  <rect x="20" y="83" width="190" height="25" rx="5" fill="#181f3a" stroke="#6e7a9c"/>
  <path d="M25 90h180M25 101h180" stroke="#7dd3fc" stroke-width="2" stroke-dasharray="14 8" opacity=".45"/>
  <rect x="92" y="80" width="22" height="20" rx="3" fill="#fbbf24"/><text x="103" y="94" text-anchor="middle" fill="#0a0f1f" font-size="11" font-weight="800">B</text>
  <polygon points="216,110 246,110 240,94 222,94" fill="#181f3a" stroke="#7dd3fc"/>
  <line x1="231" y1="96" x2="286" y2="47" stroke="#7dd3fc" stroke-width="9" stroke-linecap="round"/>
  <line x1="286" y1="47" x2="340" y2="72" stroke="#c4b5fd" stroke-width="7" stroke-linecap="round"/>
  <circle cx="286" cy="47" r="6" fill="#eef2ff"/><rect x="329" y="69" width="22" height="20" rx="3" fill="#fbbf24"/>
  <rect x="362" y="66" width="48" height="38" rx="7" fill="#fbbf2420" stroke="#fbbf24" stroke-width="2"/>
  <text x="386" y="89" text-anchor="middle" fill="#fbbf24" font-size="15" font-weight="800">B</text>
  <path d="M338 52 Q370 35 389 57" fill="none" stroke="#5eead4" stroke-width="2" stroke-dasharray="4 3"/>
</svg>`,
  lessonModal: {
    title: {
      ja: "Pick & Place — 流れる荷物を仕分ける",
      en: "Pick & Place — sort parcels on the move",
    },
    learn: {
      ja: "実際のアーム作業は、接近・把持・持ち上げ・搬送・解放という動作の連続です。対象が動いている場合は、正しい位置だけでなくタイミングも必要です。",
      en: "Real manipulation chains approach, grasp, lift, transport and release. A moving object makes timing as important as position.",
    },
    goal: {
      ja: "コンベア上の6個の荷物をつかみ、A・B・Cの同じ文字と色のドックへ運びましょう。取り逃しと誤配は2秒加算されます。",
      en: "Grab six conveyor parcels and carry each to the dock with the matching letter and colour. Misses and wrong drops add two seconds.",
    },
    first: {
      ja: "マウスか矢印で手先を荷物へ合わせ、左クリック・Enter・Pad Aでつかみます。同じ文字のドックへ移動し、もう一度押して放します。PadではRBで肘の向きを切り替えられます。",
      en: "Move the tip onto a parcel with the mouse or arrows and click, press Enter, or use pad A to grab. Move to its matching dock and press again to release. Pad RB flips the elbow.",
    },
  },
  strings: {
    ja: {
      "status.start": "仕分けライン起動 — 最初の荷物を待機中",
      "status.incoming": "荷物 {label} が流れてきた。つかめ!",
      "status.held": "荷物 {label} を把持。対応ドックへ搬送!",
      "status.sorted": "仕分け成功 {n}/{total} ・ COMBO x{combo}",
      "status.wrong": "そこは違うドック! +2秒",
      "status.escaped": "荷物を取り逃した! +2秒",
      "status.miss_grab": "手先を荷物へもっと近づけよう",
      "status.clear": "全荷物の仕分け完了!",
      hint: "マウス / 矢印: 手先 ・ クリック / Enter / Pad A: つかむ／放す ・ E / RB: 肘反転 ・ R: リセット",
    },
    en: {
      "status.start": "Sorting line online — waiting for first parcel",
      "status.incoming": "Parcel {label} incoming — grab it!",
      "status.held": "Parcel {label} secured — carry it to the matching dock!",
      "status.sorted": "Sorted {n}/{total} · COMBO x{combo}",
      "status.wrong": "Wrong dock! +2 seconds",
      "status.escaped": "Parcel escaped! +2 seconds",
      "status.miss_grab": "Move the tip closer to the parcel",
      "status.clear": "All parcels sorted!",
      hint: "mouse / arrows: tip · click / Enter / pad A: grab/release · E / RB: flip elbow · R: reset",
    },
  },
  build: makePickPlace,
});
