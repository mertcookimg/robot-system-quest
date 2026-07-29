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

export interface TennisBallExitResult {
  winner: TennisSide;
  reason: "out" | "miss";
}

export function resolveTennisBallExit(
  lastHitter: TennisSide,
  bounces: number,
): TennisBallExitResult {
  if (bounces > 0) return { winner: lastHitter, reason: "miss" };
  return {
    winner: lastHitter === "player" ? "ai" : "player",
    reason: "out",
  };
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
    x >= court.x &&
    x <= court.x + court.w &&
    y >= court.y + singlesInset &&
    y <= court.y + court.h - singlesInset
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
      ? x > netX && x <= netX + serviceDepth
      : x < netX && x >= netX - serviceDepth;
  const targetTop = !serveFromTop;
  const inTargetLane = targetTop
    ? y >= court.y + singlesInset && y < midY
    : y > midY && y <= court.y + court.h - singlesInset;
  return inReceiverDepth && inTargetLane;
}
