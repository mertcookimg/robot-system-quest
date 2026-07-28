// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// navigation: Nav2 Goal
// Reproduces RViz2's "2D Nav Goal".
// Click+drag the map to publish goal_pose → A* computes /plan → robot
// tracks it with pure pursuit.
// The most basic use of Nav2's NavigateToPose action.
import { W, H, type Stage, type GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import {
  drawGrid,
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatPose, formatTwist } from "../../lib/hud";
import { t, tx } from "../../i18n";

const PX_PER_M = 100;
const ROBOT_R = 14;
const TOPIC_CMD = "/cmd_vel";
const TOPIC_GOAL = "/goal_pose";
const TOPIC_PLAN = "/plan";

const CELL = 10;
const COLS = Math.floor(W / CELL);
const ROWS = Math.floor(H / CELL);
const INFLATION = ROBOT_R + 8;

const MAX_LIN = 1.4 * PX_PER_M;
const MAX_ANG = 1.8;
const KW = 1.5; // turn gain — too high overshoots and oscillates
const REACH_TOL = 14;
const LOOKAHEAD = 50; // larger value → smoother tracking

const START = { x: 80, y: 80, theta: 0 };

const walls = [
  { x: 250, y: 100, w: 24, h: 220 },
  { x: 250, y: 380, w: 200, h: 24 },
  { x: 450, y: 200, w: 24, h: 220 },
  { x: 550, y: 60, w: 200, h: 24 },
];

interface Cell {
  col: number;
  row: number;
}
interface Pt {
  x: number;
  y: number;
}
interface GoalPose {
  x: number;
  y: number;
  theta: number;
}
interface ClosestOnPath {
  seg: number;
  t: number;
  pt: Pt;
  dist: number;
}

export function makeNav2Goal(): Stage {
  let g!: GameContext;
  const robot = { x: START.x, y: START.y, theta: START.theta };
  const particles = new Particles();
  const trail: Pt[] = [];
  let trailAcc = 0;

  let goal: GoalPose | null = null;
  let plan: Pt[] = [];
  let pathIndex = 0; // pure-pursuit progress (prevents backtracking)
  let isFollowing = false;
  let elapsed = 0;
  let pubAcc = 0;
  let bumpFlash = 0;
  let goalsReached = 0;
  const GOALS_FOR_CLEAR = 5;
  let cleared = false;

  // Drag state — click → drag → release commits the goal pose.
  let dragging = false;
  let dragStart: Pt | null = null;
  let dragCurrent: Pt | null = null;
  let lastPlanInfo = "";

  // -- Hide the block editor for this stage.
  let editorEl: HTMLElement | null = null;

  function reset() {
    robot.x = START.x;
    robot.y = START.y;
    robot.theta = START.theta;
    particles.reset();
    trail.length = 0;
    goal = null;
    plan = [];
    pathIndex = 0;
    isFollowing = false;
    elapsed = 0;
    pubAcc = 0;
    bumpFlash = 0;
    dragging = false;
    dragStart = null;
    dragCurrent = null;
    lastPlanInfo = "";
    goalsReached = 0;
    cleared = false;
    g.ghost.startRecording();
    g.setStatus(t("navigation.status.tip"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    editorEl = document.getElementById("block-editor");
    if (editorEl) editorEl.style.display = "none"; // hide the block-editor panel

    g.canvas.style.cursor = "crosshair";
    g.canvas.addEventListener("mousedown", onMouseDown);
    g.canvas.addEventListener("mousemove", onMouseMove);
    g.canvas.addEventListener("mouseup", onMouseUp);
    g.canvas.addEventListener("mouseleave", onMouseLeave);

    reset();
  }

  function dispose() {
    g.canvas.style.cursor = "";
    g.canvas.removeEventListener("mousedown", onMouseDown);
    g.canvas.removeEventListener("mousemove", onMouseMove);
    g.canvas.removeEventListener("mouseup", onMouseUp);
    g.canvas.removeEventListener("mouseleave", onMouseLeave);
  }

  function canvasCoords(e: MouseEvent): Pt {
    const rect = g.canvas.getBoundingClientRect();
    const sx = g.canvas.width / rect.width;
    const sy = g.canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const p = canvasCoords(e);
    if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
    dragging = true;
    dragStart = p;
    dragCurrent = p;
  }

  function onMouseMove(e: MouseEvent) {
    if (!dragging) return;
    dragCurrent = canvasCoords(e);
  }

  function onMouseUp(e: MouseEvent) {
    if (!dragging || !dragStart) {
      dragging = false;
      return;
    }
    const end = canvasCoords(e);
    dragging = false;
    const dx = end.x - dragStart.x;
    const dy = end.y - dragStart.y;
    const yaw = Math.hypot(dx, dy) > 4 ? Math.atan2(dy, dx) : 0;
    sendGoal({ x: dragStart.x, y: dragStart.y, theta: yaw });
    dragStart = null;
    dragCurrent = null;
  }

  function onMouseLeave() {
    dragging = false;
    dragStart = null;
    dragCurrent = null;
  }

  function sendGoal(gp: GoalPose) {
    // 1) Reject goals that fall on blocked cells.
    const goalCell = ptToCell(gp);
    if (isCellBlocked(goalCell.col, goalCell.row)) {
      g.setStatus(t("navigation.status.bad_goal"), "var(--danger)");
      g.sfx.bump();
      return;
    }
    goal = gp;
    g.publish(
      TOPIC_GOAL,
      `geometry_msgs/msg/PoseStamped pose:(x=${(gp.x / PX_PER_M).toFixed(2)} y=${(gp.y / PX_PER_M).toFixed(2)} yaw=${gp.theta.toFixed(2)})`,
    );

    // 2) Compute the plan via A*.
    const startCell = ptToCell({ x: robot.x, y: robot.y });
    const cells = astar(startCell, goalCell);
    if (!cells.length) {
      plan = [];
      isFollowing = false;
      g.setStatus(t("navigation.status.plan_fail"), "var(--danger)");
      g.sfx.bump();
      return;
    }
    plan = simplifyPath(cells.map(cellToPt));
    // Anchor the start of the plan to the current pose for smoother
    // initial tracking.
    plan[0] = { x: robot.x, y: robot.y };
    // Replace the last waypoint with the exact goal so the robot stops
    // precisely on it.
    plan[plan.length - 1] = { x: gp.x, y: gp.y };
    pathIndex = 0;
    isFollowing = true;
    elapsed = 0;
    trail.length = 0;

    g.publish(
      TOPIC_PLAN,
      `nav_msgs/msg/Path waypoints:${plan.length} length:${pathLength(plan).toFixed(0)}px`,
    );
    lastPlanInfo = `plan: ${plan.length} pts, ${(pathLength(plan) / PX_PER_M).toFixed(2)} m`;
    g.setStatus(t("navigation.status.navigating", { info: lastPlanInfo }), "var(--ok)");
    particles.burst(gp.x, gp.y, "#5eead4", 16, 180);
    g.sfx.click();
  }

  // -- Grid conversion.
  function ptToCell(p: Pt): Cell {
    return { col: Math.floor(p.x / CELL), row: Math.floor(p.y / CELL) };
  }
  function cellToPt(c: Cell): Pt {
    return { x: c.col * CELL + CELL / 2, y: c.row * CELL + CELL / 2 };
  }
  function isCellBlocked(col: number, row: number): boolean {
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return true;
    const cx = col * CELL + CELL / 2;
    const cy = row * CELL + CELL / 2;
    if (cx < ROBOT_R || cx > W - ROBOT_R || cy < ROBOT_R || cy > H - ROBOT_R) return true;
    for (const w of walls) {
      const wx = Math.max(w.x, Math.min(cx, w.x + w.w));
      const wy = Math.max(w.y, Math.min(cy, w.y + w.h));
      const dx = cx - wx,
        dy = cy - wy;
      if (dx * dx + dy * dy < INFLATION * INFLATION) return true;
    }
    return false;
  }

  // -- A* (8-connected).
  function astar(start: Cell, goal: Cell): Cell[] {
    interface Node {
      col: number;
      row: number;
      g: number;
      f: number;
      parent?: Node;
    }
    const startNode: Node = { col: start.col, row: start.row, g: 0, f: heuristic(start, goal) };
    const open: Node[] = [startNode];
    const inOpen = new Map<string, Node>();
    const closed = new Set<string>();
    inOpen.set(`${start.col},${start.row}`, startNode);
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    let safety = 8000;
    while (open.length && safety-- > 0) {
      // Pop the lowest-f node — array is small enough for a linear scan.
      let bestI = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bestI].f) bestI = i;
      const cur = open.splice(bestI, 1)[0];
      const ckey = `${cur.col},${cur.row}`;
      inOpen.delete(ckey);
      closed.add(ckey);

      if (cur.col === goal.col && cur.row === goal.row) {
        const path: Cell[] = [];
        let n: Node | undefined = cur;
        while (n) {
          path.unshift({ col: n.col, row: n.row });
          n = n.parent;
        }
        return path;
      }

      for (const [dc, dr] of dirs) {
        const nc = cur.col + dc,
          nr = cur.row + dr;
        const nkey = `${nc},${nr}`;
        if (closed.has(nkey)) continue;
        if (isCellBlocked(nc, nr)) continue;
        // For diagonal moves, both adjacent 4-neighbors must be free
        // (no corner cutting).
        if (dc !== 0 && dr !== 0) {
          if (isCellBlocked(cur.col + dc, cur.row) && isCellBlocked(cur.col, cur.row + dr))
            continue;
        }
        const stepCost = dc !== 0 && dr !== 0 ? 1.414 : 1;
        const ng = cur.g + stepCost;
        const ex = inOpen.get(nkey);
        if (ex && ex.g <= ng) continue;
        const nf = ng + heuristic({ col: nc, row: nr }, goal);
        const node: Node = { col: nc, row: nr, g: ng, f: nf, parent: cur };
        if (ex) {
          ex.g = ng;
          ex.f = nf;
          ex.parent = cur;
        } else {
          open.push(node);
          inOpen.set(nkey, node);
        }
      }
    }
    return [];
  }

  function heuristic(a: Cell, b: Cell): number {
    const dx = a.col - b.col,
      dy = a.row - b.row;
    return Math.hypot(dx, dy);
  }

  // Simplify the path with line-of-sight checks (drop redundant waypoints).
  function simplifyPath(pts: Pt[]): Pt[] {
    if (pts.length <= 2) return pts.slice();
    const out: Pt[] = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      while (j > i + 1 && !lineOfSight(pts[i], pts[j])) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  function lineOfSight(a: Pt, b: Pt): boolean {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL / 2));
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const c = ptToCell({ x, y });
      if (isCellBlocked(c.col, c.row)) return false;
    }
    return true;
  }
  function pathLength(p: Pt[]): number {
    let L = 0;
    for (let i = 1; i < p.length; i++) L += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    return L;
  }

  // ── pure pursuit
  function followStep(): { v: number; w: number; done: boolean } {
    if (plan.length < 2 || !goal) return { v: 0, w: 0, done: true };
    const last = plan[plan.length - 1];
    const goalDist = Math.hypot(last.x - robot.x, last.y - robot.y);
    if (goalDist < REACH_TOL) {
      // Reached the goal — now align yaw to the goal heading.
      let yawErr = goal.theta - robot.theta;
      while (yawErr > Math.PI) yawErr -= 2 * Math.PI;
      while (yawErr < -Math.PI) yawErr += 2 * Math.PI;
      if (Math.abs(yawErr) < 0.07) return { v: 0, w: 0, done: true };
      const w = Math.max(-MAX_ANG, Math.min(MAX_ANG, yawErr * KW));
      return { v: 0, w, done: false };
    }

    // Find the closest projection on the segment, then aim lookahead
    // ahead of it.
    const closest = closestPointOnPath(robot, plan, pathIndex);
    pathIndex = closest.seg;
    const target = advanceAlongPath(plan, closest.seg, closest.t, LOOKAHEAD);
    const dx = target.x - robot.x;
    const dy = target.y - robot.y;
    const desired = Math.atan2(dy, dx);
    let err = desired - robot.theta;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;

    // Forward speed decays smoothly via cos(err); only fully stop and
    // turn-in-place when |err| > 90°.
    let v = 0;
    if (Math.abs(err) < Math.PI / 2) {
      // Slow down based on angle error and goal distance to dampen
      // late-stage overshoot.
      const turnScale = Math.max(0.15, Math.cos(err));
      const goalScale = Math.min(1, Math.max(0.25, goalDist / (LOOKAHEAD * 1.2)));
      v = MAX_LIN * turnScale * goalScale;
    }
    const w = Math.max(-MAX_ANG, Math.min(MAX_ANG, err * KW));
    return { v, w, done: false };
  }

  function closestPointOnPath(pos: Pt, path: Pt[], startSeg: number): ClosestOnPath {
    let best: ClosestOnPath = {
      seg: Math.max(0, Math.min(path.length - 2, startSeg)),
      t: 0,
      pt: path[Math.max(0, Math.min(path.length - 2, startSeg))],
      dist: Infinity,
    };
    for (let i = Math.max(0, startSeg); i < path.length - 1; i++) {
      const a = path[i],
        b = path[i + 1];
      const vx = b.x - a.x,
        vy = b.y - a.y;
      const wx = pos.x - a.x,
        wy = pos.y - a.y;
      const vv = vx * vx + vy * vy;
      const t = vv > 1e-6 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / vv)) : 0;
      const px = a.x + vx * t,
        py = a.y + vy * t;
      const d = Math.hypot(pos.x - px, pos.y - py);
      if (d < best.dist) best = { seg: i, t, pt: { x: px, y: py }, dist: d };
    }
    return best;
  }

  function advanceAlongPath(path: Pt[], seg: number, t: number, distance: number): Pt {
    let i = Math.max(0, Math.min(path.length - 2, seg));
    const a0 = path[i],
      b0 = path[i + 1];
    const sx = a0.x + (b0.x - a0.x) * t;
    const sy = a0.y + (b0.y - a0.y) * t;
    let cur = { x: sx, y: sy };
    let remain = Math.max(0, distance);
    while (i < path.length - 1) {
      const end = path[i + 1];
      const segLen = Math.hypot(end.x - cur.x, end.y - cur.y);
      if (segLen > remain) {
        const r = remain / segLen;
        return { x: cur.x + (end.x - cur.x) * r, y: cur.y + (end.y - cur.y) * r };
      }
      remain -= segLen;
      i++;
      cur = { x: path[i].x, y: path[i].y };
    }
    return path[path.length - 1];
  }

  function canMoveTo(x: number, y: number): boolean {
    if (x < ROBOT_R || x > W - ROBOT_R) return false;
    if (y < ROBOT_R || y > H - ROBOT_R) return false;
    for (const wall of walls) {
      const cx = Math.max(wall.x, Math.min(x, wall.x + wall.w));
      const cy = Math.max(wall.y, Math.min(y, wall.y + wall.h));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < ROBOT_R * ROBOT_R) return false;
    }
    return true;
  }

  function update(dt: number) {
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    if (!isFollowing) {
      g.setHud([
        `mode:    nav2 (waiting for goal)`,
        `pose:    ${formatPose(robot, { pxPerM: PX_PER_M })}`,
        `tip:     ${t("navigation.tip_hud")}`,
      ]);
      g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);
      return;
    }

    const r = followStep();
    if (r.done) {
      isFollowing = false;
      goalsReached++;
      particles.burst(robot.x, robot.y, COLORS.OK, 28);
      g.shake(0.3);
      g.sfx.deliver();
      g.publish(TOPIC_CMD, fmtTwist(0, 0));
      if (goalsReached >= GOALS_FOR_CLEAR && !cleared) {
        cleared = true;
        g.setStatus(t("navigation.status.cleared"), "var(--ok)");
        const stats =
          `Time      <b>${elapsed.toFixed(2)} s</b><br>` +
          `Goals     <b>${goalsReached} / ${GOALS_FOR_CLEAR}</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(3, stats);
        }, 700);
      } else {
        g.setStatus(
          t("navigation.status.reached_n", { n: goalsReached, total: GOALS_FOR_CLEAR }),
          "var(--ok)",
        );
      }
      return;
    }

    robot.theta += r.w * dt;
    const nx = robot.x + r.v * Math.cos(robot.theta) * dt;
    const ny = robot.y + r.v * Math.sin(robot.theta) * dt;
    if (canMoveTo(nx, ny)) {
      robot.x = nx;
      robot.y = ny;
    } else {
      // On collision reset; re-planning happens on the next click.
      bumpFlash = 1;
      g.shake(0.4);
      particles.burst(robot.x, robot.y, "#fb7185", 20, 220);
      isFollowing = false;
      g.sfx.bump();
      g.setStatus(t("navigation.status.collision"), "var(--danger)");
      robot.x = START.x;
      robot.y = START.y;
      robot.theta = START.theta;
      trail.length = 0;
      plan = [];
      pathIndex = 0;
      goal = null;
      return;
    }

    trailAcc += dt;
    if (trailAcc > 0.04) {
      trailAcc = 0;
      trail.push({ x: robot.x, y: robot.y });
      if (trail.length > 400) trail.shift();
    }

    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      g.publish(TOPIC_CMD, fmtTwist(r.v / PX_PER_M, r.w));
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `mode:        navigating`,
      `goal:        x=${goal!.x.toFixed(0)}px y=${goal!.y.toFixed(0)}px yaw=${goal!.theta.toFixed(2)}`,
      `${lastPlanInfo}`,
      `cmd_vel:     ${formatTwist({ v: r.v, w: r.w }, { pxPerM: PX_PER_M })}`,
      `pose:        ${formatPose(robot, { pxPerM: PX_PER_M })}`,
    ]);
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);

    // Walls.
    for (const wall of walls) {
      c.fillStyle = "rgba(35, 44, 77, 0.75)";
      c.strokeStyle = "rgba(110, 122, 156, 0.5)";
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      c.fill();
      c.stroke();
    }

    // Start marker.
    c.save();
    c.strokeStyle = "rgba(125, 211, 252, 0.45)";
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.beginPath();
    c.arc(START.x, START.y, 18, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(125, 211, 252, 0.65)";
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("START", START.x, START.y - 24);
    c.restore();

    // Plan (polyline + waypoints).
    if (plan.length > 1) {
      c.save();
      c.strokeStyle = "rgba(125, 211, 252, 0.85)";
      c.lineWidth = 2;
      c.setLineDash([8, 5]);
      c.beginPath();
      c.moveTo(plan[0].x, plan[0].y);
      for (let i = 1; i < plan.length; i++) c.lineTo(plan[i].x, plan[i].y);
      c.stroke();
      c.setLineDash([]);
      // Waypoint.
      c.fillStyle = "#7dd3fc";
      for (const p of plan) {
        c.beginPath();
        c.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        c.fill();
      }
      c.restore();
    }

    // Goal arrow during drag (preview).
    if (dragging && dragStart && dragCurrent) {
      drawGoalArrow(
        c,
        dragStart.x,
        dragStart.y,
        Math.atan2(dragCurrent.y - dragStart.y, dragCurrent.x - dragStart.x),
        "rgba(94, 234, 212, 0.85)",
      );
    }

    // Committed goal arrow.
    if (goal) {
      drawGoalArrow(c, goal.x, goal.y, goal.theta, "#5eead4");
    }

    // Trail.
    for (let i = 1; i < trail.length; i++) {
      const a = i / trail.length;
      c.strokeStyle = `rgba(196, 181, 253, ${a * 0.65})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(trail[i - 1].x, trail[i - 1].y);
      c.lineTo(trail[i].x, trail[i].y);
      c.stroke();
    }

    particles.draw(c);

    g.ghost.draw(c, elapsed, elapsed);

    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(robot.theta);
    drawRobotBody(c, bumpFlash, elapsed);
    drawRobotLabel(c);
    c.restore();

    if (goal) {
      drawZone(c, { x: goal.x, y: goal.y, r: REACH_TOL + 4 }, "#5eead4", "GOAL", elapsed);
    }

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(c, t("navigation.hint"));
  }

  function drawGoalArrow(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    yaw: number,
    color: string,
  ) {
    c.save();
    c.translate(x, y);
    c.rotate(yaw);
    // Shaft.
    c.strokeStyle = color;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(28, 0);
    c.stroke();
    // Arrowhead.
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(28, 0);
    c.lineTo(20, -6);
    c.lineTo(20, 6);
    c.closePath();
    c.fill();
    // Center dot.
    c.beginPath();
    c.arc(0, 0, 4, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  return {
    id: "navigation",
    name: "Navigation",
    lesson: "Nav2",
    lessonCmd: "ros2 action info /navigate_to_pose",
    ros2: {
      title: tx(
        "Nav2 ・クリックでゴール送信、A* で plan",
        "Nav2 — click to send a goal, A* plans the path",
      ),
      summary:
        "RViz2 の 2D Nav Goal をクリックして送るのと同じ。" +
        "PoseStamped を /goal_pose に publish → グローバルプランナが /plan (nav_msgs/msg/Path) を計算 → " +
        "ローカルプランナ (ここでは pure pursuit) が /cmd_vel を出してロボを追従させる。" +
        "Nav2 スタックの「クリック → 自動走行」が成立する仕組みのミニマム実装。",
      msgTypes: [
        "geometry_msgs/msg/PoseStamped",
        "nav_msgs/msg/Path",
        "geometry_msgs/msg/Twist",
        "nav2_msgs/action/NavigateToPose",
      ],
      cli: [
        "ros2 topic pub --once /goal_pose geometry_msgs/msg/PoseStamped \\\n  '{pose: {position: {x: 2.0, y: 1.0}, orientation: {w: 1.0}}}'",
        "ros2 topic echo /plan",
        "ros2 action send_goal /navigate_to_pose nav2_msgs/action/NavigateToPose \\\n  '{pose: {pose: {position: {x: 2.0, y: 1.0}}}}'",
      ],
      python: `# nav2_simple_commander で 1 行
from nav2_simple_commander.robot_navigator import BasicNavigator
from geometry_msgs.msg import PoseStamped

nav = BasicNavigator()
nav.waitUntilNav2Active()

goal = PoseStamped()
goal.header.frame_id = 'map'
goal.pose.position.x = 2.0
goal.pose.position.y = 1.0
goal.pose.orientation.w = 1.0

nav.goToPose(goal)
while not nav.isTaskComplete():
    feedback = nav.getFeedback()
    print(f'distance remaining: {feedback.distance_remaining:.2f} m')
result = nav.getResult()`,
      realWorld: tx(
        "実機の Nav2 では、地図・自己位置・costmap・各種 server を正しく構成すると RViz からゴールを送れます。Planner には NavFn、Controller には DWB や Regulated Pure Pursuit などの plugin を選べます。本ステージは A* と簡略化した経路追従を組み合わせた一例です。",
        "On a physical robot, Nav2 can accept RViz goals after the map, localization, costmaps, and servers are configured. Plugins may include NavFn for planning and DWB or Regulated Pure Pursuit for control. This stage models one simplified configuration using A* and path following.",
      ),
      state: {
        nodes: ["/nav2_planner", "/nav2_controller", "/robot_node"],
        topics: [
          {
            name: TOPIC_GOAL,
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/rviz2"],
            sub: ["/nav2_planner"],
          },
          {
            name: TOPIC_PLAN,
            type: "nav_msgs/msg/Path",
            pub: ["/nav2_planner"],
            sub: ["/nav2_controller"],
          },
          {
            name: TOPIC_CMD,
            type: "geometry_msgs/msg/Twist",
            pub: ["/nav2_controller"],
            sub: ["/robot_node"],
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
  mode: "lesson",
  order: 12,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="click on map sets a goal, A* plans a path, robot follows">
  <!-- map -->
  <rect x="6" y="6" width="408" height="108" rx="8" fill="#0c1124" stroke="#232c4d"/>
  <!-- grid -->
  <g stroke="#181f3a" stroke-width="0.5" opacity="0.6">
    <line x1="6" y1="34" x2="414" y2="34"/>
    <line x1="6" y1="62" x2="414" y2="62"/>
    <line x1="6" y1="90" x2="414" y2="90"/>
    <line x1="100" y1="6" x2="100" y2="114"/>
    <line x1="200" y1="6" x2="200" y2="114"/>
    <line x1="300" y1="6" x2="300" y2="114"/>
  </g>
  <!-- walls -->
  <rect x="170" y="20" width="14" height="50" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <rect x="240" y="56" width="14" height="50" fill="#3a4366" stroke="#6e7a9c" stroke-width="0.5"/>
  <!-- planned path -->
  <path d="M 60 80 Q 130 30 210 30 T 360 60" fill="none" stroke="#5eead4" stroke-width="2" stroke-dasharray="4 3"/>
  <!-- waypoints -->
  <circle cx="100" cy="50" r="2" fill="#5eead4"/>
  <circle cx="170" cy="34" r="2" fill="#5eead4"/>
  <circle cx="270" cy="34" r="2" fill="#5eead4"/>
  <circle cx="330" cy="48" r="2" fill="#5eead4"/>
  <!-- robot at start -->
  <rect x="50" y="72" width="20" height="16" rx="2" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <circle cx="55" cy="78" r="1.5" fill="#7dd3fc"/>
  <circle cx="65" cy="78" r="1.5" fill="#7dd3fc"/>
  <text x="60" y="100" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9">start</text>
  <!-- moving dot animating along path -->
  <circle r="3.5" fill="#fbbf24">
    <animateMotion dur="3s" repeatCount="indefinite" path="M 60 80 Q 130 30 210 30 T 360 60"/>
  </circle>
  <!-- goal flag -->
  <line x1="360" y1="60" x2="360" y2="34" stroke="#fbbf24" stroke-width="2"/>
  <polygon points="360,34 380,42 360,50" fill="#fb7185" stroke="#fff" stroke-width="0.5"/>
  <text x="360" y="100" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="9">goal</text>
  <!-- click cursor on goal -->
  <g transform="translate(376, 28)" stroke="#fbbf24" stroke-width="1.5" fill="none">
    <line x1="-7" y1="0" x2="7" y2="0"/>
    <line x1="0" y1="-7" x2="0" y2="7"/>
    <circle cx="0" cy="0" r="3"/>
  </g>
  <!-- annotation -->
  <text x="210" y="106" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">click + drag → A* → /cmd_vel</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Nav2 — /goal_pose から自律航行",
      en: "Nav2 — autonomous navigation via /goal_pose",
    },
    learn: {
      ja: "クリック+ドラッグで /goal_pose を送ると、A* で /plan を計算し、pure pursuit コントローラが /cmd_vel を出してロボが追従します。",
      en: "Click+drag publishes /goal_pose, A* computes a /plan, and a pure-pursuit controller emits /cmd_vel that the robot follows.",
    },
    goal: {
      ja: "好きな位置をクリック+ドラッグでゴール指定し、Nav2 にロボを誘導してもらいましょう。",
      en: "Pick any spot with click+drag and let Nav2 navigate the robot for you.",
    },
    first: {
      ja: "マップ上をクリックしたままドラッグして向きを決め、離すと /goal_pose が送信されます。",
      en: "Click on the map, drag to set heading, and release to publish /goal_pose.",
    },
  },
  strings: {
    ja: {
      hint: "Click + Drag = 2D Nav Goal / R = リセット",
      "status.bad_goal": "× ゴールが障害物 / 範囲外です。別の場所をクリック",
      "status.collision": "衝突 — START へリセット",
      "status.navigating": "navigating — {info}",
      "status.plan_fail": "× plan 失敗 (障害物に囲まれている?)",
      "status.reached": "Goal reached. 次のゴールをクリック",
      "status.reached_n": "Goal reached ({n}/{total}) — 次のゴールをクリック",
      "status.cleared": "5 ゴール達成 — クリア",
      "status.tip": "マップをクリック+ドラッグして 2D Nav Goal を送る (R でリセット)",
      tip_hud: "クリック+ドラッグでゴール送信 — 5 ゴールでクリア",
    },
    en: {
      hint: "Click + Drag = 2D Nav Goal / R = reset",
      "status.bad_goal": "× Goal is in an obstacle or out of bounds. Click elsewhere",
      "status.collision": "Collision — reset to START",
      "status.navigating": "navigating — {info}",
      "status.plan_fail": "× plan failed (surrounded by obstacles?)",
      "status.reached": "Goal reached. Click the next goal",
      "status.reached_n": "Goal reached ({n}/{total}) — click the next goal",
      "status.cleared": "5 goals completed — stage clear",
      "status.tip": "Click and drag on the map to send a 2D Nav Goal (R to reset)",
      tip_hud: "click + drag to send a goal — clear after 5 goals",
    },
  },
  build: makeNav2Goal,
});
