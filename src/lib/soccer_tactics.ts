// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import type { SoccerBall } from "./soccer_ball";

export interface SoccerTacticalPlayer {
  x: number;
  y: number;
  theta: number;
  v: number;
  team: "P" | "O";
  role: "forward" | "mid" | "defender";
}

interface Point {
  x: number;
  y: number;
}

interface Field extends Point {
  w: number;
  h: number;
}

export type SoccerDecision =
  | { kind: "pass"; receiver: number; x: number; y: number; speed: number }
  | { kind: "shoot" }
  | { kind: "dribble" };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function insideField(point: Point, field: Field, margin: number): Point {
  return {
    x: clamp(point.x, field.x + margin, field.x + field.w - margin),
    y: clamp(point.y, field.y + margin, field.y + field.h - margin),
  };
}

function laneIsClear(start: Point, end: Point, opponents: readonly Point[]): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return false;
  return opponents.every((opponent) => {
    const t = clamp(
      ((opponent.x - start.x) * dx + (opponent.y - start.y) * dy) / lengthSquared,
      0,
      1,
    );
    return Math.hypot(opponent.x - start.x - dx * t, opponent.y - start.y - dy * t) > 28;
  });
}

/** Choose a safe pass, a close clear shot, or keep carrying. Shared by both teams. */
export function chooseSoccerAction(
  ball: SoccerBall,
  bots: readonly SoccerTacticalPlayer[],
  holder: number,
  field: Field,
): SoccerDecision {
  const player = bots[holder];
  if (!player) return { kind: "dribble" };
  const attackDir = player.team === "P" ? 1 : -1;
  const goal = {
    x: player.team === "P" ? field.x + field.w : field.x,
    y: field.y + field.h / 2,
  };
  const opponents = bots.filter((bot) => bot.team !== player.team);
  const goalDistance = distance(ball, goal);
  const goalOpen = laneIsClear(ball, goal, opponents);
  const shootingAngle = ((goal.x - ball.x) * attackDir) / Math.max(1, goalDistance);
  if (goalDistance <= 210 && shootingAngle > 0.55 && goalOpen) return { kind: "shoot" };

  const pressureDistance = Math.min(...opponents.map((opponent) => distance(ball, opponent)));
  const underPressure = pressureDistance < 85;
  const needsOutlet = underPressure || (!goalOpen && goalDistance < 300);
  let best: Extract<SoccerDecision, { kind: "pass" }> | undefined;
  let bestScore = -Infinity;

  for (let receiver = 0; receiver < bots.length; receiver++) {
    const teammate = bots[receiver];
    if (receiver === holder || teammate.team !== player.team) continue;
    const target = insideField(
      {
        x: teammate.x + Math.cos(teammate.theta) * teammate.v * 0.15,
        y: teammate.y + Math.sin(teammate.theta) * teammate.v * 0.15,
      },
      field,
      35,
    );
    const passDistance = distance(ball, target);
    if (passDistance < 70 || passDistance > 320) continue;
    const clearance = Math.min(
      ...opponents.map((opponent) =>
        Math.min(distance(target, opponent), distance(teammate, opponent)),
      ),
    );
    if (clearance < 40 || !laneIsClear(ball, target, opponents)) continue;

    const progress = (target.x - ball.x) * attackDir;
    if (progress < 25) {
      // A pressured player may recycle possession, but an unpressured team
      // must not endlessly trade the ball backward or sideways.
      if (!needsOutlet || progress < -100 || clearance < 60) continue;
      if (underPressure && clearance < pressureDistance + 20) continue;
    }
    const speed = clamp(130 + passDistance * 0.91, 220, 440);
    if (progress < 0) {
      // Even a safe receiver can miss. Never send a back-pass whose remaining
      // momentum would carry it through our own goal mouth after that miss.
      const ownGoalX = player.team === "P" ? field.x : field.x + field.w;
      const timeAlongLine = (ownGoalX - ball.x) / (target.x - ball.x);
      const goalCrossingY = ball.y + (target.y - ball.y) * timeAlongLine;
      if (
        timeAlongLine > 0 &&
        passDistance * timeAlongLine <= speed / 0.91 + 9 &&
        Math.abs(goalCrossingY - goal.y) <= 94
      )
        continue;
    }
    // Prefer useful progress and space without forcing the longest pass.
    const score = progress * 1.2 + Math.min(clearance, 180) * 0.22 - passDistance * 0.12;
    if (score <= bestScore) continue;
    bestScore = score;
    best = {
      kind: "pass",
      receiver,
      ...target,
      // Friction is about 0.91/s. This leaves a soft, controllable arrival
      // instead of using the much faster shooting impulse for every pass.
      speed,
    };
  }
  return best ?? { kind: "dribble" };
}

/** Spread the two supporting roles across the pitch instead of crowding the ball. */
export function soccerSupportTarget(bot: SoccerTacticalPlayer, holder: Point, field: Field): Point {
  const attackDir = bot.team === "P" ? 1 : -1;
  const centerY = field.y + field.h / 2;
  const openSide = holder.y <= centerY ? 1 : -1;
  const advance = bot.role === "defender" ? -120 : bot.role === "forward" ? 145 : 100;
  const side = bot.role === "defender" ? -openSide : openSide;
  return insideField({ x: holder.x + attackDir * advance, y: centerY + side * 95 }, field, 28);
}
