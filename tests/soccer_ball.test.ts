// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import test from "node:test";
import assert from "node:assert/strict";
import {
  canControlSoccerBall,
  dribbleSoccerBall,
  shootSoccerBall,
  type SoccerBall,
} from "../src/lib/soccer_ball.ts";

function close(actual: number, expected: number, tolerance = 1e-8): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

test("nearby slow balls can be trapped, but distant balls and fast shots stay free", () => {
  const player = { x: 200, y: 250, theta: 0, v: 180 };
  assert.equal(canControlSoccerBall({ x: 229, y: 260, vx: 40, vy: -30 }, player), true);
  assert.equal(canControlSoccerBall({ x: 200, y: 225, vx: 0, vy: 0 }, player), true);
  assert.equal(canControlSoccerBall({ x: 235, y: 250, vx: 0, vy: 0 }, player), false);
  assert.equal(canControlSoccerBall({ x: 225, y: 250, vx: -610, vy: 0 }, player), false);
  assert.equal(canControlSoccerBall({ x: 225, y: 250, vx: 250, vy: 250 }, player), false);
});

test("continuous close control carries the ball without accelerating it away from the player", () => {
  const player = { x: 200, y: 250, theta: 0, v: 180 };
  const ball = { x: 232, y: 250, vx: 30, vy: 0 };
  for (let frame = 0; frame < 180; frame++) {
    player.x += player.v / 60;
    ball.x += ball.vx / 60;
    ball.y += ball.vy / 60;
    dribbleSoccerBall(ball, player, 1 / 60);
    close(Math.hypot(ball.vx, ball.vy), player.v);
    assert.ok(Math.hypot(ball.x - player.x, ball.y - player.y) < 34);
  }
  close(ball.x - player.x, 25);
  close(ball.y, player.y);
});

test("releasing movement stops the ball at the player's feet", () => {
  const player = { x: 200, y: 250, theta: Math.PI / 2, v: 0 };
  const ball = { x: 200, y: 275, vx: 0, vy: 180 };
  dribbleSoccerBall(ball, player, 1 / 60);
  close(Math.hypot(ball.vx, ball.vy), 0);
  for (let frame = 0; frame < 120; frame++) {
    ball.x += ball.vx / 60;
    ball.y += ball.vy / 60;
    dribbleSoccerBall(ball, player, 1 / 60);
  }
  close(ball.x, 200);
  close(ball.y, 275);
});

for (const turn of [Math.PI / 2, Math.PI, -Math.PI]) {
  test(`turning ${Math.round((turn * 180) / Math.PI)} degrees keeps the ball outside the robot and close at 30/60/120 FPS`, () => {
    const results: SoccerBall[] = [];
    for (const fps of [30, 60, 120]) {
      const player = { x: 200, y: 250, theta: turn, v: 180 };
      const ball = { x: 225, y: 250, vx: 180, vy: 0 };
      for (let frame = 0; frame < fps; frame++) {
        player.x += (Math.cos(turn) * player.v) / fps;
        player.y += (Math.sin(turn) * player.v) / fps;
        ball.x += ball.vx / fps;
        ball.y += ball.vy / fps;
        dribbleSoccerBall(ball, player, 1 / fps);
        const distance = Math.hypot(ball.x - player.x, ball.y - player.y);
        assert.ok(distance >= 25 - 1e-8, "Turning must not pull the ball through the robot");
        assert.ok(distance < 34, "Turning must keep the ball within close-control range");
        close(Math.hypot(ball.vx, ball.vy), 180);
      }
      close(ball.x - player.x, Math.cos(turn) * 25, 1e-5);
      close(ball.y - player.y, Math.sin(turn) * 25, 1e-5);
      results.push(ball);
    }
    for (const result of results.slice(1)) {
      close(result.x, results[0].x, 1e-5);
      close(result.y, results[0].y, 1e-5);
    }
  });
}

test("shots follow the displayed line toward either goal without inheriting sideways velocity", () => {
  for (const goalX of [30, 770]) {
    for (const incoming of [
      { vx: 220, vy: -300 },
      { vx: -610, vy: 0 },
      { vx: 0, vy: 0 },
    ]) {
      const ball = { x: 400, y: 150, ...incoming };
      shootSoccerBall(ball, goalX, 250);
      close(Math.hypot(ball.vx, ball.vy), 610);
      const timeToGoal = (goalX - ball.x) / ball.vx;
      assert.ok(timeToGoal > 0);
      close(ball.y + ball.vy * timeToGoal, 250);
      assert.deepEqual({ x: ball.x, y: ball.y }, { x: 400, y: 150 });
    }
  }
});
