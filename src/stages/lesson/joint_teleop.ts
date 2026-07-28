// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// joint_teleop — "Joint Teleop". The first robot-ARM lesson: you drive each
// joint DIRECTLY (shoulder + elbow) to touch a course of targets. The point is
// visceral: reaching a Cartesian point by hand-jogging joint angles is
// genuinely fiddly — the base joint drags the whole arm, and every joint has
// hard limits. That frustration is the lesson, and the motivation for ik_reach
// (A2), which lets you command the tip directly instead.
//
// Controls
//   shoulder q1 : W / S      (or pad LEFT stick up/down)
//   elbow    q2 : I / K      (or pad RIGHT stick up/down)
//   precision   : Shift      (or pad LB/RB/triggers) — 0.35× jog speed
//
// Real ROS 2: this is sensor_msgs/JointState teleop — exactly what
// joint_state_publisher_gui does when you drag its sliders.
import { type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import { clearBackground, drawGrid, drawTimer, drawHint } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatSeconds } from "../../lib/hud";
import {
  ARM,
  fk,
  drawArm,
  drawWorkspace,
  clampAngle,
  atLimit,
  COURSE_TARGETS,
} from "../../lib/arm";
import * as armpad from "../../lib/armpad";
import { withA } from "../../core/theme";
import { t, tx } from "../../i18n";

const DEG = Math.PI / 180;
const PICK_R = 24; // how close the tip must get to a target
const DWELL = 0.3; // seconds the tip must hold on a target to collect it
const ORB_R = 13;

export function makeJointTeleop(): Stage {
  let g!: GameContext;
  const particles = new Particles();

  let q1 = 0,
    q2 = 0; // joint angles (rad)
  let v1 = 0,
    v2 = 0; // last applied joint velocities (rad/s) — for HUD
  let activeIdx = 0;
  let dwell = 0;
  let elapsed = 0;
  let cleared = false;
  let pubAcc = 0;
  let flash1 = 0,
    flash2 = 0; // limit-flash timers per joint
  let wasLim1 = false,
    wasLim2 = false;

  function reset() {
    q1 = 100 * DEG;
    q2 = -90 * DEG;
    v1 = 0;
    v2 = 0;
    activeIdx = 0;
    dwell = 0;
    elapsed = 0;
    cleared = false;
    pubAcc = 0;
    flash1 = flash2 = 0;
    wasLim1 = wasLim2 = false;
    particles.reset();
    armpad.reset();
    g.setStatus(t("joint_teleop.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }

  function dispose() {
    armpad.reset();
  }

  function update(dt: number) {
    particles.update(dt);
    if (flash1 > 0) flash1 = Math.max(0, flash1 - dt);
    if (flash2 > 0) flash2 = Math.max(0, flash2 - dt);
    if (cleared) return;

    elapsed += dt;
    armpad.poll();

    // ── Read joint-velocity commands ──
    const k = g.keys;
    let dq1 = 0,
      dq2 = 0;
    if (k.has("w") || k.has("arrowup")) dq1 += 1;
    if (k.has("s") || k.has("arrowdown")) dq1 -= 1;
    if (k.has("i")) dq2 += 1;
    if (k.has("k")) dq2 -= 1;
    dq2 += -armpad.rightStickY(); // stick up (negative) → elbow +
    dq1 = Math.max(-1, Math.min(1, dq1));
    dq2 = Math.max(-1, Math.min(1, dq2));

    const precise = k.has("shift") || k.has("x");
    const speed = ARM.maxJointSpeed * (precise ? 0.35 : 1);

    const q1raw = q1 + dq1 * speed * dt;
    const q2raw = q2 + dq2 * speed * dt;
    const nq1 = clampAngle(q1raw, ARM.q1Min, ARM.q1Max);
    const nq2 = clampAngle(q2raw, ARM.q2Min, ARM.q2Max);
    v1 = (nq1 - q1) / dt;
    v2 = (nq2 - q2) / dt;
    q1 = nq1;
    q2 = nq2;

    // ── Limit feedback: bump + flash only on the frame we hit a wall ──
    const lim1 = atLimit(q1, ARM.q1Min, ARM.q1Max) && Math.abs(dq1) > 0;
    const lim2 = atLimit(q2, ARM.q2Min, ARM.q2Max) && Math.abs(dq2) > 0;
    if (lim1 && !wasLim1) {
      flash1 = 0.35;
      g.sfx.bump();
      g.shake();
    }
    if (lim2 && !wasLim2) {
      flash2 = 0.35;
      g.sfx.bump();
      g.shake();
    }
    wasLim1 = lim1;
    wasLim2 = lim2;

    // ── Target dwell / collect ──
    const { ee } = fk(q1, q2);
    const tgt = COURSE_TARGETS[activeIdx];
    if (tgt && Math.hypot(ee.x - tgt.x, ee.y - tgt.y) <= PICK_R) {
      dwell += dt;
      if (dwell >= DWELL) {
        particles.burst(tgt.x, tgt.y, "#5eead4", 26, 200);
        g.sfx.pickup();
        activeIdx++;
        dwell = 0;
        if (activeIdx >= COURSE_TARGETS.length) return finish();
        g.setStatus(
          t("joint_teleop.status.next", { n: activeIdx + 1, total: COURSE_TARGETS.length }),
          "var(--accent)",
        );
      }
    } else if (dwell > 0) {
      dwell = Math.max(0, dwell - dt * 2);
    }

    // ── Publish /joint_states at 10 Hz ──
    pubAcc += dt;
    if (pubAcc > 0.1) {
      pubAcc = 0;
      g.publish(
        "/joint_states",
        `sensor_msgs/msg/JointState position:[${q1.toFixed(2)}, ${q2.toFixed(2)}] velocity:[${v1.toFixed(2)}, ${v2.toFixed(2)}]`,
      );
    }

    g.setHud([
      `name:     [shoulder, elbow]`,
      `position: [${q1.toFixed(2)}, ${q2.toFixed(2)}] rad`,
      `velocity: [${v1.toFixed(2)}, ${v2.toFixed(2)}] rad/s`,
      `target:   ${Math.min(activeIdx + 1, COURSE_TARGETS.length)} / ${COURSE_TARGETS.length}`,
      `elapsed:  ${formatSeconds(elapsed)}`,
    ]);
  }

  function finish() {
    cleared = true;
    const stars = elapsed < 24 ? 3 : elapsed < 38 ? 2 : 1;
    g.setStatus(t("joint_teleop.status.clear"), "var(--ok)");
    g.awardStars(
      stars,
      `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
        `Targets   <b>${COURSE_TARGETS.length} / ${COURSE_TARGETS.length}</b><br>` +
        `Control   <b>joint space</b>`,
    );
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    drawWorkspace(c);

    // Targets: collected (dim ✓), active (pulsing), upcoming (faint).
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
        // dwell ring
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
    drawArm(c, q1, q2, {
      showGauges: true,
      limitHot: { q1: flash1 > 0, q2: flash2 > 0 },
    });

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("joint_teleop.hint"));
  }

  return {
    id: "joint_teleop",
    name: "Joint Teleop",
    lesson: "JointState (FK)",
    lessonCmd: "ros2 topic echo /joint_states",
    ros2: {
      title: tx(
        "JointState ・各関節を直接動かして手先を運ぶ (順運動学)",
        "JointState — jog each joint directly and watch the tip (forward kinematics)",
      ),
      summary:
        "肩 (q1) と肘 (q2) の 2 関節を直接テレオペして、手先 (end-effector) でターゲットに触れる。" +
        "関節角 → 手先位置は順運動学 (FK) で決まり、根元の関節を動かすと先の全部がついてくる。" +
        "各関節には可動域 (リミット) があり、当たると止まる。狙った場所に手先を持っていくのが" +
        "いかに大変か——これが次の逆運動学 (ik_reach) の動機になる。",
      msgTypes: ["sensor_msgs/msg/JointState"],
      cli: [
        "ros2 topic echo /joint_states",
        "ros2 topic hz /joint_states",
        "ros2 run joint_state_publisher_gui joint_state_publisher_gui",
      ],
      python: `import rclpy
from rclpy.node import Node
from sensor_msgs.msg import JointState

class JointTeleop(Node):
    def __init__(self):
        super().__init__('joint_teleop')
        self.pub = self.create_publisher(JointState, '/joint_states', 10)
        self.q = [1.75, -1.57]  # [shoulder, elbow] rad
        self.create_timer(0.1, self.tick)

    def tick(self):
        msg = JointState()
        msg.name = ['shoulder', 'elbow']
        msg.position = self.q
        self.pub.publish(msg)

    # gamepad / keyboard callbacks integrate joint velocity into self.q,
    # clamped to each joint's limit — exactly like this stage.`,
      realWorld: tx(
        "実機では各関節のエンコーダが角度を /joint_states に流し、robot_state_publisher が FK で各リンクの TF を計算する。RViz のアームはこの topic で動いている。",
        "On real hardware each joint encoder streams its angle to /joint_states, and robot_state_publisher runs FK to broadcast every link's TF — that topic is what moves the arm you see in RViz.",
      ),
      state: {
        nodes: ["/joint_teleop", "/robot_state_publisher"],
        topics: [
          {
            name: "/joint_states",
            type: "sensor_msgs/msg/JointState",
            pub: ["/joint_teleop"],
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
  order: 17,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="two-link arm: shoulder and elbow angles set the tip position">
  <defs>
    <marker id="ld-joint_teleop-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#fbbf24"/>
    </marker>
  </defs>
  <!-- base -->
  <polygon points="44,104 76,104 70,86 50,86" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <!-- link 1 -->
  <line x1="60" y1="90" x2="150" y2="44" stroke="#7dd3fc" stroke-width="9" stroke-linecap="round"/>
  <!-- link 2 -->
  <line x1="150" y1="44" x2="248" y2="60" stroke="#c4b5fd" stroke-width="7" stroke-linecap="round"/>
  <!-- joints -->
  <circle cx="60" cy="90" r="7" fill="#eef2ff" stroke="#0a0f1f" stroke-width="2"/>
  <circle cx="150" cy="44" r="6" fill="#eef2ff" stroke="#0a0f1f" stroke-width="2"/>
  <!-- gripper -->
  <line x1="248" y1="60" x2="264" y2="60" stroke="#5eead4" stroke-width="3" stroke-linecap="round"/>
  <line x1="262" y1="53" x2="272" y2="52" stroke="#5eead4" stroke-width="3" stroke-linecap="round"/>
  <line x1="262" y1="67" x2="272" y2="68" stroke="#5eead4" stroke-width="3" stroke-linecap="round"/>
  <!-- angle arcs -->
  <path d="M 84 90 A 24 24 0 0 0 78 74" fill="none" stroke="#fbbf24" stroke-width="1.5" marker-end="url(#ld-joint_teleop-arrow)"/>
  <text x="92" y="82" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">q1</text>
  <path d="M 172 46 A 20 20 0 0 1 168 66" fill="none" stroke="#fbbf24" stroke-width="1.5" marker-end="url(#ld-joint_teleop-arrow)"/>
  <text x="176" y="44" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">q2</text>
  <!-- target -->
  <circle cx="300" cy="44" r="11" fill="none" stroke="#fbbf24" stroke-width="2"/>
  <text x="300" y="48" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">1</text>
  <text x="330" y="48" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">tip → target</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Joint Teleop — 関節を直接動かす",
      en: "Joint Teleop — drive the joints directly",
    },
    learn: {
      ja: "ロボットアームは肩・肘などの関節角 (JointState) で決まります。関節角から手先位置が決まるのが順運動学 (FK)。根元の関節を動かすと先のリンク全部が動き、各関節には可動域リミットがあります。",
      en: "A robot arm is defined by its joint angles (JointState). Joint angles → tip position is forward kinematics (FK). Moving a proximal joint swings everything beyond it, and every joint has a travel limit.",
    },
    goal: {
      ja: "肩 (W/S) と肘 (I/K) を操って、手先で ① → ⑥ のターゲットに順番に触れましょう。手先を狙い通りに動かす難しさを体感してください。",
      en: "Jog the shoulder (W/S) and elbow (I/K) to touch targets ①→⑥ in order with the tip. Feel how hard it is to place the tip where you want.",
    },
    first: {
      ja: "まず W/S で肩、I/K で肘を動かしてターゲット① に手先を重ね、0.3 秒キープ。Shift でゆっくり精密に動かせます。",
      en: "Move the shoulder with W/S and elbow with I/K, hover the tip on target ① for 0.3 s. Hold Shift for slow, precise jogging.",
    },
  },
  strings: {
    ja: {
      "status.start": "肩 W/S ・肘 I/K で手先をターゲット① へ (Shift で精密)",
      "status.next": "取得! 次はターゲット {n}/{total}",
      "status.clear": "全ターゲット制覇! 関節空間で手先を運びきった",
      hint: "W/S 肩 ・ I/K 肘 ・ 右スティック肘 ・ Shift 精密 ・ R リセット",
    },
    en: {
      "status.start": "Shoulder W/S · Elbow I/K — bring the tip to target ① (Shift = precise)",
      "status.next": "Got it! Next: target {n}/{total}",
      "status.clear": "All targets cleared — you carried the tip through joint space!",
      hint: "W/S shoulder · I/K elbow · right stick elbow · Shift precise · R reset",
    },
  },
  build: makeJointTeleop,
});
