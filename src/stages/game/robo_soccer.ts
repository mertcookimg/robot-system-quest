// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { stageColor } from "../../lib/stage_colors";
import { drawCanvasLabel } from "../../lib/canvas_text";

// robo_soccer: Robo Soccer (3 vs 3)
// 1 player + 2 friendly AI vs 3 opponent AI. Push the ball into the
// opposing goal to score.
// First to 3 wins. Multi-robot extension of the ROS 2 lesson: cmd_vel
// teleop + /ball/pose subscribe.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA, getTheme, themeColor } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawHint,
  drawTimer,
  fmtCanvasTwist,
  drawRobotBody,
  clearBackground,
} from "../../lib/draw";
import { rosAngularFromCanvas } from "../../lib/control_math";
import { Particles } from "../../lib/particles";
import { formatPose, formatTwist } from "../../lib/hud";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import { t, tx, onLangChange } from "../../i18n";
import * as twoPlayer from "../../lib/two_player";
import {
  SOCCER_CONTROL,
  canControlSoccerBall,
  dribbleSoccerBall,
  shootSoccerBall,
} from "../../lib/soccer_ball";
import { isStageInteractionBlocked } from "../../lib/input_guard";
import {
  chooseSoccerAction,
  soccerSupportTarget,
  type SoccerDecision,
} from "../../lib/soccer_tactics";

const ROBOT_R = 13;
const BALL_R = 9;
const BASE_LIN = 220;
const BASE_ANG = 3.2;
const KICK_VEL = SOCCER_CONTROL.kickSpeed;
const PUSH_FACTOR = 1.7; // push factor: robot → ball
const BALL_FRIC = 0.985; // ball friction per frame at 60fps
const BALL_BOUNCE = 0.7; // wall-bounce restitution
const TARGET_SCORE = 3;
const KICK_REQUEST_WINDOW = 0.7; // forgiving input buffer before ball contact
const KICK_REACH = SOCCER_CONTROL.kickReach - ROBOT_R - BALL_R;
const AI_KICK_COOLDOWN = 0.9; // seconds between AI "kicks"
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
  let dribbler = -1; // index of the robot currently carrying the ball
  let trapCooldown = 0; // let a shot leave the feet before it can be caught again

  // Both teams use the same pass/shoot decisions after controlling the ball.
  let aiKickCooldownByIdx: number[] = [];
  let aiActions: SoccerDecision[] = [];
  let aiPossessionT: number[] = [];
  let activePass: {
    from: number;
    to: number;
    x: number;
    y: number;
    fromX: number;
    fromY: number;
    life: number;
  } | null = null;

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
    dribbler = -1;
    trapCooldown = 0;
    ballStillT = 0;
    activePass = null;
    g.setHud([]);
    twoPlayer.resetEdges();

    aiKickCooldownByIdx = bots.map(() => 0);
    aiActions = bots.map(() => ({ kind: "dribble" }));
    aiPossessionT = bots.map(() => 0);
  }

  function aiKickCooldown(b: Bot): number {
    // Stronger AI kicks more frequently.
    return Math.max(0.25, Math.min(1.8, AI_KICK_COOLDOWN / (b.team === "O" ? aiStrength : 1)));
  }

  function aiAggression(): number {
    return Math.max(0.6, Math.min(1.9, AI_AGGRESSION * aiStrength));
  }

  /**
   * Tactical "skill" of the OPPONENT AI, 0..1, derived from the difficulty
   * preset: 0 at "weak" (0.75), ~0.42 at "normal" (1.0), 1 at "strong" (1.35).
   * Scales reaction time and goalkeeper position. Every difficulty uses
   * the same passing decisions, so even Easy plays as a team.
   */
  function aiSkill(): number {
    return Math.max(0, Math.min(1, (aiStrength - 0.75) / 0.6));
  }

  function isHuman(index: number): boolean {
    return index === 0 || (mode2P && index === 3);
  }

  function playerLabel(index: number): string {
    return mode2P && index === 3 ? "P2" : bots[index].label;
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
    (g.resetStage ?? reset)();
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
    const dx = input.moveX;
    const dy = input.moveY;
    if (dx === 0 && dy === 0) {
      b.v = 0;
      b.w = 0;
      return;
    }
    // Keep the stick's angle and magnitude for fine positioning. Close control
    // slows the player slightly so keyboard taps are easier to judge, too.
    b.theta = Math.atan2(dy, dx);
    const carrying = bots[dribbler] === b;
    b.v = BASE_LIN * Math.min(1, Math.hypot(dx, dy)) * (carrying ? SOCCER_CONTROL.carrySpeed : 1);
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
    trapCooldown = Math.max(0, trapCooldown - dt);
    const inputBlocked = isStageInteractionBlocked();
    if (inputBlocked) {
      kickRequestT = 0;
      kickRequestT2 = 0;
      if (isHuman(dribbler)) dribbler = -1;
    }
    if (kickoffT > 0) {
      kickoffT -= dt;
      return;
    }
    if (activePass) {
      activePass.life -= dt;
      if (activePass.life <= 0) activePass = null;
    }

    // Decrement AI kick cooldowns.
    for (let i = 0; i < aiKickCooldownByIdx.length; i++) {
      if (aiKickCooldownByIdx[i] > 0)
        aiKickCooldownByIdx[i] = Math.max(0, aiKickCooldownByIdx[i] - dt);
      aiPossessionT[i] = dribbler === i ? aiPossessionT[i] + dt : 0;
    }

    // ── P1 input (pad slot 0 OR WASD/E/Shift via two_player) ──
    const p1 = twoPlayer.pollP1({ arrowKeys: !mode2P });
    if (p1.action) kickRequestT = KICK_REQUEST_WINDOW;
    const human = bots[0];
    applyDirectHumanDrive(human, p1);

    // ── P2 input (only in 2P) — drives bots[3] ──
    if (mode2P) {
      const p2 = twoPlayer.pollP2();
      if (p2.action) kickRequestT2 = KICK_REQUEST_WINDOW;
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
        particles.burst(ball.x, ball.y, "#425570", 8, 80);
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

    // Trap slow balls automatically and keep them near the feet. Opponents
    // can still tackle; a fast shot cannot be caught by the proximity assist.
    if (trapCooldown <= 0) {
      if (
        dribbler >= 0 &&
        Math.hypot(ball.x - bots[dribbler].x, ball.y - bots[dribbler].y) > SOCCER_CONTROL.carryReach
      )
        dribbler = -1;
      if (dribbler < 0) {
        const candidates = bots
          .map((_, i) => i)
          .filter((i) => !(inputBlocked && isHuman(i)) && activePass?.from !== i);
        candidates.sort(
          (a, b) =>
            Math.hypot(ball.x - bots[a].x, ball.y - bots[a].y) -
            Math.hypot(ball.x - bots[b].x, ball.y - bots[b].y),
        );
        dribbler = candidates.find((i) => canControlSoccerBall(ball, bots[i])) ?? -1;
        if (dribbler >= 0) activePass = null;
      }
      if (dribbler >= 0) {
        const owner = bots[dribbler];
        const tackled = bots.some(
          (b, i) =>
            i !== dribbler &&
            b.team !== owner.team &&
            Math.hypot(ball.x - b.x, ball.y - b.y) < ROBOT_R + BALL_R + 5,
        );
        if (tackled) {
          dribbler = -1;
          trapCooldown = 0.18;
        } else {
          dribbleSoccerBall(ball, owner, dt);
          // Keep possession usable along the touchlines. Goal crossings are
          // left to the normal scoring check at the start of the next step.
          ball.y = Math.max(FIELD.y + BALL_R, Math.min(FIELD.y + FIELD.h - BALL_R, ball.y));
          if (!inGoalY(ball.y))
            ball.x = Math.max(FIELD.x + BALL_R, Math.min(FIELD.x + FIELD.w - BALL_R, ball.x));
        }
      }
    }

    // -- Ball vs all robots --
    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const isP1 = i === 0;
      const isP2 = mode2P && i === 3;
      let wantKick: boolean;
      if (isP1) wantKick = kickRequestT > 0 && kickCooldown <= 0;
      else if (isP2) wantKick = kickRequestT2 > 0 && kickCooldown2 <= 0;
      else
        wantKick = dribbler === i && aiActions[i].kind !== "dribble" && aiKickCooldownByIdx[i] <= 0;

      let aimAngle: number | undefined;
      const action = aiActions[i];
      if (!isP1 && !isP2) {
        const targetX =
          action.kind === "pass" ? action.x : b.team === "P" ? FIELD.x + FIELD.w : FIELD.x;
        const targetY = action.kind === "pass" ? action.y : FIELD.y + FIELD.h / 2;
        aimAngle = Math.atan2(targetY - ball.y, targetX - ball.x);
      }

      // Teammates leave a controlled ball to its owner, but an explicit human
      // shot takes priority when a nearby AI teammate has possession.
      if (
        dribbler >= 0 &&
        b.team === bots[dribbler].team &&
        i !== dribbler &&
        !((isP1 || isP2) && wantKick)
      )
        continue;
      if (i === dribbler && !wantKick) continue;
      const contact = handleBallContact(
        b,
        wantKick,
        aimAngle,
        isP1 || isP2,
        action.kind === "pass" ? action.speed : KICK_VEL,
      );
      if (contact && activePass && activePass.from !== i) activePass = null;
      if (contact && dribbler >= 0 && b.team !== bots[dribbler].team) {
        dribbler = -1;
        trapCooldown = 0.18;
      }
      if (contact && wantKick) {
        dribbler = -1;
        trapCooldown = 0.3;
        activePass = null;
        if (isP1) {
          kickRequestT = 0;
          kickCooldown = 0.5;
        } else if (isP2) {
          kickRequestT2 = 0;
          kickCooldown2 = 0.5;
        } else {
          aiKickCooldownByIdx[i] = aiKickCooldown(b);
          if (action.kind === "pass") {
            activePass = {
              from: i,
              to: action.receiver,
              x: action.x,
              y: action.y,
              fromX: ball.x,
              fromY: ball.y,
              life: 2.2,
            };
            trapCooldown = 0.12;
            g.publish(
              "/soccer/pass",
              `team:${b.team} from:${playerLabel(i)} to:${playerLabel(action.receiver)}`,
            );
          }
        }
      }
    }

    // ── publish (10Hz) ──
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtCanvasTwist(human.v / BASE_LIN, human.w));
      if (mode2P) {
        const h2 = bots[3];
        g.publish("/p2/cmd_vel", fmtCanvasTwist(h2.v / BASE_LIN, h2.w));
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
      `cmd_vel:${formatTwist({ v: human.v, w: rosAngularFromCanvas(human.w) }, { pxPerM: BASE_LIN })}`,
      `ball:    x=${ball.x.toFixed(0)}  y=${ball.y.toFixed(0)}  v=${Math.hypot(ball.vx, ball.vy).toFixed(0)} px/s`,
      `pass:    ${activePass ? `${playerLabel(activePass.from)} → ${playerLabel(activePass.to)}` : "none"}`,
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

  // The same team tactics drive friendly and opposing robots. Difficulty
  // changes opponents' pace and reaction time, not whether they can pass.
  function aiStep(b: Bot, idx: number) {
    aiActions[idx] = { kind: "dribble" };
    const attackDir = b.team === "P" ? 1 : -1;
    const ownGoalX = b.team === "P" ? FIELD.x : FIELD.x + FIELD.w;
    const targetGoalX = b.team === "P" ? FIELD.x + FIELD.w : FIELD.x;
    const cy = FIELD.y + FIELD.h / 2;
    const owner = dribbler >= 0 ? bots[dribbler] : undefined;
    const teamHasBall = owner?.team === b.team;
    const teamPass = activePass && bots[activePass.from].team === b.team ? activePass : null;

    // A stationary human far away should not prevent an AI from retrieving
    // a loose ball. Nearby or moving humans still have priority by distance.
    let chaser = -1;
    let closest = Infinity;
    for (let i = 0; i < bots.length; i++) {
      const teammate = bots[i];
      if (teammate.team !== b.team) continue;
      const distance = Math.hypot(teammate.x - ball.x, teammate.y - ball.y);
      if (isHuman(i) && teammate.v === 0 && distance > 90) continue;
      if (distance < closest) {
        closest = distance;
        chaser = i;
      }
    }

    let tx_: number;
    let ty_: number;
    let speedMul = 0.85;
    if (dribbler === idx) {
      tx_ = targetGoalX;
      ty_ = cy;
      speedMul = SOCCER_CONTROL.carrySpeed * 0.9;
      const reaction = b.team === "O" ? 0.42 - aiSkill() * 0.22 : 0.3;
      if (aiPossessionT[idx] >= reaction && aiKickCooldownByIdx[idx] <= 0)
        aiActions[idx] = chooseSoccerAction(ball, bots, idx, FIELD);
    } else if (teamPass?.to === idx) {
      // Meet the pass at its destination; do not chase behind the moving ball.
      tx_ = teamPass.x;
      ty_ = teamPass.y;
      speedMul = 1;
    } else if (teamHasBall || teamPass) {
      const carrier = owner ?? bots[teamPass!.to];
      const target = soccerSupportTarget(b, carrier, FIELD);
      tx_ = target.x;
      ty_ = target.y;
    } else if (chaser === idx) {
      const lead = 0.12;
      const predictedX = ball.x + ball.vx * lead;
      const predictedY = ball.y + ball.vy * lead;
      const goalAngle = Math.atan2(cy - predictedY, targetGoalX - predictedX);
      tx_ = predictedX - Math.cos(goalAngle) * 24;
      ty_ = predictedY - Math.sin(goalAngle) * 24;
      // Approach around the ball when standing on its goal side.
      if ((b.x - ball.x) * attackDir > 0 && Math.hypot(b.x - ball.x, b.y - ball.y) < 100)
        ty_ += (b.y < ball.y ? -1 : 1) * 38;
      speedMul = 0.96;
    } else if (b.role === "defender") {
      tx_ = ownGoalX + attackDir * (45 + (b.team === "O" ? (1 - aiSkill()) * 45 : 30));
      ty_ = Math.max(GOAL_Y + 12, Math.min(GOAL_Y + GOAL_H - 12, ball.y));
      speedMul = 0.72;
    } else {
      const target = soccerSupportTarget(b, ball, FIELD);
      tx_ = target.x;
      ty_ = target.y;
      // Keep the midfield connected to its own half when defending.
      if (owner && owner.team !== b.team) tx_ -= attackDir * 130;
    }
    if (b.team === "O") speedMul *= aiAggression();
    tx_ = Math.max(FIELD.x + AI_SAFE_MARGIN, Math.min(FIELD.x + FIELD.w - AI_SAFE_MARGIN, tx_));
    ty_ = Math.max(FIELD.y + AI_SAFE_MARGIN, Math.min(FIELD.y + FIELD.h - AI_SAFE_MARGIN, ty_));
    const dx = tx_ - b.x;
    const dy = ty_ - b.y;
    const desired = Math.atan2(dy, dx);
    const dAng = Math.atan2(Math.sin(desired - b.theta), Math.cos(desired - b.theta));
    b.w = Math.max(-BASE_ANG, Math.min(BASE_ANG, dAng * 4));
    const slow = Math.min(1, Math.hypot(dx, dy) / 30);
    b.v = Math.max(-BASE_LIN * 0.35, Math.cos(dAng) * BASE_LIN * speedMul * slow);
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
  function handleBallContact(
    b: Bot,
    doKick: boolean,
    aimAngle?: number,
    human = false,
    kickSpeed = KICK_VEL,
  ): boolean {
    const dx = ball.x - b.x;
    const dy = ball.y - b.y;
    const d = Math.hypot(dx, dy);
    const minD = ROBOT_R + BALL_R;
    if (d > minD + (doKick ? KICK_REACH : 0) || d < 0.0001) return false;

    const ux = dx / d,
      uy = dy / d;
    // Resolve overlap only; kicking from the reach ring must not teleport
    // the ball back toward the player.
    if (d < minD) {
      ball.x = b.x + ux * minD;
      ball.y = b.y + uy * minD;
    }
    const robotVx = b.v * Math.cos(b.theta);
    const robotVy = b.v * Math.sin(b.theta);
    const along = robotVx * ux + robotVy * uy;
    const push = Math.max(along * PUSH_FACTOR, b.v * 0.3);
    if (doKick) {
      if (human) {
        shootSoccerBall(ball, b.team === "P" ? FIELD.x + FIELD.w : FIELD.x, GOAL_Y + GOAL_H / 2);
      } else {
        const ang = aimAngle ?? b.theta;
        ball.vx = Math.cos(ang) * kickSpeed;
        ball.vy = Math.sin(ang) * kickSpeed;
      }
      const passing = !human && kickSpeed < KICK_VEL;
      particles.burst(
        ball.x,
        ball.y,
        passing ? (b.team === "P" ? "#075f93" : "#be2949") : "#925b00",
        passing ? 6 : 14,
        passing ? 100 : 240,
      );
      if (passing) g.sfx.bump();
      else {
        g.sfx.deliver();
        g.shake(0.4);
      }
    } else {
      ball.vx += ux * push;
      ball.vy += uy * push;
      if (Math.abs(along) > 30) g.sfx.bump();
    }
    return true;
  }

  function onGoal(scorer: "P" | "O") {
    if (scorer === "P") scoreP++;
    else scoreO++;
    lastScorer = scorer;
    goalFlash = 1.4;
    particles.burst(ball.x, ball.y, scorer === "P" ? "#075f93" : "#be2949", 36, 280);
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
        g.showClear(stars, stats, { record: false });
      }, 700);
      return;
    }
    if (scoreP > scoreO) {
      const margin = scoreP - scoreO;
      const stars = margin >= 3 ? 3 : margin === 2 ? 2 : 1;
      const stats =
        `Score    <b>${scoreP} - ${scoreO}</b><br>` + `Time     <b>${elapsed.toFixed(2)} s</b>`;
      const timeSeconds = elapsed;
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats, { timeSeconds });
      }, 700);
    } else {
      g.crash(t("robo_soccer.crash.lost", { target: TARGET_SCORE }));
    }
  }

  // ── DRAW ─────────────────────────────────────────────────────
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    drawPitch(c);
    drawGoal(c, FIELD.x - GOAL_W, GOAL_Y, "#075f93", mode2P ? "P2 TARGET" : "DEFEND");
    drawGoal(c, FIELD.x + FIELD.w, GOAL_Y, "#be2949", mode2P ? "P1 TARGET" : "TARGET");
    drawPassGuide(c);
    drawShotGuide(c, bots[0], "P1");
    if (mode2P) drawShotGuide(c, bots[3], "P2");

    particles.draw(c);
    drawBall(c);

    for (let i = 0; i < bots.length; i++) {
      const b = bots[i];
      const color = b.team === "P" ? "#075f93" : "#be2949";
      const isHuman = i === 0 || (mode2P && i === 3);
      const label = mode2P && i === 3 ? "P2" : b.label;
      drawRobot(c, b, color, label, isHuman);
    }

    drawScoreboard(c);

    if (goalFlash > 0) {
      c.save();
      c.globalAlpha = goalFlash * 0.55;
      c.fillStyle = stageColor(lastScorer === "P" ? "#075f93" : "#be2949");
      c.fillRect(0, 0, W, H);
      c.restore();
      c.fillStyle = stageColor("#fff");
      c.textAlign = "center";
      c.font = "700 56px ui-monospace, monospace";
      c.fillText("GOAL!", W / 2, H / 2 + 20);
    }
    if (kickoffT > 0 && !cleared) {
      c.fillStyle = stageColor("rgba(23,43,77,0.95)");
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
    stadium.addColorStop(0, stageColor("#dce8f5"));
    stadium.addColorStop(0.5, stageColor("#f1f6fb"));
    stadium.addColorStop(1, stageColor("#dce8f5"));
    c.fillStyle = stageColor(stadium);
    c.fillRect(0, FIELD.y - 36, W, FIELD.h + 72);
    for (let x = 8; x < W; x += 22) {
      const teamColor = (Math.floor(x / 22) + Math.floor(elapsed * 3)) % 5 === 0;
      c.fillStyle = stageColor(teamColor ? "#925b00" : x < W / 2 ? "#075f93" : "#be2949");
      c.globalAlpha = teamColor ? 0.8 : 0.34;
      c.fillRect(x, FIELD.y - 28, 10, 4);
      c.fillRect(W - x, FIELD.y + FIELD.h + 24, 10, 4);
    }
    c.globalAlpha = 1;

    const turf = c.createLinearGradient(FIELD.x, FIELD.y, FIELD.x + FIELD.w, FIELD.y);
    turf.addColorStop(0, stageColor("#cfebdb"));
    turf.addColorStop(0.5, stageColor("#def1e5"));
    turf.addColorStop(1, stageColor("#cfebdb"));
    c.fillStyle = stageColor(turf);
    c.fillRect(FIELD.x, FIELD.y, FIELD.w, FIELD.h);

    c.fillStyle = stageColor("rgba(255,255,255,0.035)");
    const stripes = 12;
    for (let i = 0; i < stripes; i += 2) {
      c.fillRect(FIELD.x + (FIELD.w / stripes) * i, FIELD.y, FIELD.w / stripes, FIELD.h);
    }
    c.strokeStyle = stageColor("rgba(47,107,82,0.8)");
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
    c.fillStyle = stageColor("rgba(47,107,82,0.7)");
    c.fill();
    c.strokeStyle = stageColor("rgba(47,107,82,0.65)");
    const penaltyH = 220;
    const goalAreaH = GOAL_H + 34;
    c.strokeRect(FIELD.x, FIELD.y + (FIELD.h - penaltyH) / 2, 86, penaltyH);
    c.strokeRect(FIELD.x + FIELD.w - 86, FIELD.y + (FIELD.h - penaltyH) / 2, 86, penaltyH);
    c.strokeRect(FIELD.x, FIELD.y + (FIELD.h - goalAreaH) / 2, 36, goalAreaH);
    c.strokeRect(FIELD.x + FIELD.w - 36, FIELD.y + (FIELD.h - goalAreaH) / 2, 36, goalAreaH);

    c.fillStyle = stageColor("rgba(47,107,82,0.8)");
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
    c.shadowColor = stageColor(color);
    c.shadowBlur = label === "TARGET" || label === "P1 TARGET" ? 18 : 8;
    c.fillStyle = stageColor(color);
    c.globalAlpha = glow;
    c.fillRect(left ? backX : gx, gy, GOAL_W + depth, GOAL_H);
    c.globalAlpha = 1;
    c.strokeStyle = stageColor(color);
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
    c.fillStyle = stageColor(color);
    c.font = "800 8px ui-monospace, monospace";
    c.textAlign = left ? "left" : "right";
    c.fillText(label, left ? FIELD.x + 8 : FIELD.x + FIELD.w - 8, gy - 8);
    c.restore();
  }

  function drawPassGuide(c: CanvasRenderingContext2D) {
    if (!activePass) return;
    c.save();
    c.strokeStyle = stageColor(bots[activePass.from].team === "P" ? "#075f93" : "#be2949");
    c.fillStyle = c.strokeStyle;
    c.lineWidth = 2;
    c.globalAlpha = 0.8;
    c.setLineDash([5, 5]);
    c.beginPath();
    c.moveTo(activePass.fromX, activePass.fromY);
    c.lineTo(activePass.x, activePass.y);
    c.stroke();
    c.setLineDash([]);
    c.beginPath();
    c.arc(activePass.x, activePass.y, ROBOT_R + 8, 0, Math.PI * 2);
    c.stroke();
    c.font = "700 10px ui-monospace, monospace";
    c.textAlign = "center";
    drawCanvasLabel(
      c,
      t("robo_soccer.pass.target", { player: playerLabel(activePass.to) }),
      activePass.x,
      activePass.y - 29,
      { bounds: FIELD },
    );
    c.restore();
  }

  function drawShotGuide(c: CanvasRenderingContext2D, bot: Bot, label: string) {
    const distance = Math.hypot(ball.x - bot.x, ball.y - bot.y);
    if (distance > 105 || kickoffT > 0) return;
    const targetX = bot.team === "P" ? FIELD.x + FIELD.w : FIELD.x;
    const targetY = GOAL_Y + GOAL_H / 2;
    const armed = bot.team === "P" ? kickRequestT > 0 : kickRequestT2 > 0;
    const cooldown = bot.team === "P" ? kickCooldown : kickCooldown2;
    const inReach = distance <= SOCCER_CONTROL.kickReach;
    const carrying = bots[dribbler] === bot;
    c.save();
    c.strokeStyle = stageColor(armed ? "#925b00" : bot.team === "P" ? "#075f93" : "#be2949");
    c.fillStyle = stageColor(c.strokeStyle);
    c.globalAlpha = getTheme() === "light" ? (armed ? 1 : 0.8) : armed ? 0.85 : 0.32;
    c.lineWidth = inReach && cooldown <= 0 ? 2.5 : 1;
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
    c.font = "800 10px ui-monospace, monospace";
    c.textAlign = "center";
    const guideKey =
      cooldown > 0 ? "wait" : armed ? "armed" : carrying ? "carry" : inReach ? "ready" : "approach";
    drawCanvasLabel(
      c,
      `${label} ${t(`robo_soccer.shot.${guideKey}`)}`,
      ball.x,
      ball.y - SOCCER_CONTROL.kickReach - 10,
      { bounds: FIELD },
    );
    c.restore();
  }

  function drawBall(c: CanvasRenderingContext2D) {
    c.save();
    for (const point of ball.trail) {
      c.globalAlpha = Math.max(0, point.life / 0.24) * 0.42;
      c.fillStyle = themeColor("#925b00", "#fef3c7");
      c.beginPath();
      c.arc(point.x, point.y, BALL_R * (point.life / 0.24), 0, Math.PI * 2);
      c.fill();
    }
    c.restore();

    c.save();
    c.translate(ball.x, ball.y);
    c.fillStyle = stageColor("rgba(0,0,0,0.4)");
    c.beginPath();
    c.arc(0, 2, BALL_R, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = stageColor("#fef3c7");
    c.strokeStyle = stageColor("rgba(0,0,0,0.6)");
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(0, 0, BALL_R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const rot = elapsed * 4 + Math.atan2(ball.vy, ball.vx);
    c.fillStyle = "#172b4d";
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
    c.strokeStyle = stageColor(color);
    c.lineWidth = isHuman ? 2.5 : 1.8;
    c.beginPath();
    c.arc(b.x, b.y, ROBOT_R, 0, Math.PI * 2);
    c.stroke();
    c.restore();

    // Label (field-aligned, not rotated).
    c.save();
    c.fillStyle = stageColor(color);
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    c.font = (isHuman ? "700 10px " : "700 8px ") + "ui-monospace, monospace";
    drawCanvasLabel(c, label, b.x, b.y - ROBOT_R - 4, { bounds: FIELD });

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
    c.strokeStyle = stageColor("rgba(88,106,130,0.5)");
    c.lineWidth = 1;
    c.fillRect(sx, sy, sw, sh);
    c.strokeRect(sx, sy, sw, sh);
    c.fillStyle = stageColor("#075f93");
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(mode2P ? "P1 TEAM" : "YOU TEAM", sx + 50, sy + 16);
    c.font = "700 24px ui-monospace, monospace";
    c.fillText(String(scoreP), sx + 50, sy + 38);
    c.fillStyle = stageColor("#be2949");
    c.font = "700 11px ui-monospace, monospace";
    c.fillText(mode2P ? "P2 TEAM" : "AI TEAM", sx + sw - 50, sy + 16);
    c.font = "700 24px ui-monospace, monospace";
    c.fillText(String(scoreO), sx + sw - 50, sy + 38);
    c.fillStyle = stageColor("#425570");
    c.font = "700 10px ui-monospace, monospace";
    c.fillText("FIRST TO " + TARGET_SCORE, sx + sw / 2, sy + 18);
    c.font = "700 16px ui-monospace, monospace";
    c.fillStyle = theme.fg;
    c.fillText(`${scoreP} : ${scoreO}`, sx + sw / 2, sy + 38);
    c.restore();
  }

  return {
    id: "robo_soccer",
    name: "Robo Soccer",
    lesson: "",
    lessonCmd: "ros2 topic echo /ball/pose",
    ros2: {
      title: tx("Robo Soccer — マルチロボット遠隔操作", "Robo Soccer — multi-robot teleop"),
      summary:
        "プレイヤーは/cmd_velでロボットを動かします。味方と相手の計5体の自動制御ロボットは/ball/poseをsubscribeし、それぞれの役割（forward / mid / defender）に応じてボールを追います。" +
        "ROS 2のマルチロボット環境を単純化した構成で体験できます。",
      msgTypes: ["geometry_msgs/msg/Twist", "geometry_msgs/msg/Pose", "std_msgs/msg/String"],
      cli: [
        "ros2 topic list",
        "ros2 topic echo /ball/pose",
        "ros2 topic echo /soccer/score",
        "ros2 topic echo /soccer/pass",
      ],
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
        "RoboCupなどの実機ロボットサッカーでも、各ロボットが共有Topicからボール位置を取得し、自分の役割（Forward / Defender / Goalie）に応じてcmd_velを計算する構成が使われます。このステージは、そのようなマルチロボット通信を単純化したものです。",
        "Real RoboCup soccer follows the same recipe: each robot subscribes to the shared ball pose and computes its own cmd_vel based on its role (Forward / Defender / Goalie). This stage shows the minimum multi-robot setup.",
      ),
      state: {
        get nodes() {
          return [
            "/player_node",
            "/robot",
            "/ai_p2",
            "/ai_p3",
            ...(mode2P ? ["/player2_node", "/p2_robot"] : ["/ai_o1"]),
            "/ai_o2",
            "/ai_o3",
            "/ball_tracker",
          ];
        },
        get topics() {
          return [
            {
              name: "/cmd_vel",
              type: "geometry_msgs/msg/Twist",
              pub: ["/player_node"],
              sub: ["/robot"],
            },
            ...(mode2P
              ? [
                  {
                    name: "/p2/cmd_vel",
                    type: "geometry_msgs/msg/Twist",
                    pub: ["/player2_node"],
                    sub: ["/p2_robot"],
                  },
                ]
              : []),
            {
              name: "/ball/pose",
              type: "geometry_msgs/msg/Pose",
              pub: ["/ball_tracker"],
              sub: [
                "/player_node",
                "/ai_p2",
                "/ai_p3",
                ...(mode2P ? ["/player2_node"] : ["/ai_o1"]),
                "/ai_o2",
                "/ai_o3",
              ],
            },
            { name: "/soccer/score", type: "std_msgs/msg/String", pub: ["/ball_tracker"] },
            { name: "/soccer/pass", type: "std_msgs/msg/String", pub: ["/ball_tracker"] },
            { name: "/goal/scored", type: "std_msgs/msg/String", pub: ["/ball_tracker"] },
          ];
        },
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
  <rect x="20" y="14" width="380" height="92" rx="6" fill="light-dark(rgba(207,235,219,0.8), rgba(18, 83, 60, 0.8))" stroke="light-dark(rgba(47,107,82,0.75), rgba(220, 239, 229, 0.75))" stroke-width="1.5"/>
  <line x1="210" y1="14" x2="210" y2="106" stroke="light-dark(rgba(47,107,82,0.65), rgba(220, 239, 229, 0.65))" stroke-width="1"/>
  <circle cx="210" cy="60" r="22" fill="none" stroke="light-dark(rgba(47,107,82,0.65), rgba(220, 239, 229, 0.65))" stroke-width="1"/>
  <circle cx="210" cy="60" r="2" fill="light-dark(rgba(47,107,82,0.7), rgba(220, 239, 229, 0.7))"/>
  <!-- left goal (AI defends) -->
  <rect x="14" y="44" width="8" height="32" fill="light-dark(rgba(7, 95, 147,0.18), rgba(125, 211, 252, 0.18))" stroke="light-dark(#075f93, #7dd3fc)" stroke-width="1.5"/>
  <!-- right goal (player defends) -->
  <rect x="398" y="44" width="8" height="32" fill="light-dark(rgba(190, 41, 73,0.18), rgba(253, 164, 175, 0.18))" stroke="light-dark(#be2949, #fda4af)" stroke-width="1.5"/>
  <!-- ball -->
  <circle cx="200" cy="60" r="6" fill="#fef3c7" stroke="rgba(0,0,0,0.6)" stroke-width="1"/>
  <circle cx="198" cy="59" r="1" fill="light-dark(#172b4d, #edf3ff)"/>
  <circle cx="201" cy="62" r="1" fill="light-dark(#172b4d, #edf3ff)"/>
  <!-- player robot (cyan) -->
  <circle cx="160" cy="60" r="11" fill="light-dark(#f1f5fb, #131f35)" stroke="light-dark(#075f93, #7dd3fc)" stroke-width="2.5"/>
  <polygon points="170,60 165,56 165,64" fill="light-dark(#075f93, #7dd3fc)"/>
  <text x="160" y="38" text-anchor="middle" fill="light-dark(#075f93, #7dd3fc)" font-family="ui-monospace, monospace" font-size="10" font-weight="700">YOU</text>
  <!-- AI robot (pink), facing left -->
  <circle cx="270" cy="60" r="11" fill="light-dark(#f1f5fb, #131f35)" stroke="light-dark(#be2949, #fda4af)" stroke-width="2.5"/>
  <polygon points="260,60 265,56 265,64" fill="light-dark(#be2949, #fda4af)"/>
  <text x="270" y="38" text-anchor="middle" fill="light-dark(#be2949, #fda4af)" font-family="ui-monospace, monospace" font-size="10" font-weight="700">AI</text>
  <!-- attack arrows -->
  <defs>
    <marker id="ld-soccer-arrow-p" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="light-dark(#075f93, #7dd3fc)"/>
    </marker>
    <marker id="ld-soccer-arrow-o" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="light-dark(#be2949, #fda4af)"/>
    </marker>
  </defs>
  <line x1="210" y1="98" x2="394" y2="98" stroke="light-dark(#075f93, #7dd3fc)" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85" marker-end="url(#ld-soccer-arrow-p)"/>
  <text x="304" y="92" text-anchor="middle" fill="light-dark(#075f93, #7dd3fc)" font-family="ui-monospace, monospace" font-size="9">YOU attack →</text>
  <line x1="210" y1="22" x2="26" y2="22" stroke="light-dark(#be2949, #fda4af)" stroke-width="1.5" stroke-dasharray="3 2" opacity="0.85" marker-end="url(#ld-soccer-arrow-o)"/>
  <text x="118" y="32" text-anchor="middle" fill="light-dark(#be2949, #fda4af)" font-family="ui-monospace, monospace" font-size="9">← AI attack</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Robo Soccer — 3対3のマルチロボット対戦",
      en: "Robo Soccer — 3 vs 3 multi-robot",
    },
    learn: {
      ja: "プレイヤーは/cmd_velでロボットを遠隔操作します。味方と相手の計5体の自動制御ロボットは/ball/poseをsubscribeし、役割（forward / mid / defender）に応じて動きます。共有Topicからボール位置を取得し、それぞれがcmd_velを独立してpublishする、マルチロボット通信の基本例です。",
      en: "You teleoperate your robot via /cmd_vel while five rule-based robots (your two teammates and three opponents) subscribe to /ball/pose and act according to their roles (forward, midfielder, or defender). They share one ball topic but independently publish their own cmd_vel commands, illustrating a basic multi-robot ROS 2 setup.",
    },
    goal: {
      ja: "WASD・矢印キー・左スティックで移動します。近くのボールは自動で足元に収まり、そのままドリブルできます。E・Space・ゲームパッドのA/Xで右のゴールへシュート。押しっぱなしで近づいても蹴れます。\n先に3点取れば勝ちです。2体の仲間ロボットも自動でサポートします。",
      en: "Move with WASD, arrows, or the left stick. Nearby slow balls stay at your feet for easy dribbling. Press E, Space, or pad A/X to shoot at the right goal; holding the button while approaching works too.\nFirst to 3 wins! Both teams pass to open teammates and shoot near goal. Dashed lines and a receiver marker show each pass destination.",
    },
    first: {
      ja: "移動キーを離すと止まり、ドリブル中のボールも足元に止まります。スティックは浅く倒すとゆっくり移動できます。シュートはロボットの向きに関係なく、表示された線に沿って相手ゴールへ飛びます。タッチ操作は移動パッドと「キック」を使います。2キー・PAD Y・対戦モードボタンで2Pに切り替えると、P1はWASD＋E/Space、P2は矢印＋Enter。各ゲームパッドは左スティック＋A/Xです。",
      en: "Release movement to stop with the ball at your feet. Tilt the stick gently for slower movement. Shots follow the displayed line toward the opposing goal regardless of your heading. Touch players use the movement pad and KICK. Switch to 2P with 2, pad Y, or the match-mode buttons: P1 uses WASD + E/Space; P2 uses arrows + Enter. Each gamepad uses the left stick + A/X.",
    },
  },
  strings: {
    ja: {
      "crash.lost": "AIチームが先に{target}点に到達 — リトライ",
      hint: "WASD/矢印/左スティックで移動・自動ドリブル · E/Space/PAD A-Xでゴールへシュート（長押しOK） · 2/PAD Y → 2P",
      hint2p:
        "P1: WASD＋E/Space · P2: 矢印＋Enter · PAD: 左スティック＋A/X · 自動ドリブル・シュート長押しOK · 2/PAD Y → 1P",
      "status.kickoff":
        "近づくと自動ドリブル · E/Space/PAD A-X 長押しでシュート · 先に {target} 点で勝ち",
      "shot.wait": "準備中",
      "shot.armed": "シュート予約",
      "shot.carry": "ドリブル中 · キックでシュート",
      "shot.ready": "シュートできる！",
      "shot.approach": "ボールに近づこう",
      "pass.target": "パス → {player}",
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
      "overlay.2p": "2P 対戦",
    },
    en: {
      "crash.lost": "The AI team reached {target} goals first — retry",
      hint: "WASD/arrows/stick: move + auto-dribble · Hold E/Space/PAD A-X: shoot at goal · 2/PAD Y → 2P",
      hint2p:
        "P1: WASD + E/Space · P2: arrows + Enter · PAD: stick + A/X · Auto-dribble; hold to shoot · 2/PAD Y → 1P",
      "status.kickoff":
        "Approach to dribble · Hold E/Space/PAD A-X to shoot · First to {target} wins",
      "shot.wait": "RECOVERING",
      "shot.armed": "SHOT QUEUED",
      "shot.carry": "DRIBBLING · KICK TO SHOOT",
      "shot.ready": "READY TO SHOOT",
      "shot.approach": "APPROACH THE BALL",
      "pass.target": "PASS → {player}",
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
      "overlay.2p": "2P versus",
    },
  },
  build: makeRoboSoccer,
});
