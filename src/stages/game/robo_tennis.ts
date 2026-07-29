// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// robo_tennis: one-player tennis against AI or local two-player tennis.
// The ball has height, gravity, bounces and net collisions; the tracker
// publishes its 3D pose while the player moves and times racket swings.
import { H, W, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { onLangChange, t, tx } from "../../i18n";
import { clearBackground, drawHint, drawRobotBody } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import * as twoPlayer from "../../lib/two_player";
import {
  advanceTennisScore,
  isInsideDiagonalServiceBox,
  isInsideSingles,
  resolveTennisBallExit,
  tennisPointDisplay,
} from "../../lib/tennis_rules";

const COURT = { x: 48, y: 104, w: 704, h: 286 };
const NET_X = COURT.x + COURT.w / 2;
const SINGLES_INSET = 30;
const SERVICE_DEPTH = 142;
const NET_H = 48;
const MOVE_SPEED = 205;
const TARGET_GAMES = 2;
const GRAVITY = 540;
const SWING_WINDOW = 0.24;

type Side = "player" | "ai";
type Phase = "ready" | "rally" | "point" | "finished";

interface Robot {
  x: number;
  y: number;
  swing: number;
  hitCooldown: number;
}

interface TennisBall {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bounces: number;
  bounceSide: Side;
  lastHitter: Side;
  trail: Array<{ x: number; y: number; z: number }>;
}

export function makeRoboTennis(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  const player: Robot = { x: 132, y: 247, swing: 0, hitCooldown: 0 };
  const ai: Robot = { x: 668, y: 247, swing: 0, hitCooldown: 0 };
  const ball: TennisBall = {
    x: player.x + 28,
    y: player.y,
    z: 28,
    vx: 0,
    vy: 0,
    vz: 0,
    bounces: 0,
    bounceSide: "player",
    lastHitter: "player",
    trail: [],
  };

  let phase: Phase = "ready";
  let phaseTimer = 0;
  let scorePlayer = 0;
  let scoreAi = 0;
  let pointsPlayer = 0;
  let pointsAi = 0;
  let pointsPlayedInGame = 0;
  let serveAttempt = 0;
  let serveActive = false;
  let serveFromTop = false;
  let serveTargetY = COURT.y + COURT.h / 2 - 55;
  let rallyHits = 0;
  let bestRally = 0;
  let elapsed = 0;
  let animTime = 0;
  let lastBoostP1 = false;
  let lastBoostP2 = false;
  let pointText = "";
  let pointWinner: Side | null = null;
  let pubAcc = 0;
  let mode2P = false;
  let overlayPanel: OverlayPanelHandle | null = null;
  let disposeLangSync: (() => void) | null = null;
  let pointerActionPending = false;
  let onPointerMove: ((event: PointerEvent) => void) | null = null;
  let onPointerDown: ((event: PointerEvent) => void) | null = null;

  function reset(): void {
    player.x = 132;
    player.y = 247;
    player.swing = 0;
    player.hitCooldown = 0;
    ai.x = 668;
    ai.y = 247;
    ai.swing = 0;
    ai.hitCooldown = 0;
    scorePlayer = 0;
    scoreAi = 0;
    pointsPlayer = 0;
    pointsAi = 0;
    pointsPlayedInGame = 0;
    serveAttempt = 0;
    serveActive = false;
    serveFromTop = false;
    serveTargetY = COURT.y + COURT.h / 2 - 55;
    rallyHits = 0;
    bestRally = 0;
    elapsed = 0;
    animTime = 0;
    lastBoostP1 = false;
    lastBoostP2 = false;
    pointText = "";
    pointWinner = null;
    pubAcc = 0;
    pointerActionPending = false;
    particles.reset();
    phase = "ready";
    phaseTimer = 0.9;
    prepareServe();
    twoPlayer.resetEdges();
    g.ghost.startRecording();
    g.setStatus(t("robo_tennis.status.ready"), "");
  }

  function init(ctx: GameContext): void {
    g = ctx;
    overlayPanel?.dispose();
    disposeLangSync?.();
    overlayPanel = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("robo_tennis.overlay.players"),
          choices: [
            { key: "1p", label: () => t("robo_tennis.overlay.1p") },
            { key: "2p", label: () => t("robo_tennis.overlay.2p") },
          ],
          active: () => (mode2P ? "2p" : "1p"),
          onSelect: (key) => setMode2P(key === "2p"),
        },
      ],
      { placement: "dock" },
    );
    disposeLangSync = onLangChange(() => overlayPanel?.refresh());
    twoPlayer.installToggleListener();
    twoPlayer.setActive(true);
    const movePlayerToPointer = (event: PointerEvent): void => {
      if (phase === "ready" && servingSide() === "player") return;
      const rect = g.canvas.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * W;
      const y = ((event.clientY - rect.top) / rect.height) * H;
      player.x = Math.max(COURT.x + 28, Math.min(NET_X - 42, x));
      player.y = Math.max(COURT.y + 24, Math.min(COURT.y + COURT.h - 24, y));
    };
    onPointerMove = (event) => {
      if (event.pointerType === "mouse") movePlayerToPointer(event);
    };
    onPointerDown = (event) => {
      event.preventDefault();
      movePlayerToPointer(event);
      pointerActionPending = true;
    };
    g.canvas.addEventListener("pointermove", onPointerMove);
    g.canvas.addEventListener("pointerdown", onPointerDown);
    reset();
  }

  function setMode2P(active: boolean): void {
    if (mode2P === active) return;
    mode2P = active;
    overlayPanel?.refresh();
    g.sfx.click();
    reset();
  }

  function prepareServe(secondServe = false): void {
    const side = servingSide();
    const server = side === "player" ? player : ai;
    if (!secondServe) serveAttempt = 0;
    serveActive = false;
    serveFromTop = side === "player" ? pointsPlayedInGame % 2 === 1 : pointsPlayedInGame % 2 === 0;
    serveTargetY = COURT.y + COURT.h / 2 + (serveFromTop ? 55 : -55);
    server.x = side === "player" ? COURT.x + 64 : COURT.x + COURT.w - 64;
    server.y = COURT.y + COURT.h / 2 + (serveFromTop ? -70 : 70);
    const dir = side === "player" ? 1 : -1;
    ball.x = server.x + dir * 28;
    ball.y = server.y;
    ball.z = 28;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.bounces = 0;
    ball.bounceSide = servingSide() === "player" ? "ai" : "player";
    ball.lastHitter = servingSide();
    ball.trail.length = 0;
    rallyHits = 0;
  }

  function servingSide(): Side {
    return (scorePlayer + scoreAi) % 2 === 0 ? "player" : "ai";
  }

  function serve(side: Side): void {
    if (phase !== "ready" || side !== servingSide()) return;
    phase = "rally";
    const server = side === "player" ? player : ai;
    const dir = side === "player" ? 1 : -1;
    ball.x = server.x + dir * 30;
    ball.y = server.y;
    ball.z = 42;
    ball.vz = 190;
    const flightTime = (ball.vz + Math.sqrt(ball.vz * ball.vz + 2 * GRAVITY * ball.z)) / GRAVITY;
    const targetX = NET_X + dir * SERVICE_DEPTH * 0.6;
    ball.vx = (targetX - ball.x) / flightTime;
    ball.vy = (serveTargetY - ball.y) / flightTime;
    ball.lastHitter = side;
    ball.bounces = 0;
    ball.bounceSide = side === "player" ? "ai" : "player";
    serveActive = true;
    server.swing = 0.18;
    server.hitCooldown = 0.35;
    g.sfx.start();
    g.setStatus(
      serveAttempt === 0 ? t("robo_tennis.status.serve") : t("robo_tennis.status.second"),
      "",
    );
  }

  function finish(): void {
    phase = "finished";
    const won = scorePlayer > scoreAi;
    const stars = mode2P ? (won ? 3 : 2) : won && scoreAi === 0 ? 3 : won ? 2 : 1;
    g.setStatus(
      won ? t("robo_tennis.status.win") : t("robo_tennis.status.lose"),
      won ? "var(--ok)" : "var(--warn)",
    );
    if (won) {
      particles.burst(player.x, player.y, "#5eead4", 42, 280);
      g.sfx.victory();
    }
    g.awardStars(
      stars,
      `${t("robo_tennis.stats.score")} <b>${scorePlayer} - ${scoreAi}</b> ${mode2P ? "(P1 - P2)" : "(YOU - AUTO)"}<br>` +
        `${t("robo_tennis.stats.rally")} <b>${bestRally}</b><br>` +
        `${t("robo_tennis.stats.time")} <b>${elapsed.toFixed(1)} s</b>`,
    );
  }

  function pointDisplay(side: Side): string {
    const own = side === "player" ? pointsPlayer : pointsAi;
    const other = side === "player" ? pointsAi : pointsPlayer;
    return tennisPointDisplay(own, other);
  }

  function registerTennisPoint(winner: Side): boolean {
    const next = advanceTennisScore(
      {
        gamesPlayer: scorePlayer,
        gamesAi: scoreAi,
        pointsPlayer,
        pointsAi,
        pointsPlayedInGame,
      },
      winner,
      TARGET_GAMES,
    );
    scorePlayer = next.gamesPlayer;
    scoreAi = next.gamesAi;
    pointsPlayer = next.pointsPlayer;
    pointsAi = next.pointsAi;
    pointsPlayedInGame = next.pointsPlayedInGame;
    return next.gameWon;
  }

  function serviceFault(): void {
    if (!serveActive) return;
    serveActive = false;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    if (serveAttempt === 0) {
      serveAttempt = 1;
      phase = "ready";
      phaseTimer = 0.55;
      prepareServe(true);
      g.sfx.bump();
      g.setStatus(t("robo_tennis.status.fault"), "var(--warn)");
      return;
    }
    const receiver = servingSide() === "player" ? "ai" : "player";
    awardPoint(receiver, t("robo_tennis.result.double_fault"));
  }

  function awardPoint(winner: Side, reason: string): void {
    if (phase !== "rally") return;
    phase = "point";
    serveActive = false;
    phaseTimer = 1.25;
    pointWinner = winner;
    const gameWon = registerTennisPoint(winner);
    pointText = gameWon
      ? `${t("robo_tennis.result.game")} ${winner === "player" ? (mode2P ? "P1" : "YOU") : mode2P ? "P2" : "AUTO"}`
      : reason;
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    if (winner === "player") {
      particles.burst(ball.x, ball.y - ball.z, "#5eead4", 24, 220);
      g.sfx.deliver();
    } else {
      particles.burst(ball.x, ball.y - ball.z, "#fb7185", 18, 180);
      g.sfx.bump();
    }
    g.setStatus(pointText, winner === "player" ? "var(--ok)" : "var(--warn)");
  }

  function sideAt(x: number): Side {
    return x < NET_X ? "player" : "ai";
  }

  function requestSwing(side: Side, robot: Robot): void {
    if (phase === "ready" && side === servingSide() && phaseTimer <= 0) {
      serve(side);
      return;
    }
    if (phase !== "rally" || robot.hitCooldown > 0) return;
    robot.swing = SWING_WINDOW;
    robot.hitCooldown = 0.28;
    g.sfx.click();
  }

  function tryHumanHit(side: Side, robot: Robot, input: twoPlayer.PlayerInput): void {
    const incoming = side === "player" ? ball.vx < -40 : ball.vx > 40;
    if (
      robot.swing <= 0 ||
      !incoming ||
      serveActive ||
      ball.z < 5 ||
      ball.z > 105 ||
      Math.hypot(ball.x - robot.x, ball.y - robot.y) > 64
    ) {
      return;
    }
    const opponent = side === "player" ? ai : player;
    const targetY = input.fwd
      ? COURT.y + 58
      : input.back
        ? COURT.y + COURT.h - 58
        : opponent.y < COURT.y + COURT.h / 2
          ? COURT.y + COURT.h - 72
          : COURT.y + 72;
    const distance = Math.hypot(ball.x - robot.x, ball.y - robot.y);
    const quality = Math.max(0.55, 1 - distance / 115);
    const dir = side === "player" ? 1 : -1;
    ball.vx = dir * (385 + quality * 105);
    ball.vy = (targetY - ball.y) * 1.05;
    ball.vz = 222 + quality * 45;
    ball.lastHitter = side;
    ball.bounces = 0;
    ball.bounceSide = side === "player" ? "ai" : "player";
    ball.x = robot.x + dir * 26;
    robot.swing = 0;
    rallyHits++;
    bestRally = Math.max(bestRally, rallyHits);
    particles.burst(ball.x, ball.y - ball.z, side === "player" ? "#7dd3fc" : "#f472b6", 12, 145);
    g.sfx.pickup();
    g.publish("/racket/swing", `side=${side} quality=${quality.toFixed(2)}`);
  }

  function updateHuman(side: Side, robot: Robot, input: twoPlayer.PlayerInput, dt: number): void {
    const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const dy = (input.back ? 1 : 0) - (input.fwd ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    const lockedForServe = phase === "ready" && side === servingSide();
    if (!lockedForServe) {
      robot.x += (dx / len) * MOVE_SPEED * dt;
      robot.y += (dy / len) * MOVE_SPEED * dt;
    }
    const minX = side === "player" ? COURT.x + 28 : NET_X + 42;
    const maxX = side === "player" ? NET_X - 42 : COURT.x + COURT.w - 28;
    robot.x = Math.max(minX, Math.min(maxX, robot.x));
    robot.y = Math.max(COURT.y + 24, Math.min(COURT.y + COURT.h - 24, robot.y));

    const wasBoost = side === "player" ? lastBoostP1 : lastBoostP2;
    if (input.actionEdge || (input.boost && !wasBoost)) requestSwing(side, robot);
    if (side === "player") lastBoostP1 = input.boost;
    else lastBoostP2 = input.boost;
    tryHumanHit(side, robot, input);
  }

  function updateAi(dt: number): void {
    if (phase === "ready" && servingSide() === "ai") return;
    const homeX = COURT.x + COURT.w - 90;
    let targetX = homeX;
    let targetY = COURT.y + COURT.h / 2;
    if (phase === "rally" && ball.x > NET_X - 35) {
      targetY = ball.y + ball.vy * 0.12;
    }
    const dx = targetX - ai.x;
    const dy = targetY - ai.y;
    const dist = Math.hypot(dx, dy) || 1;
    const aiSpeed = 168;
    ai.x += (dx / dist) * Math.min(dist, aiSpeed * dt);
    ai.y += (dy / dist) * Math.min(dist, aiSpeed * dt);
    ai.x = Math.max(NET_X + 42, Math.min(COURT.x + COURT.w - 28, ai.x));
    ai.y = Math.max(COURT.y + 24, Math.min(COURT.y + COURT.h - 24, ai.y));

    if (
      phase === "rally" &&
      ai.hitCooldown <= 0 &&
      ball.vx > 0 &&
      !serveActive &&
      ball.z >= 4 &&
      ball.z < 94 &&
      Math.hypot(ball.x - ai.x, ball.y - ai.y) < 58
    ) {
      ai.swing = 0.22;
      ai.hitCooldown = 0.42;
      const targetY = player.y < COURT.y + COURT.h / 2 ? COURT.y + COURT.h - 64 : COURT.y + 64;
      ball.vx = -(350 + Math.min(95, rallyHits * 6));
      ball.vy = (targetY - ball.y) * 0.92 + (Math.random() - 0.5) * 35;
      ball.vz = 230;
      ball.lastHitter = "ai";
      ball.bounces = 0;
      ball.bounceSide = "player";
      ball.x = ai.x - 25;
      rallyHits++;
      bestRally = Math.max(bestRally, rallyHits);
      particles.burst(ball.x, ball.y - ball.z, "#f472b6", 10, 130);
      g.sfx.pickup();
      g.publish("/racket/swing", "side=ai quality=0.82");
    }
  }

  function updateBall(dt: number): void {
    if (phase !== "rally") return;
    const oldX = ball.x;
    ball.trail.push({ x: ball.x, y: ball.y, z: ball.z });
    if (ball.trail.length > 18) ball.trail.shift();
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    ball.vz -= GRAVITY * dt;

    // A low shot that crosses the center line hits the net.
    if ((oldX - NET_X) * (ball.x - NET_X) <= 0 && ball.z < NET_H) {
      // In 1P, prevent the AI from ending too many rallies with unforced
      // net errors. Human shots and local 2P shots still use the normal rule.
      if (!mode2P && ball.lastHitter === "ai") {
        ball.z = NET_H + 6;
        ball.vz = Math.max(ball.vz, 24);
      } else {
        if (serveActive) serviceFault();
        else
          awardPoint(ball.lastHitter === "player" ? "ai" : "player", t("robo_tennis.result.net"));
        return;
      }
    }

    if (ball.z <= 0 && ball.vz < 0) {
      ball.z = 0;
      if (serveActive) {
        const validServe = isInsideDiagonalServiceBox(
          ball.x,
          ball.y,
          servingSide(),
          serveFromTop,
          COURT,
          NET_X,
          SINGLES_INSET,
          SERVICE_DEPTH,
        );
        if (!validServe) {
          serviceFault();
          return;
        }
        serveActive = false;
      }
      const inside = isInsideSingles(ball.x, ball.y, COURT, SINGLES_INSET);
      if (!inside) {
        awardPoint(ball.lastHitter === "player" ? "ai" : "player", t("robo_tennis.result.out"));
        return;
      }
      const currentSide = sideAt(ball.x);
      if (currentSide === ball.bounceSide) ball.bounces++;
      else {
        ball.bounceSide = currentSide;
        ball.bounces = 1;
      }
      if (ball.bounces >= 2) {
        awardPoint(currentSide === "player" ? "ai" : "player", t("robo_tennis.result.double"));
        return;
      }
      ball.vz = Math.max(155, Math.abs(ball.vz) * 0.72);
      ball.vx *= 0.94;
      ball.vy *= 0.94;
      particles.burst(ball.x, ball.y, "#fef3c7", 7, 70);
      g.sfx.click();
    }

    // End balls that have travelled beyond the playable view. Before the
    // first bounce this is an out; after a valid bounce it is a missed return.
    if (ball.x < COURT.x - 130 || ball.x > COURT.x + COURT.w + 130) {
      if (serveActive) serviceFault();
      else {
        const exit = resolveTennisBallExit(ball.lastHitter, ball.bounces);
        awardPoint(exit.winner, t(`robo_tennis.result.${exit.reason}`));
      }
    }
  }

  function update(dt: number): void {
    if (twoPlayer.pollToggleEdge()) setMode2P(!mode2P);
    animTime += dt;
    particles.update(dt);
    if (player.swing > 0) player.swing = Math.max(0, player.swing - dt);
    if (ai.swing > 0) ai.swing = Math.max(0, ai.swing - dt);
    if (player.hitCooldown > 0) player.hitCooldown = Math.max(0, player.hitCooldown - dt);
    if (ai.hitCooldown > 0) ai.hitCooldown = Math.max(0, ai.hitCooldown - dt);
    if (phase === "finished") return;
    elapsed += dt;

    if (phase === "ready") {
      const side = servingSide();
      const isHumanServer = side === "player" || mode2P;
      const laneDirection = serveFromTop ? 1 : -1;
      const targetOffset = isHumanServer ? 55 + Math.sin(animTime * 2.6) * 78 : 55;
      serveTargetY = COURT.y + COURT.h / 2 + laneDirection * targetOffset;
    }

    const polledP1 = twoPlayer.pollP1();
    const p1Input = pointerActionPending
      ? { ...polledP1, action: true, actionEdge: true }
      : polledP1;
    pointerActionPending = false;
    updateHuman("player", player, p1Input, dt);
    if (mode2P) {
      const p2Input = twoPlayer.pollP2();
      updateHuman("ai", ai, p2Input, dt);
    } else {
      updateAi(dt);
    }
    updateBall(dt);

    if (phase === "ready") {
      const side = servingSide();
      const server = side === "player" ? player : ai;
      ball.x = server.x + (side === "player" ? 28 : -28);
      ball.y = server.y;
      phaseTimer = Math.max(0, phaseTimer - dt);
      if (phaseTimer <= 0) {
        if (side === "ai" && !mode2P) serve("ai");
        else
          g.setStatus(
            serveAttempt === 0
              ? t("robo_tennis.status.serve_prompt")
              : t("robo_tennis.status.second_prompt"),
            "",
          );
      }
    } else if (phase === "point") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) {
        if (scorePlayer >= TARGET_GAMES || scoreAi >= TARGET_GAMES) finish();
        else {
          prepareServe();
          phase = "ready";
          phaseTimer = 0.8;
          pointText = "";
          pointWinner = null;
          g.setStatus(t("robo_tennis.status.ready"), "");
        }
      }
    }

    pubAcc += dt;
    if (pubAcc >= 0.1) {
      pubAcc = 0;
      g.publish(
        "/tennis/ball/pose",
        `x=${((ball.x - NET_X) / 100).toFixed(2)} y=${((ball.y - (COURT.y + COURT.h / 2)) / 100).toFixed(2)} z=${(ball.z / 100).toFixed(2)}`,
      );
    }
    g.setHud([
      `GAMES  ${mode2P ? "P1" : "YOU"} ${scorePlayer} - ${scoreAi} ${mode2P ? "P2" : "AI"}`,
      `POINT  ${pointDisplay("player")} - ${pointDisplay("ai")}`,
      `SERVE  ${servingSide() === "player" ? (mode2P ? "P1" : "YOU") : mode2P ? "P2" : "AI"} · ${serveAttempt === 0 ? "1ST" : "2ND"}`,
      `RALLY  ${rallyHits}`,
      `BALL   z=${(ball.z / 100).toFixed(2)} m`,
      `TRACK  (${Math.round(ball.x)}, ${Math.round(ball.y)})`,
    ]);
  }

  function drawCourt(c: CanvasRenderingContext2D): void {
    clearBackground(c);
    const bg = c.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#071126");
    bg.addColorStop(1, "#102a35");
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // Arena glow.
    c.fillStyle = "rgba(125, 211, 252, 0.05)";
    for (let x = 20; x < W; x += 40) c.fillRect(x, 0, 1, H);
    for (let y = 20; y < H; y += 40) c.fillRect(0, y, W, 1);

    c.fillStyle = "#176b61";
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(COURT.x, COURT.y, COURT.w, COURT.h, 8);
    c.fill();
    c.stroke();

    // Regulation-style tennis markings: doubles alleys, singles court,
    // service lines and a center service line only between those lines.
    c.fillStyle = "rgba(5, 46, 42, 0.28)";
    c.fillRect(NET_X, COURT.y, COURT.w / 2, COURT.h);
    c.strokeStyle = "rgba(255,255,255,0.88)";
    c.lineWidth = 2;
    const singlesTop = COURT.y + SINGLES_INSET;
    const singlesBottom = COURT.y + COURT.h - SINGLES_INSET;
    const serviceLeft = NET_X - SERVICE_DEPTH;
    const serviceRight = NET_X + SERVICE_DEPTH;

    if (phase === "ready" || serveActive) {
      const targetTop = !serveFromTop;
      const targetX = servingSide() === "player" ? NET_X : serviceLeft;
      const targetW = SERVICE_DEPTH;
      const targetY = targetTop ? singlesTop : COURT.y + COURT.h / 2;
      const targetH = COURT.h / 2 - SINGLES_INSET;
      c.fillStyle = "rgba(250, 204, 21, 0.16)";
      c.fillRect(targetX, targetY, targetW, targetH);

      if (phase === "ready") {
        const aimX = NET_X + (servingSide() === "player" ? 1 : -1) * SERVICE_DEPTH * 0.6;
        const validAim = isInsideDiagonalServiceBox(
          aimX,
          serveTargetY,
          servingSide(),
          serveFromTop,
          COURT,
          NET_X,
          SINGLES_INSET,
          SERVICE_DEPTH,
        );
        c.strokeStyle = validAim ? "#fde047" : "#fb7185";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(aimX, serveTargetY, 10, 0, Math.PI * 2);
        c.moveTo(aimX - 15, serveTargetY);
        c.lineTo(aimX + 15, serveTargetY);
        c.moveTo(aimX, serveTargetY - 15);
        c.lineTo(aimX, serveTargetY + 15);
        c.stroke();
      }
    }

    c.strokeStyle = "rgba(255,255,255,0.88)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(COURT.x, singlesTop);
    c.lineTo(COURT.x + COURT.w, singlesTop);
    c.moveTo(COURT.x, singlesBottom);
    c.lineTo(COURT.x + COURT.w, singlesBottom);
    c.moveTo(serviceLeft, singlesTop);
    c.lineTo(serviceLeft, singlesBottom);
    c.moveTo(serviceRight, singlesTop);
    c.lineTo(serviceRight, singlesBottom);
    c.moveTo(serviceLeft, COURT.y + COURT.h / 2);
    c.lineTo(serviceRight, COURT.y + COURT.h / 2);
    c.stroke();
    // Center marks on both baselines.
    c.beginPath();
    c.moveTo(COURT.x, COURT.y + COURT.h / 2 - 7);
    c.lineTo(COURT.x + 10, COURT.y + COURT.h / 2 - 7);
    c.moveTo(COURT.x + COURT.w, COURT.y + COURT.h / 2 + 7);
    c.lineTo(COURT.x + COURT.w - 10, COURT.y + COURT.h / 2 + 7);
    c.stroke();

    // Net shadow, posts and mesh.
    c.fillStyle = "rgba(0,0,0,0.2)";
    c.fillRect(NET_X + 5, COURT.y - 8, 12, COURT.h + 16);
    c.fillStyle = "#dbeafe";
    c.fillRect(NET_X - 3, COURT.y - 12, 6, COURT.h + 24);
    c.strokeStyle = "rgba(15, 23, 42, 0.65)";
    c.lineWidth = 1;
    for (let y = COURT.y; y <= COURT.y + COURT.h; y += 10) {
      c.beginPath();
      c.moveTo(NET_X - 3, y);
      c.lineTo(NET_X + 3, y + 5);
      c.stroke();
    }
    c.fillStyle = "#fbbf24";
    c.beginPath();
    c.arc(NET_X, COURT.y - 12, 6, 0, Math.PI * 2);
    c.arc(NET_X, COURT.y + COURT.h + 12, 6, 0, Math.PI * 2);
    c.fill();
  }

  function drawRobotWithRacket(c: CanvasRenderingContext2D, robot: Robot, side: Side): void {
    const facing = side === "player" ? 0 : Math.PI;
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(facing);
    c.scale(1.75, 1.75);
    drawRobotBody(c, 0, animTime);
    c.restore();

    const swingProgress = robot.swing > 0 ? 1 - robot.swing / SWING_WINDOW : 0;
    const angle =
      side === "player"
        ? robot.swing > 0
          ? -1.4 + swingProgress * 2.4
          : -0.85
        : robot.swing > 0
          ? Math.PI + 1.4 - swingProgress * 2.4
          : Math.PI + 0.85;
    const handX = robot.x + (side === "player" ? 18 : -18);
    const handY = robot.y - 4;
    c.save();
    c.translate(handX, handY);
    c.rotate(angle);
    c.strokeStyle = side === "player" ? "#fbbf24" : "#f472b6";
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(28, 0);
    c.stroke();
    c.strokeStyle = "#eef2ff";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(39, 0, 13, 18, 0, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = "rgba(238,242,255,0.4)";
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(28, 0);
    c.lineTo(50, 0);
    c.moveTo(39, -15);
    c.lineTo(39, 15);
    c.stroke();
    c.restore();

    c.fillStyle = side === "player" ? "#7dd3fc" : "#f472b6";
    c.font = "800 8px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(
      side === "player" ? (mode2P ? "P1" : "YOU") : mode2P ? "P2" : "AUTO",
      robot.x,
      robot.y + 34,
    );
  }

  function drawBall(c: CanvasRenderingContext2D): void {
    c.save();
    for (let i = 0; i < ball.trail.length; i++) {
      const p = ball.trail[i];
      c.globalAlpha = ((i + 1) / ball.trail.length) * 0.22;
      c.fillStyle = "#fef08a";
      c.beginPath();
      c.arc(p.x, p.y - p.z * 0.42, 2 + i * 0.08, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = `rgba(0,0,0,${Math.max(0.08, 0.3 - ball.z / 500)})`;
    c.beginPath();
    c.ellipse(ball.x, ball.y + 6, 10 + ball.z * 0.025, 5, 0, 0, Math.PI * 2);
    c.fill();
    const screenY = ball.y - ball.z * 0.42;
    c.shadowColor = "#fef08a";
    c.shadowBlur = 12;
    c.fillStyle = "#d9f99d";
    c.beginPath();
    c.arc(ball.x, screenY, 7, 0, Math.PI * 2);
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = "#65a30d";
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(ball.x - 2, screenY, 4, -1.2, 1.2);
    c.stroke();
    c.restore();
  }

  function drawHud(c: CanvasRenderingContext2D): void {
    c.save();
    c.fillStyle = "rgba(3, 7, 18, 0.86)";
    c.strokeStyle = "rgba(125, 211, 252, 0.4)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(18, 14, 350, 58, 10);
    c.fill();
    c.stroke();
    c.fillStyle = "#7dd3fc";
    c.font = "900 17px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(`${mode2P ? "P1" : "YOU"}  G${scorePlayer}  ${pointDisplay("player")}`, 34, 39);
    c.fillStyle = "#94a3b8";
    c.fillText("—", 174, 39);
    c.fillStyle = "#f472b6";
    c.fillText(`${pointDisplay("ai")}  G${scoreAi}  ${mode2P ? "P2" : "AUTO"}`, 202, 39);
    c.fillStyle = "#eef2ff";
    c.font = "700 9px ui-monospace, monospace";
    c.fillText("BEST OF 3 GAMES", 34, 58);
    c.fillStyle = "#5eead4";
    c.fillText(`RALLY ${rallyHits}`, 264, 58);

    c.fillStyle = "rgba(3, 7, 18, 0.82)";
    c.beginPath();
    c.roundRect(W - 174, 14, 156, 43, 9);
    c.fill();
    c.stroke();
    c.fillStyle = "#5eead4";
    c.font = "700 8px ui-monospace, monospace";
    c.fillText("● BALL TRACKING", W - 160, 32);
    c.fillStyle = "#94a3b8";
    c.fillText(`Z ${(ball.z / 100).toFixed(2)}m`, W - 160, 47);

    if (phase === "point" && pointText) {
      c.fillStyle = "rgba(3, 7, 18, 0.8)";
      c.fillRect(0, H / 2 - 31, W, 62);
      c.fillStyle = pointWinner === "player" ? "#5eead4" : "#fb7185";
      c.font = "900 28px ui-monospace, monospace";
      c.textAlign = "center";
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 12;
      c.fillText(pointText, W / 2, H / 2 + 9);
    }
    c.restore();
  }

  function draw(): void {
    const c = g.ctx;
    drawCourt(c);
    drawRobotWithRacket(c, player, "player");
    drawRobotWithRacket(c, ai, "ai");
    drawBall(c);
    particles.draw(c);
    drawHud(c);
    drawHint(c, t("robo_tennis.hint"));
  }

  function dispose(): void {
    overlayPanel?.dispose();
    overlayPanel = null;
    disposeLangSync?.();
    disposeLangSync = null;
    twoPlayer.setActive(false);
    twoPlayer.uninstallToggleListener();
    if (onPointerMove) g.canvas.removeEventListener("pointermove", onPointerMove);
    if (onPointerDown) g.canvas.removeEventListener("pointerdown", onPointerDown);
    onPointerMove = null;
    onPointerDown = null;
  }

  return {
    id: "robo_tennis",
    name: "Robo Tennis",
    lesson: "3D ball tracking — position, height and bounce prediction",
    lessonCmd: "ros2 topic echo /tennis/ball/pose",
    ros2: defineRos2Concept({
      title: tx(
        "3Dボール追跡 — 位置・高さ・バウンドを読む",
        "3D Ball Tracking — position, height and bounce",
      ),
      summary: tx(
        "追跡ノードがテニスボールのx・y・z座標をpublishします。移動ロボは着地点を予測してラケットを振ります。",
        "A tracking node publishes the tennis ball's x, y and z coordinates. The mobile robot predicts its landing point and swings the racket.",
      ),
      msgTypes: ["geometry_msgs/msg/PointStamped", "std_msgs/msg/Float32"],
      cli: [
        "ros2 topic list",
        "ros2 topic echo /tennis/ball/pose",
        "ros2 topic echo /racket/swing",
      ],
      python: "",
      realWorld: tx(
        "飛翔物体を扱うロボットでは、カメラ座標から3次元位置と速度を推定し、未来の接触位置へ先回りします。",
        "Robots handling flying objects estimate 3D position and velocity from cameras, then move ahead to the future contact point.",
      ),
      state: state({
        nodes: ["/ball_tracker", "/player_robot", "/return_ai"],
        topics: [
          topic("/tennis/ball/pose", "geometry_msgs/msg/PointStamped", {
            pub: ["/ball_tracker"],
            sub: ["/player_robot", "/return_ai"],
          }),
          topic("/racket/swing", "std_msgs/msg/Float32", {
            pub: ["/player_robot", "/return_ai"],
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
  order: 14,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="ball tracker publishes a 3D pose to two tennis robots">
  <defs>
    <marker id="tennis-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
  </defs>
  <rect x="8" y="25" width="116" height="70" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="66" y="51" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="11" font-weight="700">ball_tracker</text>
  <text x="66" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">x / y / z</text>
  <rect x="296" y="25" width="116" height="70" rx="8" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="354" y="51" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">tennis robots</text>
  <text x="354" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">move + swing</text>
  <line x1="124" y1="60" x2="294" y2="60" stroke="#5eead4" stroke-width="2" marker-end="url(#tennis-arrow)"/>
  <circle r="4" fill="#d9f99d" stroke="#65a30d">
    <animateMotion dur="1.25s" repeatCount="indefinite" path="M 130 60 Q 210 15 288 60"/>
  </circle>
  <text x="210" y="45" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="10" font-weight="700">/tennis/ball/pose</text>
  <text x="210" y="82" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="8">geometry_msgs/PointStamped</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "ロボ・テニス — AI戦・ローカル2P対戦",
      en: "Robo Tennis — AI and local two-player matches",
    },
    learn: {
      ja: "飛んでいるボールの3次元位置とバウンドを読み、未来の接触位置へ移動する考え方を体験します。",
      en: "Track a flying ball in 3D and move toward its future contact point.",
    },
    goal: {
      ja: "AIまたは友達を相手に、0・15・30・40の得点で2ゲーム先取を目指しましょう。2バウンド、アウト、ネットで相手のポイントです。",
      en: "Against AI or a friend, win two games using 0, 15, 30, 40, deuce and advantage. A double bounce, out, or net gives the opponent a point.",
    },
    first: {
      ja: "P1はWASD・PAD・マウス/タッチ、P2は矢印・2台目PADで移動します。E・Space・Enter・Shift・PAD A/X・クリック/タップでサービスとスイング。サービスだけは1バウンド後に返球し、その後はボレーも可能です。",
      en: "P1 uses WASD, pad, mouse, or touch; P2 uses arrows or pad 2. Serve and swing with E, Space, Enter, Shift, pad A/X, click, or tap. The serve must bounce before the return; volleys are allowed afterward.",
    },
  },
  strings: {
    ja: {
      "status.ready": "サービス準備 — ボールをよく見よう",
      "status.rally": "ラリー開始！ ボールの着地点へ移動",
      "status.serve": "サービス！ 斜めのサービスボックスへ",
      "status.second": "セカンドサービス！",
      "status.serve_prompt": "アクション・クリック・タップでサービス",
      "status.second_prompt": "セカンドサービス — アクションで打つ",
      "status.fault": "FAULT! セカンドサービス",
      "status.win": "MATCH WIN! ナイスラリー",
      "status.lose": "MATCH OVER — リトライでもう一戦",
      "result.net": "NET!",
      "result.out": "OUT!",
      "result.miss": "MISS!",
      "result.double": "DOUBLE BOUNCE!",
      "result.game": "GAME",
      "result.double_fault": "DOUBLE FAULT!",
      "stats.score": "スコア",
      "stats.rally": "ベストラリー",
      "stats.time": "試合時間",
      "overlay.players": "対戦モード",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "2P 対戦",
      hint: "P1: WASD・PAD・マウス/タッチ + E/Space/A/X/タップ ｜ P2: 矢印・PAD2 + Enter/A/X ｜ 2・Y: 1P/2P",
    },
    en: {
      "status.ready": "Prepare to serve — watch the ball",
      "status.rally": "Rally started! Move to the landing point",
      "status.serve": "Serve! Aim for the diagonal service box",
      "status.second": "Second serve!",
      "status.serve_prompt": "Use action, click, or tap to serve",
      "status.second_prompt": "Second serve — use the action button",
      "status.fault": "FAULT! Second serve",
      "status.win": "MATCH WIN! Great rally",
      "status.lose": "MATCH OVER — retry for another match",
      "result.net": "NET!",
      "result.out": "OUT!",
      "result.miss": "MISS!",
      "result.double": "DOUBLE BOUNCE!",
      "result.game": "GAME",
      "result.double_fault": "DOUBLE FAULT!",
      "stats.score": "Score",
      "stats.rally": "Best rally",
      "stats.time": "Match time",
      "overlay.players": "Match mode",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "2P versus",
      hint: "P1: WASD/pad/mouse/touch + E/Space/A/X/tap | P2: arrows/pad 2 + Enter/A/X | 2 or Y: 1P/2P",
    },
  },
  build: makeRoboTennis,
});
