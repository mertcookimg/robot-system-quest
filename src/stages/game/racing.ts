// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// racing: Racing
// Lap race: 3 laps to win, 2 AI opponents.
// ROS 2 hook: Nav2 / FollowPath Action — autonomously following a
// pre-planned path.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import { drawTimer, drawHint, fmtTwist, COLORS } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatPose, formatTwist } from "../../lib/hud";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import { t, tx, onLangChange } from "../../i18n";
import * as twoPlayer from "../../lib/two_player";
import type { PlayerInput } from "../../lib/two_player";

const ROBOT_R = 13;
const TOTAL_LAPS = 3;
const ROAD_HALF = 48;
const BASE_LIN = 220;
const BASE_ANG = 3.0;
const BOOST_MULT = 1.6;
const BOOST_MAX = 100;
const BOOST_USE = 80; // drains in ~1.25s
const BOOST_REGEN = 28; // regenerates in ~3.6s
const OFF_ROAD_MULT = 0.55;
const COUNTDOWN_LEN = 3.6;

interface Pt {
  x: number;
  y: number;
}

const waypoints: Pt[] = [
  { x: 400, y: 440 }, // 0: start/finish
  { x: 580, y: 440 },
  { x: 690, y: 410 },
  { x: 730, y: 320 },
  { x: 720, y: 220 },
  { x: 670, y: 130 },
  { x: 570, y: 80 },
  { x: 430, y: 70 },
  { x: 290, y: 80 },
  { x: 180, y: 130 },
  { x: 100, y: 220 },
  { x: 80, y: 320 },
  { x: 130, y: 410 },
  { x: 240, y: 440 },
];
const N_WP = waypoints.length;

interface Racer {
  x: number;
  y: number;
  theta: number;
  v: number;
  w: number;
  lap: number;
  progress: number;
  /** Checkpoints (excluding goal line) passed on the current lap. */
  passedCheckpoints: boolean[];
  bodyColor: string;
  outline: string;
  accent: string;
  name: string;
  isPlayer: boolean;
  /** True for the human-controlled racer in 2P mode (occupies the opp1 slot). */
  isPlayer2: boolean;
  /** Boost meter (0..BOOST_MAX) and current boost state — only used by humans. */
  boostMeter: number;
  boosting: boolean;
  finishedAt?: number; // time at finish
}

// Lap checkpoints. 0 = goal line; the rest are mid-track checkpoints
// (values are progress in [0, 1]).
const CP_PROGRESS = [0.25, 0.5, 0.75];
const CP_COUNT = CP_PROGRESS.length;
const CP_RADIUS = 65; // counted as passed if within this distance

export function makeGrandPrix(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  let elapsed = 0;
  let raceState: "countdown" | "racing" | "finished" = "countdown";
  let countdownT = 0;
  let cleared = false;
  let pubAcc = 0;
  let lastLapPubAcc = 0;

  // 2P mode state — opp1 (RED) is taken over by player 2 when active.
  let mode2P = false;
  let overlayPanel: OverlayPanelHandle | null = null;
  let disposeLangSync: (() => void) | null = null;

  let player!: Racer;
  let opp1!: Racer;
  let opp2!: Racer;
  let racers: Racer[] = [];

  function makeRacer(
    name: string,
    isPlayer: boolean,
    body: string,
    outline: string,
    accent: string,
    isPlayer2 = false,
  ): Racer {
    return {
      x: waypoints[0].x,
      y: waypoints[0].y,
      theta: 0,
      v: 0,
      w: 0,
      lap: 0,
      progress: 0,
      passedCheckpoints: new Array(CP_COUNT).fill(false),
      bodyColor: body,
      outline,
      accent,
      name,
      isPlayer,
      isPlayer2,
      boostMeter: BOOST_MAX,
      boosting: false,
    };
  }

  function reset() {
    particles.reset();
    elapsed = 0;
    raceState = "countdown";
    countdownT = 0;
    cleared = false;
    pubAcc = 0;
    lastLapPubAcc = 0;
    lapWarningT = 0;
    recentProgressSamples = [];
    twoPlayer.resetEdges();

    player = makeRacer("YOU", true, "#fef3e8", "#2d2540", "#7dd3fc");
    if (mode2P) {
      // RED slot is taken over by P2; recolor to amber so P2 reads as "human".
      opp1 = makeRacer("P2", false, "#fcd34d", "#7c2d12", "#fff7ed", true);
    } else {
      opp1 = makeRacer("RED", false, "#fb7185", "#7f1d1d", "#fcd34d");
    }
    opp2 = makeRacer("LIME", false, "#a3e635", "#3f6212", "#fef3e8");

    // Line up 3 cars at the start (offset behind the center line).
    placeOnGrid(player, 0, 18);
    placeOnGrid(opp1, 0.4, -18);
    placeOnGrid(opp2, 0.8, 18);

    racers = [player, opp1, opp2];
    g.ghost.startRecording();
    g.setStatus(t("racing.status.countdown"), "");
  }

  // Place along a center-line position with a lateral offset.
  function placeOnGrid(r: Racer, segOffset: number, lateral: number) {
    const a = waypoints[0];
    const b = waypoints[1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const tx = dx / len,
      ty = dy / len;
    const nx = -ty,
      ny = tx; // perpendicular
    const cx = a.x - tx * 50 - tx * (segOffset * 30);
    const cy = a.y - ty * 50 - ty * (segOffset * 30);
    r.x = cx + nx * lateral;
    r.y = cy + ny * lateral;
    r.theta = Math.atan2(dy, dx);
  }

  function init(ctx: GameContext) {
    g = ctx;

    // Overlay panel: 1P / 2P toggle (mouse-clickable; pad-Y / key-2 also work).
    overlayPanel?.dispose();
    disposeLangSync?.();
    overlayPanel = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("racing.overlay.players"),
          choices: [
            { key: "1p", label: () => t("racing.overlay.1p") },
            { key: "2p", label: () => t("racing.overlay.2p") },
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
    reset();
  }

  function setMode2P(active: boolean) {
    if (mode2P === active) return;
    mode2P = active;
    overlayPanel?.refresh();
    g.sfx.click();
    reset();
  }

  // Closest-point info to the center line.
  function nearest(x: number, y: number) {
    let bestIdx = 0,
      bestT = 0,
      bestDist = Infinity,
      bestPx = 0,
      bestPy = 0;
    for (let i = 0; i < N_WP; i++) {
      const a = waypoints[i];
      const b = waypoints[(i + 1) % N_WP];
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a.x + t * dx,
        py = a.y + t * dy;
      const d = Math.hypot(x - px, y - py);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
        bestT = t;
        bestPx = px;
        bestPy = py;
      }
    }
    return { idx: bestIdx, t: bestT, dist: bestDist, px: bestPx, py: bestPy };
  }

  // Cumulative-distance lap progress.
  const segLen: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < N_WP; i++) {
    const a = waypoints[i],
      b = waypoints[(i + 1) % N_WP];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    segLen.push(L);
    totalLen += L;
  }
  function progressOf(r: Racer): number {
    const n = nearest(r.x, r.y);
    let d = 0;
    for (let i = 0; i < n.idx; i++) d += segLen[i];
    d += n.t * segLen[n.idx];
    return d / totalLen; // 0..1
  }

  // Convert progress in [0..1] back to world coordinates.
  function pointAtProgress(p: number): Pt {
    const target = (((p % 1) + 1) % 1) * totalLen;
    let acc = 0;
    for (let i = 0; i < N_WP; i++) {
      if (acc + segLen[i] >= target) {
        const t = (target - acc) / segLen[i];
        const a = waypoints[i];
        const b = waypoints[(i + 1) % N_WP];
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      acc += segLen[i];
    }
    return waypoints[0];
  }

  // World positions of mid-track checkpoints (excluding the goal line).
  const CHECKPOINTS: Pt[] = CP_PROGRESS.map((p) => pointAtProgress(p));

  // Latest invalid-lap notification (player only).
  let lapWarningT = 0;

  function updateLap(r: Racer) {
    const newProg = progressOf(r);
    const prev = r.progress;

    // Decide whether the progress delta is forward, accounting for
    // wrap across the lap boundary.
    let forward: boolean;
    if (prev > 0.7 && newProg < 0.3)
      forward = true; // 0.95 → 0.05 forward wrap
    else if (prev < 0.3 && newProg > 0.7)
      forward = false; // 0.05 → 0.95 reverse wrap
    else forward = newProg >= prev; // normal

    // Distance to the center line (offroad check).
    const onRoad = nearest(r.x, r.y).dist <= ROAD_HALF + 6;

    // Mark checkpoints in order: forward + on-road + physically close.
    if (forward && onRoad) {
      for (let i = 0; i < CP_COUNT; i++) {
        if (r.passedCheckpoints[i]) continue;
        // Cannot skip ahead if the previous CP wasn't reached.
        if (i > 0 && !r.passedCheckpoints[i - 1]) continue;
        const cp = CHECKPOINTS[i];
        if (Math.hypot(r.x - cp.x, r.y - cp.y) <= CP_RADIUS) {
          r.passedCheckpoints[i] = true;
          if (r.isPlayer || r.isPlayer2) {
            g.sfx.pickup();
            particles.burst(cp.x, cp.y, r.accent, 12, 140);
          }
        }
      }
    }

    // Lap counts only when crossing the goal line forward AND every CP
    // has been hit.
    if (prev > 0.7 && newProg < 0.3) {
      const allPassed = r.passedCheckpoints.every((p) => p);
      if (allPassed) {
        r.lap++;
        r.passedCheckpoints.fill(false);
        if (r.isPlayer || r.isPlayer2) {
          g.sfx.deliver();
          g.shake(0.5);
          particles.burst(r.x, r.y, r.accent, 32);
        }
      } else if (r.isPlayer && r.lap > 0) {
        // Reject invalid lap (missed CP / reverse / via offroad / ...).
        // Kept P1-only: the on-screen warning would clutter 2P UI.
        lapWarningT = 1.8;
        g.sfx.bump();
      }
    }
    r.progress = newProg;
  }

  function aiStep(r: Racer, dt: number) {
    // Look 2 segments ahead for the next waypoint.
    const n = nearest(r.x, r.y);
    const targetIdx = (n.idx + 2) % N_WP;
    const target = waypoints[targetIdx];

    const dx = target.x - r.x;
    const dy = target.y - r.y;
    const desired = Math.atan2(dy, dx);
    let diff = desired - r.theta;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;

    r.w = Math.max(-2.6, Math.min(2.6, diff * 4));

    // Slow down on tight curves.
    const turnSlow = Math.max(0.55, 1 - Math.abs(diff) * 0.7);
    const aiBase = 175; // slightly slower — gives the player an edge
    r.v = aiBase * turnSlow;

    r.theta += r.w * dt;
    r.x += r.v * Math.cos(r.theta) * dt;
    r.y += r.v * Math.sin(r.theta) * dt;
  }

  function humanStep(r: Racer, input: PlayerInput, dt: number) {
    let lin = (input.fwd ? BASE_LIN : 0) - (input.back ? BASE_LIN : 0);
    const ang = (input.right ? BASE_ANG : 0) - (input.left ? BASE_ANG : 0);

    // Boost.
    r.boosting = input.boost && r.boostMeter > 0 && lin > 0;
    if (r.boosting) {
      lin *= BOOST_MULT;
      r.boostMeter = Math.max(0, r.boostMeter - BOOST_USE * dt);
      // Flame particles (rear).
      if (Math.random() < 0.7) {
        const px = r.x + Math.cos(r.theta + Math.PI) * 14 + (Math.random() - 0.5) * 6;
        const py = r.y + Math.sin(r.theta + Math.PI) * 14 + (Math.random() - 0.5) * 6;
        particles.push({
          x: px,
          y: py,
          vx: Math.cos(r.theta + Math.PI) * 80 + (Math.random() - 0.5) * 30,
          vy: Math.sin(r.theta + Math.PI) * 80 + (Math.random() - 0.5) * 30,
          life: 0.35,
          age: 0,
          color: Math.random() < 0.5 ? "#fbbf24" : "#fb7185",
          size: 2.5 + Math.random() * 2,
        });
      }
    } else {
      r.boostMeter = Math.min(BOOST_MAX, r.boostMeter + BOOST_REGEN * dt);
    }

    // Offroad check.
    const n = nearest(r.x, r.y);
    if (n.dist > ROAD_HALF) {
      lin *= OFF_ROAD_MULT;
      // Dust particles.
      if (Math.random() < 0.35 && Math.abs(lin) > 0) {
        particles.push({
          x: r.x + (Math.random() - 0.5) * 14,
          y: r.y + (Math.random() - 0.5) * 14,
          vx: (Math.random() - 0.5) * 30,
          vy: -Math.random() * 30 - 10,
          life: 0.5,
          age: 0,
          color: "rgba(180, 160, 120, 0.8)",
          size: 1.5 + Math.random() * 1.5,
        });
      }
    }

    r.v = lin;
    r.w = ang;
    r.theta += r.w * dt;
    const nx = r.x + r.v * Math.cos(r.theta) * dt;
    const ny = r.y + r.v * Math.sin(r.theta) * dt;

    // Canvas bounds.
    if (nx > ROBOT_R && nx < W - ROBOT_R) r.x = nx;
    if (ny > ROBOT_R && ny < H - ROBOT_R) r.y = ny;
  }

  function update(dt: number) {
    // Toggle 1P/2P even during countdown.
    if (twoPlayer.pollToggleEdge()) setMode2P(!mode2P);

    particles.update(dt);
    if (lapWarningT > 0) lapWarningT = Math.max(0, lapWarningT - dt);
    if (cleared) return;

    if (raceState === "countdown") {
      countdownT += dt;
      if (countdownT >= COUNTDOWN_LEN) {
        raceState = "racing";
        elapsed = 0;
        g.sfx.start();
        g.setStatus(t("racing.status.race"), "var(--ok)");
      }
      return;
    }

    if (raceState === "finished") return;

    elapsed += dt;

    // P1 always reads via the helper (in 1P, the helper still tracks WASD/pad-0).
    humanStep(player, twoPlayer.pollP1(), dt);
    if (mode2P) {
      humanStep(opp1, twoPlayer.pollP2(), dt);
    } else {
      aiStep(opp1, dt);
    }
    aiStep(opp2, dt);

    // Lap check.
    racers.forEach(updateLap);

    // Race-finish check: triggered by EITHER human player completing all laps.
    let finisher: Racer | null = null;
    if (player.lap >= TOTAL_LAPS && !player.finishedAt) finisher = player;
    else if (mode2P && opp1.lap >= TOTAL_LAPS && !opp1.finishedAt) finisher = opp1;

    if (finisher) {
      finisher.finishedAt = elapsed;
      raceState = "finished";
      cleared = true;
      const ranked = rankRacers();
      let stars: number;
      let stats: string;
      if (mode2P) {
        const winner = finisher === player ? "P1" : "P2";
        const margin = Math.abs(player.progress - opp1.progress);
        stars = margin > 0.4 ? 3 : margin > 0.15 ? 2 : 1;
        stats =
          `Winner    <b>${winner}</b><br>` +
          `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
          `Lap times <b>${finisher.lap}</b> / ${TOTAL_LAPS}`;
      } else {
        const pos = ranked.findIndex((r) => r.isPlayer) + 1;
        stars = pos === 1 ? 3 : pos === 2 ? 2 : 1;
        stats =
          `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
          `Position  <b>${posLabel(pos)}</b> / ${racers.length}<br>` +
          `Lap times <b>${player.lap}</b> / ${TOTAL_LAPS}`;
      }
      g.shake(0.7);
      particles.burst(finisher.x, finisher.y, COLORS.OK, 50);
      g.setTimeout(() => {
        g.sfx.clear();
        g.showClear(stars, stats);
      }, 700);
    }

    g.ghost.recordPose(elapsed, player.x, player.y, player.theta);

    // Topic publish
    pubAcc += dt;
    if (pubAcc > 1 / 12) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(player.v / BASE_LIN, player.w));
      if (mode2P) {
        g.publish("/p2/cmd_vel", fmtTwist(opp1.v / BASE_LIN, opp1.w));
      } else {
        g.publish(
          "/opponent_red/odom",
          `nav_msgs/msg/Odometry pose:(${opp1.x.toFixed(0)},${opp1.y.toFixed(0)})`,
        );
      }
      g.publish(
        "/opponent_lime/odom",
        `nav_msgs/msg/Odometry pose:(${opp2.x.toFixed(0)},${opp2.y.toFixed(0)})`,
      );
    }
    lastLapPubAcc += dt;
    if (lastLapPubAcc > 0.5) {
      lastLapPubAcc = 0;
      g.publish("/race/lap", `std_msgs/msg/Int32 data:${player.lap}`);
    }

    const ranked = rankRacers();
    const pos = ranked.findIndex((r) => r.isPlayer) + 1;

    g.setStatus(
      t("racing.status.lap", { cur: Math.min(player.lap + 1, TOTAL_LAPS), total: TOTAL_LAPS, pos }),
      "",
    );
    const hudLines = [
      `pose:${formatPose(player)}`,
      `cmd_vel:${formatTwist({ v: player.v, w: player.w }, { pxPerM: BASE_LIN })}`,
      `lap:      ${player.lap} / ${TOTAL_LAPS}`,
      `position: ${posLabel(pos)} / ${racers.length}`,
      `boost P1: ${"█".repeat(Math.round(player.boostMeter / 10)).padEnd(10, "·")}  ${player.boosting ? "ON" : "  "}`,
    ];
    if (mode2P) {
      hudLines.push(
        `boost P2: ${"█".repeat(Math.round(opp1.boostMeter / 10)).padEnd(10, "·")}  ${opp1.boosting ? "ON" : "  "}`,
      );
    }
    g.setHud(hudLines);
  }

  function rankRacers(): Racer[] {
    return [...racers].sort((a, b) => {
      if (a.lap !== b.lap) return b.lap - a.lap;
      return b.progress - a.progress;
    });
  }

  function posLabel(p: number): string {
    return p === 1 ? "1st" : p === 2 ? "2nd" : p === 3 ? "3rd" : `${p}th`;
  }

  // ---- Render ----
  function draw() {
    const ctx = g.ctx;

    // Grass (offroad).
    ctx.fillStyle = "#0a1428";
    ctx.fillRect(0, 0, W, H);
    // Dotted grass texture.
    ctx.fillStyle = "rgba(94, 234, 212, 0.05)";
    for (let i = 0; i < 80; i++) {
      const seed = i * 7919;
      const x = (seed * 1.3) % W;
      const y = (seed * 2.7) % H;
      ctx.fillRect(x, y, 1, 1);
    }

    drawRoad(ctx);
    drawStartLine(ctx);
    drawCheckpoints(ctx);

    particles.draw(ctx);

    // Ghost replay.
    g.ghost.draw(ctx, elapsed, elapsed);

    // Rivals first, player on top.
    drawCar(ctx, opp1, elapsed);
    drawCar(ctx, opp2, elapsed);
    drawCar(ctx, player, elapsed);

    drawRaceUI(ctx);

    if (raceState === "countdown") drawCountdown(ctx);

    drawTimer(ctx, elapsed, g.getBestTime());
    drawHint(
      ctx,
      t(mode2P ? "racing.hint2p" : "racing.hint", {
        pads: twoPlayer.padCount(),
      }),
    );
  }

  function drawRoad(ctx: CanvasRenderingContext2D) {
    // Inflate the center line ± ROAD_HALF to form the road polygon.
    const left: Pt[] = [];
    const right: Pt[] = [];
    for (let i = 0; i < N_WP; i++) {
      const prev = waypoints[(i - 1 + N_WP) % N_WP];
      const next = waypoints[(i + 1) % N_WP];
      const tx = next.x - prev.x;
      const ty = next.y - prev.y;
      const len = Math.hypot(tx, ty);
      const ux = tx / len,
        uy = ty / len;
      const nx = -uy,
        ny = ux;
      left.push({ x: waypoints[i].x + nx * ROAD_HALF, y: waypoints[i].y + ny * ROAD_HALF });
      right.push({ x: waypoints[i].x - nx * ROAD_HALF, y: waypoints[i].y - ny * ROAD_HALF });
    }

    // road fill
    ctx.fillStyle = "#3a3a52";
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < N_WP; i++) ctx.lineTo(left[i].x, left[i].y);
    for (let i = N_WP - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.fill();

    // Curbs (1px lines on each side).
    ctx.strokeStyle = "#fef3e8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left[0].x, left[0].y);
    for (let i = 1; i < N_WP; i++) ctx.lineTo(left[i].x, left[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(right[0].x, right[0].y);
    for (let i = 1; i < N_WP; i++) ctx.lineTo(right[i].x, right[i].y);
    ctx.closePath();
    ctx.stroke();

    // Center line (yellow dashed).
    ctx.save();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 14]);
    ctx.beginPath();
    ctx.moveTo(waypoints[0].x, waypoints[0].y);
    for (let i = 1; i < N_WP; i++) ctx.lineTo(waypoints[i].x, waypoints[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawStartLine(ctx: CanvasRenderingContext2D) {
    // Checker band perpendicular to the direction of travel, 1-3px wide,
    // straddling wp[0].
    const a = waypoints[0];
    const b = waypoints[1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(dy, dx));
    // Checker: 4 rows stacked vertically, width ±halfW.
    const chSize = 6;
    const cols = Math.ceil((ROAD_HALF * 2) / chSize);
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < 3; r++) {
        const black = (c + r) % 2 === 0;
        ctx.fillStyle = black ? "#0c0c1a" : "#fef3e8";
        ctx.fillRect(-2 + r * 2, -ROAD_HALF + c * chSize, 2, chSize);
      }
    }
    ctx.restore();
  }

  function drawCheckpoints(ctx: CanvasRenderingContext2D) {
    // Waypoints (AI guides, drawn subtly).
    ctx.save();
    ctx.fillStyle = "rgba(125, 211, 252, 0.10)";
    for (let i = 0; i < N_WP; i++) {
      ctx.beginPath();
      ctx.arc(waypoints[i].x, waypoints[i].y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Mid-track checkpoints (displayed relative to the player).
    const passed = player.passedCheckpoints;
    // Next CP to hit (first unvisited).
    const nextIdx = passed.findIndex((p) => !p);
    for (let i = 0; i < CP_COUNT; i++) {
      const cp = CHECKPOINTS[i];
      const isPassed = passed[i];
      const isNext = i === nextIdx;
      ctx.save();
      // Base circle (semi-transparent).
      const baseAlpha = isPassed ? 0.12 : isNext ? 0.18 : 0.08;
      ctx.globalAlpha = baseAlpha;
      ctx.fillStyle = isPassed ? "#5eead4" : "#fbbf24";
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 18, 0, Math.PI * 2);
      ctx.fill();
      // Outline.
      ctx.globalAlpha = isPassed ? 0.55 : isNext ? 0.85 : 0.4;
      ctx.strokeStyle = isPassed ? "#5eead4" : "#fbbf24";
      ctx.lineWidth = isNext ? 2 : 1.2;
      if (isNext) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label.
      ctx.globalAlpha = 1;
      ctx.fillStyle = isPassed ? "#5eead4" : "#fbbf24";
      ctx.font = "700 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(isPassed ? "✓" : `CP${i + 1}`, cp.x, cp.y);
      // Pulse expand when this is the "next" CP.
      if (isNext) {
        const pulse = 0.4 + 0.5 * Math.abs(Math.sin(elapsed * 4));
        ctx.globalAlpha = pulse * 0.5;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 14 + pulse * 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawCar(ctx: CanvasRenderingContext2D, r: Racer, t: number) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.theta);
    drawCarBody(ctx, r, t);
    ctx.restore();
    // Name tag.
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(r.x - 16, r.y - 26, 32, 11);
    ctx.fillStyle = r.bodyColor;
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText(r.name, r.x, r.y - 18);
    ctx.restore();
  }

  function drawCarBody(ctx: CanvasRenderingContext2D, r: Racer, t: number) {
    const px = (x: number, y: number, w: number, h: number, c: string) => {
      ctx.fillStyle = c;
      ctx.fillRect(x, y, w, h);
    };
    const bob = Math.round(Math.sin((t + (r.isPlayer ? 0 : 1.7)) * 1.6));
    px(-9, 14, 19, 1, "rgba(0,0,0,0.32)");

    ctx.save();
    ctx.translate(0, bob);

    // Body (outline via 4-direction shift).
    const sil = (color: string, dx = 0, dy = 0) => {
      const row = (y: number, halfW: number) => px(-halfW + dx, y + dy, halfW * 2 + 1, 1, color);
      row(-10, 6);
      row(-9, 8);
      row(-8, 9);
      for (let y = -7; y <= 7; y++) row(y, 10);
      row(8, 9);
      row(9, 8);
      row(10, 6);
    };
    sil(r.outline, 0, -1);
    sil(r.outline, 0, 1);
    sil(r.outline, -1, 0);
    sil(r.outline, 1, 0);
    sil(r.bodyColor);
    px(-9, 7, 19, 1, "rgba(0,0,0,0.22)");

    // Eyes — humans blink, AIs stay open.
    const blink = (r.isPlayer || r.isPlayer2) && Math.sin(t * 1.5) > 0.95;
    if (blink) {
      px(2, -2, 2, 1, r.outline);
      px(2, 2, 2, 1, r.outline);
    } else {
      px(2, -3, 2, 2, r.outline);
      px(2, 1, 2, 2, r.outline);
      px(3, -3, 1, 1, "#ffffff");
      px(3, 1, 1, 1, "#ffffff");
    }
    // Forward accent.
    px(10, -1, 1, 3, r.accent);
    // Top and bottom tires (black lines).
    px(-3, -11, 6, 1, r.outline);
    px(-3, 10, 6, 1, r.outline);

    ctx.restore();
  }

  function drawRaceUI(ctx: CanvasRenderingContext2D) {
    // Top-left: LAP.
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(12, 12, 110, 42, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.FG_DIM;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("LAP", 22, 24);
    ctx.fillStyle = COLORS.ACCENT;
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.textAlign = "right";
    const lapShow = Math.min(player.lap + 1, TOTAL_LAPS);
    ctx.fillText(`${lapShow}/${TOTAL_LAPS}`, 110, 46);

    // Top-center: position. (Top-right is reserved for the TIME panel
    // drawn by drawTimer(), so we sit between LAP and TIME.)
    const ranked = rankRacers();
    const pos = ranked.findIndex((rr) => rr.isPlayer) + 1;
    const posW = 120;
    const posX = (W - posW) / 2;
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.35)";
    ctx.beginPath();
    ctx.roundRect(posX, 12, posW, 42, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = COLORS.FG_DIM;
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("POSITION", posX + 10, 24);
    ctx.fillStyle = pos === 1 ? "#fbbf24" : COLORS.ACCENT;
    ctx.font = "700 22px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${posLabel(pos)}/${racers.length}`, posX + posW - 10, 46);
    ctx.restore();

    // Boost meter (bottom-left).
    drawBoostBar(ctx);

    // Ranking (right).
    drawMiniRanking(ctx, ranked);

    // Final-lap announcement.
    if (player.lap === TOTAL_LAPS - 1 && raceState === "racing") {
      ctx.save();
      ctx.fillStyle = `rgba(251, 191, 36, ${0.6 + 0.3 * Math.sin(elapsed * 6)})`;
      ctx.font = "700 11px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("★ FINAL LAP ★", W / 2, 30);
      ctx.restore();
    }

    // Invalid-lap rejection notice.
    if (lapWarningT > 0) {
      ctx.save();
      const a = Math.min(1, lapWarningT * 1.5);
      ctx.fillStyle = `rgba(251, 113, 133, ${0.85 * a})`;
      ctx.font = "700 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("LAP NOT COUNTED — missed a checkpoint", W / 2, H / 2 + 60);
      ctx.fillStyle = `rgba(251, 113, 133, ${0.5 * a})`;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText("CP1→CP2→CP3 を順番に通過する必要があります", W / 2, H / 2 + 78);
      ctx.restore();
    }

    // Reverse-direction warning.
    if (raceState === "racing" && isWrongWay()) {
      ctx.save();
      const blink = 0.5 + 0.5 * Math.sin(elapsed * 8);
      ctx.fillStyle = `rgba(251, 113, 133, ${0.7 + 0.3 * blink})`;
      ctx.font = "700 16px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.fillText("⚠  WRONG WAY  ⚠", W / 2, H / 2 - 60);
      ctx.restore();
    }
  }

  // Look at the last 0.5s of progress to detect reverse driving.
  let recentProgressSamples: { t: number; p: number }[] = [];
  function isWrongWay(): boolean {
    const now = elapsed;
    recentProgressSamples = recentProgressSamples.filter((s) => now - s.t < 0.6);
    recentProgressSamples.push({ t: now, p: player.progress });
    if (recentProgressSamples.length < 3) return false;
    // Total progress delta (wrap-aware).
    let delta = 0;
    for (let i = 1; i < recentProgressSamples.length; i++) {
      let d = recentProgressSamples[i].p - recentProgressSamples[i - 1].p;
      if (d > 0.5) d -= 1; // 0.05 → 0.95 (reverse wrap)
      if (d < -0.5) d += 1; // 0.95 → 0.05 (forward wrap)
      delta += d;
    }
    return delta < -0.01; // non-trivial progress in the reverse direction
  }

  function drawBoostBarFor(ctx: CanvasRenderingContext2D, racer: Racer, label: string, y: number) {
    const w = 130,
      h = 8,
      x = 18;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = "#0a0e1f";
    ctx.fillRect(x, y, w, h);
    const frac = racer.boostMeter / BOOST_MAX;
    ctx.fillStyle = racer.boosting ? "#fbbf24" : "#fb7185";
    ctx.fillRect(x, y, w * frac, h);
    ctx.font = "600 9px ui-monospace, monospace";
    ctx.fillStyle = COLORS.FG_DIM;
    ctx.fillText(`${label}  ${Math.round(frac * 100)}%`, x, y - 4);
    ctx.restore();
  }

  function drawBoostBar(ctx: CanvasRenderingContext2D) {
    if (mode2P) {
      drawBoostBarFor(ctx, opp1, "BOOST P2  [RShift / pad-2 trigger]", H - 22);
      drawBoostBarFor(ctx, player, "BOOST P1  [Shift / X / pad trigger]", H - 50);
    } else {
      drawBoostBarFor(ctx, player, "BOOST  [X]", H - 38);
    }
  }

  function drawMiniRanking(ctx: CanvasRenderingContext2D, ranked: Racer[]) {
    ctx.save();
    const h = 18 * ranked.length + 18;
    const x = W - 130,
      y = 70;
    ctx.fillStyle = withA(theme.scrim, 0.78);
    ctx.strokeStyle = "rgba(125,211,252,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, 118, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = COLORS.FG_DIM;
    ctx.textAlign = "left";
    ctx.fillText("RANKING", x + 8, y + 12);
    ranked.forEach((rr, i) => {
      const ry = y + 22 + i * 18;
      ctx.fillStyle = rr.bodyColor;
      ctx.fillRect(x + 8, ry, 6, 6);
      ctx.fillStyle = rr.isPlayer ? COLORS.ACCENT : COLORS.FG_DIM;
      ctx.font = "700 10px ui-monospace, monospace";
      ctx.fillText(`P${i + 1}`, x + 20, ry + 6);
      ctx.fillStyle = rr.isPlayer ? COLORS.FG : COLORS.FG_DIM;
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(rr.name, x + 42, ry + 6);
      ctx.fillStyle = COLORS.FG_DIM;
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`L${rr.lap}`, x + 110, ry + 6);
      ctx.textAlign = "left";
    });
    ctx.restore();
  }

  function drawCountdown(ctx: CanvasRenderingContext2D) {
    const remaining = COUNTDOWN_LEN - countdownT;
    let text = "GO!";
    let color: string = COLORS.OK;
    if (remaining > 2.5) {
      text = "3";
      color = COLORS.WARN;
    } else if (remaining > 1.5) {
      text = "2";
      color = COLORS.WARN;
    } else if (remaining > 0.5) {
      text = "1";
      color = "#fb7185";
    }

    // Last 0.5s: GO! appears.
    const phase =
      text === "GO!"
        ? Math.min(1, (0.5 - remaining) / 0.5) // expand from 0..1
        : 1 - (remaining % 1); // pulse per count

    ctx.save();
    ctx.translate(W / 2, H / 2);
    const scale = text === "GO!" ? 1 + (1 - Math.min(1, phase * 2)) * 1.5 : 1 + phase * 0.3;
    ctx.scale(scale, scale);
    ctx.globalAlpha = text === "GO!" ? Math.max(0, 1 - phase * 0.6) : 0.85 + phase * 0.15;
    ctx.fillStyle = color;
    ctx.font = "700 96px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  function dispose() {
    overlayPanel?.dispose();
    overlayPanel = null;
    disposeLangSync?.();
    disposeLangSync = null;
    twoPlayer.setActive(false);
    twoPlayer.uninstallToggleListener();
  }

  return {
    id: "racing",
    name: "Racing",
    lesson: "",
    lessonCmd: "ros2 action info /follow_path",
    ros2: {
      title: tx(
        "Action ・経路追従の自律ナビゲーション",
        "Action — autonomous path-following navigation",
      ),
      summary:
        "AI 対戦相手は事前計算された /race/path を Nav2 の FollowPath Action で自律走行している、" +
        "という想定です。Pub-Sub と違い Action は「ゴールを送って結果を待ち、途中でフィードバックを受ける」長時間タスク。" +
        "/race/lap には現在のラップ数が Int32 で publish されます。",
      msgTypes: ["nav_msgs/msg/Path", "std_msgs/msg/Int32", "nav2_msgs/action/FollowPath"],
      cli: [
        "ros2 topic echo /race/lap",
        "ros2 topic echo /opponent_red/odom",
        "ros2 action list",
        "ros2 action info /follow_path",
      ],
      python: `from rclpy.action import ActionClient
from nav2_msgs.action import FollowPath

class Racer(Node):
    def __init__(self):
        super().__init__('racer')
        self.cli = ActionClient(self, FollowPath, '/follow_path')

    async def race(self, path):
        await self.cli.wait_for_server()
        goal = FollowPath.Goal()
        goal.path = path
        send = await self.cli.send_goal_async(goal)
        result = await send.get_result_async()`,
      realWorld: tx(
        "Nav2 の FollowPath Action は、実機でも controller server に経路追従を依頼するために使われます。AGV や配送ロボの構成は製品ごとに異なりますが、経路を受け取り追従制御を行う考え方は共通します。",
        "Nav2's FollowPath Action is also used on physical robots to ask the controller server to follow a path. AGV and delivery-robot architectures vary, but many share the idea of receiving a path and executing path-following control.",
      ),
      state: {
        nodes: ["/player", "/opponent_red", "/opponent_lime", "/race_director"],
        topics: [
          { name: "/cmd_vel", type: "geometry_msgs/msg/Twist", pub: ["/player"], sub: [] },
          {
            name: "/opponent_red/odom",
            type: "nav_msgs/msg/Odometry",
            pub: ["/opponent_red"],
            sub: [],
          },
          {
            name: "/opponent_lime/odom",
            type: "nav_msgs/msg/Odometry",
            pub: ["/opponent_lime"],
            sub: [],
          },
          { name: "/race/lap", type: "std_msgs/msg/Int32", pub: ["/race_director"], sub: [] },
          {
            name: "/race/path",
            type: "nav_msgs/msg/Path",
            pub: ["/race_director"],
            sub: ["/opponent_red", "/opponent_lime"],
          },
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
  order: 5,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="action client sends goal, server streams feedback and result">
  <defs>
    <marker id="ld-racing-arrow-goal" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-racing-arrow-fb" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
    <marker id="ld-racing-arrow-res" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fb7185"/>
    </marker>
  </defs>
  <rect x="8" y="22" width="138" height="76" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="77" y="52" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">race_client</text>
  <text x="77" y="74" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Action Client</text>
  <rect x="274" y="22" width="138" height="76" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="343" y="52" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">FollowPath</text>
  <text x="343" y="74" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Action Server</text>
  <line x1="146" y1="38" x2="272" y2="38" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-racing-arrow-goal)"/>
  <text x="209" y="32" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Goal</text>
  <line x1="272" y1="60" x2="146" y2="60" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-racing-arrow-fb)"/>
  <text x="209" y="55" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Feedback (cont.)</text>
  <line x1="272" y1="86" x2="146" y2="86" stroke="#fb7185" stroke-width="2" marker-end="url(#ld-racing-arrow-res)"/>
  <text x="209" y="80" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="11" font-weight="700">Result</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Action / Nav2 FollowPath — 経路に追従する",
      en: "Action / Nav2 FollowPath — tracking a path",
    },
    learn: {
      ja: "Nav2 の FollowPath は Action で実装されており、Goal を送ると Feedback で進捗を返しつつ Result で完了を知らせます。レースでは決まったコースを高速に追従します。",
      en: "Nav2's FollowPath is implemented as an Action: send a Goal, receive progress Feedback while it runs, then get a final Result. Racing means tracking a fixed path as fast as possible.",
    },
    goal: {
      ja: "WASD で操縦、Shift か X でブースト!\n3 周走り切って AI の対戦相手より先にフィニッシュすれば 1 位クリア。",
      en: "WASD to steer, Shift or X to boost!\nFinish 3 laps before the AI opponents to take 1st place.",
    },
    first: {
      ja: "1PはWASDで発進し、X（Shift）でBOOST。Pad対戦はPadを2台接続してYを押すと開始できます。P1・P2とも左スティックで走行、LB/RBでBOOSTします。",
      en: "In 1P, drive with WASD and boost with X (Shift). For a pad battle, connect two pads and press Y. Both players drive with the left stick and boost with LB/RB.",
    },
  },
  strings: {
    ja: {
      hint: "1P · WASD/左スティック 走行 · X/LB/RB BOOST · Y → 2P PAD（接続 {pads}/2）",
      hint2p: "🎮 2P PAD（接続 {pads}/2）· P1/P2 左スティック 走行 · LB/RB BOOST · Y → 1P",
      "status.countdown": "3...2...1... GO!",
      "status.lap": "LAP {cur} / {total}  ·  P{pos}",
      "status.race": "RACE!",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD対戦",
    },
    en: {
      hint: "1P · WASD/LEFT STICK drive · X/LB/RB BOOST · Y → 2P PAD ({pads}/2)",
      hint2p: "🎮 2P PAD ({pads}/2) · P1/P2 LEFT STICK drive · LB/RB BOOST · Y → 1P",
      "status.countdown": "3...2...1... GO!",
      "status.lap": "LAP {cur} / {total}  ·  P{pos}",
      "status.race": "RACE!",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD BATTLE",
    },
  },
  build: makeGrandPrix,
});
