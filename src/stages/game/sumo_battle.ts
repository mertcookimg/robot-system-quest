// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// sumo_battle: Sumo Battle — push the rival robot out of the dohyo ring
// while watching /odom to keep yourself inside.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import {
  drawGrid,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { formatPose, formatTwist } from "../../lib/hud";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { t, tx, onLangChange } from "../../i18n";
import { defineStage } from "../../core/stage_def";
import * as twoPlayer from "../../lib/two_player";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";

const PX_PER_M = 100;
const ROBOT_R = 16;
const BASE_LIN = 185;
const BASE_ANG = 2.8;
const BOOST_MULT = 1.7;
const RING = { x: W / 2, y: H / 2 + 10, r: 200 };
const TOPIC_CMD = "/robot/manual_control/cmd_vel";
const TOPIC_ODOM = "/robot/odom";
const TOPIC_RIVAL_ODOM = "/rival/odom";
const START_P = { x: RING.x - 120, y: RING.y, theta: 0 };
const START_E = { x: RING.x + 120, y: RING.y, theta: Math.PI };

type AiState = "approach" | "windup" | "charge" | "recover";

type Difficulty = "easy" | "normal" | "hard";

interface DifficultyParams {
  approachSpd: number; // px/s while circling toward the player
  chargeSpd: number; // px/s during the dash
  chargeRange: number; // px — starts the windup within this distance
  cdMin: number; // seconds between charges (min)
  cdRand: number; // + random(0..cdRand)
  chargeResist: number; // knockback multiplier while charging (lower = firmer)
  clearStars: number; // star cap for a 1P win at this difficulty
}

const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: {
    approachSpd: 85,
    chargeSpd: 260,
    chargeRange: 150,
    cdMin: 2.0,
    cdRand: 1.2,
    chargeResist: 0.75,
    clearStars: 1,
  },
  normal: {
    approachSpd: 110,
    chargeSpd: 350,
    chargeRange: 175,
    cdMin: 1.1,
    cdRand: 1.0,
    chargeResist: 0.55,
    clearStars: 2,
  },
  hard: {
    approachSpd: 135,
    chargeSpd: 430,
    chargeRange: 200,
    cdMin: 0.7,
    cdRand: 0.7,
    chargeResist: 0.4,
    clearStars: 3,
  },
};

function normAngle(a: number): number {
  return ((((a + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
}

function turnToward(cur: number, target: number, maxStep: number): number {
  const d = normAngle(target - cur);
  return cur + Math.max(-maxStep, Math.min(maxStep, d));
}

export function makeSumoBattle(): Stage {
  let g!: GameContext;
  const robot = { x: START_P.x, y: START_P.y, theta: START_P.theta, kbx: 0, kby: 0 };
  const enemy = { x: START_E.x, y: START_E.y, theta: START_E.theta, kbx: 0, kby: 0 };
  const cmd = { lin: 0, ang: 0 };
  const particles = new Particles();
  const ai = { state: "approach" as AiState, t: 0, cd: 1.5 };
  let stamina = 1;
  let boosting = false;
  let staminaE = 1;
  let p2Boosting = false;
  let pushes = 0;
  let elapsed = 0;
  let cleared = false;
  let animTime = 0;
  let pubAcc = 0;
  let odomAcc = 0;
  let bumpCd = 0;
  let bumpFlash = 0;

  // 2P toggle / difficulty overlay state (same pattern as tag_chase).
  let mode2P = false;
  let difficulty: Difficulty = "normal";
  let overlayPanel: OverlayPanelHandle | null = null;
  let disposeLangSync: (() => void) | null = null;

  function reset() {
    robot.x = START_P.x;
    robot.y = START_P.y;
    robot.theta = START_P.theta;
    enemy.x = START_E.x;
    enemy.y = START_E.y;
    enemy.theta = START_E.theta;
    robot.kbx = robot.kby = enemy.kbx = enemy.kby = 0;
    cmd.lin = 0;
    cmd.ang = 0;
    particles.reset();
    ai.state = "approach";
    ai.t = 0;
    ai.cd = 1.5;
    stamina = 1;
    boosting = false;
    staminaE = 1;
    p2Boosting = false;
    pushes = 0;
    elapsed = 0;
    cleared = false;
    bumpCd = 0;
    bumpFlash = 0;
    twoPlayer.resetEdges();
    g.ghost.startRecording();
    g.setStatus(t(mode2P ? "sumo_battle.status.fight2p" : "sumo_battle.status.fight"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;

    overlayPanel?.dispose();
    disposeLangSync?.();
    const diffLevels: Difficulty[] = ["easy", "normal", "hard"];
    overlayPanel = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("sumo_battle.overlay.players"),
          choices: [
            { key: "1p", label: () => t("sumo_battle.overlay.1p") },
            { key: "2p", label: () => t("sumo_battle.overlay.2p") },
          ],
          active: () => (mode2P ? "2p" : "1p"),
          onSelect: (key) => setMode2P(key === "2p"),
        },
        {
          kind: "choice",
          label: () => t("sumo_battle.overlay.difficulty"),
          choices: diffLevels.map((level) => ({
            key: level,
            label: () => t(`sumo_battle.overlay.${level}`),
          })),
          active: () => difficulty,
          onSelect: (key) => setDifficulty(key as Difficulty),
          dividerBefore: true,
          visible: () => !mode2P,
        },
      ],
      { placement: "dock" },
    );
    disposeLangSync = onLangChange(() => overlayPanel?.refresh());

    twoPlayer.installToggleListener();
    twoPlayer.setActive(true);
    reset();
  }

  function setMode2P(active: boolean) {
    if (mode2P === active) return;
    mode2P = active;
    overlayPanel?.refresh();
    g.sfx.click();
    reset();
  }

  function setDifficulty(d: Difficulty) {
    if (difficulty === d) return;
    difficulty = d;
    overlayPanel?.refresh();
    g.sfx.click();
    if (!mode2P) reset();
  }

  function distFromCenter(p: { x: number; y: number }): number {
    return Math.hypot(p.x - RING.x, p.y - RING.y);
  }

  function updateEnemy(dt: number) {
    const params = DIFFICULTY[difficulty];
    ai.t -= dt;
    ai.cd -= dt;
    const angToP = Math.atan2(robot.y - enemy.y, robot.x - enemy.x);
    const distP = Math.hypot(robot.x - enemy.x, robot.y - enemy.y);
    let spd = 0;

    switch (ai.state) {
      case "approach": {
        // Steer back toward the center when the AI drifts near the edge.
        const nearEdge = distFromCenter(enemy) > RING.r - 60;
        const target = nearEdge ? Math.atan2(RING.y - enemy.y, RING.x - enemy.x) : angToP;
        enemy.theta = turnToward(enemy.theta, target, 2.4 * dt);
        spd = params.approachSpd;
        const facing = Math.abs(normAngle(angToP - enemy.theta)) < 0.35;
        if (!nearEdge && facing && distP < params.chargeRange && ai.cd <= 0) {
          ai.state = "windup";
          ai.t = 0.45 + Math.random() * 0.25;
        }
        break;
      }
      case "windup":
        enemy.theta = turnToward(enemy.theta, angToP, 1.0 * dt);
        spd = 8;
        if (ai.t <= 0) {
          ai.state = "charge";
          ai.t = 0.8;
        }
        break;
      case "charge":
        // Full-speed dash with no steering — dodge it and shove from the side!
        spd = params.chargeSpd;
        if (ai.t <= 0) {
          ai.state = "recover";
          ai.t = 0.9;
          ai.cd = params.cdMin + Math.random() * params.cdRand;
        }
        break;
      case "recover":
        enemy.theta = turnToward(enemy.theta, angToP, 1.4 * dt);
        spd = 45;
        if (ai.t <= 0) ai.state = "approach";
        break;
    }

    enemy.x += (spd * Math.cos(enemy.theta) + enemy.kbx) * dt;
    enemy.y += (spd * Math.sin(enemy.theta) + enemy.kby) * dt;
    const decay = Math.exp(-3.5 * dt);
    enemy.kbx *= decay;
    enemy.kby *= decay;
    return spd;
  }

  // 2P mode: the rival robot is driven by the second player (pad slot 1 /
  // arrow keys + RShift boost) with the same speed and stamina rules as P1.
  function updateEnemyHuman(dt: number) {
    const input = twoPlayer.pollP2();
    const linDir = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
    const angDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    p2Boosting = input.boost && staminaE > 0 && linDir > 0;
    if (p2Boosting) staminaE = Math.max(0, staminaE - 0.5 * dt);
    else staminaE = Math.min(1, staminaE + 0.35 * dt);
    const spd = linDir * BASE_LIN * (p2Boosting ? BOOST_MULT : 1);
    enemy.theta += angDir * BASE_ANG * dt;
    enemy.x += (spd * Math.cos(enemy.theta) + enemy.kbx) * dt;
    enemy.y += (spd * Math.sin(enemy.theta) + enemy.kby) * dt;
    const decay = Math.exp(-3.5 * dt);
    enemy.kbx *= decay;
    enemy.kby *= decay;
    return spd;
  }

  function resolveContact(enemySpd: number) {
    const dx = enemy.x - robot.x;
    const dy = enemy.y - robot.y;
    const d = Math.hypot(dx, dy);
    if (d >= ROBOT_R * 2 || d === 0) return;
    const nx = dx / d,
      ny = dy / d;
    const overlap = ROBOT_R * 2 - d;
    robot.x -= (nx * overlap) / 2;
    robot.y -= (ny * overlap) / 2;
    enemy.x += (nx * overlap) / 2;
    enemy.y += (ny * overlap) / 2;

    const pvx = cmd.lin * Math.cos(robot.theta) + robot.kbx;
    const pvy = cmd.lin * Math.sin(robot.theta) + robot.kby;
    const evx = enemySpd * Math.cos(enemy.theta) + enemy.kbx;
    const evy = enemySpd * Math.sin(enemy.theta) + enemy.kby;
    const pv = Math.max(0, pvx * nx + pvy * ny);
    const ev = Math.max(0, -(evx * nx + evy * ny));
    const charging = !mode2P && ai.state === "charge";
    const pPower = pv * (boosting ? 1.9 : 1.1);
    const ePower = ev * (charging ? 1.7 : p2Boosting ? 1.9 : 1.0);

    // Impulses only fire on the bumpCd edge — while the bodies stay
    // overlapped, the per-frame position separation above already conveys
    // a sustained shove; re-adding the impulse every frame would stack it
    // into an unbounded launch.
    if (bumpCd <= 0) {
      bumpCd = 0.25;
      bumpFlash = 0.5;
      // A charging rival plants its feet — harder to shove back.
      const eResist = charging ? DIFFICULTY[difficulty].chargeResist : 1.0;
      enemy.kbx += nx * (pPower * 1.5 + 50) * eResist;
      enemy.kby += ny * (pPower * 1.5 + 50) * eResist;
      robot.kbx -= nx * (ePower * 1.5 + 50);
      robot.kby -= ny * (ePower * 1.5 + 50);
      if (pPower > ePower) pushes++;
      const mx = (robot.x + enemy.x) / 2,
        my = (robot.y + enemy.y) / 2;
      particles.burst(mx, my, pPower >= ePower ? "#7dd3fc" : "#fb7185", 14, 200);
      g.sfx.bump();
      g.shake(0.25);
    }
  }

  function win() {
    cleared = true;
    particles.burst(enemy.x, enemy.y, "#fbbf24", 40, 280);
    particles.burst(enemy.x, enemy.y, "#7dd3fc", 28);
    g.sfx.victory();
    g.shake(0.6);
    if (mode2P) {
      g.setStatus(t("sumo_battle.status.p1win"), "var(--ok)");
      const stats =
        `Winner  <b>P1</b><br>` +
        `Time    <b>${elapsed.toFixed(2)} s</b><br>` +
        `Pushes  <b>${pushes}</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(3, stats);
      }, 500);
      return;
    }
    g.setStatus(t("sumo_battle.status.win"), "var(--ok)");
    // Time decides the stars, capped by difficulty (hard is the only tier
    // where a fast bout earns the full 3).
    const timeStars = elapsed < 20 ? 3 : elapsed < 40 ? 2 : 1;
    const stars = Math.min(timeStars, DIFFICULTY[difficulty].clearStars);
    const stats =
      `Time       <b>${elapsed.toFixed(2)} s</b><br>` +
      `Difficulty <b>${difficulty.toUpperCase()}</b><br>` +
      `Pushes     <b>${pushes}</b>`;
    g.awardStars(stars, stats);
  }

  function update(dt: number) {
    animTime += dt;
    particles.update(dt);
    if (bumpCd > 0) bumpCd -= dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);
    if (twoPlayer.pollToggleEdge()) setMode2P(!mode2P);
    if (cleared) return;
    elapsed += dt;

    // --- Player teleop + boost (LB/RB or Shift).
    if (mode2P) {
      const input = twoPlayer.pollP1();
      const linDir = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
      const angDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      boosting = input.boost && stamina > 0 && linDir > 0;
      cmd.lin = linDir * BASE_LIN * (boosting ? BOOST_MULT : 1);
      cmd.ang = angDir * BASE_ANG;
    } else {
      const tw = teleop(g.keys, { baseLin: BASE_LIN, baseAng: BASE_ANG });
      boosting = g.keys.has("shift") && stamina > 0 && tw.lin > 0;
      cmd.lin = tw.lin * (boosting ? BOOST_MULT : 1);
      cmd.ang = tw.ang;
    }
    if (boosting) stamina = Math.max(0, stamina - 0.5 * dt);
    else stamina = Math.min(1, stamina + 0.35 * dt);

    robot.theta += cmd.ang * dt;
    robot.x += (cmd.lin * Math.cos(robot.theta) + robot.kbx) * dt;
    robot.y += (cmd.lin * Math.sin(robot.theta) + robot.kby) * dt;
    const decay = Math.exp(-3.5 * dt);
    robot.kbx *= decay;
    robot.kby *= decay;

    const enemySpd = mode2P ? updateEnemyHuman(dt) : updateEnemy(dt);
    resolveContact(enemySpd);

    // --- Ring out judgement (the referee node watches /odom).
    // Player is checked first: if both robots cross the tawara on the same
    // frame, the loss stands — you cannot win while out of the ring.
    if (distFromCenter(robot) > RING.r) {
      cleared = true;
      if (mode2P) {
        particles.burst(robot.x, robot.y, "#fb7185", 30, 200);
        g.sfx.victory();
        g.shake(0.6);
        g.setStatus(t("sumo_battle.status.p2win"), "var(--ok)");
        const stats = `Winner  <b>P2</b><br>` + `Time    <b>${elapsed.toFixed(2)} s</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(2, stats);
        }, 500);
      } else {
        g.crash(t("sumo_battle.crash.out"));
      }
      return;
    }
    if (distFromCenter(enemy) > RING.r) {
      win();
      return;
    }

    pubAcc += dt;
    if (pubAcc > 1 / 20) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(cmd.lin / PX_PER_M, cmd.ang));
    }
    odomAcc += dt;
    if (odomAcc > 1 / 10) {
      odomAcc = 0;
      const dm = distFromCenter(robot) / PX_PER_M;
      g.publish(TOPIC_ODOM, `nav_msgs/msg/Odometry dist_from_center:${dm.toFixed(2)}m`);
      const de = distFromCenter(enemy) / PX_PER_M;
      g.publish(TOPIC_RIVAL_ODOM, `nav_msgs/msg/Odometry dist_from_center:${de.toFixed(2)}m`);
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    const edgeM = (RING.r - distFromCenter(robot)) / PX_PER_M;
    const gauge = "#".repeat(Math.round(stamina * 10)).padEnd(10, "-");
    g.setHud([
      `mode:      sumo battle ${mode2P ? "(P1 vs P2)" : `[${difficulty}]`}`,
      `pose:      ${formatPose(robot, { pxPerM: PX_PER_M })}`,
      `cmd_vel:   ${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: PX_PER_M })}`,
      `edge:      ${edgeM.toFixed(2)} m ${edgeM < 0.5 ? "!! DANGER" : ""}`,
      `rival:     ${mode2P ? "P2 (human)" : ai.state}`,
      `boost:     [${gauge}]`,
    ]);
  }

  function drawRing(c: CanvasRenderingContext2D) {
    // Dohyo surface.
    c.save();
    c.fillStyle = "rgba(30, 38, 70, 0.55)";
    c.beginPath();
    c.arc(RING.x, RING.y, RING.r, 0, Math.PI * 2);
    c.fill();
    // Tawara (straw bale) edge.
    c.strokeStyle = "#b08d57";
    c.lineWidth = 5;
    c.globalAlpha = 0.85;
    c.beginPath();
    c.arc(RING.x, RING.y, RING.r, 0, Math.PI * 2);
    c.stroke();
    // Inner guide ring.
    c.globalAlpha = 0.25;
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 1;
    c.setLineDash([6, 6]);
    c.beginPath();
    c.arc(RING.x, RING.y, RING.r - 60, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    // Shikiri starting lines.
    c.globalAlpha = 0.6;
    c.strokeStyle = "#eef2ff";
    c.lineWidth = 2;
    for (const sx of [RING.x - 40, RING.x + 40]) {
      c.beginPath();
      c.moveTo(sx, RING.y - 22);
      c.lineTo(sx, RING.y + 22);
      c.stroke();
    }
    c.restore();

    // Danger arc near the player when close to the edge.
    const dc = distFromCenter(robot);
    if (dc > RING.r - 55 && !cleared) {
      const a = Math.atan2(robot.y - RING.y, robot.x - RING.x);
      c.save();
      c.strokeStyle = COLORS.DANGER;
      c.lineWidth = 6;
      c.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(animTime * 6));
      c.beginPath();
      c.arc(RING.x, RING.y, RING.r, a - 0.5, a + 0.5);
      c.stroke();
      c.restore();
    }
  }

  function drawEnemy(c: CanvasRenderingContext2D) {
    const flash = !mode2P && ai.state === "windup" && Math.sin(animTime * 22) > 0;
    c.save();
    c.translate(enemy.x, enemy.y);
    // Ground shadow.
    c.fillStyle = "rgba(0, 0, 0, 0.32)";
    c.fillRect(-9, 14, 19, 1);
    c.rotate(enemy.theta);
    // Body.
    c.fillStyle = flash ? "#7f1d1d" : "#3d1526";
    c.strokeStyle = flash ? "#fecaca" : "#fb7185";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(-11, -11, 22, 22, 5);
    c.fill();
    c.stroke();
    // Tires.
    c.fillStyle = "#2d2540";
    c.fillRect(-4, -13, 8, 2);
    c.fillRect(-4, 11, 8, 2);
    // Forward ram spike.
    c.fillStyle = "#fb7185";
    c.beginPath();
    c.moveTo(11, -4);
    c.lineTo(17, 0);
    c.lineTo(11, 4);
    c.closePath();
    c.fill();
    // Angry eyes.
    c.fillStyle = "#fecaca";
    c.fillRect(2, -6, 4, 2);
    c.fillRect(2, 4, 4, 2);
    c.restore();
    // Boost exhaust behind a boosting P2 rival.
    if (mode2P && p2Boosting) {
      c.save();
      c.translate(enemy.x, enemy.y);
      c.rotate(enemy.theta);
      c.fillStyle = "rgba(251, 113, 133, 0.7)";
      const len = 6 + 4 * Math.abs(Math.sin(animTime * 20));
      c.beginPath();
      c.moveTo(-12, -4);
      c.lineTo(-12 - len, 0);
      c.lineTo(-12, 4);
      c.closePath();
      c.fill();
      c.restore();
    }
    // Telegraph mark above a winding-up rival.
    if (!mode2P && ai.state === "windup") {
      c.save();
      c.fillStyle = "#fbbf24";
      c.font = "700 14px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText("!!", enemy.x, enemy.y - 24);
      c.restore();
    }
  }

  function drawBoostGauge(
    c: CanvasRenderingContext2D,
    x: number,
    label: string,
    value: number,
    fillColor: string,
  ) {
    const y = 12,
      w = 96,
      h = 22;
    c.save();
    c.fillStyle = withA(theme.scrim, 0.78);
    c.strokeStyle = "rgba(125, 211, 252, 0.3)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(x, y, w, h, 5);
    c.fill();
    c.stroke();
    c.fillStyle = COLORS.FG_DIM;
    c.font = "600 8px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(label, x + 8, y + h / 2);
    const bw = 46;
    c.fillStyle = "rgba(35, 44, 77, 0.9)";
    c.fillRect(x + 42, y + 7, bw, 8);
    c.fillStyle = value < 0.3 ? COLORS.WARN : fillColor;
    c.fillRect(x + 42, y + 7, bw * value, 8);
    c.restore();
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);

    const vg = c.createRadialGradient(RING.x, RING.y, 100, RING.x, RING.y, 600);
    vg.addColorStop(0, "rgba(251, 191, 36, 0.04)");
    vg.addColorStop(1, "rgba(0, 0, 0, 0)");
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);

    drawGrid(c);
    drawRing(c);

    particles.draw(c);
    g.ghost.draw(c, elapsed, animTime);

    drawEnemy(c);

    // Player robot.
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, animTime);
    if (boosting) {
      // Boost exhaust behind the robot.
      c.fillStyle = "rgba(125, 211, 252, 0.7)";
      const len = 6 + 4 * Math.abs(Math.sin(animTime * 20));
      c.beginPath();
      c.moveTo(-12, -4);
      c.lineTo(-12 - len, 0);
      c.lineTo(-12, 4);
      c.closePath();
      c.fill();
    }
    c.rotate(-robot.theta);
    drawRobotLabel(c);
    c.restore();

    drawBoostGauge(c, 12, mode2P ? "P1 BOOST" : "BOOST", stamina, COLORS.ACCENT);
    if (mode2P) drawBoostGauge(c, W - 108, "P2 BOOST", staminaE, "#fb7185");
    drawTimer(c, elapsed, g.getBestTime());
    drawHint(
      c,
      t(mode2P ? "sumo_battle.hint2p" : "sumo_battle.hint", {
        pads: twoPlayer.padCount(),
      }),
    );
  }

  function dispose() {
    overlayPanel?.dispose();
    overlayPanel = null;
    disposeLangSync?.();
    disposeLangSync = null;
    twoPlayer.setActive(false);
    twoPlayer.uninstallToggleListener();
  }

  return {
    id: "sumo_battle",
    name: "Sumo Battle",
    lesson: "",
    lessonCmd: "ros2 topic echo /robot/odom",
    ros2: defineRos2Concept({
      title: tx(
        "Odometry ・/odom で自分の位置を知る",
        "Odometry — knowing where you are via /odom",
      ),
      summary:
        "ロボットは車輪の回転量から自己位置を推定し、nav_msgs/msg/Odometry として /odom に publish します。" +
        "土俵の中心からの距離を /odom で監視すれば「あとどれだけで場外か」が分かる。" +
        "自律ロボットの第一歩は『自分がどこにいるか』を知ることです。",
      msgTypes: ["nav_msgs/msg/Odometry", "geometry_msgs/msg/Twist"],
      cli: [
        "ros2 topic echo /robot/odom",
        "ros2 topic hz /robot/odom",
        "ros2 topic info /robot/odom",
      ],
      python: `import math
import rclpy
from rclpy.node import Node
from nav_msgs.msg import Odometry

RING_RADIUS = 2.0  # [m]

class SumoReferee(Node):
    def __init__(self):
        super().__init__('sumo_referee')
        self.create_subscription(
            Odometry, '/robot/odom', self.on_odom, 10)

    def on_odom(self, msg: Odometry):
        x = msg.pose.pose.position.x
        y = msg.pose.pose.position.y
        dist = math.hypot(x, y)
        if dist > RING_RADIUS:
            self.get_logger().warn('RING OUT!')
        elif dist > RING_RADIUS - 0.5:
            self.get_logger().info('edge! be careful')`,
      realWorld: tx(
        "実機でもホイールオドメトリは必ずズレます（スリップ・接触）。だから LiDAR や IMU と融合して補正するのが実用ロボの定石です。",
        "On real robots wheel odometry always drifts (slip, contact). That is why practical robots fuse it with LiDAR or IMU data for correction.",
      ),
      state: state({
        nodes: ["/robot_node", "/rival_node", "/sumo_referee"],
        topics: [
          topic("/robot/manual_control/cmd_vel", "geometry_msgs/msg/Twist", {
            pub: ["/teleop"],
            sub: ["/robot_node"],
          }),
          topic("/robot/odom", "nav_msgs/msg/Odometry", {
            pub: ["/robot_node"],
            sub: ["/sumo_referee"],
          }),
          topic("/rival/odom", "nav_msgs/msg/Odometry", {
            pub: ["/rival_node"],
            sub: ["/sumo_referee"],
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
  mode: "game",
  order: 9,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="robot publishes /odom, sumo referee subscribes and judges ring out">
  <defs>
    <marker id="ld-sumo-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="52" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">robot_node</text>
  <text x="82" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">wheel odometry</text>
  <rect x="264" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="338" y="52" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="12" font-weight="700">sumo_referee</text>
  <text x="338" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">dist &gt; 2.0m → OUT</text>
  <line x1="156" y1="60" x2="262" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-sumo-arrow)"/>
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="1.6s" repeatCount="indefinite" path="M 158 60 L 258 60"/>
  </circle>
  <text x="210" y="46" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/odom</text>
  <text x="210" y="80" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">nav_msgs/msg/Odometry</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Odometry 入門 — /odom で場外を回避する",
      en: "Odometry basics — staying in the ring with /odom",
    },
    learn: {
      ja: "ロボットは車輪の回転から自己位置を推定し /odom に publish します。HUD の edge 距離は /odom から計算されたもの。位置が分かるから「場外まであと何m」が分かるのです。",
      en: "A robot estimates its own pose from wheel rotation and publishes it on /odom. The HUD edge distance is computed from /odom — knowing your pose is what tells you how close you are to falling out.",
    },
    goal: {
      ja: "ライバルロボを土俵の外へ押し出せ! 自分が先に出たら負け。\nLB/RB(Shift) ブーストで押し込み、突進(!!)はかわして横から押そう。",
      en: "Shove the rival robot out of the ring — fall out first and you lose.\nUse LB/RB (Shift) boost to push hard, dodge its charge (!!) and hit it from the side.",
    },
    first: {
      ja: "1PはWASDで移動。Pad対戦はPadを2台接続してYを押します。P1・P2とも左スティックで移動し、LB/RBでブーストして押し合います。",
      en: "In 1P, move with WASD. For a pad battle, connect two pads and press Y. Both players move with the left stick and boost with LB/RB.",
    },
  },
  strings: {
    ja: {
      "status.fight": "ライバルを土俵の外へ押し出せ! 自分が出たら負け",
      "status.fight2p": "P1 vs P2 — 相手を先に土俵の外へ押し出せ!",
      "status.win": "押し出し勝ち! RING OUT!",
      "status.p1win": "P1 の押し出し勝ち! RING OUT!",
      "status.p2win": "P2 の押し出し勝ち! P1 が場外!",
      "crash.out": "場外負け — /odom の edge 距離に注意",
      hint: "1P · WASD/左スティック 移動 · Shift/LB/RB BOOST · Y → 2P PAD（接続 {pads}/2）",
      hint2p: "🎮 2P PAD（接続 {pads}/2）· P1/P2 左スティック 移動 · LB/RB BOOST · Y → 1P",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD対戦",
      "overlay.difficulty": "AI 難易度",
      "overlay.easy": "EASY",
      "overlay.normal": "NORMAL",
      "overlay.hard": "HARD",
    },
    en: {
      "status.fight": "Push the rival out of the ring — fall out and you lose",
      "status.fight2p": "P1 vs P2 — shove your opponent out of the ring first!",
      "status.win": "RING OUT! You win!",
      "status.p1win": "P1 wins by push-out! RING OUT!",
      "status.p2win": "P2 wins — P1 fell out of the ring!",
      "crash.out": "Ring out — watch the edge distance on /odom",
      hint: "1P · WASD/LEFT STICK move · Shift/LB/RB BOOST · Y → 2P PAD ({pads}/2)",
      hint2p: "🎮 2P PAD ({pads}/2) · P1/P2 LEFT STICK move · LB/RB BOOST · Y → 1P",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD BATTLE",
      "overlay.difficulty": "AI DIFFICULTY",
      "overlay.easy": "EASY",
      "overlay.normal": "NORMAL",
      "overlay.hard": "HARD",
    },
  },
  build: makeSumoBattle,
});
