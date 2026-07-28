// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// ik_reach — "IK Reach". The second robot-ARM lesson and the pay-off to
// joint_teleop (A1). Now you command the TIP directly (a cursor) and the arm
// solves inverse kinematics to follow it. The exact course that felt fiddly in
// joint space now feels trivial — that contrast is the whole point, and the
// clear screen shows your A1 time next to this one.
//
// It also surfaces the three things that make IK more than "just point there":
//   • two solutions   — elbow-up / elbow-down (E or pad RB flips)
//   • workspace       — the annulus you can actually reach; outside it the
//                        boundary flashes red and the tip clamps
//   • singularity     — near full extension, small tip moves need big joint
//                        moves; the |dq| meter spikes
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import { clearBackground, drawGrid, drawTimer, drawHint } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatSeconds } from "../../lib/hud";
import { ARM, fk, ik, slew, drawArm, drawWorkspace, COURSE_TARGETS, PX_PER_M } from "../../lib/arm";
import * as armpad from "../../lib/armpad";
import { withA } from "../../core/theme";
import { t, tx } from "../../i18n";

const PICK_R = 22;
const DWELL = 0.2;
const ORB_R = 13;
const CURSOR_SPEED = 280; // px/s for keyboard / stick cursor motion

// Neutral rest pose for the cursor: above the base, clear of every target so
// the arm doesn't auto-collect target ① the instant the stage loads.
const HOME = { x: 400, y: 260 };

export function makeIkReach(): Stage {
  let g!: GameContext;
  const particles = new Particles();

  let q1 = 0,
    q2 = 0;
  let cursor = { x: 0, y: 0 };
  let elbowUp = true;
  let activeIdx = 0;
  let dwell = 0;
  let elapsed = 0;
  let cleared = false;
  let edgeFlash = 0;
  let manip = 1; // |sin(q2)| — manipulability; →0 at a singularity
  let prevE = false;

  function canvasCoords(e: MouseEvent) {
    const rect = g.canvas.getBoundingClientRect();
    const sx = g.canvas.width / rect.width;
    const sy = g.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }
  function onMouseMove(e: MouseEvent) {
    const p = canvasCoords(e);
    cursor.x = Math.max(0, Math.min(W, p.x));
    cursor.y = Math.max(0, Math.min(H, p.y));
  }

  function reset() {
    // Park the cursor at the neutral HOME pose and seed the arm at that IK
    // solution, so the arm starts already posed (not slewing in from a folded
    // one) without sitting on target ①. Default to the elbow-DOWN branch — the
    // natural "elbow tucked low, forearm lifting to the tip" reach. The
    // elbow-up branch remains one E-flip away.
    cursor = { x: HOME.x, y: HOME.y };
    elbowUp = false;
    const seed = ik(cursor.x, cursor.y, elbowUp);
    q1 = seed.q1;
    q2 = seed.q2;
    activeIdx = 0;
    dwell = 0;
    elapsed = 0;
    cleared = false;
    edgeFlash = 0;
    manip = 1;
    prevE = false;
    particles.reset();
    armpad.reset();
    g.setStatus(t("ik_reach.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    g.canvas.addEventListener("mousemove", onMouseMove);
    g.canvas.style.cursor = "none";
    reset();
  }

  function dispose() {
    g.canvas.removeEventListener("mousemove", onMouseMove);
    g.canvas.style.cursor = "";
    armpad.reset();
  }

  function update(dt: number) {
    particles.update(dt);
    if (edgeFlash > 0) edgeFlash = Math.max(0, edgeFlash - dt * 2);
    if (cleared) return;

    elapsed += dt;
    armpad.poll();
    const k = g.keys;

    // ── Cursor motion: keyboard arrows / left stick (mouse handled by listener) ──
    let cx = 0,
      cy = 0;
    if (k.has("arrowleft") || k.has("a")) cx -= 1;
    if (k.has("arrowright") || k.has("d")) cx += 1;
    if (k.has("arrowup") || k.has("w")) cy -= 1;
    if (k.has("arrowdown") || k.has("s")) cy += 1;
    if (cx || cy) {
      cursor.x = Math.max(0, Math.min(W, cursor.x + cx * CURSOR_SPEED * dt));
      cursor.y = Math.max(0, Math.min(H, cursor.y + cy * CURSOR_SPEED * dt));
    }

    // ── Elbow flip: E (keyboard edge) or pad RB ──
    const eNow = k.has("e");
    if ((eNow && !prevE) || armpad.buttonEdge(5)) {
      elbowUp = !elbowUp;
      g.sfx.click();
    }
    prevE = eNow;

    // ── Solve IK for the cursor, slew the arm toward it ──
    const sol = ik(cursor.x, cursor.y, elbowUp);
    if (!sol.reachable) edgeFlash = 1;
    const step = ARM.maxJointSpeed * dt;
    q1 = slew(q1, sol.q1, step);
    q2 = slew(q2, sol.q2, step);
    // Manipulability of a 2-link arm ∝ |sin(q2)|: it vanishes when the arm is
    // straight (q2→0) or fully folded (q2→±π) — the singularities where the
    // tip loses a degree of freedom and the joints get twitchy.
    const target = Math.abs(Math.sin(q2));
    manip += (target - manip) * Math.min(1, dt * 8);

    // ── Target dwell / collect (only when the tip actually reaches it) ──
    const { ee } = fk(q1, q2);
    const tgt = COURSE_TARGETS[activeIdx];
    if (tgt && sol.reachable && Math.hypot(ee.x - tgt.x, ee.y - tgt.y) <= PICK_R) {
      dwell += dt;
      if (dwell >= DWELL) {
        particles.burst(tgt.x, tgt.y, "#5eead4", 26, 200);
        g.sfx.pickup();
        activeIdx++;
        dwell = 0;
        if (activeIdx >= COURSE_TARGETS.length) return finish();
        g.setStatus(
          t("ik_reach.status.next", { n: activeIdx + 1, total: COURSE_TARGETS.length }),
          "var(--accent)",
        );
      }
    } else if (dwell > 0) {
      dwell = Math.max(0, dwell - dt * 2);
    }

    g.setHud([
      `tip target: x=${(cursor.x / PX_PER_M).toFixed(2)} y=${((H - cursor.y) / PX_PER_M).toFixed(2)} m`,
      `IK sol:     q=[${q1.toFixed(2)}, ${q2.toFixed(2)}]  elbow-${elbowUp ? "up" : "down"}`,
      `reach:      ${sol.reachable ? "in workspace" : "OUT OF REACH"}`,
      `manip:      ${manip.toFixed(2)}${manip < 0.15 ? "  ⚠ singular" : ""}`,
      `target:     ${Math.min(activeIdx + 1, COURSE_TARGETS.length)} / ${COURSE_TARGETS.length}`,
      `elapsed:    ${formatSeconds(elapsed)}`,
    ]);
  }

  function finish() {
    cleared = true;
    const stars = elapsed < 16 ? 3 : elapsed < 26 ? 2 : 1;
    g.setStatus(t("ik_reach.status.clear"), "var(--ok)");
    const jt = g.getBestTime("joint_teleop");
    const compare =
      jt != null
        ? `<br>Joint (A1) <b>${jt.toFixed(2)} s</b> → IK <b>${elapsed.toFixed(2)} s</b>`
        : "";
    g.awardStars(
      stars,
      `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
        `Targets   <b>${COURSE_TARGETS.length} / ${COURSE_TARGETS.length}</b><br>` +
        `Control   <b>Cartesian (IK)</b>${compare}`,
    );
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    drawWorkspace(c, edgeFlash);

    // Targets.
    for (let i = 0; i < COURSE_TARGETS.length; i++) {
      const p = COURSE_TARGETS[i];
      if (i < activeIdx) {
        c.strokeStyle = withA("#5eead4", 0.5);
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, ORB_R, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = "#5eead4";
        c.font = "700 12px ui-monospace, monospace";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText("✓", p.x, p.y);
      } else if (i === activeIdx) {
        const pulse = 0.6 + 0.4 * Math.sin(elapsed * 5);
        c.fillStyle = withA("#fbbf24", 0.18 * pulse);
        c.beginPath();
        c.arc(p.x, p.y, ORB_R + 8 * pulse, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#fbbf24";
        c.beginPath();
        c.arc(p.x, p.y, ORB_R, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = "#0a0f1f";
        c.font = "700 12px ui-monospace, monospace";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(String(i + 1), p.x, p.y);
        if (dwell > 0) {
          c.strokeStyle = "#5eead4";
          c.lineWidth = 3;
          c.beginPath();
          c.arc(p.x, p.y, ORB_R + 5, -Math.PI / 2, -Math.PI / 2 + (dwell / DWELL) * Math.PI * 2);
          c.stroke();
        }
      } else {
        c.strokeStyle = withA("#6e7a9c", 0.4);
        c.lineWidth = 1.5;
        c.beginPath();
        c.arc(p.x, p.y, ORB_R, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = "#6e7a9c";
        c.font = "600 11px ui-monospace, monospace";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.fillText(String(i + 1), p.x, p.y);
      }
    }

    particles.draw(c);

    // Draw only the active IK solution. E switches the physical arm between
    // elbow configurations; showing both at once makes the controllable arm
    // ambiguous.
    drawArm(c, q1, q2);

    // Cursor crosshair (the commanded tip position).
    drawCursor(c);

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("ik_reach.hint"));
  }

  function drawCursor(c: CanvasRenderingContext2D) {
    const reachHot = edgeFlash > 0.01;
    c.strokeStyle = reachHot ? "#fb7185" : "#fbbf24";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2);
    c.moveTo(cursor.x - 13, cursor.y);
    c.lineTo(cursor.x - 4, cursor.y);
    c.moveTo(cursor.x + 4, cursor.y);
    c.lineTo(cursor.x + 13, cursor.y);
    c.moveTo(cursor.x, cursor.y - 13);
    c.lineTo(cursor.x, cursor.y - 4);
    c.moveTo(cursor.x, cursor.y + 4);
    c.lineTo(cursor.x, cursor.y + 13);
    c.stroke();
  }

  return {
    id: "ik_reach",
    name: "IK Reach",
    lesson: "Inverse Kinematics",
    lessonCmd:
      "ros2 topic pub --once /tip_target geometry_msgs/msg/PoseStamped '{pose: {position: {x: 0.4, y: 0.2, z: 0.0}, orientation: {w: 1.0}}}'",
    ros2: {
      title: tx(
        "Inverse Kinematics ・手先の目標位置から関節角を逆算する",
        "Inverse Kinematics — command the tip pose, solve back for joint angles",
      ),
      summary:
        "手先 (tip) の目標位置を直接動かすと、アームが逆運動学 (IK) で関節角を逆算して追従する。" +
        "joint_teleop で苦労した同じコースが一瞬で解ける。IK には elbow-up / elbow-down の 2 解があり、" +
        "到達できるのはワークスペース (アニュラス) 内だけ。腕が伸びきる特異点付近では、わずかな手先移動に" +
        "大きな関節移動が必要になる (|dq| メータが跳ねる)。",
      msgTypes: ["geometry_msgs/msg/PoseStamped", "sensor_msgs/msg/JointState"],
      cli: [
        "ros2 topic pub /tip_target geometry_msgs/msg/PoseStamped '{...}'",
        "ros2 topic echo /joint_states",
        "ros2 launch moveit_servo servo.launch.py",
      ],
      python: `import math

# Analytic 2-link IK (law of cosines). elbow_up picks one of the two
# mirror solutions; returns None when the target is outside the annulus
# |L1-L2| <= r <= L1+L2.
def ik(x, y, L1, L2, elbow_up=True):
    d = math.hypot(x, y)
    if d > L1 + L2 or d < abs(L1 - L2):
        return None  # unreachable
    c = (d*d - L1*L1 - L2*L2) / (2*L1*L2)
    q2 = math.acos(max(-1.0, min(1.0, c)))
    if not elbow_up:
        q2 = -q2
    q1 = math.atan2(y, x) - math.atan2(L2*math.sin(q2), L1 + L2*math.cos(q2))
    return q1, q2`,
      realWorld: tx(
        "実機では MoveIt 2 / moveit_servo が Cartesian ジョグ (手先の速度・位置指令) を IK で関節指令に変換して joint_trajectory_controller に渡す。この topic 名や PoseStamped はその入口。",
        "On real hardware MoveIt 2 / moveit_servo turns a Cartesian jog (tip velocity/pose) into joint commands via IK and hands them to joint_trajectory_controller — PoseStamped here is that entry point.",
      ),
      state: {
        nodes: ["/ik_reach", "/robot_state_publisher"],
        topics: [
          {
            name: "/tip_target",
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/ik_reach"],
            sub: ["/ik_reach"],
          },
          {
            name: "/joint_states",
            type: "sensor_msgs/msg/JointState",
            pub: ["/ik_reach"],
            sub: ["/robot_state_publisher"],
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
  order: 18,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="cursor sets the tip; IK solves joint angles; two elbow solutions">
  <defs>
    <marker id="ld-ik_reach-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#5eead4"/>
    </marker>
  </defs>
  <!-- reachable annulus hint -->
  <path d="M 60 96 A 92 92 0 0 1 244 96" fill="none" stroke="#7dd3fc" stroke-width="1" stroke-dasharray="3 3" opacity="0.5"/>
  <!-- base -->
  <polygon points="44,104 76,104 70,86 50,86" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <!-- solid arm (elbow up) -->
  <line x1="60" y1="90" x2="140" y2="40" stroke="#7dd3fc" stroke-width="9" stroke-linecap="round"/>
  <line x1="140" y1="40" x2="232" y2="52" stroke="#c4b5fd" stroke-width="7" stroke-linecap="round"/>
  <circle cx="60" cy="90" r="7" fill="#eef2ff" stroke="#0a0f1f" stroke-width="2"/>
  <circle cx="140" cy="40" r="6" fill="#eef2ff" stroke="#0a0f1f" stroke-width="2"/>
  <!-- cursor target -->
  <circle cx="232" cy="52" r="9" fill="none" stroke="#fbbf24" stroke-width="1.5"/>
  <line x1="232" y1="38" x2="232" y2="46" stroke="#fbbf24" stroke-width="1.5"/>
  <line x1="232" y1="58" x2="232" y2="66" stroke="#fbbf24" stroke-width="1.5"/>
  <line x1="218" y1="52" x2="226" y2="52" stroke="#fbbf24" stroke-width="1.5"/>
  <line x1="238" y1="52" x2="246" y2="52" stroke="#fbbf24" stroke-width="1.5"/>
  <!-- flow: cursor → IK → joints -->
  <text x="300" y="40" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">tip pose</text>
  <line x1="300" y1="48" x2="300" y2="64" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-ik_reach-arrow)"/>
  <text x="300" y="80" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">IK</text>
  <line x1="300" y1="86" x2="300" y2="100" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-ik_reach-arrow)"/>
  <text x="300" y="114" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="10">q1, q2</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "IK Reach — 手先を直接動かす",
      en: "IK Reach — command the tip directly",
    },
    learn: {
      ja: "逆運動学 (IK) は「手先をここに」という目標から関節角を逆算します。同じ課題が joint_teleop より遥かに楽になるはず。IK には肘の向きで 2 解 (elbow-up/down) があり、到達できるのはワークスペース内だけ。腕が伸びきる特異点では関節が敏感になります。",
      en: "Inverse kinematics (IK) turns a tip goal ('put the hand here') back into joint angles. The same course is far easier than joint_teleop. IK has two solutions (elbow-up/down), only points inside the workspace are reachable, and near full extension (a singularity) the joints get twitchy.",
    },
    goal: {
      ja: "カーソル (マウス / 矢印) で手先目標を動かし、① → ⑥ に触れましょう。届かない所ではワークスペース境界が赤く光ります。E で肘の向きを切り替えられます。",
      en: "Move the tip target with the cursor (mouse / arrows) and touch ①→⑥. The workspace boundary flashes red where you can't reach. Press E to switch the elbow configuration.",
    },
    first: {
      ja: "カーソルをターゲット① に重ねるだけ。アームが IK で勝手に追従します。次に E で肘を反転して、腕の形が変わるのを見てください。",
      en: "Just hover the cursor over target ①; the arm follows via IK. Then press E to flip the elbow and watch the arm change shape.",
    },
  },
  strings: {
    ja: {
      "status.start": "カーソルで手先目標を動かす。IK が関節角を解いて追従 (E で肘反転)",
      "status.next": "取得! 次はターゲット {n}/{total}",
      "status.clear": "IK で全ターゲット制覇! 関節を直接触るより速かったはず",
      hint: "マウス / 矢印で手先 ・ E or RB で肘反転 ・ 境界赤=到達不可 ・ R リセット",
    },
    en: {
      "status.start": "Move the tip target; IK solves the joints to follow (E flips elbow)",
      "status.next": "Got it! Next: target {n}/{total}",
      "status.clear": "All targets via IK — faster than jogging joints by hand, right?",
      hint: "mouse / arrows = tip · E or RB flips elbow · red edge = unreachable · R reset",
    },
  },
  build: makeIkReach,
});
