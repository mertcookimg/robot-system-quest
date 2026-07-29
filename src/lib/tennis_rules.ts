// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

export type TennisSide = "player" | "ai";

export interface TennisScoreInput {
  gamesPlayer: number;
  gamesAi: number;
  pointsPlayer: number;
  pointsAi: number;
  pointsPlayedInGame: number;
}

export interface TennisScoreResult extends TennisScoreInput {
  gameWon: boolean;
  matchWon: boolean;
}

export interface CourtBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

const LINE_EPSILON = 1e-6;

export interface TennisBallExitResult {
  winner: TennisSide;
  reason: "out" | "miss" | "ace";
}

export interface TennisBallPosition {
  x: number;
  y: number;
  z: number;
}

export interface TennisBallVelocity {
  x: number;
  y: number;
  z: number;
}

export function otherTennisSide(side: TennisSide): TennisSide {
  return side === "player" ? "ai" : "player";
}

export function tennisGroundContact(
  position: TennisBallPosition,
  velocity: TennisBallVelocity,
  gravity: number,
  maxTime: number,
): (TennisBallPosition & { vz: number; time: number }) | null {
  if (gravity <= 0) return null;
  const discriminant = velocity.z * velocity.z + 2 * gravity * position.z;
  if (discriminant < 0) return null;
  const time = (velocity.z + Math.sqrt(discriminant)) / gravity;
  if (time < 0 || time > maxTime) return null;
  return {
    x: position.x + velocity.x * time,
    y: position.y + velocity.y * time,
    z: 0,
    vz: velocity.z - gravity * time,
    time,
  };
}

export function tennisHeightAtCrossing(
  position: Pick<TennisBallPosition, "x" | "z">,
  velocity: Pick<TennisBallVelocity, "x" | "z">,
  crossingX: number,
  gravity: number,
  maxTime: number,
): number | null {
  if (velocity.x === 0) return null;
  const time = (crossingX - position.x) / velocity.x;
  if (time < 0 || time > maxTime) return null;
  return position.z + velocity.z * time - 0.5 * gravity * time * time;
}

export function resolveTennisBallExit(
  lastHitter: TennisSide,
  bounces: number,
  isServe = false,
): TennisBallExitResult {
  if (bounces > 0) return { winner: lastHitter, reason: isServe ? "ace" : "miss" };
  return {
    winner: otherTennisSide(lastHitter),
    reason: "out",
  };
}

export function resolveTennisLanding(
  lastHitter: TennisSide,
  previousBounces: number,
  insideSingles: boolean,
  isServe = false,
): TennisBallExitResult | null {
  if (previousBounces > 0) {
    return { winner: lastHitter, reason: isServe ? "ace" : "miss" };
  }
  if (!insideSingles) {
    return {
      winner: otherTennisSide(lastHitter),
      reason: "out",
    };
  }
  return null;
}

export function tennisPointDisplay(own: number, other: number): string {
  if (own >= 3 && other >= 3) {
    if (own === other) return "40";
    return own > other ? "AD" : "40";
  }
  return ["0", "15", "30", "40"][Math.min(3, own)];
}

export function advanceTennisScore(
  state: TennisScoreInput,
  winner: TennisSide,
  targetGames: number,
): TennisScoreResult {
  let { gamesPlayer, gamesAi, pointsPlayer, pointsAi, pointsPlayedInGame } = state;
  if (winner === "player") pointsPlayer++;
  else pointsAi++;
  pointsPlayedInGame++;

  const lead = pointsPlayer - pointsAi;
  const gameWon = (pointsPlayer >= 4 || pointsAi >= 4) && Math.abs(lead) >= 2;
  if (gameWon) {
    if (lead > 0) gamesPlayer++;
    else gamesAi++;
    pointsPlayer = 0;
    pointsAi = 0;
    pointsPlayedInGame = 0;
  }

  return {
    gamesPlayer,
    gamesAi,
    pointsPlayer,
    pointsAi,
    pointsPlayedInGame,
    gameWon,
    matchWon: gamesPlayer >= targetGames || gamesAi >= targetGames,
  };
}

export function isInsideSingles(
  x: number,
  y: number,
  court: CourtBounds,
  singlesInset: number,
): boolean {
  return (
    x >= court.x - LINE_EPSILON &&
    x <= court.x + court.w + LINE_EPSILON &&
    y >= court.y + singlesInset - LINE_EPSILON &&
    y <= court.y + court.h - singlesInset + LINE_EPSILON
  );
}

export function isInsideDiagonalServiceBox(
  x: number,
  y: number,
  server: TennisSide,
  serveFromTop: boolean,
  court: CourtBounds,
  netX: number,
  singlesInset: number,
  serviceDepth: number,
): boolean {
  const midY = court.y + court.h / 2;
  const inReceiverDepth =
    server === "player"
      ? x > netX && x <= netX + serviceDepth + LINE_EPSILON
      : x < netX && x >= netX - serviceDepth - LINE_EPSILON;
  const targetTop = !serveFromTop;
  const inTargetLane = targetTop
    ? y >= court.y + singlesInset - LINE_EPSILON && y <= midY + LINE_EPSILON
    : y >= midY - LINE_EPSILON && y <= court.y + court.h - singlesInset + LINE_EPSILON;
  return inReceiverDepth && inTargetLane;
}
