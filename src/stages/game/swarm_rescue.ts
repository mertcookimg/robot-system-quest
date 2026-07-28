// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// swarm_rescue — coordinate three friendly robots to find lost mini-bots and
// bring them back to the charging station.
import { W, H, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { clearBackground, drawGrid, drawHint, drawRobotBody } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { withA } from "../../core/theme";
import { t, tx } from "../../i18n";
import * as armpad from "../../lib/armpad";

type Role = "SCOUT" | "CARRIER" | "RELAY";
interface Bot {
  role: Role;
  x: number;
  y: number;
  theta: number;
  color: string;
  connected: boolean;
  carrying: number | null;
}
interface Victim {
  x: number;
  y: number;
  rescued: boolean;
  carried: boolean;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BASE = { x: 62, y: 250, r: 42 };
const ROBOT_R = 14;
const TOTAL_TIME = 150;
const CELL = 20;
const COLS = W / CELL;
const ROWS = H / CELL;
const WALLS: Rect[] = [
  { x: 270, y: 0, w: 22, h: 150 },
  { x: 270, y: 345, w: 22, h: 155 },
  { x: 505, y: 135, w: 22, h: 230 },
  { x: 650, y: 225, w: 115, h: 18 },
];
const VICTIM_START = [
  { x: 205, y: 405 },
  { x: 430, y: 80 },
  { x: 705, y: 405 },
];

export function makeSwarmRescue(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  const bots: Bot[] = [
    { role: "SCOUT", x: 65, y: 230, theta: 0, color: "#7dd3fc", connected: true, carrying: null },
    { role: "CARRIER", x: 65, y: 250, theta: 0, color: "#5eead4", connected: true, carrying: null },
    { role: "RELAY", x: 65, y: 270, theta: 0, color: "#c4b5fd", connected: true, carrying: null },
  ];
  const victims: Victim[] = VICTIM_START.map((p) => ({ ...p, rescued: false, carried: false }));
  const explored = new Uint8Array(COLS * ROWS);
  let active = 0;
  let remaining = TOTAL_TIME;
  let rescued = 0;
  let discovered = 0;
  let score = 0;
  let combo = 0;
  let animTime = 0;
  let switchFlash = 0;
  let cleared = false;
  let prevSwitch = [false, false, false];
  let pubAcc = 0;
  let scoutTarget = { x: 180, y: 250 };
  let scoutRetarget = 0;

  function collides(x: number, y: number) {
    if (x < ROBOT_R || x > W - ROBOT_R || y < ROBOT_R || y > H - ROBOT_R) return true;
    return WALLS.some((w) => {
      const cx = Math.max(w.x, Math.min(x, w.x + w.w));
      const cy = Math.max(w.y, Math.min(y, w.y + w.h));
      return Math.hypot(x - cx, y - cy) < ROBOT_R;
    });
  }

  function linkRange(a: Bot | null, b: Bot) {
    return a?.role === "RELAY" || b.role === "RELAY" ? 320 : 235;
  }

  function updateNetwork() {
    bots.forEach((b) => (b.connected = false));
    const queue: number[] = [];
    bots.forEach((b, i) => {
      if (Math.hypot(b.x - BASE.x, b.y - BASE.y) <= linkRange(null, b)) {
        b.connected = true;
        queue.push(i);
      }
    });
    while (queue.length) {
      const i = queue.shift()!;
      bots.forEach((b, j) => {
        if (!b.connected && Math.hypot(b.x - bots[i].x, b.y - bots[i].y) <= linkRange(bots[i], b)) {
          b.connected = true;
          queue.push(j);
        }
      });
    }
  }

  function reveal(x: number, y: number, radius: number) {
    const minX = Math.max(0, Math.floor((x - radius) / CELL));
    const maxX = Math.min(COLS - 1, Math.floor((x + radius) / CELL));
    const minY = Math.max(0, Math.floor((y - radius) / CELL));
    const maxY = Math.min(ROWS - 1, Math.floor((y + radius) / CELL));
    for (let cy = minY; cy <= maxY; cy++)
      for (let cx = minX; cx <= maxX; cx++) {
        const px = cx * CELL + CELL / 2,
          py = cy * CELL + CELL / 2;
        if (Math.hypot(px - x, py - y) <= radius) explored[cy * COLS + cx] = 1;
      }
  }

  function visible(x: number, y: number) {
    const cx = Math.max(0, Math.min(COLS - 1, Math.floor(x / CELL)));
    const cy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / CELL)));
    return explored[cy * COLS + cx] === 1;
  }

  function moveToward(bot: Bot, tx: number, ty: number, speed: number, dt: number) {
    const dx = tx - bot.x,
      dy = ty - bot.y;
    const d = Math.hypot(dx, dy);
    if (d < 4) return;
    const step = Math.min(d, speed * dt);
    const vx = (dx / d) * step,
      vy = (dy / d) * step;
    bot.theta = Math.atan2(dy, dx);
    // Axis-separated movement naturally slides along simple walls. If the
    // direct axis is blocked, try a small perpendicular sidestep.
    let moved = false;
    if (!collides(bot.x + vx, bot.y)) {
      bot.x += vx;
      moved = true;
    }
    if (!collides(bot.x, bot.y + vy)) {
      bot.y += vy;
      moved = true;
    }
    if (!moved) {
      const side = speed * dt * 0.7;
      if (!collides(bot.x - (dy / d) * side, bot.y + (dx / d) * side)) {
        bot.x -= (dy / d) * side;
        bot.y += (dx / d) * side;
      } else if (!collides(bot.x + (dy / d) * side, bot.y - (dx / d) * side)) {
        bot.x += (dy / d) * side;
        bot.y -= (dx / d) * side;
      }
    }
  }

  function pickScoutTarget() {
    const options: { x: number; y: number }[] = [];
    for (let cy = 1; cy < ROWS - 1; cy += 2)
      for (let cx = 1; cx < COLS - 1; cx += 2) {
        if (!explored[cy * COLS + cx]) options.push({ x: cx * CELL + 10, y: cy * CELL + 10 });
      }
    scoutTarget = options.length
      ? options[Math.floor(Math.random() * options.length)]
      : { x: BASE.x, y: BASE.y };
    scoutRetarget = 3.5;
  }

  function updateAutopilot(dt: number) {
    const scout = bots[0],
      carrier = bots[1],
      relay = bots[2];
    if (active !== 0) {
      scoutRetarget -= dt;
      if (scoutRetarget <= 0 || Math.hypot(scout.x - scoutTarget.x, scout.y - scoutTarget.y) < 30)
        pickScoutTarget();
      moveToward(scout, scoutTarget.x, scoutTarget.y, 105 * (scout.connected ? 1 : 0.75), dt);
    }
    if (active !== 1) {
      let target: { x: number; y: number } = BASE;
      if (carrier.carrying == null) {
        const found = victims.filter((v) => !v.rescued && !v.carried && visible(v.x, v.y));
        if (found.length)
          target = found.reduce((a, b) =>
            Math.hypot(a.x - carrier.x, a.y - carrier.y) <
            Math.hypot(b.x - carrier.x, b.y - carrier.y)
              ? a
              : b,
          );
      }
      moveToward(carrier, target.x, target.y, 92 * (carrier.connected ? 1 : 0.75), dt);
    }
    if (active !== 2) {
      const far = [scout, carrier].reduce((a, b) =>
        Math.hypot(a.x - BASE.x, a.y - BASE.y) > Math.hypot(b.x - BASE.x, b.y - BASE.y) ? a : b,
      );
      // Stay between home and the most distant teammate, biased slightly
      // toward that teammate so its radio link remains comfortable.
      const tx = BASE.x + (far.x - BASE.x) * 0.55;
      const ty = BASE.y + (far.y - BASE.y) * 0.55;
      moveToward(relay, tx, ty, 88, dt);
    }
  }

  function reset() {
    bots[0].x = 65;
    bots[0].y = 230;
    bots[1].x = 65;
    bots[1].y = 250;
    bots[2].x = 65;
    bots[2].y = 270;
    bots.forEach((b) => {
      b.theta = 0;
      b.connected = true;
      b.carrying = null;
    });
    victims.forEach((v, i) => {
      v.x = VICTIM_START[i].x;
      v.y = VICTIM_START[i].y;
      v.rescued = false;
      v.carried = false;
    });
    explored.fill(0);
    reveal(BASE.x, BASE.y, 105);
    active = 0;
    remaining = TOTAL_TIME;
    rescued = 0;
    discovered = 0;
    score = 0;
    combo = 0;
    animTime = 0;
    switchFlash = 0;
    cleared = false;
    pubAcc = 0;
    prevSwitch = [false, false, false];
    armpad.reset();
    scoutTarget = { x: 180, y: 250 };
    scoutRetarget = 0;
    particles.reset();
    g.setStatus(t("swarm_rescue.status.scout"), bots[0].color);
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }
  function dispose() {
    armpad.reset();
  }

  function switchBot(index: number) {
    active = index;
    switchFlash = 1;
    g.sfx.click();
    g.setStatus(t(`swarm_rescue.status.${bots[index].role.toLowerCase()}`), bots[index].color);
  }

  function finish(allRescued: boolean) {
    if (cleared) return;
    cleared = true;
    const stars = rescued >= 3 ? 3 : rescued >= 2 ? 2 : 1;
    g.setStatus(
      t(allRescued ? "swarm_rescue.status.all_safe" : "swarm_rescue.status.timeup"),
      "var(--ok)",
    );
    g.awardStars(
      stars,
      `Brought home <b>${rescued} / ${victims.length}</b><br>` +
        `Found <b>${discovered} / ${victims.length}</b><br>` +
        `Score <b>${score}</b><br>` +
        `Time left <b>${remaining.toFixed(1)} s</b>`,
    );
  }

  function update(dt: number) {
    armpad.poll();
    animTime += dt;
    particles.update(dt);
    switchFlash = Math.max(0, switchFlash - dt * 3);
    if (cleared) return;
    remaining -= dt;
    if (remaining <= 0) {
      remaining = 0;
      finish(false);
      return;
    }

    // Pad Y cycles SCOUT → CARRIER → RELAY without taking movement away
    // from the left stick.
    if (armpad.buttonEdge(3)) switchBot((active + 1) % bots.length);

    ["1", "2", "3"].forEach((key, i) => {
      const now = g.keys.has(key);
      if (now && !prevSwitch[i]) switchBot(i);
      prevSwitch[i] = now;
    });
    updateAutopilot(dt);
    updateNetwork();
    const bot = bots[active];
    let dx = 0,
      dy = 0;
    if (g.keys.has("arrowleft") || g.keys.has("a")) dx--;
    if (g.keys.has("arrowright") || g.keys.has("d")) dx++;
    if (g.keys.has("arrowup") || g.keys.has("w")) dy--;
    if (g.keys.has("arrowdown") || g.keys.has("s")) dy++;
    if (dx || dy) {
      const n = Math.hypot(dx, dy);
      const baseSpeed = bot.role === "SCOUT" ? 175 : bot.role === "CARRIER" ? 125 : 140;
      const speed = baseSpeed * (bot.connected ? 1 : 0.75);
      const vx = (dx / n) * speed,
        vy = (dy / n) * speed;
      bot.theta = Math.atan2(vy, vx);
      const nx = bot.x + vx * dt,
        ny = bot.y + vy * dt;
      if (!collides(nx, bot.y)) bot.x = nx;
      if (!collides(bot.x, ny)) bot.y = ny;
    }

    updateNetwork();
    bots.forEach((b) => reveal(b.x, b.y, b.role === "SCOUT" && b.connected ? 112 : 46));
    discovered = victims.filter((v) => v.rescued || visible(v.x, v.y)).length;

    const carrier = bots[1];
    {
      if (carrier.carrying == null) {
        const idx = victims.findIndex(
          (v) =>
            !v.rescued &&
            !v.carried &&
            visible(v.x, v.y) &&
            Math.hypot(carrier.x - v.x, carrier.y - v.y) < 27,
        );
        if (idx >= 0) {
          carrier.carrying = idx;
          victims[idx].carried = true;
          combo++;
          particles.burst(carrier.x, carrier.y, "#fbbf24", 24, 180);
          g.sfx.pickup();
          g.setStatus(t("swarm_rescue.status.carrying"), "#fbbf24");
        }
      } else {
        const v = victims[carrier.carrying];
        v.x = carrier.x;
        v.y = carrier.y - 19;
        if (Math.hypot(carrier.x - BASE.x, carrier.y - BASE.y) < BASE.r) {
          v.rescued = true;
          v.carried = false;
          carrier.carrying = null;
          rescued++;
          score += 500 + combo * 75 + Math.ceil(remaining);
          particles.burst(BASE.x, BASE.y, "#5eead4", 38, 230);
          g.sfx.deliver();
          g.setStatus(
            t("swarm_rescue.status.saved", { n: rescued, total: victims.length }),
            "var(--ok)",
          );
          if (rescued >= victims.length) finish(true);
        }
      }
    }

    pubAcc += dt;
    if (pubAcc >= 0.25) {
      pubAcc = 0;
      g.publish("/swarm/status", `active=${bot.role} link=${bot.connected} rescued=${rescued}`);
    }
    g.setHud([
      `TIME       ${remaining.toFixed(1)} s`,
      `ACTIVE     [${active + 1}]`,
      `OTHERS     AUTO PILOT`,
      `LINK       ${bot.connected ? "ONLINE" : "WEAK — 75% SPEED"}`,
      `FOUND      ${discovered} / ${victims.length}`,
      `HOME       ${rescued} / ${victims.length}`,
      `SCORE      ${score}`,
    ]);
  }

  function drawWalls(c: CanvasRenderingContext2D) {
    WALLS.forEach((w) => {
      c.fillStyle = "#202842";
      c.strokeStyle = "#53607f";
      c.lineWidth = 2;
      c.fillRect(w.x, w.y, w.w, w.h);
      c.strokeRect(w.x, w.y, w.w, w.h);
      c.strokeStyle = withA("#fb7185", 0.18);
      for (let y = w.y + 6; y < w.y + w.h; y += 13) {
        c.beginPath();
        c.moveTo(w.x, y);
        c.lineTo(w.x + w.w, y - 8);
        c.stroke();
      }
    });
  }

  function drawNetwork(c: CanvasRenderingContext2D) {
    c.save();
    c.setLineDash([5, 5]);
    c.lineWidth = 1.5;
    bots.forEach((b, i) => {
      let best: { x: number; y: number } | null = null;
      if (Math.hypot(b.x - BASE.x, b.y - BASE.y) <= linkRange(null, b)) best = BASE;
      for (let j = 0; j < bots.length; j++)
        if (
          i !== j &&
          bots[j].connected &&
          Math.hypot(b.x - bots[j].x, b.y - bots[j].y) <= linkRange(bots[j], b)
        )
          best = bots[j];
      if (best && b.connected) {
        c.strokeStyle = withA("#5eead4", 0.5);
        c.beginPath();
        c.moveTo(b.x, b.y);
        c.lineTo(best.x, best.y);
        c.stroke();
      }
    });
    c.restore();
  }

  function drawVictim(c: CanvasRenderingContext2D, v: Victim, i: number) {
    if (v.rescued || (!v.carried && !visible(v.x, v.y))) return;
    c.fillStyle = "#fbbf24";
    c.strokeStyle = "#0a0f1f";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(v.x, v.y, 10, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#0a0f1f";
    c.font = "900 10px monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("☺", v.x, v.y + 1);
    if (!v.carried) {
      c.fillStyle = "#fbbf24";
      c.font = "700 8px monospace";
      c.fillText(`BOT ${i + 1}`, v.x, v.y - 17);
    }
  }

  function drawBot(c: CanvasRenderingContext2D, b: Bot, i: number) {
    c.save();
    c.translate(b.x, b.y);
    c.rotate(b.theta);
    if (i === active) {
      c.strokeStyle = b.color;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, 0, 21 + switchFlash * 4, 0, Math.PI * 2);
      c.stroke();
    }
    if (!b.connected) {
      c.fillStyle = withA("#fb7185", 0.25);
      c.beginPath();
      c.arc(0, 0, 19, 0, Math.PI * 2);
      c.fill();
    }
    drawRobotBody(c, !b.connected ? 0.4 : 0, animTime);
    c.restore();
    c.fillStyle = b.color;
    c.font = "800 8px ui-monospace,monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(`${i + 1}  ${i === active ? "MANUAL" : "AUTO"}`, b.x, b.y - 25);
  }

  function drawFog(c: CanvasRenderingContext2D) {
    c.fillStyle = "rgba(4, 7, 17, .88)";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (!explored[y * COLS + x]) c.fillRect(x * CELL, y * CELL, CELL + 1, CELL + 1);
      }
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    drawWalls(c);
    c.fillStyle = withA("#5eead4", 0.12);
    c.strokeStyle = "#5eead4";
    c.lineWidth = 2;
    c.beginPath();
    c.arc(BASE.x, BASE.y, BASE.r, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    c.fillStyle = "#5eead4";
    c.font = "800 10px monospace";
    c.textAlign = "center";
    c.fillText("CHARGE HOME", BASE.x, BASE.y - 51);
    drawNetwork(c);
    victims.forEach((v, i) => drawVictim(c, v, i));
    particles.draw(c);
    bots.forEach(drawBot.bind(null, c));
    drawFog(c);
    // Active bots stay visible above fog, but hidden terrain does not.
    bots.forEach(drawBot.bind(null, c));
    c.fillStyle = remaining < 15 ? "#fb7185" : "#eef2ff";
    c.font = "900 24px ui-monospace,monospace";
    c.textAlign = "right";
    c.textBaseline = "top";
    c.fillText(`${remaining.toFixed(1)}s`, W - 18, 18);
    drawHint(c, t("swarm_rescue.hint"));
  }

  return {
    id: "swarm_rescue",
    name: "Swarm Helpers",
    lesson: "Multi-Robot Teamwork",
    lessonCmd: "ros2 topic echo /swarm/status",
    ros2: {
      title: tx(
        "Swarm Helpers ・複数ロボットのチームワーク",
        "Swarm Helpers — multi-robot teamwork",
      ),
      summary: tx(
        "探索・送迎・通信中継の役割を分担し、通信グラフを維持しながら迷子のミニロボを家へ連れ帰る。",
        "Split scouting, transport and relay roles while maintaining a communication graph to bring lost mini-bots home.",
      ),
      msgTypes: [
        "geometry_msgs/msg/PoseStamped",
        "nav_msgs/msg/OccupancyGrid",
        "std_msgs/msg/String",
      ],
      cli: [
        "ros2 topic echo /swarm/status",
        "ros2 node list",
        "ros2 topic echo /lost_bot_locations",
      ],
      python: `robots = {"scout": Scout(), "carrier": Carrier(), "relay": Relay()}\nwhile mission.active:\n    map_update = robots["scout"].explore()\n    robots["relay"].maintain_link(robots)\n    robots["carrier"].bring_home(map_update.lost_bots)`,
      realWorld: tx(
        "倉庫や農場では、探索機、搬送機、通信中継機が地図と目標を共有しながら協力する。",
        "Warehouses and farms use scout, transport and relay robots that cooperate by sharing maps and goals.",
      ),
      state: {
        nodes: ["/rescue_coordinator", "/scout", "/carrier", "/relay"],
        topics: [
          { name: "/swarm/status", type: "std_msgs/msg/String", pub: ["/rescue_coordinator"] },
          {
            name: "/map",
            type: "nav_msgs/msg/OccupancyGrid",
            pub: ["/scout"],
            sub: ["/carrier", "/relay"],
          },
          {
            name: "/lost_bot_locations",
            type: "geometry_msgs/msg/PoseArray",
            pub: ["/scout"],
            sub: ["/carrier"],
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
  order: 12,
  diagram: `<svg viewBox="0 0 420 130" role="img" aria-label="scout finds a lost mini-bot, relay maintains the radio link, carrier brings it home">
    <rect x="8" y="23" width="82" height="76" rx="9" fill="#5eead418" stroke="#5eead4"/><text x="49" y="43" text-anchor="middle" fill="#5eead4" font-size="10" font-weight="700">HOME</text>
    <circle cx="132" cy="65" r="22" fill="#c4b5fd18" stroke="#c4b5fd"/><text x="132" y="70" text-anchor="middle" fill="#c4b5fd" font-size="15" font-weight="700">3</text>
    <circle cx="242" cy="35" r="22" fill="#7dd3fc18" stroke="#7dd3fc"/><text x="242" y="40" text-anchor="middle" fill="#7dd3fc" font-size="15" font-weight="700">1</text>
    <circle cx="242" cy="99" r="22" fill="#5eead418" stroke="#5eead4"/><text x="242" y="104" text-anchor="middle" fill="#5eead4" font-size="15" font-weight="700">2</text>
    <circle cx="365" cy="67" r="12" fill="#fbbf24"/><text x="365" y="71" text-anchor="middle" fill="#0a0f1f" font-size="13" font-weight="900">!</text>
    <path d="M90 61L110 63M154 59L220 40M154 72L220 94M264 40L350 61M350 75L264 94M220 103Q120 125 78 96" fill="none" stroke="#5eead4" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="210" y="124" text-anchor="middle" fill="#9aa6c8" font-size="9">FIND → LINK → PICK UP → HOME</text>
  </svg>`,
  lessonModal: {
    title: {
      ja: "Swarm Helpers — 迷子のミニロボをお迎え",
      en: "Swarm Helpers — bring the lost mini-bots home",
    },
    learn: {
      ja: "選択していない機体も自律行動します。1は未探索エリアを巡回、2はミニロボをホームへ運び、3は仲間との通信を保ちます。",
      en: "Unselected robots remain autonomous: 1 patrols unknown areas, 2 brings mini-bots home, and 3 keeps the team linked.",
    },
    goal: {
      ja: "150秒以内に迷子のミニロボ3体を左の充電ホームへ連れ帰ると★3。通信が弱くなっても速度は75%なので、ゆっくり戻れます。",
      en: "Bring three lost mini-bots to the charging home within 150 seconds for ★3. A weak link only slows a robot to 75%, so it can still return easily.",
    },
    first: {
      ja: "まずは何も押さず、3機が自動で動く様子を見てみましょう。壁で止まった機体や遠回りしている機体があれば1・2・3、またはPad Yで機体を選び、手動操作で助けます。",
      en: "First, watch all three robots work automatically. If one gets stuck or takes a long route, select it with 1, 2, 3, or pad Y and help manually.",
    },
  },
  strings: {
    ja: {
      "status.scout": "1を選択 — 霧を広く晴らして迷子のミニロボを探す",
      "status.carrier": "2を選択 — 見つけたミニロボを充電ホームへ送る",
      "status.relay": "3を選択 — ほかの2体の通信をつなぐ",
      "status.carrying": "ミニロボを乗せた! 左のCHARGE HOMEへ戻ろう",
      "status.saved": "おかえり! {n}/{total}",
      "status.all_safe": "みんな充電ホームへ帰れた!",
      "status.timeup": "お迎えタイム終了!",
      hint: "1 / 2 / 3 または Pad Y: 機体を選択 ・ WASD / 矢印 / 左スティック: 移動 ・ R: リスタート",
    },
    en: {
      "status.scout": "Robot 1 selected — reveal fog and find lost mini-bots",
      "status.carrier": "Robot 2 selected — bring found mini-bots to charging home",
      "status.relay": "Robot 3 selected — keep the other two linked",
      "status.carrying": "Mini-bot aboard! Return to CHARGE HOME on the left",
      "status.saved": "Welcome home! {n}/{total}",
      "status.all_safe": "Every mini-bot made it home!",
      "status.timeup": "Pickup time is over!",
      hint: "1 / 2 / 3 or pad Y: select robot · WASD / arrows / left stick: move · R: restart",
    },
  },
  build: makeSwarmRescue,
});
