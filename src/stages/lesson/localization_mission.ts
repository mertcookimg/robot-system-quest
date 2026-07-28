// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// localization_mission: Monte Carlo Localization (Particle Filter / AMCL)
// Sequel to mapping_mission: the map is now KNOWN and the unknown is the
// robot's own pose. Scatter ~300 hypotheses (particles) across the map, then
// drive with WASD teleop. Every step each particle is moved like the robot
// (motion update) and re-weighted by how well its predicted LiDAR scan
// matches the robot's real scan (measurement update); a low-variance
// resampler kills bad hypotheses and multiplies good ones until the cloud
// collapses onto the true pose.
//
// GOAL (GLOBAL LOCALIZATION): fill the LOCALIZE meter by converging the cloud
// onto the robot, then hold it — clear. GLOBAL RELOCALIZE (G key / screen
// button = ROS `/reinitialize_global_localization`) re-scatters the cloud at
// any time: an optional toy for replaying the convergence, and a nod to the
// kidnapped-robot problem it exists to solve.
import { type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawHint,
  drawTimer,
  fmtTwist,
  drawRobotBody,
  drawRobotLabel,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { makeOverlayPanel } from "../../lib/overlay_panel";
import { t, tx } from "../../i18n";

// ── Room grid (KNOWN map). TWO IDENTICAL ROOMS that are exact TRANSLATED copies
//    of each other (left room cols 1-5, right room cols 7-11, shifted +6), joined
//    by a shared corridor along the top (row 1). Translation — not mirroring — is
//    deliberate: the likelihood compares LiDAR beams by index, and a reflection
//    reverses beam order, so a mirror twin would NOT actually score equally. A
//    translated twin (same heading) produces a byte-identical scan, so the filter
//    genuinely cannot tell the two rooms apart and holds BOTH as candidates. The
//    single exception is one LANDMARK wall in the right room (row 7, col 10) with
//    no left-room twin: the whole puzzle is to drive to where that asymmetry
//    shows up and collapse the two candidates into one. ──
const TILE = 38;
const COLS = 14;
const ROWS = 10;
const ROBOT_R = 12;
const WORLD_Y = 30;

const LIN_SPEED = 120;
const ANG_SPEED = 2.2;
const PX_PER_M = 100;

// 0 = free, 1 = wall. The two rooms are translation-symmetric (col c in 1-5 ↔ col
// c+6 in 7-11) EXCEPT the landmark at row 7 / col 10 — see the comment above.
// prettier-ignore
const maze: number[][] = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,1],  // top corridor joins the two rooms
  [1,1,1,0,1,1,1,1,1,0,1,1,1,1],  // room ceilings; doorways at col3 & col9
  [1,0,0,0,0,0,1,0,0,0,0,0,1,1],  // Upper half of each room kept OPEN so the start
  [1,0,0,0,0,0,1,0,0,0,0,0,1,1],  // and the path up to the corridor are clear.
  [1,0,0,0,0,0,1,0,0,0,0,0,1,1],  // START sits here, in open space.
  [1,0,1,0,1,0,1,0,1,0,1,0,1,1],  // Lower half carries the SAME pillar pattern in
  [1,0,0,0,0,0,1,0,0,0,1,0,1,1],  // both rooms (left cols1-5 == right cols7-11 +6),
  [1,0,0,0,0,0,1,0,0,0,0,0,1,1],  // except the LANDMARK at col10/row7 (no twin col4)
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];
// The lone landmark cell that breaks the translation symmetry — deep in the
// right room, far from the start's twin, so both candidates survive until the
// robot drives across and down to it.
const LANDMARK = { col: 10, row: 7 };

// Start in the LEFT room's centre, whose translated twin (right room centre)
// looks identical from here — so the cloud splits into two candidates and stays
// split until the robot drives across to where the landmark tells them apart.
const START = { col: 3, row: 5 };

// ── Particle filter tuning ──
const N_PARTICLES = 600; // hypotheses scattered across the map. Higher than a
// plain AMCL demo on purpose: both mirror chambers must
// stay well-populated so the two candidates are visibly
// held side by side instead of one starving out.
const N_BEAMS = 12; // LiDAR beams used for the likelihood. Enough to lock the
// pose WITHIN a room quickly, so each room-blob is tight
// and the filter reliably converges once the ambiguity is
// resolved — the two identical rooms supply the ambiguity.
const MCL_HZ = 10; // filter update rate (decoupled from 60 fps render)
const MAX_RANGE = 150; // LiDAR range in px (1.5 m). Deliberately short so the
// robot sees only its local surroundings: from the
// start corner it cannot see the distant landmark, so
// the left- and right-chamber hypotheses look equally
// good and BOTH survive. The player has to drive down
// toward the landmark to break the tie. (A long range
// would reveal the landmark instantly and collapse the
// ambiguity before it can be seen.)
const RAY_STEP = 6; // raycast marching step in px
const SIGMA = 64; // measurement noise std in px (Gaussian beam model).
// Tight enough for each room-blob to gather and the
// filter to commit reliably once the two rooms are told
// apart, soft enough that the two identical rooms keep
// comparable weight until the landmark breaks the tie.
const Z_RAND = 0.05; // per-beam uniform mixture term (AMCL's z_rand). Slightly
// raised so ordinary beam mismatches barely dent a
// particle, keeping both chambers alive till the landmark
const TRANS_NOISE = 0.14; // motion noise: fraction of translation
const TRANS_NOISE_MIN = 1.6;
const ANG_NOISE = 0.11; // motion noise: fraction of rotation
const ANG_NOISE_MIN = 0.02;
const INJECT_FRAC = 0.06; // 6% random particles injected each resample — a touch
// higher so a chamber that briefly loses population
// gets re-seeded and the tie is restored
const COPY_JITTER_POS = 2.2;
const COPY_JITTER_ANG = 0.03;
// Only run a filter step after enough motion (AMCL's update_min_d / update_min_a):
// resampling a static robot destroys diversity without adding information.
const UPDATE_MIN_D = 3; // px of accumulated translation
const UPDATE_MIN_A = 0.04; // rad of accumulated rotation

// ── Convergence criteria — all computed over the DOMINANT CLUSTER (particles
//    near the best hypothesis), so the random injections and stray modes can
//    never poison the metric the way a global weighted mean would. ──
const CLUSTER_R = 70; // px: particles within this radius of the best particle
const SHARE_THRESH = 0.6; // cluster must hold >60% of the total weight
const COUNT_THRESH = 0.25; // ...and >25% of the particles — blocks a single lucky
// particle grabbing the weight from counting as converged
const SPREAD_THRESH = 42; // cluster position std must drop below this (px)
const ERR_THRESH = 34; // estimate-vs-truth error must drop below this (px)
const HOLD = 1.5; // ...sustained for this long (s) to count as converged

// ── Candidate (mode) counting — how many distinct high-weight hypotheses
//    still survive. Starts high with a global scatter, drops step by step to 1
//    as the robot drives past features that rule modes out. This is the readout
//    that makes "narrowing down" visible; it does NOT gate the clear. ──
const MODE_R = 60; // px: particles within this radius = same candidate
const MODE_MIN_SHARE = 0.15; // a cluster holding >15% of the PARTICLES counts as
// a real surviving candidate. Counting particles (not
// weight) tracks where the cloud physically sits — the
// weight can spike onto one mode long before the dots
// actually gather there, so it is a poor "candidates"
// readout.
const GATHER_SHARE = 0.22; // until the biggest cluster holds this share, the
// cloud hasn't gathered anywhere yet — it is still a
// diffuse global scatter (report "many", not a count).

// Side panel layout (right of the world).
const PANEL_X = 552;
const PANEL_W = 236;

// Big LOCALIZE meter (the clear condition itself) across the top of the world.
const METER_X = 14;
const METER_Y = 5;
const METER_W = 516;
const METER_H = 20;
// The converge part fills 0..80% of the bar; the HOLD part fills the rest.
const METER_SPLIT = 0.8;

interface P {
  x: number;
  y: number;
  theta: number;
  weight: number;
}

interface Ray {
  angle: number;
  dist: number;
}

export function makeLocalizationMission(): Stage {
  let g!: GameContext;

  const robot = {
    x: START.col * TILE + TILE / 2,
    y: WORLD_Y + START.row * TILE + TILE / 2,
    theta: 0,
  };
  const cmd = { v: 0, w: 0 };
  const fx = new Particles(); // celebration/relocalize burst fx
  let cloud: P[] = []; // the particle filter hypotheses

  // Relative beam angles, evenly spaced around the robot.
  const beam: number[] = [];
  for (let i = 0; i < N_BEAMS; i++) beam.push((i / N_BEAMS) * Math.PI * 2);

  let elapsed = 0;
  let mclAcc = 0;
  let pubAcc = 0;
  let convergeTimer = 0; // time the cloud has stayed converged
  let bumpFlash = 0;
  let cleared = false;
  let prevG = false;

  // Odometry accumulated between filter steps (commanded, like a real robot's
  // wheel odometry — it does not know about collisions).
  let travelDs = 0;
  let travelDtheta = 0;

  // Estimate = weighted mean of the dominant cluster, refreshed each filter
  // step. clusterShare = fraction of total weight inside that cluster (the
  // convergence readout), spread = position std within it.
  let estX = robot.x,
    estY = robot.y,
    estTheta = 0;
  let clusterShare = 0; // weight fraction in the dominant cluster
  let clusterCount = 0; // particle-count fraction in it
  let spread = CLUSTER_R;
  let estErr = 0;
  let modeCount = 1; // distinct surviving candidates (readout)
  let diffuse = true; // cloud not gathered anywhere yet ("many")
  let modeCenters: { x: number; y: number; n: number }[] = []; // their locations

  // Robot's most recent real scan (for rendering).
  let lastScan: Ray[] = [];

  let editorEl: HTMLElement | null = null;
  let overlayHandle: { dispose(): void } | null = null;

  // ── Small helpers ──
  function cellCenter(col: number, row: number) {
    return { x: col * TILE + TILE / 2, y: WORLD_Y + row * TILE + TILE / 2 };
  }
  function gauss(): number {
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function isWall(col: number, row: number): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    return maze[row][col] === 1;
  }
  function randFreePose(): P {
    for (let tries = 0; tries < 50; tries++) {
      const col = 1 + Math.floor(Math.random() * (COLS - 2));
      const row = 1 + Math.floor(Math.random() * (ROWS - 2));
      if (maze[row][col] === 1) continue;
      return {
        x: col * TILE + TILE / 2 + (Math.random() - 0.5) * TILE * 0.6,
        y: WORLD_Y + row * TILE + TILE / 2 + (Math.random() - 0.5) * TILE * 0.6,
        theta: Math.random() * Math.PI * 2,
        weight: 1 / N_PARTICLES,
      };
    }
    const c = cellCenter(START.col, START.row);
    return { x: c.x, y: c.y, theta: Math.random() * Math.PI * 2, weight: 1 / N_PARTICLES };
  }
  function scatterAll() {
    cloud = [];
    for (let i = 0; i < N_PARTICLES; i++) cloud.push(randFreePose());
    convergeTimer = 0;
    // Refresh the metrics immediately (uniform weights → tiny cluster share).
    computeEstimate();
  }

  // Circle-vs-tile collision, identical scheme to mapping_mission.
  function canMoveTo(x: number, y: number): boolean {
    const minCol = Math.max(0, Math.floor((x - ROBOT_R) / TILE));
    const maxCol = Math.min(COLS - 1, Math.floor((x + ROBOT_R) / TILE));
    const minRow = Math.max(0, Math.floor((y - WORLD_Y - ROBOT_R) / TILE));
    const maxRow = Math.min(ROWS - 1, Math.floor((y - WORLD_Y + ROBOT_R) / TILE));
    for (let r = minRow; r <= maxRow; r++) {
      for (let c = minCol; c <= maxCol; c++) {
        if (!isWall(c, r)) continue;
        const wx = c * TILE;
        const wy = WORLD_Y + r * TILE;
        const cx = Math.max(wx, Math.min(x, wx + TILE));
        const cy = Math.max(wy, Math.min(y, wy + TILE));
        const dx = x - cx,
          dy = y - cy;
        if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
      }
    }
    return true;
  }

  // Raycast to the nearest wall from (x, y) along absolute `angle`.
  function rayDist(x: number, y: number, angle: number): number {
    const dx = Math.cos(angle),
      dy = Math.sin(angle);
    for (let d = RAY_STEP; d <= MAX_RANGE; d += RAY_STEP) {
      const col = Math.floor((x + dx * d) / TILE);
      const row = Math.floor((y + dy * d - WORLD_Y) / TILE);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return d;
      if (maze[row][col] === 1) return d;
    }
    return MAX_RANGE;
  }

  // ── One particle-filter iteration: motion → measurement → resample ──
  function mclStep() {
    // 1. Motion update — replay the accumulated odometry onto every particle
    //    with noise. Rotate first, then translate along the new heading.
    const ds = travelDs;
    const dth = travelDtheta;
    travelDs = 0;
    travelDtheta = 0;
    for (const p of cloud) {
      p.theta += dth + gauss() * (ANG_NOISE * Math.abs(dth) + ANG_NOISE_MIN);
      const d = ds + gauss() * (TRANS_NOISE * Math.abs(ds) + TRANS_NOISE_MIN);
      p.x += d * Math.cos(p.theta);
      p.y += d * Math.sin(p.theta);
    }

    // 2. Measurement update — the robot's REAL scan (ground truth pose).
    const zRobot: number[] = [];
    lastScan = [];
    for (let i = 0; i < N_BEAMS; i++) {
      const a = robot.theta + beam[i];
      const d = rayDist(robot.x, robot.y, a);
      zRobot.push(d);
      lastScan.push({ angle: a, dist: d });
    }
    // Weight each particle with a per-beam Gaussian + uniform mixture
    // (AMCL's z_hit + z_rand beam model). The uniform floor keeps the weight
    // field smooth: one wrong beam dents a particle instead of erasing it,
    // which prevents premature collapse onto a single wrong hypothesis.
    let wsum = 0;
    for (const p of cloud) {
      let w = 1;
      for (let i = 0; i < N_BEAMS; i++) {
        const zp = rayDist(p.x, p.y, p.theta + beam[i]);
        const err = zRobot[i] - zp;
        w *= Math.exp(-(err * err) / (2 * SIGMA * SIGMA)) + Z_RAND;
      }
      p.weight = w + 1e-300;
      wsum += p.weight;
    }
    if (wsum > 0) for (const p of cloud) p.weight /= wsum;
    else for (const p of cloud) p.weight = 1 / N_PARTICLES;

    // 3. Estimate (dominant-cluster mean) + spread — computed BEFORE
    //    resampling so the weights are still meaningful.
    computeEstimate();

    // 4. Low-variance resampling + a few random injections (helps recover from
    //    the kidnapped-robot problem and prevents particle depletion).
    resample();
  }

  function computeEstimate() {
    // Anchor the dominant cluster on the highest-weight particle, then take
    // the weighted mean over its neighborhood only. A global weighted mean
    // would be dragged around by injected particles and secondary modes.
    let best = cloud[0];
    for (const p of cloud) if (p.weight > best.weight) best = p;
    const r2 = CLUSTER_R * CLUSTER_R;
    let sx = 0,
      sy = 0,
      sc = 0,
      ss = 0,
      wsum = 0,
      cnt = 0;
    for (const p of cloud) {
      const dx = p.x - best.x,
        dy = p.y - best.y;
      if (dx * dx + dy * dy > r2) continue;
      sx += p.weight * p.x;
      sy += p.weight * p.y;
      sc += p.weight * Math.cos(p.theta);
      ss += p.weight * Math.sin(p.theta);
      wsum += p.weight;
      cnt++;
    }
    // Weights are normalized to 1 over the full cloud, so the cluster's
    // weight sum IS its share of the total probability mass.
    clusterShare = wsum;
    clusterCount = cnt / cloud.length;
    if (wsum > 0) {
      estX = sx / wsum;
      estY = sy / wsum;
      estTheta = Math.atan2(ss, sc);
    }
    let varsum = 0;
    for (const p of cloud) {
      const dx = p.x - best.x,
        dy = p.y - best.y;
      if (dx * dx + dy * dy > r2) continue;
      const ex = p.x - estX,
        ey = p.y - estY;
      varsum += p.weight * (ex * ex + ey * ey);
    }
    spread = wsum > 0 ? Math.sqrt(varsum / wsum) : CLUSTER_R;
    estErr = Math.hypot(estX - robot.x, estY - robot.y);
    modeCount = countModes();
  }

  // How many distinct places the cloud physically occupies right now. Greedy
  // weight-ordered clustering: walk the particles heaviest-first, drop each
  // into the first candidate within MODE_R or open a new one, then count the
  // candidates holding a meaningful share of the PARTICLES. Starts high with a
  // global scatter and drops toward 1 as driving rules candidates out.
  function countModes(): number {
    const sorted = cloud.slice().sort((a, b) => b.weight - a.weight);
    const centers: { x: number; y: number; sx: number; sy: number; n: number }[] = [];
    const r2 = MODE_R * MODE_R;
    for (const p of sorted) {
      let placed = false;
      for (const c of centers) {
        const dx = p.x - c.x,
          dy = p.y - c.y;
        if (dx * dx + dy * dy < r2) {
          c.sx += p.x;
          c.sy += p.y;
          c.n++;
          placed = true;
          break;
        }
      }
      if (!placed) centers.push({ x: p.x, y: p.y, sx: p.x, sy: p.y, n: 1 });
    }
    const N = cloud.length;
    let largest = 0;
    for (const c of centers) if (c.n > largest) largest = c.n;
    // Diffuse = nothing has gathered yet (even the densest spot is thin): the
    // cloud is still spread everywhere, which is "many candidates", not one.
    diffuse = largest < GATHER_SHARE * N;
    modeCenters = centers
      .filter((c) => c.n > MODE_MIN_SHARE * N)
      .map((c) => ({ x: c.sx / c.n, y: c.sy / c.n, n: c.n }));
    return Math.max(1, modeCenters.length);
  }

  function resample() {
    const M = cloud.length;
    const nInject = Math.floor(M * INJECT_FRAC);
    const next: P[] = [];
    // Low-variance (systematic) resampler over the whole set.
    const step = 1 / M;
    let r = Math.random() * step;
    let c = cloud[0].weight;
    let i = 0;
    for (let m = 0; m < M; m++) {
      const U = r + m * step;
      while (U > c && i < M - 1) {
        i++;
        c += cloud[i].weight;
      }
      const src = cloud[i];
      next.push({
        x: src.x + gauss() * COPY_JITTER_POS,
        y: src.y + gauss() * COPY_JITTER_POS,
        theta: src.theta + gauss() * COPY_JITTER_ANG,
        weight: 1 / M,
      });
    }
    // Replace a random handful with fresh global samples.
    for (let k = 0; k < nInject; k++) {
      next[Math.floor(Math.random() * M)] = randFreePose();
    }
    cloud = next;
  }

  function converged(): boolean {
    return (
      clusterShare > SHARE_THRESH &&
      clusterCount > COUNT_THRESH &&
      spread < SPREAD_THRESH &&
      estErr < ERR_THRESH
    );
  }

  // GLOBAL RELOCALIZE — optional: re-scatter the cloud and watch it re-converge
  // (mirrors the kidnapped-robot recovery service on a real robot).
  function relocalize() {
    if (cleared) return;
    scatterAll();
    fx.burst(robot.x, robot.y, "#c4b5fd", 24, 200);
    g.sfx.bump();
    // Mirrors: ros2 service call /reinitialize_global_localization std_srvs/srv/Empty
    g.publish(
      "/reinitialize_global_localization",
      `std_srvs/srv/Empty  → re-scattered ${N_PARTICLES} particles across the map`,
    );
    g.setStatus(t("localization_mission.status.relocalize"), "var(--accent)");
  }

  // ── Lifecycle ──
  function reset() {
    const c = cellCenter(START.col, START.row);
    robot.x = c.x;
    robot.y = c.y;
    robot.theta = 0;
    cmd.v = 0;
    cmd.w = 0;
    elapsed = 0;
    mclAcc = 0;
    pubAcc = 0;
    convergeTimer = 0;
    bumpFlash = 0;
    cleared = false;
    prevG = false;
    travelDs = 0;
    travelDtheta = 0;
    lastScan = [];
    fx.reset();
    scatterAll(); // also refreshes estimate / clusterShare / spread
    g.setStatus(t("localization_mission.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    if (editorEl) editorEl.style.display = "none";
    setupOverlay();
    reset();
  }

  function dispose() {
    overlayHandle?.dispose();
    overlayHandle = null;
  }

  function setupOverlay() {
    overlayHandle = makeOverlayPanel(
      g.overlay,
      [
        { kind: "note", text: tx("WASD で走行", "WASD to drive") },
        {
          kind: "choice",
          label: () => "",
          choices: [{ key: "reloc", label: () => t("localization_mission.btn.relocalize") }],
          active: () => "",
          onSelect: () => relocalize(),
        },
        {
          kind: "note",
          text: tx("G キーでも再散布 / R でリセット", "G key also re-scatters / R to reset"),
        },
      ],
      { placement: "dock" },
    );
  }

  // ── UPDATE ──
  function update(dt: number) {
    fx.update(dt);
    if (cleared) return;

    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    // GLOBAL RELOCALIZE on the G key (edge-triggered) — the screen button
    // calls relocalize() directly.
    const gDown = g.keys.has("g");
    if (gDown && !prevG) relocalize();
    prevG = gDown;

    // Teleop drive.
    const tw = teleop(g.keys, { baseLin: LIN_SPEED, baseAng: ANG_SPEED });
    cmd.v = tw.lin;
    cmd.w = tw.ang;

    robot.theta += cmd.w * dt;
    const nx = robot.x + cmd.v * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.v * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.v !== 0) {
      bumpFlash = 1;
      g.sfx.bump();
    }
    // Accumulate commanded odometry (collisions are invisible to odometry).
    travelDs += cmd.v * dt;
    travelDtheta += cmd.w * dt;

    // Run the particle filter at a fixed rate, but only once the robot has
    // actually moved — odometry keeps accumulating while gated, so no motion
    // is ever lost.
    mclAcc += dt;
    if (mclAcc >= 1 / MCL_HZ) {
      mclAcc = 0;
      if (Math.abs(travelDs) > UPDATE_MIN_D || Math.abs(travelDtheta) > UPDATE_MIN_A) {
        mclStep();
      }
    }
    // Keep the error readout live even between filter steps.
    estErr = Math.hypot(estX - robot.x, estY - robot.y);

    // Convergence hold timer → clear once the cloud stays converged long enough.
    if (converged()) convergeTimer += dt;
    else convergeTimer = 0;
    if (convergeTimer >= HOLD) {
      winStage();
      return;
    }

    // Periodic ROS publishes (topic names match the ROS Lab CLI examples).
    pubAcc += dt;
    if (pubAcc > 1 / 5) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(cmd.v / PX_PER_M, cmd.w));
      g.publish(
        "/amcl_pose",
        `geometry_msgs/msg/PoseWithCovarianceStamped ` +
          `x:${(estX / PX_PER_M).toFixed(2)} y:${(estY / PX_PER_M).toFixed(2)} ` +
          `θ:${estTheta.toFixed(2)} cov:${(spread / PX_PER_M).toFixed(2)}m`,
      );
      g.publish(
        "/particle_cloud",
        `nav2_msgs/msg/ParticleCloud particles:${cloud.length} spread:${(spread / PX_PER_M).toFixed(2)}m`,
      );
    }

    g.setHud(makeHud());
  }

  function winStage() {
    cleared = true;
    cmd.v = 0;
    cmd.w = 0;
    fx.burst(robot.x, robot.y, "#5eead4", 40, 260);
    g.shake(0.5);
    g.setStatus(t("localization_mission.status.clear"), "var(--ok)");
    const stars = elapsed < 30 ? 3 : elapsed < 50 ? 2 : 1;
    const stats =
      `Converged onto the true pose<br>` +
      `Final error <b>${(estErr / PX_PER_M).toFixed(2)} m</b><br>` +
      `Time <b>${elapsed.toFixed(2)} s</b>`;
    g.awardStars(stars, stats);
  }

  function convergencePct(): number {
    // Fraction of particles physically inside the dominant cluster — starts
    // near 0% with a uniform scatter and approaches 100% as the survivors
    // gather in one place. (Weight share is too jumpy for a progress bar:
    // one lucky particle can spike it for a frame.) The ~4% injected
    // particles are always elsewhere, so 90% counts as fully converged.
    return Math.min(1, clusterCount / 0.9) * 100;
  }

  // Single 0..1 progress value behind the LOCALIZE meter = the clear condition
  // itself. Gathering fills the first METER_SPLIT of the bar; the HOLD seconds
  // fill the rest. A cloud gathered in the WRONG place is discounted by the
  // estimate error, so a false convergence never fills the bar.
  function meterProgress(): number {
    if (cleared) return 1;
    const conv = convergencePct() / 100;
    const errFactor = estErr < ERR_THRESH ? 1 : Math.max(0.1, ERR_THRESH / estErr);
    const holdFrac = Math.min(1, convergeTimer / HOLD);
    return Math.min(1, METER_SPLIT * conv * errFactor + (1 - METER_SPLIT) * holdFrac);
  }

  function goalLine(): string {
    return t("localization_mission.hud.goal.step1");
  }

  // Candidate readout text: "many" while the cloud is still a diffuse scatter,
  // otherwise the number of gathered clusters.
  function modeLabel(): string {
    return diffuse && !cleared ? t("localization_mission.hud.modes.many") : `${modeCount}`;
  }
  // True only when the cloud has genuinely split into ≥2 gathered candidates
  // (a diffuse scatter is uncertainty, not a clean two-way tie).
  function isTwoWayTie(): boolean {
    return !cleared && !diffuse && modeCount >= 2;
  }

  function makeHud(): string[] {
    return [
      goalLine(),
      `${t("localization_mission.hud.meter")}: ${(meterProgress() * 100).toFixed(0)}%`,
      `${t("localization_mission.hud.modes")}: ${modeLabel()}`,
      `${t("localization_mission.hud.particles")}: ${cloud.length}`,
      `${t("localization_mission.hud.spread")}: ${(spread / PX_PER_M).toFixed(2)} m`,
      `${t("localization_mission.hud.err")}: ${(estErr / PX_PER_M).toFixed(2)} m`,
      `time: ${elapsed.toFixed(1)}s`,
    ];
  }

  // ── DRAW ──
  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);
    drawWorld(ctx);
    drawParticleCloud(ctx);
    drawCandidateRings(ctx);
    drawLidarRays(ctx);
    drawEstimate(ctx);
    // True robot sprite.
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, elapsed);
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();
    fx.draw(ctx);
    drawSidePanel(ctx);
    drawMeter(ctx);
    drawTimer(ctx, elapsed, g.getBestTime());
    drawHint(ctx, t("localization_mission.hint"));
  }

  // ── The clear condition as one big meter ──
  function drawMeter(ctx: CanvasRenderingContext2D) {
    const progress = meterProgress();
    const splitX = METER_X + METER_W * METER_SPLIT;
    ctx.save();
    // Track.
    ctx.fillStyle = withA(theme.scrim, 0.9);
    ctx.fillRect(METER_X, METER_Y, METER_W, METER_H);
    // Converge segment (blue) + hold segment (green).
    const fillW = METER_W * Math.min(progress, METER_SPLIT);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillRect(METER_X, METER_Y, fillW, METER_H);
    if (progress > METER_SPLIT) {
      ctx.fillStyle = "#5eead4";
      ctx.fillRect(splitX, METER_Y, METER_W * (progress - METER_SPLIT), METER_H);
    }
    // Split tick + border.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(splitX + 0.5, METER_Y);
    ctx.lineTo(splitX + 0.5, METER_Y + METER_H);
    ctx.stroke();
    ctx.strokeStyle = progress >= 1 ? "#5eead4" : "rgba(125,211,252,0.6)";
    ctx.strokeRect(METER_X + 0.5, METER_Y + 0.5, METER_W - 1, METER_H - 1);
    // Label + percent.
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = "#eef2ff";
    ctx.fillText(t("localization_mission.meter.label"), METER_X + 8, METER_Y + METER_H / 2 + 1);
    ctx.textAlign = "right";
    ctx.fillStyle = progress >= 1 ? "#5eead4" : "#eef2ff";
    ctx.fillText(
      progress >= 1 ? "100% ✓" : `${(progress * 100).toFixed(0)}%`,
      METER_X + METER_W - 8,
      METER_Y + METER_H / 2 + 1,
    );
    ctx.restore();
  }

  function drawWorld(ctx: CanvasRenderingContext2D) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * TILE;
        const y = WORLD_Y + r * TILE;
        if (maze[r][c] === 1) {
          const isLandmark = c === LANDMARK.col && r === LANDMARK.row;
          ctx.fillStyle = isLandmark ? "#3b2f1a" : "#1d2336";
          ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = isLandmark ? "#fbbf24" : "rgba(110,122,156,0.28)";
          ctx.lineWidth = isLandmark ? 1.5 : 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          if (isLandmark) {
            // The one asymmetric wall — the clue that breaks the tie between
            // the two candidate chambers.
            ctx.fillStyle = "#fbbf24";
            ctx.font = "700 16px ui-monospace, monospace";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("★", x + TILE / 2, y + TILE / 2 + 1);
          }
        } else {
          ctx.fillStyle = "#070b16";
          ctx.fillRect(x, y, TILE, TILE);
        }
      }
    }
  }

  function drawParticleCloud(ctx: CanvasRenderingContext2D) {
    ctx.save();
    for (const p of cloud) {
      // Overlapping particles in a cluster naturally read as brighter, so a
      // constant per-particle alpha communicates density.
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#7dd3fc";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
      ctx.fill();
      // Short heading tick.
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = "#7dd3fc";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(p.theta) * 5, p.y + Math.sin(p.theta) * 5);
      ctx.stroke();
    }
    ctx.restore();
  }

  // While more than one candidate survives, ring each cluster and label it "?"
  // so the ambiguity is unmistakable: "the robot thinks it could be HERE or
  // HERE". The rings vanish the moment the cloud collapses to a single answer.
  function drawCandidateRings(ctx: CanvasRenderingContext2D) {
    if (!isTwoWayTie()) return;
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = withA("#fbbf24", 0.85);
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of modeCenters) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = withA("#fbbf24", 0.9);
      ctx.fillText("?", c.x, c.y - 34);
    }
    ctx.restore();
  }

  function drawLidarRays(ctx: CanvasRenderingContext2D) {
    if (!lastScan.length) return;
    ctx.save();
    for (const ray of lastScan) {
      const ex = robot.x + Math.cos(ray.angle) * ray.dist;
      const ey = robot.y + Math.sin(ray.angle) * ray.dist;
      ctx.strokeStyle = "rgba(94,234,212,0.28)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(robot.x, robot.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = "#5eead4";
      ctx.beginPath();
      ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawEstimate(ctx: CanvasRenderingContext2D) {
    // Dashed line from the estimate "ghost" to the true robot = the error.
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = withA("#c4b5fd", 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(estX, estY);
    ctx.lineTo(robot.x, robot.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Estimate marker (purple diamond + heading).
    ctx.translate(estX, estY);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "#c4b5fd";
    ctx.fillStyle = withA("#c4b5fd", 0.18);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(8, 0);
    ctx.lineTo(0, 8);
    ctx.lineTo(-8, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(estTheta) * 12, Math.sin(estTheta) * 12);
    ctx.stroke();
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("EST", 0, -12);
    ctx.restore();
  }

  function drawSidePanel(ctx: CanvasRenderingContext2D) {
    const px = PANEL_X;
    const py = 40;
    const ph = 268;
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.fillRect(px, py, PANEL_W, ph);
    ctx.strokeRect(px, py, PANEL_W, ph);

    // Title.
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 12px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("PARTICLE FILTER", px + 12, py + 22);
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText("/amcl_pose", px + PANEL_W - 12, py + 22);

    // Single objective — the clear condition, visible from second 0.
    ctx.textAlign = "left";
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillStyle = cleared ? "#5eead4" : "#eef2ff";
    ctx.fillText(
      `${cleared ? "✔" : "□"} ${t("localization_mission.check.step1")}`,
      px + 12,
      py + 48,
    );

    // Candidates remaining — the headline number. Amber while the robot is
    // still unsure (many, or a two-way tie), teal once it is down to one.
    const unsure = !cleared && (diffuse || modeCount >= 2);
    ctx.font = "700 11px ui-monospace, monospace";
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText(t("localization_mission.hud.modes"), px + 12, py + 74);
    ctx.textAlign = "right";
    ctx.fillStyle = unsure ? "#fbbf24" : "#5eead4";
    ctx.fillText(modeLabel(), px + PANEL_W - 12, py + 74);

    // Numbers (plain words — the theory lives in the ROS Lab panel).
    ctx.textAlign = "left";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText(t("localization_mission.hud.particles"), px + 12, py + 100);
    ctx.fillText(t("localization_mission.hud.spread"), px + 12, py + 118);
    ctx.fillText(t("localization_mission.hud.err"), px + 12, py + 136);
    ctx.textAlign = "right";
    ctx.fillStyle = "#eef2ff";
    ctx.font = "700 10px ui-monospace, monospace";
    ctx.fillText(`${cloud.length}`, px + PANEL_W - 12, py + 100);
    ctx.fillText(`${(spread / PX_PER_M).toFixed(2)} m`, px + PANEL_W - 12, py + 118);
    ctx.fillStyle = estErr < ERR_THRESH ? "#5eead4" : "#fbbf24";
    ctx.fillText(`${(estErr / PX_PER_M).toFixed(2)} m`, px + PANEL_W - 12, py + 136);

    // Legend.
    ctx.textAlign = "left";
    ctx.font = "9px ui-monospace, monospace";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText("■", px + 12, py + 168);
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText(t("localization_mission.legend.real"), px + 26, py + 168);
    ctx.fillStyle = "#c4b5fd";
    ctx.fillText("◆", px + 12, py + 184);
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText(t("localization_mission.legend.est"), px + 26, py + 184);
    ctx.fillStyle = "#7dd3fc";
    ctx.fillText("•", px + 12, py + 200);
    ctx.fillStyle = "#9aa6c8";
    ctx.fillText(t("localization_mission.legend.particles"), px + 26, py + 200);

    // Call to action — nudge toward the landmark while candidates are tied.
    ctx.font = "700 10px ui-monospace, monospace";
    if (isTwoWayTie()) {
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(t("localization_mission.cta.disambiguate"), px + 12, py + 230);
    } else {
      ctx.fillStyle = "#7dd3fc";
      ctx.fillText(t("localization_mission.cta.converge"), px + 12, py + 230);
    }
    ctx.restore();
  }

  return {
    id: "localization_mission",
    name: "Localization",
    lesson: "AMCL / Particle Filter",
    lessonCmd: "ros2 topic echo /amcl_pose",
    ros2: {
      title: tx(
        "AMCL — 既知の地図の中で自分の位置を推定する",
        "AMCL — estimate your pose inside a known map",
      ),
      summary:
        "Localization は既知の地図から現在の姿勢を推定し、Mapping は姿勢を手掛かりに地図を作ります。SLAM は地図と姿勢を結び付けて同時に推定します。Nav2 の amcl ノードはパーティクルフィルタ (Monte Carlo Localization) を使い、多数の姿勢仮説を移動情報で更新し、LiDAR /scan と一致する仮説ほど大きな重みを与えて再サンプリングします。仮説が真の位置付近に集まると収束です。ロボットが突然運ばれた場合は、/reinitialize_global_localization で全域に仮説を配置し直せます。",
      msgTypes: [
        "geometry_msgs/msg/PoseWithCovarianceStamped",
        "nav2_msgs/msg/ParticleCloud",
        "sensor_msgs/msg/LaserScan",
      ],
      cli: [
        "ros2 topic echo /amcl_pose",
        "ros2 topic echo /particle_cloud --once",
        "ros2 service call /reinitialize_global_localization std_srvs/srv/Empty",
      ],
      python: `# Minimal AMCL loop: motion update -> measurement update -> resample
import numpy as np

class ParticleFilter:
    def __init__(self, n, world_map):
        self.map = world_map
        self.p = sample_free_poses(world_map, n)   # (n, 3): x, y, theta
        self.w = np.full(n, 1.0 / n)

    def motion_update(self, ds, dtheta):
        n = len(self.p)
        self.p[:, 2] += dtheta + np.random.normal(0, 0.05, n)
        d = ds + np.random.normal(0, 0.02, n)
        self.p[:, 0] += d * np.cos(self.p[:, 2])
        self.p[:, 1] += d * np.sin(self.p[:, 2])

    def measurement_update(self, scan, sigma=0.3):
        for i, pose in enumerate(self.p):
            predicted = raycast(self.map, pose)     # expected ranges
            err = scan - predicted
            self.w[i] = np.exp(-np.sum(err ** 2) / (2 * sigma ** 2))
        self.w /= self.w.sum()

    def resample(self):
        # low-variance resampler + a few random injections
        idx = low_variance_sample(self.w)
        self.p = self.p[idx]
        self.w = np.full(len(self.p), 1.0 / len(self.p))`,
      realWorld: tx(
        "実機では Nav2 の amcl ノードが、既知の地図 (/map)、LiDAR (/scan)、オドメトリ (tf odom→base_link) を入力に姿勢を推定します。/initialpose で初期姿勢を与え、`/reinitialize_global_localization` で地図全域に仮説を配置し直せます。SLAM は Mapping と Localization を単に別々に同時実行するのではなく、地図と姿勢を互いに関係付けて推定します。",
        "On a real robot, Nav2's AMCL node estimates pose from a known /map, LiDAR /scan, and odometry (tf odom→base_link). You can provide an initial pose through /initialpose or redistribute hypotheses globally with `/reinitialize_global_localization`. SLAM does more than run separate mapping and localization processes at the same time: it estimates map and pose as a coupled problem.",
      ),
      state: {
        nodes: ["/amcl", "/robot_node", "/lidar_node"],
        topics: [
          {
            name: "/cmd_vel",
            type: "geometry_msgs/msg/Twist",
            pub: ["/robot_node"],
            sub: ["/robot_node"],
          },
          {
            name: "/scan",
            type: "sensor_msgs/msg/LaserScan",
            pub: ["/lidar_node"],
            sub: ["/amcl"],
          },
          {
            name: "/amcl_pose",
            type: "geometry_msgs/msg/PoseWithCovarianceStamped",
            pub: ["/amcl"],
          },
          { name: "/particle_cloud", type: "nav2_msgs/msg/ParticleCloud", pub: ["/amcl"] },
          {
            name: "/initialpose",
            type: "geometry_msgs/msg/PoseWithCovarianceStamped",
            sub: ["/amcl"],
          },
        ],
        services: [
          { name: "/reinitialize_global_localization", type: "std_srvs/srv/Empty", node: "/amcl" },
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
  mode: "lesson",
  order: 11.5,
  diagram: `
<svg viewBox="0 0 420 130" role="img" aria-label="particles scattered across a known map converge onto the true robot pose as it drives">
  <defs>
    <marker id="ld-loc-arrow" markerWidth="9" markerHeight="7" refX="8" refY="3.5" orient="auto">
      <polygon points="0 0, 9 3.5, 0 7" fill="#5eead4"/>
    </marker>
  </defs>
  <!-- Panel 1: scattered particles -->
  <g>
    <rect x="10" y="18" width="180" height="94" rx="6" fill="#0a0e1a" stroke="#7dd3fc" stroke-width="1"/>
    <text x="18" y="32" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9" font-weight="700">GLOBAL: scatter</text>
    <!-- known walls -->
    <rect x="18" y="40" width="164" height="6" fill="#1d2336"/>
    <rect x="18" y="100" width="164" height="6" fill="#1d2336"/>
    <rect x="90" y="46" width="6" height="34" fill="#1d2336"/>
    <!-- particles everywhere -->
    <g fill="#7dd3fc" opacity="0.7">
      <circle cx="30" cy="60" r="1.5"/><circle cx="48" cy="88" r="1.5"/><circle cx="66" cy="54" r="1.5"/>
      <circle cx="120" cy="66" r="1.5"/><circle cx="150" cy="52" r="1.5"/><circle cx="164" cy="90" r="1.5"/>
      <circle cx="40" cy="72" r="1.5"/><circle cx="108" cy="94" r="1.5"/><circle cx="138" cy="78" r="1.5"/>
      <circle cx="72" cy="94" r="1.5"/><circle cx="130" cy="58" r="1.5"/><circle cx="56" cy="66" r="1.5"/>
    </g>
    <!-- true robot -->
    <rect x="56" y="70" width="10" height="8" rx="2" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  </g>
  <!-- arrow: drive + resample -->
  <line x1="196" y1="65" x2="224" y2="65" stroke="#5eead4" stroke-width="1.6" marker-end="url(#ld-loc-arrow)"/>
  <text x="210" y="58" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="8" font-weight="700">drive</text>
  <!-- Panel 2: converged cloud -->
  <g>
    <rect x="230" y="18" width="180" height="94" rx="6" fill="#0a0e1a" stroke="#c4b5fd" stroke-width="1"/>
    <text x="238" y="32" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="9" font-weight="700">CONVERGED</text>
    <rect x="238" y="40" width="164" height="6" fill="#1d2336"/>
    <rect x="238" y="100" width="164" height="6" fill="#1d2336"/>
    <rect x="310" y="46" width="6" height="34" fill="#1d2336"/>
    <!-- tight cloud on the robot -->
    <g fill="#7dd3fc" opacity="0.8">
      <circle cx="292" cy="72" r="1.5"/><circle cx="296" cy="74" r="1.5"/><circle cx="288" cy="70" r="1.5"/>
      <circle cx="294" cy="68" r="1.5"/><circle cx="290" cy="76" r="1.5"/><circle cx="298" cy="72" r="1.5"/>
    </g>
    <rect x="288" y="70" width="10" height="8" rx="2" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
    <text x="402" y="103" text-anchor="end" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="8">/amcl_pose</text>
  </g>
</svg>
`,
  lessonModal: {
    title: {
      ja: "自己位置推定 — パーティクルフィルタ (AMCL)",
      en: "Localization — Particle Filter (AMCL)",
    },
    learn: {
      ja: "Localization (自己位置推定) は、既知の地図の中で現在の姿勢を推定する処理です。ここではパーティクルフィルタ (Monte Carlo Localization) を体感します。パーティクルは 1 つの姿勢仮説です。多数の仮説を配置し、ロボットの移動に合わせて更新し、LiDAR と一致する仮説ほど大きな重みを与えて再サンプリングします。似た場所が複数あると仮説は複数の塊に分かれて残ります。1 つに絞るには、場所を見分けられる特徴が観測できる所まで移動して情報を増やす必要があります。",
      en: "Localization estimates the robot's current pose in a known map. Here you explore a particle filter (Monte Carlo Localization), where each particle represents one pose hypothesis. The filter propagates many hypotheses with robot motion, assigns higher weights to those that better match the LiDAR observation, and resamples them. Similar-looking places can leave several clusters alive; moving to a distinctive area provides information that lets the filter converge to one location.",
    },
    goal: {
      ja: "この地図には左右そっくりな部屋が2つあり、LiDAR だけでは自分がどちらの部屋にいるか区別できません。だから仮説の雲は2か所 (2つの「?」リング) に分かれます。カギは右下の部屋だけにある ★ の目印。WASD で ★ の方へ走ると、間違った側の仮説が「そこに ★ は無い / 有る」で否定されて消え、正しい部屋に収束 → 画面上部の LOCALIZE メーターが満タンでクリア。G キーはいつでも仮説を撒き直せる操作 (誘拐ロボット問題の復帰体験)。★ 評価は所要時間で決まります。",
      en: "This map has two look-alike rooms (left and right), and from the LiDAR alone the robot cannot tell which room it is in — so the hypothesis cloud splits into two places (two '?' rings). The key is the ★ landmark, which exists in only the bottom-right room. Drive with WASD toward the ★: the wrong candidate gets ruled out (it expects a ★ where there is none, or vice-versa) and the cloud collapses onto the true room, filling the LOCALIZE meter at the top to clear. Press G anytime to re-scatter (recovering from the kidnapped-robot problem). Stars depend on your total time.",
    },
    first: {
      ja: "最初、青い点 (仮説) は2つの部屋の同じ位置に分かれて固まります — ロボットが「自分は左の部屋かも、右の部屋かも」と迷っている状態で、それぞれに黄色い「?」リングが付きます。紫の ◆ (EST) が推定位置、黄色い機体が真の位置。右下の ★ の目印まで走れば迷いが解け、点が1か所に集まってメーターが満ちます。右パネルの「残り候補」が 2 → 1 になるのを狙いましょう。",
      en: "At first the blue dots (hypotheses) gather in two rooms at the same spot — the robot is torn between 'maybe I'm in the left room, maybe the right', each marked with a yellow '?' ring. The purple diamond (EST) is the estimate, the yellow robot is the truth. Drive to the ★ landmark in the bottom-right and the tie breaks: the dots collapse to one place and the meter fills. Watch 'candidates left' in the right panel go from 2 to 1.",
    },
  },
  strings: {
    ja: {
      hint: "WASD で走行 — 地図には同じ形の部屋が2つ。★の目印まで走って自分の部屋を特定しよう",
      "status.start":
        "地図には同じ形の部屋が2つ。仮説が2か所に分かれる → ★の目印まで走って、自分がどっちにいるか見分けよう",
      "status.relocalize":
        "GLOBAL RELOCALIZE — 600 個の仮説を全域へ再散布 (/reinitialize_global_localization)",
      "status.clear": "LOCALIZED — 仮説が真の位置に収束した！",
      "btn.relocalize": "GLOBAL RELOCALIZE (G)",
      "meter.label": "LOCALIZE",
      "check.step1": "自己位置を特定する",
      "hud.goal.step1": "同じ形の部屋が2つ。★まで走って自分の居場所を見分けよう",
      "hud.meter": "メーター",
      "hud.modes": "残り候補",
      "hud.modes.many": "多数",
      "hud.particles": "仮説(点)の数",
      "hud.spread": "ばらつき",
      "hud.err": "推定のズレ",
      "legend.real": "真の位置 (robot)",
      "legend.est": "推定位置 (/amcl_pose)",
      "legend.particles": "仮説の点",
      "cta.converge": "走って仮説を1か所に集めよう",
      "cta.disambiguate": "候補が2つ！ ★まで走って見分けよう",
    },
    en: {
      hint: "WASD to drive — the map has TWO identical rooms. Drive to the ★ landmark to tell which one you're in",
      "status.start":
        "The map has TWO identical rooms, so the cloud splits in two → drive to the ★ landmark to find which room you're in",
      "status.relocalize":
        "GLOBAL RELOCALIZE — re-scattered 600 hypotheses (/reinitialize_global_localization)",
      "status.clear": "LOCALIZED — the hypotheses converged onto the true pose!",
      "btn.relocalize": "GLOBAL RELOCALIZE (G)",
      "meter.label": "LOCALIZE",
      "check.step1": "Find where you are",
      "hud.goal.step1": "Two identical rooms — drive to the ★ to tell which one you're in",
      "hud.meter": "meter",
      "hud.modes": "candidates left",
      "hud.modes.many": "many",
      "hud.particles": "hypotheses (dots)",
      "hud.spread": "scatter",
      "hud.err": "estimate error",
      "legend.real": "true pose (robot)",
      "legend.est": "estimate (/amcl_pose)",
      "legend.particles": "hypothesis dots",
      "cta.converge": "Drive to gather the hypotheses",
      "cta.disambiguate": "2 candidates! drive to the ★ to break the tie",
    },
  },
  build: makeLocalizationMission,
});
