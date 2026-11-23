// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

/** Close control for players and AI receivers; fast shots remain free balls. */
export const SOCCER_CONTROL = {
  trapReach: 34,
  trapSpeed: 340,
  carryReach: 58,
  carryOffset: 25,
  carrySpeed: 0.82,
  kickSpeed: 610,
  kickReach: 48,
};

export interface SoccerBall {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface SoccerPlayer {
  x: number;
  y: number;
  theta: number;
  v: number;
}

export function canControlSoccerBall(ball: SoccerBall, player: SoccerPlayer): boolean {
  return (
    Math.hypot(ball.x - player.x, ball.y - player.y) <= SOCCER_CONTROL.trapReach &&
    Math.hypot(ball.vx, ball.vy) <= SOCCER_CONTROL.trapSpeed
  );
}

/** Carry around the robot when turning, without repeatedly accelerating the ball. */
export function dribbleSoccerBall(ball: SoccerBall, player: SoccerPlayer, dt: number): void {
  const dx = ball.x - player.x;
  const dy = ball.y - player.y;
  const angle = Math.atan2(dy, dx);
  const turn = Math.atan2(Math.sin(player.theta - angle), Math.cos(player.theta - angle));
  const follow = 1 - Math.exp(-20 * dt);
  const heading = angle + turn * follow;
  const distance = Math.max(
    SOCCER_CONTROL.carryOffset,
    Math.hypot(dx, dy) + (SOCCER_CONTROL.carryOffset - Math.hypot(dx, dy)) * follow,
  );
  ball.x = player.x + Math.cos(heading) * distance;
  ball.y = player.y + Math.sin(heading) * distance;
  ball.vx = Math.cos(player.theta) * player.v;
  ball.vy = Math.sin(player.theta) * player.v;
}

/** The shot follows the displayed goal line, independent of the last movement key. */
export function shootSoccerBall(ball: SoccerBall, goalX: number, goalY: number): void {
  const angle = Math.atan2(goalY - ball.y, goalX - ball.x);
  ball.vx = Math.cos(angle) * SOCCER_CONTROL.kickSpeed;
  ball.vy = Math.sin(angle) * SOCCER_CONTROL.kickSpeed;
}
