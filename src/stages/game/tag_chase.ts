// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// tag_chase: a game of tag
// 1P: player runs; 2 AI taggers chase. Survive 60s to win.
// 2P: P1 runs, P2 chases. Tagger wins by tagging within 30s; runner wins by surviving.
// ROS 2 hook: multi-robot pursuit — each agent publishes /<name>/pose on a
// shared topic, opponents subscribe to compute reactive control.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawHint,
  drawTimer,
  fmtTwist,
  drawRobotBody,
  COLORS,
  clearBackground,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { formatPose, formatTwist } from "../../lib/hud";
import { canMoveTo, type Aabb } from "../../lib/walls";
import { makeOverlayPanel, type OverlayPanelHandle } from "../../lib/overlay_panel";
import { t, tx, onLangChange } from "../../i18n";
import * as twoPlayer from "../../lib/two_player";
import type { PlayerInput } from "../../lib/two_player";

const ROBOT_R = 13;
const RUNNER_LIN = 215;
const TAGGER_LIN_HUMAN = 215; // 2P: equal — obstacles give the runner the edge
const BASE_ANG = 3.0;

type Difficulty = "easy" | "normal" | "hard";

interface DifficultyParams {
  taggerCount: number;
  speedRatio: number; // tagger linear speed = RUNNER_LIN * speedRatio
  angSpeedMult: number; // multiplier on BASE_ANG (turning speed)
  flankCount: number; // how many of the AI use predictive flanking
  flankLead: number; // seconds of forward prediction for flankers
  wallAvoid: boolean; // probe ahead and swing around walls
  itemSeek: boolean; // detour to nearby items
  itemSeekRange: number; // px — only seek items closer than this
  cleardStars: number; // stars awarded on 1P clear
}

const DIFFICULTY: Record<Difficulty, DifficultyParams> = {
  easy: {
    taggerCount: 1,
    speedRatio: 0.85,
    angSpeedMult: 0.85,
    flankCount: 0,
    flankLead: 0.0,
    wallAvoid: false,
    itemSeek: false,
    itemSeekRange: 0,
    cleardStars: 1,
  },
  normal: {
    taggerCount: 2,
    speedRatio: 0.95,
    angSpeedMult: 1.0,
    flankCount: 1,
    flankLead: 0.55,
    wallAvoid: true,
    itemSeek: false,
    itemSeekRange: 0,
    cleardStars: 2,
  },
  hard: {
    taggerCount: 2,
    speedRatio: 1.05,
    angSpeedMult: 1.2,
    flankCount: 2,
    flankLead: 0.85,
    wallAvoid: true,
    itemSeek: true,
    itemSeekRange: 140,
    cleardStars: 3,
  },
};
const TAG_DIST = ROBOT_R * 2 - 2; // contact to count as tagged
const ROUND_TIME_1P = 30;
const ROUND_TIME_2P = 30;
const COUNTDOWN_LEN = 2.4;

// Items + mines.
const ITEM_R = 11;
const ITEM_SPAWN_PERIOD = 7; // seconds between spawn attempts
const ITEM_MAX_ON_FIELD = 3;
const DASH_DURATION = 2.5;
const DASH_MULT = 1.6;
const REACH_DURATION = 3.0;
const REACH_MULT = 1.4;
const MINE_DURATION = 8;
const MINE_R = 14;
const STUN_DURATION = 1.2;

const ARENA = { x: 30, y: 60, w: 740, h: 380 };

// Boundary walls (so canMoveTo can confine bots to the arena interior).
const BOUNDS: Aabb[] = [
  { x: 0, y: 0, w: ARENA.x, h: H }, // left strip
  { x: ARENA.x + ARENA.w, y: 0, w: W - (ARENA.x + ARENA.w), h: H }, // right strip
  { x: 0, y: 0, w: W, h: ARENA.y }, // top strip
  { x: 0, y: ARENA.y + ARENA.h, w: W, h: H - (ARENA.y + ARENA.h) }, // bottom strip
];

// Interior obstacles — make line-of-sight breakable so the runner can juke.
const OBSTACLES: Aabb[] = [
  { x: 150, y: 130, w: 60, h: 80 },
  { x: 350, y: 90, w: 90, h: 50 },
  { x: 560, y: 130, w: 60, h: 80 },
  { x: 200, y: 320, w: 90, h: 50 },
  { x: 420, y: 290, w: 60, h: 80 },
  { x: 600, y: 320, w: 80, h: 50 },
];

const WALLS: Aabb[] = [...BOUNDS, ...OBSTACLES];

interface Body {
  x: number;
  y: number;
  theta: number;
  v: number;
  w: number;
  isRunner: boolean;
  isHuman: boolean;
  isPlayer2: boolean;
  bodyColor: string;
  outline: string;
  label: string;
  /** AI taggers can have personalities (direct vs flanker). */
  aiKind?: "direct" | "flanker";
  /** Active buff timers (seconds remaining). */
  dashT: number;
  /** Tagger-only: extended TAG_DIST window. */
  reachT: number;
  /** Stunned (frozen, can't move). */
  stunT: number;
}

type ItemKind = "dash" | "pulse";
interface Item {
  x: number;
  y: number;
  kind: ItemKind;
  age: number;
}
interface Mine {
  x: number;
  y: number;
  age: number;
}

export function makeTagChase(): Stage {
  let g!: GameContext;
  let elapsed = 0;
  let timeLeft = 0;
  let cleared = false;
  let pubAcc = 0;
  let countdownT = 0;
  let stage: "countdown" | "active" | "over" = "countdown";

  const particles = new Particles();
  let runner!: Body;
  let bots: Body[] = [];

  // Items + mines.
  let items: Item[] = [];
  let mines: Mine[] = [];
  let itemSpawnT = 0;

  // 2P toggle / overlay state.
  let mode2P = false;
  let difficulty: Difficulty = "normal";
  let overlayPanel: OverlayPanelHandle | null = null;
  let disposeLangSync: (() => void) | null = null;

  function makeBody(
    name: string,
    isRunner: boolean,
    isHuman: boolean,
    isPlayer2: boolean,
    bodyColor: string,
    outline: string,
    aiKind?: "direct" | "flanker",
  ): Body {
    return {
      x: 0,
      y: 0,
      theta: 0,
      v: 0,
      w: 0,
      isRunner,
      isHuman,
      isPlayer2,
      bodyColor,
      outline,
      label: name,
      aiKind,
      dashT: 0,
      reachT: 0,
      stunT: 0,
    };
  }

  function reset() {
    particles.reset();
    elapsed = 0;
    cleared = false;
    countdownT = 0;
    stage = "countdown";
    pubAcc = 0;
    items = [];
    mines = [];
    itemSpawnT = 3.0; // first item appears ~3s after the round starts
    twoPlayer.resetEdges();

    timeLeft = mode2P ? ROUND_TIME_2P : ROUND_TIME_1P;

    runner = makeBody("P1", true, true, false, "#7dd3fc", "#1e3a5f");
    const rs = findSpawnSpot(ARENA.x + 90, ARENA.y + ARENA.h / 2);
    runner.x = rs.x;
    runner.y = rs.y;
    runner.theta = 0;

    if (mode2P) {
      const p2 = makeBody("P2", false, true, true, "#fb7185", "#7f1d1d");
      const ps = findSpawnSpot(ARENA.x + ARENA.w - 90, ARENA.y + ARENA.h / 2);
      p2.x = ps.x;
      p2.y = ps.y;
      p2.theta = Math.PI;
      bots = [runner, p2];
    } else {
      const params = DIFFICULTY[difficulty];
      const aiList: Body[] = [];
      // Spread AI starting positions vertically across the right side.
      for (let i = 0; i < params.taggerCount; i++) {
        const isFlanker = i < params.flankCount;
        const colors =
          i === 0
            ? { body: "#fb7185", outline: "#7f1d1d" }
            : i === 1
              ? { body: "#fbbf24", outline: "#7c2d12" }
              : { body: "#a3e635", outline: "#3f6212" };
        const ai = makeBody(
          `AI${i + 1}`,
          false,
          false,
          false,
          colors.body,
          colors.outline,
          isFlanker ? "flanker" : "direct",
        );
        const slots = params.taggerCount;
        // x=735 is a clear vertical column on the right side — no interior
        // obstacle reaches that x — so each AI starts with an open straight
        // line toward the runner.
        const preferX = ARENA.x + ARENA.w - 35;
        let preferY: number;
        if (slots === 1) preferY = ARENA.y + ARENA.h / 2;
        else if (slots === 2) preferY = i === 0 ? ARENA.y + 40 : ARENA.y + ARENA.h - 40;
        else preferY = ARENA.y + 50 + (i * (ARENA.h - 100)) / Math.max(1, slots - 1);
        const s = findSpawnSpot(preferX, preferY);
        ai.x = s.x;
        ai.y = s.y;
        ai.theta = Math.PI;
        aiList.push(ai);
      }
      bots = [runner, ...aiList];
    }

    g.ghost.startRecording();
    g.setStatus(t("tag_chase.status.countdown"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;

    overlayPanel?.dispose();
    disposeLangSync?.();
    overlayPanel = makeOverlayPanel(
      g.overlay,
      [
        {
          kind: "choice",
          label: () => t("tag_chase.overlay.players"),
          choices: [
            { key: "1p", label: () => t("tag_chase.overlay.1p") },
            { key: "2p", label: () => t("tag_chase.overlay.2p") },
          ],
          active: () => (mode2P ? "2p" : "1p"),
          onSelect: (key) => setMode2P(key === "2p"),
        },
        {
          kind: "choice",
          label: () => t("tag_chase.overlay.difficulty"),
          choices: (["easy", "normal", "hard"] as Difficulty[]).map((lvl) => ({
            key: lvl,
            label: () => t(`tag_chase.overlay.${lvl}`),
          })),
          active: () => difficulty,
          onSelect: (key) => setDifficulty(key as Difficulty),
          dividerBefore: true,
          // Difficulty only applies in 1P mode.
          visible: () => !mode2P,
        },
      ],
      { placement: "dock" },
    );
    disposeLangSync = onLangChange(() => overlayPanel?.refresh());

    twoPlayer.installToggleListener();
    twoPlayer.setActive(true);
    reset();
  }

  function dispose() {
    overlayPanel?.dispose();
    overlayPanel = null;
    disposeLangSync?.();
    disposeLangSync = null;
    twoPlayer.setActive(false);
    twoPlayer.uninstallToggleListener();
  }

  function setMode2P(active: boolean) {
    if (mode2P === active) return;
    mode2P = active;
    overlayPanel?.refresh();
    g.sfx.click();
    reset();
  }

  function setDifficulty(d: Difficulty) {
    if (difficulty === d) return;
    difficulty = d;
    overlayPanel?.refresh();
    g.sfx.click();
    if (!mode2P) reset();
  }

  function speedMult(b: Body): number {
    return b.dashT > 0 ? DASH_MULT : 1;
  }

  /**
   * Return a position close to the requested point that is clear of all
   * walls and obstacles. Uses a spiral search; falls back to the requested
   * point if nothing fits (shouldn't happen for our arena).
   */
  function findSpawnSpot(preferX: number, preferY: number): { x: number; y: number } {
    if (canMoveTo(WALLS, preferX, preferY, ROBOT_R + 4)) {
      return { x: preferX, y: preferY };
    }
    for (let r = 14; r <= 100; r += 12) {
      for (let a = 0; a < 12; a++) {
        const ang = (a / 12) * Math.PI * 2;
        const x = preferX + Math.cos(ang) * r;
        const y = preferY + Math.sin(ang) * r;
        if (canMoveTo(WALLS, x, y, ROBOT_R + 4)) return { x, y };
      }
    }
    return { x: preferX, y: preferY };
  }

  // Slide-along-wall motion: try full move, then X-only, then Y-only.
  function applyMotion(b: Body, dt: number) {
    if (b.stunT > 0) {
      b.v = 0;
      b.w = 0;
      return;
    } // frozen
    b.theta += b.w * dt;
    const dx = b.v * Math.cos(b.theta) * dt;
    const dy = b.v * Math.sin(b.theta) * dt;
    if (canMoveTo(WALLS, b.x + dx, b.y + dy, ROBOT_R)) {
      b.x += dx;
      b.y += dy;
    } else if (canMoveTo(WALLS, b.x + dx, b.y, ROBOT_R)) {
      b.x += dx;
    } else if (canMoveTo(WALLS, b.x, b.y + dy, ROBOT_R)) {
      b.y += dy;
    }
  }

  function aiTaggerStep(b: Body, dt: number) {
    if (b.stunT > 0) {
      b.v = 0;
      b.w = 0;
      return;
    }
    const params = DIFFICULTY[difficulty];

    // Pick target: runner (with optional lead), or detour to a nearby item.
    const lead = b.aiKind === "flanker" ? params.flankLead : 0;
    let targetX = runner.x + runner.v * Math.cos(runner.theta) * lead;
    let targetY = runner.y + runner.v * Math.sin(runner.theta) * lead;

    if (params.itemSeek && items.length > 0) {
      let bestItem: Item | null = null;
      let bestD = params.itemSeekRange;
      for (const it of items) {
        const d = Math.hypot(b.x - it.x, b.y - it.y);
        if (d < bestD) {
          bestD = d;
          bestItem = it;
        }
      }
      if (bestItem) {
        targetX = bestItem.x;
        targetY = bestItem.y;
      }
    }

    let desired = Math.atan2(targetY - b.y, targetX - b.x);

    // Wall-avoidance probe: if the straight line is blocked, pick the
    // candidate heading (offset from `desired`) that is both clear AND
    // requires the smallest rotation from the current heading. Picking by
    // smallest |dAng| keeps the choice stable across frames; picking the
    // first-clear swing was causing the AI to oscillate when the runner
    // line stayed blocked but different swings became valid each tick.
    if (params.wallAvoid) {
      const probeDist = 34;
      const px = b.x + Math.cos(desired) * probeDist;
      const py = b.y + Math.sin(desired) * probeDist;
      if (!canMoveTo(WALLS, px, py, ROBOT_R + 2)) {
        const swings = [
          Math.PI / 6,
          -Math.PI / 6,
          Math.PI / 3,
          -Math.PI / 3,
          Math.PI / 2,
          -Math.PI / 2,
          (2 * Math.PI) / 3,
          -(2 * Math.PI) / 3,
          Math.PI, // 180° — can back away if everything else is blocked
        ];
        let bestDesired: number | null = null;
        let bestCost = Infinity;
        for (const s of swings) {
          const ta = desired + s;
          const tx = b.x + Math.cos(ta) * probeDist;
          const ty = b.y + Math.sin(ta) * probeDist;
          if (!canMoveTo(WALLS, tx, ty, ROBOT_R + 2)) continue;
          let dA = ta - b.theta;
          while (dA > Math.PI) dA -= 2 * Math.PI;
          while (dA < -Math.PI) dA += 2 * Math.PI;
          // Prefer smaller rotation; tiny bias toward smaller swing s.
          const cost = Math.abs(dA) + Math.abs(s) * 0.15;
          if (cost < bestCost) {
            bestCost = cost;
            bestDesired = ta;
          }
        }
        if (bestDesired !== null) desired = bestDesired;
      }
    }

    let dAng = desired - b.theta;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    const angCap = BASE_ANG * params.angSpeedMult;
    b.w = Math.max(-angCap, Math.min(angCap, dAng * 4));
    // Allow modest backward motion when facing the wrong way so the AI
    // never "freezes while rotating" inside an obstacle pocket. Forward
    // is full speed; backward is capped at 50%.
    const align = Math.cos(dAng);
    const fwdSpeed = RUNNER_LIN * params.speedRatio * speedMult(b);
    b.v = align >= 0 ? align * fwdSpeed : align * fwdSpeed * 0.5;
    applyMotion(b, dt);
  }

  function humanStep(b: Body, input: PlayerInput, dt: number) {
    const linDir = (input.fwd ? 1 : 0) - (input.back ? 1 : 0);
    const angDir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const baseSpeed = b.isRunner ? RUNNER_LIN : TAGGER_LIN_HUMAN;
    b.v = linDir * baseSpeed * speedMult(b);
    b.w = angDir * BASE_ANG;
    applyMotion(b, dt);
  }

  function trySpawnItem() {
    if (items.length >= ITEM_MAX_ON_FIELD) return;
    // Find a valid spot away from walls and bots.
    for (let attempt = 0; attempt < 18; attempt++) {
      const x = ARENA.x + 25 + Math.random() * (ARENA.w - 50);
      const y = ARENA.y + 25 + Math.random() * (ARENA.h - 50);
      if (!canMoveTo(WALLS, x, y, ITEM_R + 6)) continue;
      let tooClose = false;
      for (const b of bots) {
        if (Math.hypot(b.x - x, b.y - y) < 90) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      // Roughly equal mix of types, slight bias toward DASH.
      const kind: ItemKind = Math.random() < 0.55 ? "dash" : "pulse";
      items.push({ x, y, kind, age: 0 });
      g.sfx.bump();
      return;
    }
  }

  function applyPickup(b: Body, item: Item) {
    if (item.kind === "dash") {
      b.dashT = Math.max(b.dashT, DASH_DURATION);
      particles.burst(b.x, b.y, "#5eead4", 14, 180);
    } else {
      // PULSE: role-aware effect.
      if (b.isRunner) {
        // Drop a stun mine at the runner's current spot.
        mines.push({ x: b.x, y: b.y, age: 0 });
        particles.burst(b.x, b.y, "#fbbf24", 14, 180);
      } else {
        b.reachT = Math.max(b.reachT, REACH_DURATION);
        particles.burst(b.x, b.y, "#fb7185", 14, 180);
      }
    }
    g.sfx.pickup();
    g.shake(0.2);
  }

  function update(dt: number) {
    if (twoPlayer.pollToggleEdge()) setMode2P(!mode2P);

    particles.update(dt);
    if (cleared) return;

    if (stage === "countdown") {
      countdownT += dt;
      if (countdownT >= COUNTDOWN_LEN) {
        stage = "active";
        elapsed = 0;
        g.sfx.start();
        g.setStatus(t("tag_chase.status.run"), "var(--ok)");
      }
      return;
    }

    if (stage === "over") return;

    elapsed += dt;
    timeLeft = Math.max(0, (mode2P ? ROUND_TIME_2P : ROUND_TIME_1P) - elapsed);

    // Tick per-bot buff/debuff timers.
    for (const b of bots) {
      if (b.dashT > 0) b.dashT = Math.max(0, b.dashT - dt);
      if (b.reachT > 0) b.reachT = Math.max(0, b.reachT - dt);
      if (b.stunT > 0) b.stunT = Math.max(0, b.stunT - dt);
    }

    // Drive the runner (always P1).
    humanStep(runner, twoPlayer.pollP1(), dt);

    // Drive the taggers.
    if (mode2P) {
      humanStep(bots[1], twoPlayer.pollP2(), dt);
    } else {
      for (let i = 1; i < bots.length; i++) aiTaggerStep(bots[i], dt);
    }

    // Item spawn cycle.
    itemSpawnT -= dt;
    if (itemSpawnT <= 0) {
      trySpawnItem();
      itemSpawnT = ITEM_SPAWN_PERIOD;
    }
    // Animate item age (used for visual pulsing).
    for (const it of items) it.age += dt;

    // Pickup detection (any bot vs any item).
    for (const b of bots) {
      for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k];
        if (Math.hypot(b.x - it.x, b.y - it.y) < ROBOT_R + ITEM_R) {
          applyPickup(b, it);
          items.splice(k, 1);
        }
      }
    }

    // Mines: age out, and stun any tagger that walks over one.
    for (let i = mines.length - 1; i >= 0; i--) {
      const m = mines[i];
      m.age += dt;
      if (m.age >= MINE_DURATION) {
        mines.splice(i, 1);
        continue;
      }
      // Only taggers can be stunned; runner walks freely over their own mines.
      for (let bi = 1; bi < bots.length; bi++) {
        const b = bots[bi];
        if (b.stunT > 0) continue;
        if (Math.hypot(b.x - m.x, b.y - m.y) < ROBOT_R + MINE_R) {
          b.stunT = STUN_DURATION;
          particles.burst(m.x, m.y, "#fbbf24", 22, 230);
          g.sfx.bump();
          g.shake(0.4);
          mines.splice(i, 1);
          break;
        }
      }
    }

    // Tag check: runner vs any tagger (tagger reach buff extends contact distance).
    let tagged = false;
    let taggerIdx = -1;
    for (let i = 1; i < bots.length; i++) {
      const tb = bots[i];
      const reach = TAG_DIST * (tb.reachT > 0 ? REACH_MULT : 1);
      if (Math.hypot(runner.x - tb.x, runner.y - tb.y) < reach) {
        tagged = true;
        taggerIdx = i;
        break;
      }
    }

    if (tagged) {
      stage = "over";
      cleared = true;
      const tagger = bots[taggerIdx];
      particles.burst(tagger.x, tagger.y, tagger.bodyColor, 26, 220);
      particles.burst(runner.x, runner.y, "#fb7185", 30, 180);
      g.shake(0.6);

      if (mode2P) {
        const stats =
          `Winner    <b>P2 (tagger)</b><br>` +
          `Caught at <b>${elapsed.toFixed(2)} s</b><br>` +
          `Survived  <b>${elapsed.toFixed(1)}</b> / ${ROUND_TIME_2P} s`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(2, stats);
        }, 700);
      } else {
        // 1P: classic crash on tag.
        g.setTimeout(() => g.crash(t("tag_chase.crash.tagged")), 600);
      }
      publishOnce();
      return;
    }

    if (timeLeft <= 0) {
      stage = "over";
      cleared = true;
      particles.burst(runner.x, runner.y, COLORS.OK, 40);
      g.sfx.deliver();
      g.shake(0.5);

      if (mode2P) {
        const stats =
          `Winner    <b>P1 (runner)</b><br>` + `Survived  <b>${ROUND_TIME_2P.toFixed(0)} s</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(3, stats);
        }, 700);
      } else {
        const params = DIFFICULTY[difficulty];
        const stats =
          `Survived   <b>${ROUND_TIME_1P.toFixed(0)} s</b><br>` +
          `Difficulty <b>${difficulty.toUpperCase()}</b><br>` +
          `Threats    <b>${bots.length - 1}</b> AI tagger(s)`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(params.cleardStars, stats);
        }, 700);
      }
      publishOnce();
      return;
    }

    // ── publish (10Hz) ──
    pubAcc += dt;
    if (pubAcc > 1 / 10) {
      pubAcc = 0;
      publishOnce();
    }
    g.ghost.recordPose(elapsed, runner.x, runner.y, runner.theta);

    g.setStatus(
      t(mode2P ? "tag_chase.status.run2p" : "tag_chase.status.run", { left: timeLeft.toFixed(1) }),
      "",
    );

    const buffP1 = formatBuffs(runner);
    const modeLine = mode2P ? "2P (P1 vs P2)" : `1P [${difficulty}] you vs ${bots.length - 1} AI`;
    const hudLines = [
      `mode:    ${modeLine}`,
      `survive: ${timeLeft.toFixed(1)} / ${(mode2P ? ROUND_TIME_2P : ROUND_TIME_1P).toFixed(0)} s`,
      `pose:${formatPose(runner)}`,
      `cmd_vel:${formatTwist({ v: runner.v, w: runner.w }, { pxPerM: RUNNER_LIN })}`,
      `nearest_tagger: ${nearestTaggerDist().toFixed(0)} px`,
      `items: ${items.length} on field · mines: ${mines.length}`,
      `P1 buffs: ${buffP1}`,
    ];
    if (mode2P) hudLines.push(`P2 buffs: ${formatBuffs(bots[1])}`);
    g.setHud(hudLines);
  }

  function formatBuffs(b: Body): string {
    const parts: string[] = [];
    if (b.dashT > 0) parts.push(`DASH ${b.dashT.toFixed(1)}s`);
    if (b.reachT > 0) parts.push(`REACH ${b.reachT.toFixed(1)}s`);
    if (b.stunT > 0) parts.push(`STUN ${b.stunT.toFixed(1)}s`);
    return parts.length ? parts.join("  ") : "—";
  }

  function nearestTaggerDist(): number {
    let best = Infinity;
    for (let i = 1; i < bots.length; i++) {
      best = Math.min(best, Math.hypot(runner.x - bots[i].x, runner.y - bots[i].y));
    }
    return best;
  }

  function publishOnce() {
    g.publish("/runner/pose", `x=${runner.x.toFixed(1)} y=${runner.y.toFixed(1)}`);
    g.publish("/runner/cmd_vel", fmtTwist(runner.v / RUNNER_LIN, runner.w));
    for (let i = 1; i < bots.length; i++) {
      const tb = bots[i];
      const topic = mode2P ? "/p2/pose" : `/tagger${i}/pose`;
      g.publish(topic, `x=${tb.x.toFixed(1)} y=${tb.y.toFixed(1)}`);
    }
  }

  // ── DRAW ─────────────────────────────────────────────────────
  function draw() {
    const c = g.ctx;
    clearBackground(c);

    drawArena(c);
    drawObstacles(c);

    // Subtle leash line from each tagger to the runner (active stage only).
    if (stage === "active") drawLeashes(c);

    drawMines(c);
    drawItems(c);

    particles.draw(c);

    for (const b of bots) drawBot(c, b);

    drawTimerBar(c);

    if (stage === "countdown") drawCountdown(c);

    drawTimer(c, elapsed, g.getBestTime());
    drawHint(
      c,
      t(mode2P ? "tag_chase.hint2p" : "tag_chase.hint", {
        pads: twoPlayer.padCount(),
      }),
    );
  }

  function drawArena(c: CanvasRenderingContext2D) {
    c.fillStyle = "rgba(15, 30, 56, 0.55)";
    c.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    c.strokeStyle = "rgba(125, 211, 252, 0.4)";
    c.lineWidth = 2;
    c.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    // Subtle grid for orientation.
    c.strokeStyle = "rgba(125, 211, 252, 0.06)";
    c.lineWidth = 1;
    for (let x = ARENA.x; x <= ARENA.x + ARENA.w; x += 40) {
      c.beginPath();
      c.moveTo(x, ARENA.y);
      c.lineTo(x, ARENA.y + ARENA.h);
      c.stroke();
    }
    for (let y = ARENA.y; y <= ARENA.y + ARENA.h; y += 40) {
      c.beginPath();
      c.moveTo(ARENA.x, y);
      c.lineTo(ARENA.x + ARENA.w, y);
      c.stroke();
    }
  }

  function drawObstacles(c: CanvasRenderingContext2D) {
    for (const o of OBSTACLES) {
      c.fillStyle = "rgba(94, 110, 160, 0.85)";
      c.fillRect(o.x, o.y, o.w, o.h);
      c.strokeStyle = "rgba(180, 200, 240, 0.5)";
      c.lineWidth = 1;
      c.strokeRect(o.x + 0.5, o.y + 0.5, o.w - 1, o.h - 1);
      // Diagonal hatch.
      c.save();
      c.beginPath();
      c.rect(o.x, o.y, o.w, o.h);
      c.clip();
      c.strokeStyle = "rgba(180, 200, 240, 0.18)";
      const step = 8;
      for (let i = -o.h; i < o.w + o.h; i += step) {
        c.beginPath();
        c.moveTo(o.x + i, o.y);
        c.lineTo(o.x + i + o.h, o.y + o.h);
        c.stroke();
      }
      c.restore();
    }
  }

  function drawItems(c: CanvasRenderingContext2D) {
    for (const it of items) {
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(it.age * 3));
      const color = it.kind === "dash" ? "#5eead4" : "#fbbf24";
      const glyph = it.kind === "dash" ? "⚡" : "✦";

      c.save();
      // Glow halo.
      c.globalAlpha = 0.18 + 0.25 * pulse;
      c.fillStyle = color;
      c.beginPath();
      c.arc(it.x, it.y, ITEM_R + 4 + pulse * 3, 0, Math.PI * 2);
      c.fill();

      // Body.
      c.globalAlpha = 1;
      c.fillStyle = "#0c1124";
      c.strokeStyle = color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(it.x, it.y, ITEM_R, 0, Math.PI * 2);
      c.fill();
      c.stroke();

      // Glyph.
      c.fillStyle = color;
      c.font = "700 14px ui-monospace, monospace";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(glyph, it.x, it.y + 0.5);
      c.restore();
    }
  }

  function drawMines(c: CanvasRenderingContext2D) {
    for (const m of mines) {
      const remaining = MINE_DURATION - m.age;
      const lifeFrac = Math.max(0, Math.min(1, remaining / MINE_DURATION));
      // Faster pulse when about to expire.
      const pulseRate = remaining < 2 ? 9 : 3.5;
      const pulse = 0.5 + 0.5 * Math.abs(Math.sin(m.age * pulseRate));

      c.save();
      c.globalAlpha = 0.15 + 0.3 * pulse * lifeFrac;
      c.fillStyle = "#fbbf24";
      c.beginPath();
      c.arc(m.x, m.y, MINE_R + 3 + pulse * 2, 0, Math.PI * 2);
      c.fill();

      c.globalAlpha = 0.8 * lifeFrac;
      c.strokeStyle = "#fbbf24";
      c.setLineDash([3, 3]);
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(m.x, m.y, MINE_R, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);

      // Cross marker.
      c.globalAlpha = lifeFrac;
      c.strokeStyle = "#fb7185";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(m.x - 4, m.y);
      c.lineTo(m.x + 4, m.y);
      c.moveTo(m.x, m.y - 4);
      c.lineTo(m.x, m.y + 4);
      c.stroke();
      c.restore();
    }
  }

  function drawLeashes(c: CanvasRenderingContext2D) {
    c.save();
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    for (let i = 1; i < bots.length; i++) {
      const tb = bots[i];
      const d = Math.hypot(runner.x - tb.x, runner.y - tb.y);
      // Closer = redder + more opaque.
      const tnorm = Math.max(0, Math.min(1, (220 - d) / 220));
      c.globalAlpha = 0.18 + 0.45 * tnorm;
      c.strokeStyle = "#fb7185";
      c.beginPath();
      c.moveTo(tb.x, tb.y);
      c.lineTo(runner.x, runner.y);
      c.stroke();
    }
    c.restore();
  }

  function drawBot(c: CanvasRenderingContext2D, b: Body) {
    const scale = ROBOT_R / 16;

    // Buff: extended-reach circle (taggers only).
    if (b.reachT > 0 && !b.isRunner) {
      c.save();
      c.globalAlpha = 0.18 + 0.18 * Math.abs(Math.sin(elapsed * 5));
      c.strokeStyle = "#fb7185";
      c.lineWidth = 1.5;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.arc(b.x, b.y, TAG_DIST * REACH_MULT, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.restore();
    }

    // Buff: dash trail (motion lines behind heading).
    if (b.dashT > 0 && Math.abs(b.v) > 1) {
      c.save();
      const tailColor = b.isRunner ? "#5eead4" : "#fb7185";
      c.strokeStyle = tailColor;
      c.lineWidth = 2;
      for (let k = 0; k < 4; k++) {
        const off = (k + 1) * 6;
        const tx = b.x - Math.cos(b.theta) * off;
        const ty = b.y - Math.sin(b.theta) * off;
        c.globalAlpha = (1 - k / 4) * 0.55;
        c.beginPath();
        c.arc(tx, ty, ROBOT_R - k * 2, 0, Math.PI * 2);
        c.stroke();
      }
      c.restore();
    }

    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.theta);
    c.save();
    c.scale(scale, scale);
    drawRobotBody(c, 0, elapsed);
    c.restore();
    c.restore();

    // Outer ring + role indicator.
    c.save();
    c.strokeStyle = b.bodyColor;
    c.lineWidth = b.isHuman ? 2.5 : 1.8;
    c.beginPath();
    c.arc(b.x, b.y, ROBOT_R, 0, Math.PI * 2);
    c.stroke();

    // Runner: pulsing safe-glow halo.
    if (b.isRunner) {
      const pulse = 0.4 + 0.4 * Math.abs(Math.sin(elapsed * 3));
      c.globalAlpha = pulse * 0.45;
      c.strokeStyle = "#7dd3fc";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(b.x, b.y, ROBOT_R + 5 + pulse * 3, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    } else {
      // Tagger: small triangle indicating heading.
      c.fillStyle = b.bodyColor;
      const tx = b.x + Math.cos(b.theta) * (ROBOT_R + 2);
      const ty = b.y + Math.sin(b.theta) * (ROBOT_R + 2);
      const px = -Math.sin(b.theta),
        py = Math.cos(b.theta);
      c.beginPath();
      c.moveTo(tx + Math.cos(b.theta) * 4, ty + Math.sin(b.theta) * 4);
      c.lineTo(tx + px * 3, ty + py * 3);
      c.lineTo(tx - px * 3, ty - py * 3);
      c.closePath();
      c.fill();
    }
    c.restore();

    // Stun overlay: spinning ✕ above the bot.
    if (b.stunT > 0) {
      c.save();
      c.translate(b.x, b.y - ROBOT_R - 12);
      c.rotate(elapsed * 6);
      c.strokeStyle = "#fbbf24";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-5, -5);
      c.lineTo(5, 5);
      c.moveTo(5, -5);
      c.lineTo(-5, 5);
      c.stroke();
      c.restore();
    }

    // Label above head.
    c.save();
    c.fillStyle = b.bodyColor;
    c.font = (b.isHuman ? "700 10px " : "700 8px ") + "ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(b.label, b.x, b.y - ROBOT_R - 5);
    if (b.isRunner) {
      c.fillStyle = "rgba(125,211,252,0.55)";
      c.font = "8px ui-monospace, monospace";
      c.fillText(t("tag_chase.label.runner"), b.x, b.y + ROBOT_R + 11);
    } else {
      c.fillStyle = "rgba(251,113,133,0.55)";
      c.font = "8px ui-monospace, monospace";
      c.fillText(t("tag_chase.label.tagger"), b.x, b.y + ROBOT_R + 11);
    }
    c.restore();
  }

  function drawTimerBar(c: CanvasRenderingContext2D) {
    const total = mode2P ? ROUND_TIME_2P : ROUND_TIME_1P;
    const frac = Math.max(0, Math.min(1, timeLeft / total));
    const barW = 320,
      barH = 14;
    const bx = (W - barW) / 2,
      by = 18;
    c.save();
    c.fillStyle = withA(theme.scrim, 0.9);
    c.strokeStyle = "rgba(125,211,252,0.4)";
    c.lineWidth = 1;
    c.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    c.strokeRect(bx - 2, by - 2, barW + 4, barH + 4);
    c.fillStyle = "#0a0e1f";
    c.fillRect(bx, by, barW, barH);
    // Fill: green → amber → red as time runs out.
    const col = frac > 0.6 ? "#5eead4" : frac > 0.25 ? "#fbbf24" : "#fb7185";
    c.fillStyle = col;
    c.fillRect(bx, by, barW * frac, barH);
    c.fillStyle = COLORS.FG;
    c.font = "700 11px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText(
      `${t("tag_chase.label.survive")}  ${timeLeft.toFixed(1)} / ${total.toFixed(0)} s`,
      W / 2,
      by + barH / 2 + 4,
    );
    c.restore();
  }

  function drawCountdown(c: CanvasRenderingContext2D) {
    const remaining = COUNTDOWN_LEN - countdownT;
    let text = "GO!";
    let color: string = COLORS.OK;
    if (remaining > 1.6) {
      text = "READY";
      color = COLORS.WARN;
    } else if (remaining > 0.5) {
      text = "SET";
      color = "#fbbf24";
    }

    const phase = text === "GO!" ? Math.min(1, (0.5 - remaining) / 0.5) : 1 - (remaining % 1);

    c.save();
    c.translate(W / 2, H / 2);
    const scale = text === "GO!" ? 1 + (1 - Math.min(1, phase * 2)) * 1.5 : 1 + phase * 0.25;
    c.scale(scale, scale);
    c.globalAlpha = text === "GO!" ? Math.max(0, 1 - phase * 0.6) : 0.85 + phase * 0.15;
    c.fillStyle = color;
    c.font = "700 88px ui-monospace, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = color;
    c.shadowBlur = 30;
    c.fillText(text, 0, 0);
    c.restore();
  }

  return {
    id: "tag_chase",
    name: "Tag",
    lesson: "",
    lessonCmd: "ros2 topic echo /runner/pose",
    ros2: {
      title: tx(
        "Multi-robot pursuit — 共有 topic で他者位置を読む",
        "Multi-robot pursuit — read peer poses from a shared topic",
      ),
      summary:
        "鬼ごっこは multi-robot pursuit の典型的なミニマム例。各ロボは自分の pose を /<name>/pose に publish し、" +
        "他のロボはそれを subscribe して相対位置を計算→ cmd_vel を決める。" +
        "Pure-pursuit (敵に向かって) と evasion (敵から離れる) の両方が同じ仕組みで書ける。",
      msgTypes: ["geometry_msgs/msg/Pose", "geometry_msgs/msg/Twist"],
      cli: ["ros2 topic list", "ros2 topic echo /runner/pose", "ros2 topic echo /tagger1/pose"],
      python: `# 鬼 (tagger) ロボ — runner を購読して向かう
class Tagger(Node):
    def __init__(self):
        super().__init__('tagger1')
        self.create_subscription(Pose, '/runner/pose', self.on_runner, 10)
        self.pub = self.create_publisher(Twist, '/tagger1/cmd_vel', 10)
        self.runner = None
    def on_runner(self, p):
        self.runner = p
    def step(self):
        if self.runner is None: return
        # pure-pursuit: aim straight at the runner
        dx = self.runner.position.x - self.x
        dy = self.runner.position.y - self.y
        ang = math.atan2(dy, dx) - self.theta
        self.pub.publish(Twist(linear=Vector3(x=0.5),
                               angular=Vector3(z=ang*4)))`,
      realWorld: tx(
        "実機ロボのチェイス・追従・回避は本質的に同じ — 仲間/敵の pose を共有 topic で読み合い、自分の cmd_vel を独立に決める。",
        "Real robot chase / follow / evasion is the same recipe: each robot reads peers' poses from shared topics and decides its own cmd_vel. Used in RoboCup, drone formations, auto-park.",
      ),
      state: {
        nodes: ["/runner", "/tagger1", "/tagger2"],
        topics: [
          {
            name: "/runner/pose",
            type: "geometry_msgs/msg/Pose",
            pub: ["/runner"],
            sub: ["/tagger1", "/tagger2"],
          },
          { name: "/runner/cmd_vel", type: "geometry_msgs/msg/Twist", pub: ["/runner"], sub: [] },
          {
            name: "/tagger1/pose",
            type: "geometry_msgs/msg/Pose",
            pub: ["/tagger1"],
            sub: ["/runner"],
          },
          {
            name: "/tagger2/pose",
            type: "geometry_msgs/msg/Pose",
            pub: ["/tagger2"],
            sub: ["/runner"],
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
  order: 8,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="runner publishes pose, two taggers subscribe and chase">
  <defs>
    <marker id="ld-tag-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fb7185"/>
    </marker>
    <marker id="ld-tag-pose" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#7dd3fc"/>
    </marker>
  </defs>
  <!-- runner box -->
  <rect x="20" y="44" width="120" height="34" rx="6" fill="#0c1124" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="80" y="60" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="11" font-weight="700">runner</text>
  <text x="80" y="73" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">pub /runner/pose</text>
  <!-- tagger1 box -->
  <rect x="280" y="14" width="120" height="34" rx="6" fill="#0c1124" stroke="#fb7185" stroke-width="1.5"/>
  <text x="340" y="30" text-anchor="middle" fill="#fb7185" font-family="ui-monospace, monospace" font-size="11" font-weight="700">tagger1</text>
  <text x="340" y="43" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">sub → cmd_vel</text>
  <!-- tagger2 box -->
  <rect x="280" y="74" width="120" height="34" rx="6" fill="#0c1124" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="340" y="90" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">tagger2</text>
  <text x="340" y="103" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">sub → cmd_vel</text>
  <!-- pose lines (cyan) -->
  <line x1="140" y1="55" x2="278" y2="30" stroke="#7dd3fc" stroke-width="1.5" marker-end="url(#ld-tag-pose)"/>
  <line x1="140" y1="65" x2="278" y2="90" stroke="#7dd3fc" stroke-width="1.5" marker-end="url(#ld-tag-pose)"/>
  <text x="200" y="38" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="9">/runner/pose</text>
  <!-- chase arrows (pink, dashed) -->
  <line x1="278" y1="40" x2="146" y2="55" stroke="#fb7185" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.7" marker-end="url(#ld-tag-arrow)"/>
  <line x1="278" y1="92" x2="146" y2="65" stroke="#fb7185" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.7" marker-end="url(#ld-tag-arrow)"/>
</svg>
`,
  lessonModal: {
    title: {
      ja: "鬼ごっこ — Multi-robot pursuit",
      en: "Tag — Multi-robot pursuit",
    },
    learn: {
      ja: "ロボサッカーと同じ multi-robot 通信のミニマム例。各ロボは自分の pose を topic に publish し、相手 (鬼 / 逃げ手) はそれを subscribe して相対位置を計算→ cmd_vel を決めます。Pure-pursuit と evasion が同じデータフローで書けます。",
      en: "A minimum multi-robot pursuit setup. Each robot publishes its pose to a topic; the others subscribe to compute relative positions and pick their cmd_vel. Pure-pursuit and evasion share the same data flow.",
    },
    goal: {
      ja: "1P: 30 秒間 AI 鬼につかまらなければクリア。難易度 (弱め=AI 1 体 / ふつう=AI 2 体 / 強め=AI 2 体高速&アイテム狙い) を選べる。\n2P: P1 が逃げる人、P2 が鬼。30 秒以内につかまれば鬼の勝ち、生き残れば逃げの勝ち。\n\nアイテム: ⚡ DASH = 速度+60% (2.5s) / ✦ PULSE = 逃げ手が拾うと地雷を設置(鬼を 1.2s スタン)・鬼が拾うとタッチ範囲+40% (3s)。",
      en: "1P: Survive 30s without being tagged by AI taggers. Pick a difficulty (Easy=1 AI / Normal=2 AI / Hard=2 fast item-seeking AI).\n2P: P1 runs, P2 chases. Tagger wins by tagging within 30s; runner wins by surviving.\n\nItems: ⚡ DASH = +60% speed (2.5s) / ✦ PULSE = runner drops a stun mine (1.2s tagger stun); tagger gets +40% tag reach (3s).",
    },
    first: {
      ja: "障害物を盾にして視線を切るのが鉄則。Pad対戦はPadを2台接続してYを押します。P1が逃げ手、P2が鬼になり、どちらも左スティックで移動します。",
      en: "Use obstacles to break line of sight. For a pad battle, connect two pads and press Y. P1 is the runner, P2 is the tagger, and both move with the left stick.",
    },
  },
  strings: {
    ja: {
      hint: "1P · WASD/左スティック 移動 · Y → 2P PAD（接続 {pads}/2）",
      hint2p: "🎮 2P PAD（接続 {pads}/2）· P1=逃げ手 / P2=鬼 · 左スティック 移動 · Y → 1P",
      "status.countdown": "READY... 鬼が来るぞ!",
      "status.run": "逃げろ! あと {left} 秒",
      "status.run2p": "P1=逃 / P2=鬼  ·  あと {left} 秒",
      "crash.tagged": "タッチされた! — リトライ",
      "label.runner": "runner",
      "label.tagger": "tagger",
      "label.survive": "SURVIVE",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD対戦",
      "overlay.difficulty": "難易度",
      "overlay.easy": "弱め",
      "overlay.normal": "ふつう",
      "overlay.hard": "強め",
    },
    en: {
      hint: "1P · WASD/LEFT STICK move · Y → 2P PAD ({pads}/2)",
      hint2p: "🎮 2P PAD ({pads}/2) · P1=RUNNER / P2=TAGGER · LEFT STICK move · Y → 1P",
      "status.countdown": "READY... taggers incoming!",
      "status.run": "Run! {left}s left",
      "status.run2p": "P1=runner / P2=tagger  ·  {left}s left",
      "crash.tagged": "Tagged! — retry",
      "label.runner": "runner",
      "label.tagger": "tagger",
      "label.survive": "SURVIVE",
      "overlay.players": "LOCAL PLAY",
      "overlay.1p": "1P vs AI",
      "overlay.2p": "🎮 2P PAD BATTLE",
      "overlay.difficulty": "Difficulty",
      "overlay.easy": "Easy",
      "overlay.normal": "Normal",
      "overlay.hard": "Hard",
    },
  },
  build: makeTagChase,
});
