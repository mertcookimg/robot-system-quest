// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceTennisScore,
  isInsideDiagonalServiceBox,
  isInsideSingles,
  resolveTennisBallExit,
  tennisPointDisplay,
  type TennisScoreInput,
} from "../src/lib/tennis_rules.ts";

const COURT = { x: 0, y: 0, w: 100, h: 60 };
const NET_X = 50;
const SINGLES_INSET = 5;
const SERVICE_DEPTH = 20;

function score(overrides: Partial<TennisScoreInput> = {}): TennisScoreInput {
  return {
    gamesPlayer: 0,
    gamesAi: 0,
    pointsPlayer: 0,
    pointsAi: 0,
    pointsPlayedInGame: 0,
    ...overrides,
  };
}

test("tennis points display 0, 15, 30, 40, deuce and advantage", () => {
  assert.equal(tennisPointDisplay(0, 0), "0");
  assert.equal(tennisPointDisplay(1, 0), "15");
  assert.equal(tennisPointDisplay(2, 0), "30");
  assert.equal(tennisPointDisplay(3, 2), "40");
  assert.equal(tennisPointDisplay(3, 3), "40");
  assert.equal(tennisPointDisplay(4, 3), "AD");
  assert.equal(tennisPointDisplay(3, 4), "40");
});

test("a game requires four points and a two-point lead", () => {
  const deuce = score({ pointsPlayer: 3, pointsAi: 3, pointsPlayedInGame: 6 });
  const advantage = advanceTennisScore(deuce, "player", 2);
  assert.equal(advantage.gameWon, false);
  assert.equal(advantage.pointsPlayer, 4);
  assert.equal(advantage.pointsPlayedInGame, 7);

  const backToDeuce = advanceTennisScore(advantage, "ai", 2);
  assert.equal(backToDeuce.gameWon, false);
  assert.equal(tennisPointDisplay(backToDeuce.pointsPlayer, backToDeuce.pointsAi), "40");

  const advantageAgain = advanceTennisScore(backToDeuce, "player", 2);
  const game = advanceTennisScore(advantageAgain, "player", 2);
  assert.equal(game.gameWon, true);
  assert.equal(game.gamesPlayer, 1);
  assert.equal(game.pointsPlayer, 0);
  assert.equal(game.pointsAi, 0);
  assert.equal(game.pointsPlayedInGame, 0);
});

test("winning the target number of games ends the match", () => {
  const result = advanceTennisScore(
    score({ gamesPlayer: 1, pointsPlayer: 3, pointsPlayedInGame: 3 }),
    "player",
    2,
  );
  assert.equal(result.gameWon, true);
  assert.equal(result.matchWon, true);
  assert.equal(result.gamesPlayer, 2);
});

test("singles bounds reject the doubles alleys", () => {
  assert.equal(isInsideSingles(25, 30, COURT, SINGLES_INSET), true);
  assert.equal(isInsideSingles(25, 2, COURT, SINGLES_INSET), false);
  assert.equal(isInsideSingles(101, 30, COURT, SINGLES_INSET), false);
});

test("a ball leaving the play area is only out before a valid bounce", () => {
  assert.deepEqual(resolveTennisBallExit("ai", 0), {
    winner: "player",
    reason: "out",
  });
  assert.deepEqual(resolveTennisBallExit("ai", 1), {
    winner: "ai",
    reason: "miss",
  });
});

test("a serve must land in the receiver's diagonal service box", () => {
  // Player serves from the bottom, so the target is the top-right box.
  assert.equal(
    isInsideDiagonalServiceBox(60, 15, "player", false, COURT, NET_X, SINGLES_INSET, SERVICE_DEPTH),
    true,
  );
  assert.equal(
    isInsideDiagonalServiceBox(60, 45, "player", false, COURT, NET_X, SINGLES_INSET, SERVICE_DEPTH),
    false,
  );
  assert.equal(
    isInsideDiagonalServiceBox(75, 15, "player", false, COURT, NET_X, SINGLES_INSET, SERVICE_DEPTH),
    false,
  );

  // The opposite server mirrors both the receiver side and diagonal lane.
  assert.equal(
    isInsideDiagonalServiceBox(40, 45, "ai", true, COURT, NET_X, SINGLES_INSET, SERVICE_DEPTH),
    true,
  );
});
