// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// robo_soccer: Robo Soccer (3 vs 3)
// 1 player + 2 friendly AI vs 3 opponent AI. Push the ball into the
// opposing goal to score.
// First to 3 wins. Multi-robot extension of the ROS 2 lesson: cmd_vel
// teleop + /ball/pose subscribe.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { drawHint, drawTimer, fmtTwist, drawRobotBody, clearBackground } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatPose, formatTwist } from "../../lib/hud";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import { t, tx, onLangChange } from "../../i18n";
import * as twoPlayer from "../../lib/two_player";

const ROBOT_R = 13;
const BALL_R = 9;
const BASE_LIN = 220;
const BASE_ANG = 3.2;
const KICK_VEL = 610; // ball velocity added when kicked (E or pad-X)
const PUSH_FACTOR = 1.7; // push factor: robot → ball
const BALL_FRIC = 0.985; // ball friction per frame at 60fps
const BALL_BOUNCE = 0.7; // wall-bounce restitution
const TARGET_SCORE = 3;
const KICK_REQUEST_WINDOW = 0.7; // forgiving input buffer before ball contact
const KICK_REACH = 22; // extra reach while a buffered kick is armed
const SHOT_ASSIST_1P = 0.78;
const SHOT_ASSIST_2P = 0.5;
const AI_KICK_COOLDOWN = 0.9; // seconds between AI "kicks"
const AI_KICK_DIST = 38; // attempt kick only when close to ball
const AI_KICK_ALIGN_COS = 0.55; // require heading roughly toward scoring direction
const AI_AGGRESSION = 1.02; // opponent team's overall speed multiplier

const FIELD = { x: 30, y: 60, w: 740, h: 380 };
const GOAL_W = 14;
const GOAL_H = 170;
const GOAL_Y = FIELD.y + (FIELD.h - GOAL_H) / 2;
const AI_SAFE_MARGIN = 28; // keep AI targets at least this far from walls (anti-pin)
const BALL_STUCK_VEL = 8; // considered stalled below this speed
const BALL_STUCK_TIME = 1.4; // seconds stuck in a corner before triggering rescue

interface Body {
  x: number;
  y: number;
  theta: number;
  v: number;
  w: number;
}
type Role = "forward" | "mid" | "defender";
interface Bot extends Body {
  team: "P" | "O";
  role: Role;
  label: string;
}

export function makeRoboSoccer(): Stage {
  let g!: GameContext;
  const bots: Bot[] = [];
  const ball = {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    trail: [] as Array<{ x: number; y: number; life: number }>,
  };
  const particles = new Particles();

  let scoreP = 0,
    scoreO = 0;
  let elapsed = 0,
    cleared = false;
  let kickoffT = 0;
  let goalFlash = 0;
  let lastScorer: "P" | "O" | null = null;

  // Stage overlay UI (enemy AI strength).
  let overlayPanel: OverlayPanelHandle | null = null;
  // 0.75 / 1.0 / 1.35 (see overlay presets).
  let aiStrength = 1.0;
  let disposeLangSync: (() => void) | null = null;

  // Kick-related state (human player only).
  let kickCooldown = 0;
  let kickRequestT = 0; // grace window after pressing kick

  // 2P mode: bots[3] (opponent forward) becomes human player 2.
  let mode2P = false;
  let kickCooldown2 = 0;
  let kickRequestT2 = 0;

  // Kick-like attack state for AI opponents.
  let aiKickCooldownByIdx: number[] = [];
  let aiWantsKickByIdx: boolean[] = [];

  let pubAcc = 0;
  let ballStillT = 0; // time the ball has been moving slowly / stalled

  function reset() {
    scoreP = 0;
    scoreO = 0;
    elapsed = 0;
    cleared = false;
    goalFlash = 0;
    lastScorer = null;
    particles.reset();
    placeKickoff();
    g.ghost.startRecording();
    g.setStatus(t("robo_soccer.status.kickoff", { target: TARGET_SCORE }), "");
  }

  function placeKickoff() {
    bots.length = 0;
    const cx = FIELD.x + FIELD.w / 2;
    const cy = FIELD.y + FIELD.h / 2;
    // Player team (blue, attacks left → right). Index 0 is the human.
    bots.push({
      x: cx - 200,
      y: cy,
      theta: 0,
      v: 0,
      w: 0,
      team: "P",
      role: "forward",
      label: "YOU",
    });
    bots.push({
      x: cx - 240,
      y: cy - 110,
      theta: 0,
      v: 0,
      w: 0,
      team: "P",
      role: "mid",
      label: "P2",
    });
    bots.push({
      x: cx - 300,
      y: cy + 90,
      theta: 0,
      v: 0,
      w: 0,
      team: "P",
      role: "defender",
      label: "P3",
    });
    // Opponent team (pink, attacks right → left).
    bots.push({
      x: cx + 200,
      y: cy,
      theta: Math.PI,
      v: 0,
      w: 0,
      team: "O",
      role: "forward",
      label: "O1",
    });
    bots.push({
      x: cx + 240,
      y: cy - 110,
      theta: Math.PI,
      v: 0,
      w: 0,
      team: "O",
      role: "mid",
      label: "O2",
    });
    bots.push({
      x: cx + 300,
      y: cy + 90,
      theta: Math.PI,
      v: 0,
      w: 0,
      team: "O",
      role: "defender",
      label: "O3",
    });
    ball.x = cx;
    ball.y = cy;
    ball.vx = 0;
    ball.vy = 0;
    ball.trail.length = 0;
    kickoffT = 0.9;
    kickCooldown = 0;
    kickRequestT = 0;
    kickCooldown2 = 0;
    kickRequestT2 = 0;
    twoPlayer.resetEdges();

    aiKickCooldownByIdx = bots.map(() => 0);
    aiWantsKickByIdx = bots.map(() => false);
  }

  function aiKickCooldown(): number {
    // Stronger AI kicks more frequently.
    return Math.max(0.25, Math.min(1.8, AI_KICK_COOLDOWN / aiStrength));
  }

  function aiKickDist(): number {
    return Math.max(18, Math.min(70, AI_KICK_DIST * aiStrength));
  }

  function aiKickAlignCos(): number {
    // Stronger AI accepts more heading errors => threshold gets smaller.
    return Math.max(0.25, Math.min(0.75, AI_KICK_ALIGN_COS / aiStrength));
  }

  function aiAggression(): number {
    return Math.max(0.6, Math.min(1.9, AI_AGGRESSION * aiStrength));
  }

  /**
   * Tactical "skill" of the OPPONENT AI, 0..1, derived from the difficulty
   * preset: 0 at "weak" (0.75), ~0.42 at "normal" (1.0), 1 at "strong" (1.35).
   * Scales the smart behaviors (get-behind-the-ball, ball prediction, keeper,
   * aimed shots) so the easy setting stays beginner-friendly and only the
   * strong setting plays a proper game.
   */
  function aiSkill(): number {
    return Math.max(0, Math.min(1, (aiStrength - 0.75) / 0.6));
  }

  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

  /** Interpolate between two angles along the shortest arc. */
  function lerpAngle(a: number, b: number, t: number): number {
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  }

  // AI strength presets — three choices instead of a slider (easier to use).
  const AI_PRESETS: Array<{ key: "easy" | "normal" | "hard"; value: number }> = [
    { key: "easy", value: 0.75 },
    { key: "normal", value: 1.0 },
    { key: "hard", value: 1.35 },
  ];

  function init(ctx: GameContext) {
    g = ctx;
    disposeLangSync?.();
    disposeLangSync = null;
    overlayPanel?.dispose();

    overlayPanel = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("robo_soccer.overlay.players"),
          choices: [
            { key: "1p", label: () => t("robo_soccer.overlay.1p") },
            { key: "2p", label: () => t("robo_soccer.overlay.2p") },
          ],
          active: () => (mode2P ? "2p" : "1p"),
          onSelect: (key) => setMode2P(key === "2p"),
        },
        {
          kind: "choice",
          label: () => t("robo_soccer.overlay.title"),
          choices: AI_PRESETS.map((p) => ({
            key: p.key,
            label: () => t(`robo_soccer.overlay.${p.key}`),
          })),
          active: () => AI_PRESETS.find((p) => Math.abs(aiStrength - p.value) < 0.06)?.key ?? "",
          onSelect: (key) => {
            aiStrength = AI_PRESETS.find((p) => p.key === key)!.value;
            overlayPanel?.refresh();
            g.sfx.click();
          },
          dividerBefore: true,
        },
      ],
      { placement: "dock" },
    );

    // Keep labels in sync when user toggles language.
    disposeLangSync = onLangChange(() => overlayPanel?.refresh());

    twoPlayer.installToggleListener();
    twoPlayer.setActive(true); // helper handles 1P input too (P2 listeners idle until 2P)
    reset();
  }

  function setMode2P(active: boolean) {
    if (mode2P === active) return;
    mode2P = active;
    overlayPanel?.refresh();
    g.sfx.click();
    reset();
  }

  function dispose() {
    overlayPanel?.dispose();
    overlayPanel = null;
    disposeLangSync?.();
    disposeLangSync = null;
    twoPlayer.setActive(false);
    twoPlayer.uninstallToggleListener();
  }

  function clampInside(b: Body) {
    const r = ROBOT_R;
    if (b.x < FIELD.x + r) b.x = FIELD.x + r;
    if (b.x > FIELD.x + FIELD.w - r) b.x = FIELD.x + FIELD.w - r;
    if (b.y < FIELD.y + r) b.y = FIELD.y + r;
    if (b.y > FIELD.y + FIELD.h - r) b.y = FIELD.y + FIELD.h - r;
  }

  function applyDirectHumanDrive(b: Bot, input: twoPlayer.PlayerInput) {
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.back ? 1 : 0) - (input.fwd ? 1 : 0);
    if (dx === 0 && dy === 0) {
      b.v = 0;
      b.w = 0;
      return;
    }
    // Top-down direct movement: the robot immediately faces and travels in
    // the direction of the stick/WASD input. No turn-then-drive step.
    b.theta = Math.atan2(dy, dx);
    b.v = BASE_LIN;
    b.w = 0;
  }

  function update(dt: number) {
    // 1P/2P toggle is responsive even during the kickoff freeze.
    if (twoPlayer.pollToggleEdge()) setMode2P(!mode2P);

    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (goalFlash > 0) goalFlash = Math.max(0, goalFlash - dt);
    if (kickCooldown > 0) kickCooldown = Math.max(0, kickCooldown - dt);
    if (kickRequestT > 0) kickRequestT = Math.max(0, kickRequestT - dt);
    if (kickCooldown2 > 0) kickCooldown2 = Math.max(0, kickCooldown2 - dt);
    if (kickRequestT2 > 0) kickRequestT2 = Math.max(0, kickRequestT2 - dt);
    if (kickoffT > 0) {
      kickoffT -= dt;
      return;
    }

    // Decrement AI kick cooldowns.
    for (let i = 0; i < aiKickCooldownByIdx.length; i++) {
      if (aiKickCooldownByIdx[i] > 0)
        aiKickCooldownByIdx[i] = Math.max(0, aiKickCooldownByIdx[i] - dt);
    }

    // ── P1 input (pad slot 0 OR WASD/E/Shift via two_player) ──
    const p1 = twoPlayer.pollP1();
    if (p1.actionEdge) kickRequestT = KICK_REQUEST_WINDOW;
    const human = bots[0];
    applyDirectHumanDrive(human, p1);

    // ── P2 input (only in 2P) — drives bots[3] ──
    if (mode2P) {
      const p2 = twoPlayer.pollP2();
      if (p2.actionEdge) kickRequestT2 = KICK_REQUEST_WINDOW;
      const human2 = bots[3];
      applyDirectHumanDrive(human2, p2);
    }

    // -- AI step (skip P2-controlled bot in 2P mode) --
    for (let i = 1; i < bots.length; i++) {
      if (mode2P && i === 3) continue;
      aiStep(bots[i], i);
    }

    // -- Physics: robot movement --
    for (const b of bots) {
      b.theta += b.w * dt;
      b.x += b.v * Math.cos(b.theta) * dt;
      b.y += b.v * Math.sin(b.theta) * dt;
      clampInside(b);
    }

    // -- Resolve robot-robot overlap (simple rigid body, 3 iters to stabilize) --
    for (let iter = 0; iter < 3; iter++) {
      for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
          separateBodies(bots[i], bots[j]);
        }
      }
    }

    // -- Ball movement + friction --
    for (const point of ball.trail) point.life -= dt;
    ball.trail = ball.trail.filter((point) => point.life > 0);
    if (Math.hypot(ball.vx, ball.vy) > 90) {
      ball.trail.push({ x: ball.x, y: ball.y, life: 0.24 });
      if (ball.trail.length > 16) ball.trail.shift();
    }
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    const fric = Math.pow(BALL_FRIC, dt * 60);
    ball.vx *= fric;
    ball.vy *= fric;
    if (Math.hypot(ball.vx, ball.vy) < 4) {
      ball.vx = 0;
      ball.vy = 0;
    }

    // -- If the ball is stuck in a corner, nudge it toward field center (anti-stuck) --
    const ballSpeed = Math.hypot(ball.vx, ball.vy);
    const nearWall =
      ball.x - FIELD.x < 36 ||
      FIELD.x + FIELD.w - ball.x < 36 ||
      ball.y - FIELD.y < 36 ||
      FIELD.y + FIELD.h - ball.y < 36;
    if (ballSpeed < BALL_STUCK_VEL && nearWall) {
      ballStillT += dt;
      if (ballStillT > BALL_STUCK_TIME) {
        const cx = FIELD.x + FIELD.w / 2;
        const cy = FIELD.y + FIELD.h / 2;
        const ndx = cx - ball.x,
          ndy = cy - ball.y;
        const nlen = Math.hypot(ndx, ndy) || 1;
        ball.vx = (ndx / nlen) * 130;
        ball.vy = (ndy / nlen) * 130;
        ballStillT = 0;
        particles.burst(ball.x, ball.y, "#9aa6c8", 8, 80);
      }
    } else {
      ballStillT = 0;
    }

    // -- Ball vs walls --
    if (ball.x - BALL_R < FIELD.x) {
      if (inGoalY(ball.y)) {
        onGoal("O");
        return;
      }
      ball.x = FIELD.x + BALL_R;
      ball.vx = Math.abs(ball.vx) * BALL_BOUNCE;
    }
    if (ball.x + BALL_R > FIELD.x + FIELD.w) {
      if (inGoalY(ball.y)) {
        onGoal("P");
        return;
      }
      ball.x = FIELD.x + FIELD.w - BALL_R;
      ball.vx = -Math.abs(ball.vx) * BALL_BOUNCE;
    }
    if (ball.y - BALL_R < FIELD.y) {
      ball.y = FIELD.y + BALL_R;
      ball.vy = Math.abs(ball.vy) * BALL_BOUNCE;
    }
    if (ball.y + BALL_R > FIELD.y + FIELD.h) {
      ball.y = FIELD.y + FIELD.h - BALL_R;
      ball.vy = -Math.abs(ball.vy) * BALL_BOUNCE;
    }

    // -- Ball vs all robots --
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const isP1 = i === 0;
      const isP2 = mode2P && i === 3;
      let wantKick: boolean;
      if (isP1) wantKick = kickRequestT > 0 && kickCooldown <= 0;
      else if (isP2) wantKick = kickRequestT2 > 0 && kickCooldown2 <= 0;
      else wantKick = b.team === "O" && aiWantsKickByIdx[i] && aiKickCooldownByIdx[i] <= 0;

      // Human kicks receive a moderate goal-center assist. The robot still
      // needs to face the attacking half, but small heading errors no longer
      // turn a good approach into a shot off the post.
      let aimAngle: number | undefined;
      if (isP1 || isP2) {
        const targetX = b.team === "P" ? FIELD.x + FIELD.w : FIELD.x;
        const targetY = GOAL_Y + GOAL_H / 2;
        const goalAngle = Math.atan2(targetY - ball.y, targetX - ball.x);
        aimAngle = lerpAngle(b.theta, goalAngle, mode2P ? SHOT_ASSIST_2P : SHOT_ASSIST_1P);
      } else if (b.team === "O") {
        const s = aiSkill();
        if (s > 0) {
          const goalAng = Math.atan2(FIELD.y + FIELD.h / 2 - ball.y, FIELD.x - ball.x);
          aimAngle = lerpAngle(b.theta, goalAng, s);
        }
      }

      if (handleBallContact(b, wantKick, aimAngle) && wantKick) {
        if (isP1) {
          kickRequestT = 0;
          kickCooldown = 0.5;
        } else if (isP2) {
          kickRequestT2 = 0;
          kickCooldown2 = 0.5;
        } else {
          aiKickCooldownByIdx[i] = aiKickCooldown();
        }
      }
    }

    // ── publish (10Hz) ──
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(human.v / BASE_LIN, human.w));
      if (mode2P) {
        const h2 = bots[3];
        g.publish("/p2/cmd_vel", fmtTwist(h2.v / BASE_LIN, h2.w));
      }
      g.publish(
        "/ball/pose",
        `x=${ball.x.toFixed(1)} y=${ball.y.toFixed(1)} vx=${ball.vx.toFixed(1)} vy=${ball.vy.toFixed(1)}`,
      );
      g.publish("/soccer/score", `P:${scoreP} O:${scoreO}`);
    }
    g.ghost.recordPose(elapsed, human.x, human.y, human.theta);

    g.setStatus(
      t(mode2P ? "robo_soccer.status.match2p" : "robo_soccer.status.match", {
        p: scoreP,
        o: scoreO,
        target: TARGET_SCORE,
      }),
      "",
    );
    const kickStatus = (cd: number, rq: number, label: string) =>
      cd > 0 ? `cooldown ${cd.toFixed(2)}s` : rq > 0 ? "armed" : `ready (${label})`;
    const hudLines = [
      `mode:    ${mode2P ? "2-player vs (1 vs 1 + 2 AI each)" : "3 vs 3 soccer"}`,
      `score:   P-team ${scoreP} - ${scoreO} ${mode2P ? "P2-team" : "O-team"}   (first to ${TARGET_SCORE})`,
      `pose:${formatPose(human)}`,
      `cmd_vel:${formatTwist({ v: human.v, w: human.w }, { pxPerM: BASE_LIN })}`,
      `ball:    x=${ball.x.toFixed(0)}  y=${ball.y.toFixed(0)}  v=${Math.hypot(ball.vx, ball.vy).toFixed(0)} px/s`,
      `kick P1: ${kickStatus(kickCooldown, kickRequestT, "E / Space / pad A-X")}`,
    ];
    if (mode2P)
      hudLines.push(`kick P2: ${kickStatus(kickCooldown2, kickRequestT2, "Enter / pad-2 A-X")}`);
    g.setHud(hudLines);
  }

  function inGoalY(y: number): boolean {
    const postForgiveness = BALL_R * 0.35;
    return y > GOAL_Y - postForgiveness && y < GOAL_Y + GOAL_H + postForgiveness;
  }

  // -- AI: pick a target based on role and team --
  function aiStep(b: Bot, idx: number) {
    aiWantsKickByIdx[idx] = false;

    const isPlayerTeam = b.team === "P";
    const attackDir = isPlayerTeam ? 1 : -1; // P attacks right, O attacks left
    const ownGoalX = isPlayerTeam ? FIELD.x : FIELD.x + FIELD.w; // goal we defend
    const targetGoalX = isPlayerTeam ? FIELD.x + FIELD.w : FIELD.x;
    const cy = FIELD.y + FIELD.h / 2;
    const inOwnHalf = isPlayerTeam
      ? ball.x < FIELD.x + FIELD.w / 2
      : ball.x > FIELD.x + FIELD.w / 2;

    // Only the team-mate closest to the ball becomes "chaser"; others
    // hang back as support to avoid corner pile-ups.
    const myTeamMates = bots.filter((x) => x.team === b.team);
    let closest: Bot = b;
    let bestD = Infinity;
    for (const m of myTeamMates) {
      const d = Math.hypot(m.x - ball.x, m.y - ball.y);
      if (d < bestD) {
        bestD = d;
        closest = m;
      }
    }
    const isChaser = closest === b;

    let tx_: number,
      ty_: number,
      speedMul = 0.85;

    if (b.role === "defender") {
      // Defender: move in front of our goal; when danger is close, go direct.
      const distToOwnGoal = Math.abs(ball.x - ownGoalX);
      if (inOwnHalf && distToOwnGoal < FIELD.w * 0.3) {
        tx_ = ball.x;
        ty_ = ball.y;
        speedMul = 0.98;
      } else {
        tx_ = ownGoalX + attackDir * 90;
        ty_ = ball.y * 0.55 + cy * 0.45;
        speedMul = 0.66;
      }
    } else if (b.role === "mid") {
      // Midfielder: anchor around midline but more reactive for opponents.
      const myMidX = isPlayerTeam ? FIELD.x + FIELD.w * 0.42 : FIELD.x + FIELD.w * 0.58;
      const mix = b.team === "O" ? 0.62 : 0.55;
      tx_ = ball.x * mix + myMidX * (1 - mix);
      ty_ = ball.y * 0.5 + cy * 0.5;
      speedMul = b.team === "O" ? 0.88 : 0.78;
    } else {
      // Forward: chase only when designated chaser; otherwise camp the
      // opposing goal as a finisher.
      if (isChaser) {
        const dx = ball.x - b.x,
          dy = ball.y - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 50) {
          tx_ = ball.x - attackDir * 26;
          ty_ = ball.y;
        } else {
          tx_ = targetGoalX;
          ty_ = cy;
        }
        speedMul = b.team === "O" ? 1.02 : 0.95;
      } else {
        // A team-mate is chasing — set up in front of the opposing goal.
        tx_ = targetGoalX - attackDir * 100;
        ty_ = ball.y * 0.52 + cy * 0.48;
        speedMul = b.team === "O" ? 0.78 : 0.7;
      }
    }

    // Opponent team is a bit more aggressive.
    if (!isPlayerTeam) speedMul *= aiAggression();

    // ── Smart tactics (opponent only, scaled by difficulty) ─────────────
    // At skill 0 (easy) these are no-ops, so the target stays exactly the
    // old role-based one; at skill 1 (strong) they fully take over.
    const smart = b.team === "O" ? aiSkill() : 0;
    if (smart > 0) {
      if (isChaser) {
        // B1 + B2: aim for the point BEHIND the (predicted) ball on the line
        // to the target goal, so pushing forward drives the ball goalward
        // instead of the old "run at the ball and shove it any direction".
        const lead = smart * 0.16; // seconds of look-ahead
        const pbx = ball.x + ball.vx * lead;
        const pby = ball.y + ball.vy * lead;
        let vgx = pbx - targetGoalX,
          vgy = pby - cy; // goal → ball (behind dir)
        const gl = Math.hypot(vgx, vgy) || 1;
        vgx /= gl;
        vgy /= gl;
        const behindOff = ROBOT_R + BALL_R + 4;
        let smx = pbx + vgx * behindOff;
        let smy = pby + vgy * behindOff;
        // If we're on the goal side of the ball, curve around it rather than
        // plowing through and knocking it toward our own goal.
        const rbx = b.x - pbx,
          rby = b.y - pby;
        if (rbx * vgx + rby * vgy < 0) {
          const side = rbx * -vgy + rby * vgx >= 0 ? 1 : -1;
          smx += -vgy * side * ROBOT_R * 2.6;
          smy += vgx * side * ROBOT_R * 2.6;
        }
        tx_ = lerp(tx_, smx, smart);
        ty_ = lerp(ty_, smy, smart);
        speedMul = lerp(speedMul, Math.max(speedMul, 1.05), smart);
      } else if (b.role === "defender") {
        // B3: play goalkeeper — hold the goal line and track the ball's Y
        // within the mouth, closing off the "empty net".
        const keeperX = ownGoalX + attackDir * (ROBOT_R + 6);
        const keeperY = Math.max(GOAL_Y + 8, Math.min(GOAL_Y + GOAL_H - 8, ball.y));
        const keeperSkill = !mode2P && b.team === "O" ? smart * 0.48 : smart;
        tx_ = lerp(tx_, keeperX, keeperSkill);
        ty_ = lerp(ty_, keeperY, keeperSkill);
        speedMul = lerp(speedMul, 1.0, keeperSkill);
      }
    }

    // Keep the target inside the field bounds (avoid wall-pinning).
    tx_ = Math.max(FIELD.x + AI_SAFE_MARGIN, Math.min(FIELD.x + FIELD.w - AI_SAFE_MARGIN, tx_));
    ty_ = Math.max(FIELD.y + AI_SAFE_MARGIN, Math.min(FIELD.y + FIELD.h - AI_SAFE_MARGIN, ty_));

    const dx = tx_ - b.x,
      dy = ty_ - b.y;
    const desired = Math.atan2(dy, dx);
    let dAng = desired - b.theta;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    b.w = Math.max(-BASE_ANG, Math.min(BASE_ANG, dAng * 4));
    const align = Math.cos(dAng); // [-1..1]
    const distToTarget = Math.hypot(dx, dy);

    // Don't stop completely: nearby bots should still push the ball.
    const slowDiv = b.team === "O" ? 22 : 30;
    const slow = Math.min(1, distToTarget / slowDiv);

    // Signed velocity allows slight backward pressure instead of "spin and stop".
    const vRaw = align * BASE_LIN * speedMul * slow;
    const maxBack = -BASE_LIN * 0.35;
    const maxFwd = BASE_LIN * speedMul;
    b.v = Math.max(maxBack, Math.min(maxFwd, vRaw));

    // AI kick decision: only opponent team tries to kick (strong impulse),
    // only when close to the ball and aligned with scoring direction.
    if (b.team === "O" && isChaser) {
      const distToBall = Math.hypot(ball.x - b.x, ball.y - b.y);
      if (distToBall < aiKickDist() && aiKickCooldownByIdx[idx] <= 0) {
        const goalX = targetGoalX; // O scoring goal
        const goalY = cy;
        const goalAng = Math.atan2(goalY - ball.y, goalX - ball.x);
        let dd = goalAng - b.theta;
        while (dd > Math.PI) dd -= 2 * Math.PI;
        while (dd < -Math.PI) dd += 2 * Math.PI;
        if (Math.cos(dd) > aiKickAlignCos()) aiWantsKickByIdx[idx] = true;
      }
    }
  }

  function separateBodies(a: Body, c: Body) {
    const dx = c.x - a.x,
      dy = c.y - a.y;
    const d = Math.hypot(dx, dy);
    const minD = ROBOT_R * 2;
    if (d < minD && d > 0.0001) {
      const overlap = (minD - d) / 2;
      const ux = dx / d,
        uy = dy / d;
      a.x -= ux * overlap;
      a.y -= uy * overlap;
      c.x += ux * overlap;
      c.y += uy * overlap;
      clampInside(a);
      clampInside(c);
    }
  }

  /** Returns whether contact happened. Kick eligibility / kickRequestT
   *  consumption is handled by the caller. */
  function handleBallContact(b: Bot, doKick: boolean, aimAngle?: number): boolean {
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const d = Math.hypot(dx, dy);
    const minD = ROBOT_R + BALL_R;
    if (d > minD + (doKick ? KICK_REACH : 0) || d < 0.0001) return false;

    const ux = dx / d,
      uy = dy / d;
    ball.x = b.x + ux * minD;
    ball.y = b.y + uy * minD;
    const robotVx = b.v * Math.cos(b.theta);
    const robotVy = b.v * Math.sin(b.theta);
    const along = robotVx * ux + robotVy * uy;
    const push = Math.max(along * PUSH_FACTOR, b.v * 0.3);
    ball.vx += ux * push;
    ball.vy += uy * push;

    if (doKick) {
      // B4: AI kicks are steered toward the goal (aimAngle); the human's kick
      // still follows their own heading.
      const ang = aimAngle ?? b.theta;
      const fx = Math.cos(ang),
        fy = Math.sin(ang);
      ball.vx += fx * KICK_VEL;
      ball.vy += fy * KICK_VEL;
      particles.burst(ball.x, ball.y, "#fbbf24", 14, 240);
      g.sfx.deliver();
      g.shake(0.4);
    } else if (Math.abs(along) > 30) {
      g.sfx.bump();
    }
    return true;
  }

  function onGoal(scorer: "P" | "O") {
    if (scorer === "P") scoreP++;
    else scoreO++;
    lastScorer = scorer;
    goalFlash = 1.4;
    particles.burst(ball.x, ball.y, scorer === "P" ? "#7dd3fc" : "#fb7185", 36, 280);
    g.sfx.victory();
    g.shake(0.7);
    g.publish("/goal/scored", `team:${scorer} score:P${scoreP}-O${scoreO}`);

    if (scoreP >= TARGET_SCORE || scoreO >= TARGET_SCORE) {
      finishMatch();
    } else {
      placeKickoff();
      const scorerWasPlayer1 = scorer === "P";
      const scoreKey = scorerWasPlayer1
        ? "robo_soccer.status.you_score"
        : mode2P
          ? "robo_soccer.status.p2_score"
          : "robo_soccer.status.opp_score";
      g.setStatus(t(scoreKey), scorerWasPlayer1 ? "var(--ok)" : "var(--danger)");
    }
  }

  function finishMatch() {
    cleared = true;
    if (mode2P) {
      // Both sides have a human player — always show a friendly result panel.
      const winner = scoreP > scoreO ? "P1" : "P2";
      const margin = Math.abs(scoreP - scoreO);
      const stars = margin >= 3 ? 3 : margin === 2 ? 2 : 1;
      const stats =
        `Winner   <b>${winner} team</b><br>` +
        `Score    <b>${scoreP} - ${scoreO}</b><br>` +
        `Time     <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
      return;
    }
    if (scoreP > scoreO) {
      const margin = scoreP - scoreO;
      const stars = margin >= 3 ? 3 : margin === 2 ? 2 : 1;
      const stats =
        `Score    <b>${scoreP} - ${scoreO}</b><br>` + `Time     <b>${elapsed.toFixed(2)} s</b>`;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
    } else {
      g.crash(t("robo_soccer.crash.lost"));
    }
  }

  // ── DRAW ─────────────────────────────────────────────────────
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    drawPitch(c);
    drawGoal(c, FIELD.x - GOAL_W, GOAL_Y, "#7dd3fc", mode2P ? "P2 TARGET" : "DEFEND");
    drawGoal(c, FIELD.x + FIELD.w, GOAL_Y, "#fb7185", mode2P ? "P1 TARGET" : "TARGET");
    drawShotGuide(c, bots[0], "P1");
    if (mode2P) drawShotGuide(c, bots[3], "P2");

    particles.draw(c);
    drawBall(c);

    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const color = b.team === "P" ? "#7dd3fc" : "#fb7185";
      const isHuman = i === 0 || (mode2P && i === 3);
      const label = mode2P && i === 3 ? "P2" : b.label;
      drawRobot(c, b, color, label, isHuman);
    }

    drawScoreboard(c);

    if (goalFlash > 0) {
      c.save();
      c.globalAlpha = goalFlash * 0.55;
      c.fillStyle = lastScorer === "P" ? "#7dd3fc" : "#fb7185";
      c.fillRect(0, 0, W, H);
      c.restore();
      c.fillStyle = "#fff";
      c.textAlign = "center";
      c.font = "700 56px ui-monospace, monospace";
      c.fillText("GOAL!", W / 2, H / 2 + 20);
    }
    if (kickoffT > 0 && !cleared) {
      c.fillStyle = "rgba(255,255,255,0.85)";
      c.font = "700 44px ui-monospace, monospace";
      c.textAlign = "center";
      c.fillText("READY", W / 2, FIELD.y + FIELD.h / 2 - 20);
    }

    drawTimer(c, elapsed);
    drawHint(
      c,
      t(mode2P ? "robo_soccer.hint2p" : "robo_soccer.hint", {
        pads: twoPlayer.padCount(),
      }),
    );
  }

  function drawPitch(c: CanvasRenderingContext2D) {
    // Stadium shell and animated LED boards.
    const stadium = c.createLinearGradient(0, FIELD.y - 48, 0, FIELD.y + FIELD.h + 35);
    stadium.addColorStop(0, "#10243d");
    stadium.addColorStop(0.5, "#071521");
    stadium.addColorStop(1, "#10243d");
    c.fillStyle = stadium;
    c.fillRect(0, FIELD.y - 36, W, FIELD.h + 72);
    for (let x = 8; x < W; x += 22) {
      const teamColor = (Math.floor(x / 22) + Math.floor(elapsed * 3)) % 5 === 0;
      c.fillStyle = teamColor ? "#fbbf24" : x < W / 2 ? "#7dd3fc" : "#fb7185";
      c.globalAlpha = teamColor ? 0.8 : 0.34;
      c.fillRect(x, FIELD.y - 28, 10, 4);
      c.fillRect(W - x, FIELD.y + FIELD.h + 24, 10, 4);
    }
    c.globalAlpha = 1;

    const turf = c.createLinearGradient(FIELD.x, FIELD.y, FIELD.x + FIELD.w, FIELD.y);
    turf.addColorStop(0, "#12533c");
    turf.addColorStop(0.5, "#176447");
    turf.addColorStop(1, "#12533c");
    c.fillStyle = turf;
    c.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);

    c.fillStyle = "rgba(255,255,255,0.035)";
    const stripes = 12;
    for (let i = 0; i < stripes; i += 2) {
      c.fillRect(FIELD.x + (FIELD.w / stripes) * i, FIELD.y, FIELD.w / stripes, FIELD.h);
    }
    c.strokeStyle = "rgba(255,255,255,0.72)";
    c.lineWidth = 2;
    c.strokeRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);
    const cx = FIELD.x + FIELD.w / 2;
    c.beginPath();
    c.moveTo(cx, FIELD.y);
    c.lineTo(cx, FIELD.y + FIELD.h);
    c.stroke();
    c.beginPath();
    c.arc(cx, FIELD.y + FIELD.h / 2, 50, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(cx, FIELD.y + FIELD.h / 2, 3, 0, Math.PI * 2);
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.46)";
    const penaltyH = 220;
    const goalAreaH = GOAL_H + 34;
    c.strokeRect(FIELD.x, FIELD.y + (FIELD.h - penaltyH) / 2, 86, penaltyH);
    c.strokeRect(FIELD.x + FIELD.w - 86, FIELD.y + (FIELD.h - penaltyH) / 2, 86, penaltyH);
    c.strokeRect(FIELD.x, FIELD.y + (FIELD.h - goalAreaH) / 2, 36, goalAreaH);
    c.strokeRect(FIELD.x + FIELD.w - 36, FIELD.y + (FIELD.h - goalAreaH) / 2, 36, goalAreaH);

    c.fillStyle = "rgba(255,255,255,0.75)";
    c.beginPath();
    c.arc(FIELD.x + 62, FIELD.y + FIELD.h / 2, 2.5, 0, Math.PI * 2);
    c.arc(FIELD.x + FIELD.w - 62, FIELD.y + FIELD.h / 2, 2.5, 0, Math.PI * 2);
    c.fill();

    // Corner arcs.
    c.beginPath();
    c.arc(FIELD.x, FIELD.y, 13, 0, Math.PI / 2);
    c.moveTo(FIELD.x + FIELD.w - 13, FIELD.y);
    c.arc(FIELD.x + FIELD.w, FIELD.y, 13, Math.PI / 2, Math.PI);
    c.moveTo(FIELD.x + 13, FIELD.y + FIELD.h);
    c.arc(FIELD.x, FIELD.y + FIELD.h, 13, -Math.PI / 2, 0);
    c.moveTo(FIELD.x + FIELD.w, FIELD.y + FIELD.h - 13);
    c.arc(FIELD.x + FIELD.w, FIELD.y + FIELD.h, 13, Math.PI, Math.PI * 1.5);
    c.stroke();
  }

  function drawGoal(
    c: CanvasRenderingContext2D,
    gx: number,
    gy: number,
    color: string,
    label: string,
  ) {
    c.save();
    const left = gx < FIELD.x;
    const depth = 22;
    const backX = left ? gx - depth : gx + GOAL_W;
    const glow = 0.18 + (Math.sin(elapsed * 4) + 1) * 0.05;
    c.shadowColor = color;
    c.shadowBlur = label === "TARGET" || label === "P1 TARGET" ? 18 : 8;
    c.fillStyle = color;
    c.globalAlpha = glow;
    c.fillRect(left ? backX : gx, gy, GOAL_W + depth, GOAL_H);
    c.globalAlpha = 1;
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.strokeRect(gx, gy, GOAL_W, GOAL_H);
    c.lineWidth = 1;
    c.globalAlpha = 0.48;
    for (let i = 0; i <= 7; i++) {
      const yi = gy + (GOAL_H / 7) * i;
      c.beginPath();
      c.moveTo(left ? backX : gx, yi);
      c.lineTo(left ? gx + GOAL_W : gx + GOAL_W + depth, yi);
      c.stroke();
    }
    for (let i = 0; i <= 4; i++) {
      const xi = (left ? backX : gx) + ((GOAL_W + depth) / 4) * i;
      c.beginPath();
      c.moveTo(xi, gy);
      c.lineTo(xi, gy + GOAL_H);
      c.stroke();
    }
    c.shadowBlur = 0;
    c.globalAlpha = 0.9;
    c.fillStyle = color;
    c.font = "800 8px ui-monospace, monospace";
    c.textAlign = left ? "left" : "right";
    c.fillText(label, left ? FIELD.x + 8 : FIELD.x + FIELD.w - 8, gy - 8);
    c.restore();
  }

  function drawShotGuide(c: CanvasRenderingContext2D, bot: Bot, label: string) {
    const distance = Math.hypot(ball.x - bot.x, ball.y - bot.y);
    if (distance > 105 || kickoffT > 0) return;
    const targetX = bot.team === "P" ? FIELD.x + FIELD.w : FIELD.x;
    const targetY = GOAL_Y + GOAL_H / 2;
    const armed = bot.team === "P" ? kickRequestT > 0 : kickRequestT2 > 0;
    c.save();
    c.strokeStyle = armed ? "#fbbf24" : bot.team === "P" ? "#7dd3fc" : "#fb7185";
    c.fillStyle = c.strokeStyle;
    c.globalAlpha = armed ? 0.85 : 0.32;
    c.lineWidth = armed ? 2 : 1;
    c.setLineDash([6, 7]);
    c.beginPath();
    c.moveTo(ball.x, ball.y);
    c.lineTo(targetX, targetY);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(ball.x, ball.y, ROBOT_R + BALL_R + KICK_REACH, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 0.85;
    c.font = "800 8px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(armed ? `${label} SHOT LOCK` : "SHOT RANGE", ball.x, ball.y - 29);
    c.restore();
  }

  function drawBall(c: CanvasRenderingContext2D) {
    c.save();
    for (const point of ball.trail) {
      c.globalAlpha = Math.max(0, point.life / 0.24) * 0.42;
      c.fillStyle = "#fef3c7";
      c.beginPath();
      c.arc(point.x, point.y, BALL_R * (point.life / 0.24), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    c.save();
    c.translate(ball.x, ball.y);
    c.fillStyle = "rgba(0,0,0,0.4)";
    c.beginPath();
    c.arc(0, 2, BALL_R, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#fef3c7";
    c.strokeStyle = "rgba(0,0,0,0.6)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, 0, BALL_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const rot = elapsed * 4 + Math.atan2(ball.vy, ball.vx);
    c.fillStyle = "#0c1124";
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rot;
      c.beginPath();
      c.arc(Math.cos(a) * 4, Math.sin(a) * 4, 1.6, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }

  function drawRobot(
    c: CanvasRenderingContext2D,
    b: Bot,
    color: string,
    label: string,
    isHuman: boolean,
  ) {
    // Make RoboSoccer robots visually consistent with other stages by reusing
    // the shared pixel-art robot body.
    //
    // drawRobotBody() is designed around ROBOT_R≈16; this stage uses a
    // smaller ROBOT_R=13 for gameplay balance, so we scale the body only.
    const scale = ROBOT_R / 16;

    // Body (rotated with heading).
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.theta);
    c.save();
    c.scale(scale, scale);
    drawRobotBody(c, 0, elapsed);
    c.restore();
    c.restore();

    // Team ring (field-aligned marker for readability; doesn't rotate).
    c.save();
    c.strokeStyle = color;
    c.lineWidth = isHuman ? 2.5 : 1.8;
    c.beginPath();
    c.arc(b.x, b.y, ROBOT_R, 0, Math.PI * 2);
    c.stroke();
    c.restore();

    // Label (field-aligned, not rotated).
    c.save();
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.font = (isHuman ? "700 10px " : "700 8px ") + "ui-monospace, monospace";
    c.fillText(label, b.x, b.y - ROBOT_R - 4);

    // Role marker (defender = triangle, mid = bar, forward = none).
    if (!isHuman) {
      if (b.role === "defender") {
        c.beginPath();
        c.moveTo(b.x - 3, b.y + ROBOT_R + 6);
        c.lineTo(b.x + 3, b.y + ROBOT_R + 6);
        c.lineTo(b.x, b.y + ROBOT_R + 11);
        c.fill();
      } else if (b.role === "mid") {
        c.fillRect(b.x - 4, b.y + ROBOT_R + 7, 8, 2);
      }
    }
    c.restore();
  }

  function drawScoreboard(c: CanvasRenderingContext2D) {
    const sw = 240,
      sh = 44;
    const sx = (W - sw) / 2,
      sy = 12;
    c.save();
    c.fillStyle = withA(theme.scrim, 0.9);
    c.strokeStyle = "rgba(255,255,255,0.3)";
    c.lineWidth = 1;
    c.fillRect(sx, sy, sw, sh);
    c.strokeRect(sx, sy, sw, sh);
    c.fillStyle = "#7dd3fc";
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(mode2P ? "P1 TEAM" : "YOU TEAM", sx + 50, sy + 16);
    c.font = "700 24px ui-monospace, monospace";
    c.fillText(String(scoreP), sx + 50, sy + 38);
    c.fillStyle = "#fb7185";
    c.font = "700 11px ui-monospace, monospace";
    c.fillText(mode2P ? "P2 TEAM" : "AI TEAM", sx + sw - 50, sy + 16);
    c.font = "700 24px ui-monospace, monospace";
    c.fillText(String(scoreO), sx + sw - 50, sy + 38);
    c.fillStyle = "#9aa6c8";
    c.font = "700 10px ui-monospace, monospace";
    c.fillText("FIRST TO " + TARGET_SCORE, sx + sw / 2, sy + 18);
    c.font = "700 16px ui-monospace, monospace";
    c.fillStyle = "#eef2ff";
    c.fillText(`${scoreP} : ${scoreO}`, sx + sw / 2, sy + 38);
    c.restore();
  }

  return {
    id: "robo_soccer",
    name: "Robo Soccer",
    lesson: "",
    lessonCmd: "ros2 topic echo /ball/pose",
    ros2: {
      title: tx("Robo Soccer — multi-robot teleop", "Robo Soccer — multi-robot teleop"),
      summary:
        "プレイヤーは /cmd_vel でロボを動かし、味方 + 相手の AI 計 5 体は /ball/pose を subscribe して各自の役割 (forward / mid / defender) でボールを追う。" +
        "ROS2 の multi-robot 環境を最小構成で体験。",
      msgTypes: ["geometry_msgs/msg/Twist", "geometry_msgs/msg/Pose"],
      cli: ["ros2 topic list", "ros2 topic echo /ball/pose", "ros2 topic echo /soccer/score"],
      python: `# 各ロボが /ball/pose を subscribe して役割ごとの cmd_vel を計算する
class SoccerBot(Node):
    def __init__(self, name, role, attack_dir):
        super().__init__(name)
        self.role = role          # "forward" / "mid" / "defender"
        self.attack_dir = attack_dir
        self.create_subscription(Pose, "/ball/pose", self.cb, 10)
        self.pub = self.create_publisher(Twist, f"/{name}/cmd_vel", 10)
    def cb(self, ball):
        target = self.target_for_role(ball)
        ...`,
      realWorld: tx(
        "RoboCup などの実機ロボサッカーも似ている仕組み: 各ロボが共有 topic からボール位置を読み、自分の役割 (Forward / Defender / Goalie) に応じて cmd_vel を計算する。本ステージは最小単位の multi-robot 通信。",
        "Real RoboCup soccer follows the same recipe: each robot subscribes to the shared ball pose and computes its own cmd_vel based on its role (Forward / Defender / Goalie). This stage shows the minimum multi-robot setup.",
      ),
      state: {
        nodes: ["/player_node", "/ai_p2", "/ai_p3", "/ai_o1", "/ai_o2", "/ai_o3", "/ball_tracker"],
        topics: [
          {
            name: "/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/player_node"],
            sub: ["/robot"],
          },
          {
            name: "/ball/pose",
            type: "geometry_msgs/msg/Pose",
            pub: ["/ball_tracker"],
            sub: ["/player_node", "/ai_p2", "/ai_p3", "/ai_o1", "/ai_o2", "/ai_o3"],
          },
          { name: "/soccer/score", type: "std_msgs/msg/String", pub: ["/ball_tracker"] },
          { name: "/goal/scored", type: "std_msgs/msg/String", pub: ["/ball_tracker"] },
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
  mode: "game",
  order: 6,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="two robots fight for a ball, each pushing toward opposite goals">
  <!-- pitch -->
  <rect x="20" y="14" width="380" height="92" rx="6" fill="rgba(15,50,36,0.6)" stroke="rgba(255,255,255,0.45)" stroke-width="1.5"/>
  <line x1="210" y1="14" x2="210" y2="106" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
  <circle cx="210" cy="60" r="22" fill="none" stroke="rgba(255,255,255,0.35)" stroke-width="1"/>
  <circle cx="210" cy="60" r="2" fill="rgba(255,255,255,0.6)"/>
  <!-- left goal (AI defends) -->
  <rect x="14" y="44" width="8" height="32" fill="rgba(125,211,252,0.18)" stroke="#7dd3fc" stroke-width="1.5"/>
  <!-- right goal (player defends) -->
  <rect x="398" y="44" width="8" height="32" fill="rgba(251,113,133,0.18)" stroke="#fb7185" stroke-width="1.5"/>
  <!-- ball -->
  <circle cx="200" cy="60" r="6" fill="#fef3c7" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
  <circle cx="198" cy="59" r="1" fill="#0c1124"/>
  <circle cx="201" cy="62" r="1" fill="#0c1124"/>
  <!-- player robot (cyan) -->
  <circle cx="160" cy="60" r="11" fill="#0c1124" stroke="#7dd3fc" stroke-width="2.5"/>
  <polygon points="170,60 165,56 165,64" fill="#7dd3fc"/>
  <text x="160" y="38" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="10" font-weight="700">YOU</text>
  <!-- AI robot (pink), facing left -->
  <circle cx="270" cy="60" r="11" fill="#0c1124" stroke="#fb7185" stroke-width="2.5"/>
  <polygon points="260,60 265,56 265,64" fill="#fb7185"/>
  <text x="270" y="38" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="10" font-weight="700">AI</text>
  <!-- attack arrows -->
  <defs>
    <marker id="ld-soccer-arrow-p" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#7dd3fc"/>
    </marker>
    <marker id="ld-soccer-arrow-o" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#fb7185"/>
    </marker>
  </defs>
  <line x1="210" y1="98" x2="394" y2="98" stroke="#7dd3fc" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85" marker-end="url(#ld-soccer-arrow-p)"/>
  <text x="304" y="92" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9">YOU attack →</text>
  <line x1="210" y1="22" x2="26" y2="22" stroke="#fb7185" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85" marker-end="url(#ld-soccer-arrow-o)"/>
  <text x="118" y="32" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="9">← AI attack</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Robo Soccer — 3 vs 3 multi-robot",
      en: "Robo Soccer — 3 vs 3 multi-robot",
    },
    learn: {
      ja: "プレイヤーは /cmd_vel でロボを teleop し、味方と相手の AI 計 5 体は /ball/pose を subscribe して役割 (forward / mid / defender) ごとに動きます。共有 topic でボール位置を読み合い、各自の cmd_vel を独立に publish する multi-robot 通信の最小例です。",
      en: "You teleop your robot via /cmd_vel while five AI robots (your two teammates plus three opponents) all subscribe to /ball/pose and act per role (forward / mid / defender). They share one ball topic but publish their own cmd_vel — the minimum multi-robot ROS2 setup.",
    },
    goal: {
      ja: "WASD でロボを操縦、E・Space・PAD A/X でキック! 光るシュートレンジから相手 (右) のゴールを狙おう。\n先に 3 点取れば勝ち! 仲間ロボ 2 体も自動でサポートしてくれます。",
      en: "Drive with WASD and kick with E, Space, or pad A/X. Use the glowing shot range to aim at the right goal.\nFirst to 3 wins! Your two teammates help automatically.",
    },
    first: {
      ja: "1PはWASDで移動しE・Space・PAD A/Xでキック。Pad対戦はPadを2台接続してYを押します。キックは少し早めに押しても受付され、ゴール方向へ自然に補正されます。",
      en: "In 1P, move with WASD and kick with E, Space, or pad A/X. Connect two pads and press Y for versus mode. Kicks are buffered and gently assisted toward goal.",
    },
  },
  strings: {
    ja: {
      "crash.lost": "AI に先に取られて負け — リトライ",
      hint: "1P · WASD/左スティック 移動 · E/Space/PAD A-X キック · SHOT RANGEで照準 · Y → 2P",
      hint2p: "🎮 2P PAD（接続 {pads}/2）· P1/P2 左スティック · A/X キック · Y → 1P",
      "status.kickoff":
        "ボールを相手ゴールに押し込め — E でキック / 3 vs 3 で先に {target} 点で勝ち",
      "status.match": "YOU-team {p} - {o} AI-team  ·  先に {target} 点取った方の勝ち",
      "status.match2p": "P1-team {p} - {o} P2-team  ·  先に {target} 点取った方の勝ち",
      "status.opp_score": "AI に 1 点取られた — 反撃しよう",
      "status.p2_score": "P2 チームに 1 点取られた — 反撃しよう",
      "status.you_score": "GOAL! いいぞ — kickoff から再開",
      "overlay.title": "相手",
      "overlay.easy": "弱め",
      "overlay.normal": "ふつう",
      "overlay.hard": "強め",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD対戦",
    },
    en: {
      "crash.lost": "The AI scored first — retry",
      hint: "1P · WASD/LEFT STICK · E/Space/PAD A-X kick · aim in SHOT RANGE · Y → 2P",
      hint2p: "🎮 2P PAD ({pads}/2) · P1/P2 LEFT STICK · A/X kick · Y → 1P",
      "status.kickoff":
        "Push the ball into the opponent goal — E to kick / 3 vs 3, first to {target} wins",
      "status.match": "YOU-team {p} - {o} AI-team  ·  first to {target} wins",
      "status.match2p": "P1-team {p} - {o} P2-team  ·  first to {target} wins",
      "status.opp_score": "The AI just scored — fight back",
      "status.p2_score": "P2 team just scored — fight back",
      "status.you_score": "GOAL! Nice — kicking off again",
      "overlay.title": "Level",
      "overlay.easy": "Easy",
      "overlay.normal": "Normal",
      "overlay.hard": "Hard",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD BATTLE",
    },
  },
  build: makeRoboSoccer,
});
