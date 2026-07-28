// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Shared 2-link planar arm model for the robot-arm LESSON stages
// (joint_teleop / ik_reach). One place owns the geometry, forward + inverse
// kinematics, joint limits, the canvas drawing, and the shared reach course so
// A1 (joint space) and A2 (IK) present the *same* physical arm and the *same*
// target course — that lets ik_reach honestly compare "joints were slow → IK
// is fast" against joint_teleop's best time.
//
// Coordinate convention: the canvas y-axis points DOWN, but joint angles are
// stored in the intuitive MATH convention (CCW-positive, "up on screen" = a
// positive angle). Every position formula therefore uses `- L*sin(θ)` for the
// y term. Keep that in mind when reading fk()/ik().

import { withA } from "../core/theme";

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DEG = Math.PI / 180;

// ── Arm geometry ──────────────────────────────────────────────────────────
// Base sits on a pedestal at the bottom-centre of the canvas. L1+L2 = 260 px,
// so with PX_PER_M = 200 the arm is ~1.3 m — a UR-class tabletop arm.
export const ARM = {
  base: { x: 400, y: 430 } as Pt,
  L1: 150,
  L2: 110,
  // Joint limits (rad). q1 is the shoulder measured from +x (up = positive);
  // its range straddles π, which is why angles are normalised into
  // [-π/2, 3π/2) below rather than the usual [-π, π]. The range is wide enough
  // (-20°..200°) that every target in COURSE_TARGETS is reachable in BOTH the
  // elbow-up and elbow-down solution — so the reach course is always
  // completable in either config, and the shelf (not a reach limit) is what
  // motivates flipping the elbow.
  q1Min: -20 * DEG,
  q1Max: 200 * DEG,
  // q2 is the elbow, relative to link-1's direction.
  q2Min: -150 * DEG,
  q2Max: 150 * DEG,
  // Max angular rate of a single joint (rad/s). Stages slew toward targets at
  // this rate so the arm never teleports; precision mode scales it down.
  maxJointSpeed: 2.0,
};

/** Pixels per metre — shared so HUD readouts match across both arm stages. */
export const PX_PER_M = 200;

export const reachMax = (): number => ARM.L1 + ARM.L2;
export const reachMin = (): number => Math.abs(ARM.L1 - ARM.L2);

export function clampAngle(a: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, a));
}

// Normalise into [-π/2, 3π/2). The arm's whole working set (upward + near-
// horizontal reaches) lives in this window, and unlike [-π, π] it does not cut
// through the middle of the shoulder's -10°..190° range.
function normArm(a: number): number {
  while (a < -Math.PI / 2) a += Math.PI * 2;
  while (a >= Math.PI * 1.5) a -= Math.PI * 2;
  return a;
}

// ── Forward kinematics ──────────────────────────────────────────────────────
export function fk(q1: number, q2: number): { elbow: Pt; ee: Pt } {
  const ex = ARM.base.x + ARM.L1 * Math.cos(q1);
  const ey = ARM.base.y - ARM.L1 * Math.sin(q1);
  const a = q1 + q2;
  const hx = ex + ARM.L2 * Math.cos(a);
  const hy = ey - ARM.L2 * Math.sin(a);
  return { elbow: { x: ex, y: ey }, ee: { x: hx, y: hy } };
}

// ── Inverse kinematics ──────────────────────────────────────────────────────
export interface IKSolution {
  q1: number;
  q2: number;
  /** True when the raw target lies inside the reachable annulus. */
  reachable: boolean;
  /** True when a joint had to be clamped to its limit to get closest. */
  limited: boolean;
}

/**
 * Analytic 2-link IK (law of cosines). `elbowUp` selects one of the two mirror
 * solutions. When the target is outside the annulus it is clamped onto the
 * nearest reachable radius (so the arm points straight at it, fully extended or
 * fully folded) and `reachable` is returned false so the caller can flash the
 * workspace boundary. If the resulting joint angles exceed a limit they are
 * clamped and `limited` is set.
 */
export function ik(tx: number, ty: number, elbowUp: boolean): IKSolution {
  const dx = tx - ARM.base.x;
  const dy = -(ty - ARM.base.y); // screen → math (up positive)
  const d = Math.hypot(dx, dy);

  const rMax = reachMax() - 0.001;
  const rMin = reachMin() + 0.001;
  const reachable = d >= rMin && d <= rMax;

  // Clamp the target distance into the annulus while keeping its direction.
  const dC = Math.max(rMin, Math.min(rMax, d));
  const dirX = d > 1e-6 ? dx / d : 1;
  const dirY = d > 1e-6 ? dy / d : 0;

  const c = clampAngle(
    (dC * dC - ARM.L1 * ARM.L1 - ARM.L2 * ARM.L2) / (2 * ARM.L1 * ARM.L2),
    -1,
    1,
  );
  const beta = Math.acos(c);

  // The two mirror solutions (q2 = ±β). `elbowUp` must mean "elbow higher ON
  // SCREEN" (world-up), NOT a fixed sign of q2 — a fixed sign only looks up on
  // one side of the base and flips to point at the floor on the other, which
  // makes the solid arm disagree with its own ghost. So build both candidates
  // and choose by the elbow's screen height (smaller y = higher).
  const cand = (q2: number) => {
    const q1 = normArm(
      Math.atan2(dirY, dirX) - Math.atan2(ARM.L2 * Math.sin(q2), ARM.L1 + ARM.L2 * Math.cos(q2)),
    );
    const elbowY = ARM.base.y - ARM.L1 * Math.sin(q1);
    return { q1, q2, elbowY };
  };
  const s1 = cand(beta);
  const s2 = cand(-beta);
  const higher = s1.elbowY <= s2.elbowY ? s1 : s2; // smaller y = higher on screen
  const lower = s1.elbowY <= s2.elbowY ? s2 : s1;
  const pick = elbowUp ? higher : lower;

  const q1 = clampAngle(pick.q1, ARM.q1Min, ARM.q1Max);
  const q2 = clampAngle(pick.q2, ARM.q2Min, ARM.q2Max);
  const limited = q1 !== pick.q1 || q2 !== pick.q2;
  return { q1, q2, reachable, limited };
}

/** Move `cur` toward `target` by at most `maxStep` (no overshoot). */
export function slew(cur: number, target: number, maxStep: number): number {
  const d = target - cur;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

/** True when angle `a` sits within `eps` of either end of [lo, hi]. */
export function atLimit(a: number, lo: number, hi: number, eps = 0.5 * DEG): boolean {
  return a <= lo + eps || a >= hi - eps;
}

// ── Shared reach course ─────────────────────────────────────────────────────
// The SAME six targets in both stages. Chosen to span the workspace: straight
// up (near full extension), the two sides, two low/far reaches near the limit
// of reach, and one tucked close to the base that forces the elbow to fold.
export const COURSE_TARGETS: Pt[] = [
  { x: 400, y: 190 }, // 1 straight up, arm nearly straight
  { x: 560, y: 285 }, // 2 upper right
  { x: 240, y: 285 }, // 3 upper left
  { x: 620, y: 378 }, // 4 far low-right (near max extension)
  { x: 400, y: 252 }, // 5 close to base — elbow must fold hard
  { x: 182, y: 398 }, // 6 far low-left
];

// ── Geometry helpers (A2 shelf collision) ───────────────────────────────────
function segSeg(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const cross = (o: Pt, p: Pt, q: Pt) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** True when segment p0→p1 touches axis-aligned rectangle r. */
export function segRectHit(p0: Pt, p1: Pt, r: Rect): boolean {
  const inside = (p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
  if (inside(p0) || inside(p1)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.w, y: r.y };
  const bl = { x: r.x, y: r.y + r.h };
  const br = { x: r.x + r.w, y: r.y + r.h };
  return (
    segSeg(p0, p1, tl, tr) ||
    segSeg(p0, p1, tr, br) ||
    segSeg(p0, p1, br, bl) ||
    segSeg(p0, p1, bl, tl)
  );
}

/** True when either arm link (base→elbow, elbow→ee) intersects rect r. */
export function armHitsRect(q1: number, q2: number, r: Rect): boolean {
  const { elbow, ee } = fk(q1, q2);
  return segRectHit(ARM.base, elbow, r) || segRectHit(elbow, ee, r);
}

// ── Drawing ─────────────────────────────────────────────────────────────────
const COL = {
  link: "#7dd3fc",
  link2: "#c4b5fd",
  joint: "#eef2ff",
  outline: "#0a0f1f",
  danger: "#fb7185",
  ok: "#5eead4",
  dim: "#6e7a9c",
};

function capsule(
  ctx: CanvasRenderingContext2D,
  p0: Pt,
  p1: Pt,
  w: number,
  fill: string,
  alpha: number,
) {
  ctx.lineCap = "round";
  // Dark outline first, then the coloured core on top.
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = COL.outline;
  ctx.lineWidth = w + 5;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.strokeStyle = fill;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function joint(ctx: CanvasRenderingContext2D, p: Pt, r: number, alpha: number, hot: boolean) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = hot ? COL.danger : COL.joint;
  ctx.strokeStyle = COL.outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
}

export interface DrawArmOpts {
  /** Draw translucent (used for the alternate-IK-solution ghost in A2). */
  ghost?: boolean;
  /** Flash a joint red when it is pinned at a limit. */
  limitHot?: { q1?: boolean; q2?: boolean };
  /** Draw the little limit-range arc gauges at each joint (A1). */
  showGauges?: boolean;
  /** Highlight a link red (e.g. it is colliding with the shelf in A2). */
  linkHot?: boolean;
}

export function drawArm(
  ctx: CanvasRenderingContext2D,
  q1: number,
  q2: number,
  opts: DrawArmOpts = {},
) {
  const { elbow, ee } = fk(q1, q2);
  const a = opts.ghost ? 0.28 : 1;
  const hot = opts.linkHot === true;
  const c1 = hot ? COL.danger : COL.link;
  const c2 = hot ? COL.danger : COL.link2;

  // Pedestal.
  if (!opts.ghost) {
    ctx.fillStyle = COL.outline;
    ctx.beginPath();
    ctx.moveTo(ARM.base.x - 26, ARM.base.y + 34);
    ctx.lineTo(ARM.base.x + 26, ARM.base.y + 34);
    ctx.lineTo(ARM.base.x + 16, ARM.base.y);
    ctx.lineTo(ARM.base.x - 16, ARM.base.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = withA("#7dd3fc", 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  if (opts.showGauges) {
    drawGauge(ctx, ARM.base, 30, 0, ARM.q1Min, ARM.q1Max, q1, opts.limitHot?.q1);
    drawGauge(ctx, elbow, 24, q1, ARM.q2Min, ARM.q2Max, q2, opts.limitHot?.q2);
  }

  capsule(ctx, ARM.base, elbow, 16, c1, a);
  capsule(ctx, elbow, ee, 12, c2, a);
  joint(ctx, ARM.base, 12, a, false);
  joint(ctx, elbow, 9, a, opts.limitHot?.q2 === true);

  drawGripper(ctx, ee, q1 + q2, a, hot);
}

/** End-effector: two short prongs opening along the tool direction. */
function drawGripper(
  ctx: CanvasRenderingContext2D,
  ee: Pt,
  dir: number,
  alpha: number,
  hot: boolean,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(ee.x, ee.y);
  ctx.rotate(-dir); // math angle → canvas (y-down) rotation
  ctx.strokeStyle = hot ? COL.danger : COL.ok;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  // wrist stub
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(4, 0);
  ctx.stroke();
  // two prongs
  ctx.beginPath();
  ctx.moveTo(4, -7);
  ctx.lineTo(14, -7);
  ctx.moveTo(4, 7);
  ctx.lineTo(14, 7);
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = 1;
}

/** Small arc showing a joint's [min,max] travel with a tick at the current angle. */
function drawGauge(
  ctx: CanvasRenderingContext2D,
  pivot: Pt,
  r: number,
  baseAngle: number,
  lo: number,
  hi: number,
  cur: number,
  hotFlag?: boolean,
) {
  const pt = (ang: number, rad: number): Pt => ({
    x: pivot.x + rad * Math.cos(baseAngle + ang),
    y: pivot.y - rad * Math.sin(baseAngle + ang),
  });
  // range track
  ctx.strokeStyle = withA("#6e7a9c", 0.5);
  ctx.lineWidth = 2;
  ctx.beginPath();
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const ang = lo + ((hi - lo) * i) / steps;
    const p = pt(ang, r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // current tick
  const hot = hotFlag === true;
  ctx.strokeStyle = hot ? COL.danger : COL.ok;
  ctx.lineWidth = hot ? 3 : 2;
  const a0 = pt(cur, r - 5);
  const a1 = pt(cur, r + 5);
  ctx.beginPath();
  ctx.moveTo(a0.x, a0.y);
  ctx.lineTo(a1.x, a1.y);
  ctx.stroke();
}

/**
 * Faint filled annulus sector covering the shoulder's angular travel — the
 * arm's reachable region. `edgeFlash` (0..1) reddens the boundary rings when
 * the caller's target is out of reach.
 */
export function drawWorkspace(ctx: CanvasRenderingContext2D, edgeFlash = 0) {
  const rMax = reachMax();
  const rMin = reachMin();
  const steps = 48;
  const arc = (rad: number, from: number, to: number) => {
    for (let i = 0; i <= steps; i++) {
      const ang = from + ((to - from) * i) / steps;
      const x = ARM.base.x + rad * Math.cos(ang);
      const y = ARM.base.y - rad * Math.sin(ang);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  };
  ctx.save();
  ctx.beginPath();
  // outer arc forward, inner arc back → closed annulus sector
  {
    let first = true;
    for (let i = 0; i <= steps; i++) {
      const ang = ARM.q1Min + ((ARM.q1Max - ARM.q1Min) * i) / steps;
      const x = ARM.base.x + rMax * Math.cos(ang);
      const y = ARM.base.y - rMax * Math.sin(ang);
      if (first) {
        ctx.moveTo(x, y);
        first = false;
      } else ctx.lineTo(x, y);
    }
    for (let i = steps; i >= 0; i--) {
      const ang = ARM.q1Min + ((ARM.q1Max - ARM.q1Min) * i) / steps;
      const x = ARM.base.x + rMin * Math.cos(ang);
      const y = ARM.base.y - rMin * Math.sin(ang);
      ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  ctx.fillStyle = withA("#7dd3fc", 0.05);
  ctx.fill();
  // boundary rings
  const edge = edgeFlash > 0;
  ctx.strokeStyle = edge ? withA("#fb7185", 0.35 + 0.5 * edgeFlash) : withA("#7dd3fc", 0.18);
  ctx.lineWidth = edge ? 2.5 : 1.5;
  ctx.beginPath();
  arc(rMax, ARM.q1Min, ARM.q1Max);
  ctx.stroke();
  ctx.beginPath();
  arc(rMin, ARM.q1Min, ARM.q1Max);
  ctx.stroke();
  ctx.restore();
}
