// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseSoccerAction,
  soccerSupportTarget,
  type SoccerTacticalPlayer,
} from "../src/lib/soccer_tactics.ts";

const field = { x: 30, y: 60, w: 740, h: 380 };
const ball = { x: 400, y: 250, vx: 0, vy: 0 };

function player(
  x: number,
  y: number,
  team: "P" | "O" = "P",
  role: SoccerTacticalPlayer["role"] = "mid",
): SoccerTacticalPlayer {
  return { x, y, team, role, theta: team === "P" ? 0 : Math.PI, v: 0 };
}

function close(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

test("an open forward pass leads the receiver and uses distance-adjusted power", () => {
  const holder = player(375, 250);
  const receiver = { ...player(500, 150), v: 100 };
  const short = chooseSoccerAction(ball, [holder, receiver], 0, field);
  assert.equal(short.kind, "pass");
  if (short.kind !== "pass") return;
  assert.equal(short.receiver, 1);
  close(short.x, 515);
  close(short.y, 150);
  close(short.speed, 130 + Math.hypot(short.x - ball.x, short.y - ball.y) * 0.91);

  const longer = chooseSoccerAction(ball, [holder, { ...receiver, x: 650 }], 0, field);
  assert.equal(longer.kind, "pass");
  if (longer.kind !== "pass") return;
  assert.ok(longer.speed > short.speed);
  assert.ok(longer.speed <= 440);
  // With the stage's approximately 0.91/s friction, the ball reaches the
  // receiver slowly enough for its automatic close-control range.
  const arrivalSpeed = longer.speed - Math.hypot(longer.x - ball.x, longer.y - ball.y) * 0.91;
  close(arrivalSpeed, 130);
});

test("passes reject both an obstructed lane and a separately marked receiver", () => {
  const holder = player(375, 250);
  const receiver = player(550, 250);
  assert.equal(
    chooseSoccerAction(ball, [holder, receiver, player(475, 250, "O")], 0, field).kind,
    "dribble",
  );
  assert.equal(
    chooseSoccerAction(ball, [holder, receiver, player(550, 280, "O")], 0, field).kind,
    "dribble",
  );
});

test("a safe backward outlet is used under pressure but avoids voluntary back-and-forth passes", () => {
  const holder = player(375, 250);
  const receiver = player(320, 140);
  assert.equal(chooseSoccerAction(ball, [holder, receiver], 0, field).kind, "dribble");
  const escape = chooseSoccerAction(ball, [holder, receiver, player(425, 285, "O")], 0, field);
  assert.equal(escape.kind, "pass");
  if (escape.kind !== "pass") return;
  assert.equal(escape.receiver, 1);
  assert.ok(escape.x < ball.x);
});

test("a pressured backpass must not continue into either team's own goal if missed", () => {
  for (const team of ["P", "O"] as const) {
    const mirror = (x: number) => (team === "P" ? x : 800 - x);
    const opponent = team === "P" ? "O" : "P";
    const defensiveBall = { ...ball, x: mirror(150) };
    const holder = player(mirror(175), 250, team);
    const pressure = player(mirror(175), 285, opponent);
    assert.equal(
      chooseSoccerAction(defensiveBall, [holder, player(mirror(65), 250, team), pressure], 0, field)
        .kind,
      "dribble",
    );
    assert.equal(
      chooseSoccerAction(defensiveBall, [holder, player(mirror(70), 140, team), pressure], 0, field)
        .kind,
      "pass",
      "A safe outlet toward the flank remains available",
    );
  }
});

test("a clear close shot takes precedence; a blocked goal instead uses an open teammate", () => {
  const shootingBall = { ...ball, x: 620 };
  const holder = player(595, 250);
  const receiver = player(670, 120);
  assert.equal(chooseSoccerAction(shootingBall, [holder, receiver], 0, field).kind, "shoot");
  const blocked = chooseSoccerAction(
    shootingBall,
    [holder, receiver, player(700, 250, "O")],
    0,
    field,
  );
  assert.equal(blocked.kind, "pass");
  if (blocked.kind !== "pass") return;
  assert.equal(blocked.receiver, 1);
});

test("both teams make mirrored passing and shooting decisions", () => {
  const bots = [player(375, 250), { ...player(540, 150), v: 110 }, player(480, 315, "O")];
  const mirrorPlayer = (bot: SoccerTacticalPlayer): SoccerTacticalPlayer => ({
    ...bot,
    x: 800 - bot.x,
    theta: Math.PI - bot.theta,
    team: bot.team === "P" ? "O" : "P",
  });
  const passP = chooseSoccerAction(ball, bots, 0, field);
  const passO = chooseSoccerAction({ ...ball, x: 800 - ball.x }, bots.map(mirrorPlayer), 0, field);
  assert.equal(passP.kind, "pass");
  assert.equal(passO.kind, "pass");
  if (passP.kind !== "pass" || passO.kind !== "pass") return;
  assert.equal(passO.receiver, passP.receiver);
  close(passO.x, 800 - passP.x);
  close(passO.y, passP.y);
  close(passO.speed, passP.speed);

  assert.equal(chooseSoccerAction({ ...ball, x: 620 }, [player(595, 250)], 0, field).kind, "shoot");
  assert.equal(
    chooseSoccerAction({ ...ball, x: 180 }, [player(205, 250, "O")], 0, field).kind,
    "shoot",
  );
});

test("supporters spread ahead and behind possession while staying inside the pitch", () => {
  const holder = { x: 400, y: 160 };
  const mid = soccerSupportTarget(player(300, 200, "P", "mid"), holder, field);
  const forward = soccerSupportTarget(player(300, 200, "P", "forward"), holder, field);
  const defender = soccerSupportTarget(player(300, 200, "P", "defender"), holder, field);
  assert.ok(mid.x > holder.x && forward.x > mid.x);
  assert.ok(defender.x < holder.x);
  assert.ok(mid.y > holder.y, "The midfielder offers space on the other flank");
  assert.notEqual(defender.y, mid.y, "The defender offers a separate outlet");

  for (const team of ["P", "O"] as const) {
    for (const role of ["forward", "mid", "defender"] as const) {
      for (const corner of [
        { x: 30, y: 60 },
        { x: 770, y: 440 },
      ]) {
        const target = soccerSupportTarget(player(400, 250, team, role), corner, field);
        assert.ok(target.x >= field.x + 28 && target.x <= field.x + field.w - 28);
        assert.ok(target.y >= field.y + 28 && target.y <= field.y + field.h - 28);
      }
    }
  }
});
