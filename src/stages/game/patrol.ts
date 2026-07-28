// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// patrol: Patrol — evade WARDEN units (Service & Lifecycle)
// Evade the rogue AI "WARDEN", hack 3 terminals, then escape through
// the gate.
// The boss locks on when the player enters its vision cone; the gate
// unlocks after 3 hacks.
import { W, H, type Stage, type GameContext } from "../../types";
import { theme, withA } from "../../core/theme";

import { defineStage } from "../../core/stage_def";
import {
  drawZone,
  drawRobotBody,
  drawRobotLabel,
  drawTimer,
  drawHint,
  fmtTwist,
  clearBackground,
  COLORS,
} from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { teleop } from "../../lib/teleop";
import { Trail } from "../../lib/trail";
import { formatPose, formatTwist } from "../../lib/hud";
import { canMoveTo as inWalls } from "../../lib/walls";
import { t, tx } from "../../i18n";

const ROBOT_R = 16;
const BASE_LIN = 220;
const BASE_ANG = 2.8;

// Obstacles (cover).
const walls = [
  { x: 110, y: 110, w: 110, h: 30 },
  { x: 580, y: 110, w: 110, h: 30 },
  { x: 110, y: 360, w: 110, h: 30 },
  { x: 580, y: 360, w: 110, h: 30 },
];

const HACK_POINTS = [
  { x: 80, y: 80, id: "α", srv: "/warden/disable_camera" },
  { x: 720, y: 80, id: "β", srv: "/warden/disable_motor" },
  { x: 80, y: 420, id: "γ", srv: "/warden/disable_brain" },
];
const ESCAPE = { x: 720, y: 420 };
// Player starts in the center-left.
const PLAYER_START = { x: 160, y: 250 };

// Initial positions of the 5 enemies (≥240px from the player).
const ENEMY_STARTS: { x: number; y: number }[] = [
  { x: 440, y: 250 }, // center
  { x: 380, y: 130 }, // top
  { x: 380, y: 380 }, // bottom
  { x: 640, y: 200 }, // east-top
  { x: 640, y: 320 }, // east-bottom
];
const ENEMY_SIZE = 18;
const ENEMY_BASE_SPEED = 58;
const ENEMY_VISION_RANGE = 200;
const ENEMY_VISION_HALF_ANGLE = 0.5; // radians
const LOCKON_TIME = 1.5; // seconds

export function makeWarden(): Stage {
  let g!: GameContext;
  const robot = { x: PLAYER_START.x, y: PLAYER_START.y, theta: 0 };
  const cmd = { lin: 0, ang: 0 };
  const particles = new Particles();
  const trail = new Trail({ max: 60 });
  let elapsed = 0;
  let cleared = false;
  let pubAcc = 0;
  let bumpFlash = 0;
  let animTime = 0;

  interface Enemy {
    x: number;
    y: number;
    theta: number;
  }
  const enemies: Enemy[] = ENEMY_STARTS.map((p) => ({ x: p.x, y: p.y, theta: 0 }));
  // Speed multiplier applied to all enemies (decays as you hack).
  let enemySpeedMul = 1.0;
  let lockon = 0; // 0..LOCKON_TIME
  const hacked = new Set<string>();
  let escapeOpen = false;

  function reset() {
    robot.x = PLAYER_START.x;
    robot.y = PLAYER_START.y;
    robot.theta = 0;
    cmd.lin = 0;
    cmd.ang = 0;
    trail.reset();
    particles.reset();
    elapsed = 0;
    cleared = false;
    bumpFlash = 0;
    for (let i = 0; i < enemies.length; i++) {
      enemies[i].x = ENEMY_STARTS[i].x;
      enemies[i].y = ENEMY_STARTS[i].y;
      enemies[i].theta = 0;
    }
    enemySpeedMul = 1.0;
    lockon = 0;
    hacked.clear();
    escapeOpen = false;
    g.ghost.startRecording();
    g.setStatus(t("patrol.status.evade"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    reset();
  }

  function update(dt: number) {
    animTime += dt;
    particles.update(dt);
    if (cleared) return;
    elapsed += dt;

    const tw = teleop(g.keys, { baseLin: BASE_LIN, baseAng: BASE_ANG });
    cmd.lin = tw.lin;
    cmd.ang = tw.ang;

    const nx = robot.x + cmd.lin * Math.cos(robot.theta) * dt;
    const ny = robot.y + cmd.lin * Math.sin(robot.theta) * dt;
    if (inWalls(walls, nx, ny, ROBOT_R)) {
      robot.x = nx;
      robot.y = ny;
    } else if (cmd.lin !== 0) {
      bumpFlash = 1;
      cleared = true;
      g.crash(t("patrol.crash.wall"));
      return;
    }
    robot.theta += cmd.ang * dt;
    if (bumpFlash > 0) bumpFlash = Math.max(0, bumpFlash - dt);

    trail.update(dt, robot.x, robot.y);
    // === Enemies AI ===
    updateEnemies(dt);

    // Direct contact: any single enemy touching = captured.
    for (const e of enemies) {
      const ex = e.x - robot.x,
        ey = e.y - robot.y;
      if (ex * ex + ey * ey < (ENEMY_SIZE + ROBOT_R) ** 2) {
        cleared = true;
        g.crash(t("patrol.crash.captured"));
        return;
      }
    }

    // Lock-on accumulates while any enemy has the player in its vision cone.
    const inCone = isInAnyEnemyVision();
    if (inCone) {
      lockon += dt;
      if (lockon >= LOCKON_TIME) {
        cleared = true;
        g.crash(t("patrol.crash.lockon"));
        return;
      }
    } else {
      lockon = Math.max(0, lockon - dt * 1.5);
    }

    // Hack check.
    for (const hp of HACK_POINTS) {
      if (hacked.has(hp.id)) continue;
      const dx = robot.x - hp.x;
      const dy = robot.y - hp.y;
      if (dx * dx + dy * dy < (28 + ROBOT_R) ** 2) {
        hacked.add(hp.id);
        enemySpeedMul = Math.max(0, enemySpeedMul - 0.3);
        particles.burst(hp.x, hp.y, "#7dd3fc", 36, 260);
        g.sfx.pickup();
        g.shake(0.4);
        // The hack IS a std_srvs/srv/Trigger call on the warden's service —
        // publish under that service name so `ros2 service call ...` / echo in
        // the terminal matches what the game actually does.
        g.publish(
          hp.srv,
          `Trigger.Response success:true message:"${hp.id} disabled, enemy_speed:${enemySpeedMul.toFixed(2)}"`,
        );
        if (hacked.size === 3) {
          escapeOpen = true;
          enemySpeedMul = 0; // all enemies disabled
          g.setStatus(t("patrol.status.disabled"), "var(--ok)");
          g.publish(
            "/warden/change_state",
            "ChangeState.Response: transition=shutdown success:true",
          );
        } else {
          g.setStatus(t("patrol.status.hack_ok", { id: hp.id, n: hacked.size }), "var(--accent)");
        }
      }
    }

    // ESCAPE
    if (escapeOpen) {
      const dx = robot.x - ESCAPE.x;
      const dy = robot.y - ESCAPE.y;
      if (dx * dx + dy * dy < (28 + ROBOT_R) ** 2) {
        cleared = true;
        particles.burst(ESCAPE.x, ESCAPE.y, "#5eead4", 40);
        particles.burst(ESCAPE.x, ESCAPE.y, "#fbbf24", 30);
        g.sfx.deliver();
        g.shake(0.8);
        g.setStatus(t("patrol.status.escape_complete"), "var(--ok)");
        const stars = elapsed < 30 ? 3 : elapsed < 50 ? 2 : 1;
        const stats =
          `Time     <b>${elapsed.toFixed(2)} s</b><br>` +
          `Hacks    <b>${hacked.size} / 3</b><br>` +
          `Lockon   <b>${(lockon * 100).toFixed(0)}%</b>`;
        g.setTimeout(() => {
          g.sfx.clear();
          g.showClear(stars, stats);
        }, 700);
      }
    }

    pubAcc += dt;
    if (pubAcc > 1 / 20) {
      pubAcc = 0;
      g.publish("/cmd_vel", fmtTwist(cmd.lin / BASE_LIN, cmd.ang));
      g.publish(
        "/warden/state",
        `units:${enemies.length} speed_mul:${enemySpeedMul.toFixed(2)} lockon:${((lockon / LOCKON_TIME) * 100).toFixed(0)}%`,
      );
    }

    g.ghost.recordPose(elapsed, robot.x, robot.y, robot.theta);

    g.setHud([
      `pose:${formatPose(robot)}`,
      `cmd_vel:${formatTwist({ v: cmd.lin, w: cmd.ang }, { pxPerM: BASE_LIN })}`,
      `enemies:     ${enemies.length} units  speed×${enemySpeedMul.toFixed(2)}`,
      `lockon:      ${((lockon / LOCKON_TIME) * 100).toFixed(0)}%`,
      `hacks:       ${hacked.size} / 3`,
      `escape:      ${escapeOpen ? "OPEN" : "locked"}`,
      `elapsed:     ${elapsed.toFixed(1)} s`,
    ]);
  }

  function updateEnemies(dt: number) {
    if (enemySpeedMul <= 0) return; // all enemies disabled
    for (const e of enemies) {
      const dx = robot.x - e.x;
      const dy = robot.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 1) continue;
      const targetTheta = Math.atan2(dy, dx);
      let dTheta = targetTheta - e.theta;
      while (dTheta > Math.PI) dTheta -= Math.PI * 2;
      while (dTheta < -Math.PI) dTheta += Math.PI * 2;
      e.theta += Math.max(-2.4 * dt, Math.min(2.4 * dt, dTheta));
      const move = ENEMY_BASE_SPEED * enemySpeedMul * dt;
      const nx = e.x + Math.cos(e.theta) * move;
      const ny = e.y + Math.sin(e.theta) * move;
      if (inWalls(walls, nx, ny, ENEMY_SIZE - 4)) {
        e.x = nx;
        e.y = ny;
      }
    }
  }

  function isEnemySeesPlayer(e: Enemy): boolean {
    const dx = robot.x - e.x;
    const dy = robot.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ENEMY_VISION_RANGE) return false;
    const angleToPlayer = Math.atan2(dy, dx);
    let d = angleToPlayer - e.theta;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > ENEMY_VISION_HALF_ANGLE) return false;
    const steps = Math.ceil(dist / 8);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = e.x + dx * t;
      const py = e.y + dy * t;
      for (const wall of walls) {
        if (px > wall.x && px < wall.x + wall.w && py > wall.y && py < wall.y + wall.h) {
          return false;
        }
      }
    }
    return true;
  }

  function isInAnyEnemyVision(): boolean {
    for (const e of enemies) if (isEnemySeesPlayer(e)) return true;
    return false;
  }

  function draw() {
    const ctx = g.ctx;
    clearBackground(ctx);

    // Faint warning grid on the floor.
    ctx.strokeStyle = "rgba(248, 113, 113, 0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Walls.
    for (const wall of walls) {
      ctx.fillStyle = "rgba(35, 44, 77, 0.85)";
      ctx.strokeStyle = "rgba(110, 122, 156, 0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(wall.x, wall.y, wall.w, wall.h, 4);
      ctx.fill();
      ctx.stroke();
    }

    // Hack terminals.
    for (const hp of HACK_POINTS) {
      const got = hacked.has(hp.id);
      drawHackPoint(ctx, hp.x, hp.y, hp.id, got, animTime);
    }

    // ESCAPE GATE
    if (escapeOpen) {
      drawZone(ctx, { x: ESCAPE.x, y: ESCAPE.y, r: 30 }, "#5eead4", "ESCAPE", animTime);
    } else {
      drawZone(ctx, { x: ESCAPE.x, y: ESCAPE.y, r: 30 }, "#6e7a9c", "LOCKED", animTime);
    }

    // Trail.
    trail.draw(ctx, 0.5);
    particles.draw(ctx);

    // Ghost replay.
    g.ghost.draw(ctx, elapsed, animTime);

    // === Enemies x5 ===
    drawEnemies(ctx);

    // Robot.
    ctx.save();
    ctx.translate(robot.x, robot.y);
    ctx.rotate(robot.theta);
    drawRobotBody(ctx, bumpFlash, animTime);
    ctx.rotate(-robot.theta);
    drawRobotLabel(ctx);
    ctx.restore();

    // Lock-on meter.
    if (lockon > 0.05 && !cleared) drawLockon(ctx, robot.x, robot.y, lockon / LOCKON_TIME);

    // Top HUD: hack progress.
    drawHackHUD(ctx);

    drawTimer(ctx, elapsed, g.getBestTime());
    if (g.ghost.hasReplay()) drawGhostBadge(ctx);
    drawHint(ctx, t("patrol.hint"));
  }

  function drawEnemies(ctx: CanvasRenderingContext2D) {
    const disabled = enemySpeedMul <= 0;
    // Each enemy's vision cone (drawn behind the enemy).
    if (!disabled) {
      for (const e of enemies) {
        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.theta);
        const intensity = Math.max(0.06, (lockon / LOCKON_TIME) * 0.4);
        const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, ENEMY_VISION_RANGE);
        grd.addColorStop(0, `rgba(248, 113, 113, ${0.12 + intensity * 0.6})`);
        grd.addColorStop(1, "rgba(248, 113, 113, 0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, ENEMY_VISION_RANGE, -ENEMY_VISION_HALF_ANGLE, ENEMY_VISION_HALF_ANGLE);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(248, 113, 133, ${0.25 + intensity * 0.5})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
          Math.cos(-ENEMY_VISION_HALF_ANGLE) * ENEMY_VISION_RANGE,
          Math.sin(-ENEMY_VISION_HALF_ANGLE) * ENEMY_VISION_RANGE,
        );
        ctx.moveTo(0, 0);
        ctx.lineTo(
          Math.cos(ENEMY_VISION_HALF_ANGLE) * ENEMY_VISION_RANGE,
          Math.sin(ENEMY_VISION_HALF_ANGLE) * ENEMY_VISION_RANGE,
        );
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const e of enemies) drawSingleEnemy(ctx, e, disabled);
  }

  function drawSingleEnemy(ctx: CanvasRenderingContext2D, e: Enemy, disabled: boolean) {
    // Shadow.
    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + 18, 22, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Body.
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.theta);

    // Outer shell.
    ctx.fillStyle = disabled ? "#374151" : "#7f1d1d";
    ctx.beginPath();
    ctx.roundRect(-20, -14, 40, 28, 6);
    ctx.fill();

    // Main body.
    const grad = ctx.createLinearGradient(0, -12, 0, 12);
    if (disabled) {
      grad.addColorStop(0, "#9ca3af");
      grad.addColorStop(1, "#374151");
    } else {
      grad.addColorStop(0, "#fecaca");
      grad.addColorStop(0.5, "#dc2626");
      grad.addColorStop(1, "#7f1d1d");
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(-17, -12, 34, 24, 5);
    ctx.fill();
    ctx.strokeStyle = disabled ? "#6b7280" : "#fb7185";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Central core.
    if (!disabled) {
      const corePulse = 0.6 + 0.4 * Math.sin(animTime * 5);
      ctx.fillStyle = `rgba(220, 38, 38, ${0.5 * corePulse})`;
      ctx.fillRect(-12, -9, 24, 14);
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(0, -2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(0, -2, 1, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#6b7280";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.lineTo(5, 4);
      ctx.moveTo(5, -6);
      ctx.lineTo(-5, 4);
      ctx.stroke();
    }

    // Wheels.
    ctx.fillStyle = "#08101e";
    ctx.fillRect(-20, -14, 4, 5);
    ctx.fillRect(16, -14, 4, 5);
    ctx.fillRect(-20, 9, 4, 5);
    ctx.fillRect(16, 9, 4, 5);

    // Front sensor.
    if (!disabled) {
      ctx.fillStyle = "#0a0e1f";
      ctx.beginPath();
      ctx.arc(13, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      ctx.arc(13, 0, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawHackPoint(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    id: string,
    hacked: boolean,
    t: number,
  ) {
    const pulse = 0.7 + 0.3 * Math.sin(t * 3);
    ctx.save();
    ctx.translate(x, y);
    if (hacked) {
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = "#5eead4";
      ctx.fillStyle = "rgba(94, 234, 212, 0.15)";
    } else {
      ctx.strokeStyle = "#7dd3fc";
      ctx.fillStyle = `rgba(125, 211, 252, ${0.15 * pulse})`;
    }
    ctx.lineWidth = 2;
    // Server-rack style.
    ctx.beginPath();
    ctx.roundRect(-18, -22, 36, 44, 4);
    ctx.fill();
    ctx.stroke();
    // Slit.
    ctx.fillStyle = ctx.strokeStyle;
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(-14, -16 + i * 9, 28, 1.5);
    }
    if (hacked) {
      // Check mark.
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-7, 2);
      ctx.lineTo(-2, 7);
      ctx.lineTo(8, -5);
      ctx.stroke();
    } else {
      // ID
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "700 14px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(id, 0, 0);
    }
    ctx.restore();
  }

  function drawLockon(ctx: CanvasRenderingContext2D, x: number, y: number, pct: number) {
    ctx.save();
    ctx.translate(x, y - 30);
    // Frame.
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(-30, -7, 60, 8);
    ctx.strokeStyle = "rgba(248, 113, 113, 0.7)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-30, -7, 60, 8);
    // Bar.
    ctx.fillStyle = pct > 0.7 ? "#dc2626" : "#fb7185";
    ctx.fillRect(-30, -7, 60 * pct, 8);
    // Label.
    ctx.fillStyle = "#fb7185";
    ctx.font = "700 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("LOCKON", 0, -10);
    ctx.restore();
  }

  function drawHackHUD(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.fillStyle = withA(theme.scrim, 0.85);
    ctx.strokeStyle = "rgba(125, 211, 252, 0.4)";
    ctx.lineWidth = 1;
    const w = 156;
    const h = 26;
    const x = 12;
    const y = 12;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#7a89ad";
    ctx.font = "10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("HACKS", x + 10, y + h / 2);
    HACK_POINTS.forEach((hp, i) => {
      const cx = x + 60 + i * 30;
      const cy = y + h / 2;
      const got = hacked.has(hp.id);
      ctx.fillStyle = got ? "#5eead4" : "rgba(122, 137, 173, 0.3)";
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = got ? COLORS.BG_DARK : "#7a89ad";
      ctx.font = "700 9px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(hp.id, cx, cy + 0.5);
    });
    ctx.restore();
  }

  function drawGhostBadge(ctx: CanvasRenderingContext2D) {
    ctx.save();
    const w = 96;
    const h = 22;
    const x = W - w - 12;
    const y = H - h - 30;
    ctx.fillStyle = "rgba(196, 181, 253, 0.18)";
    ctx.strokeStyle = "rgba(196, 181, 253, 0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#c4b5fd";
    ctx.font = "600 10px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("vs GHOST", x + 10, y + h / 2 + 1);
    ctx.beginPath();
    ctx.arc(x + w - 13, y + h / 2 + 1, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function dispose() {
    /* nothing */
  }

  return {
    id: "patrol",
    name: "Patrol",
    lesson: "",
    lessonCmd: "ros2 lifecycle get /warden",
    ros2: {
      title: tx(
        "Service & Lifecycle ・暴走ノードを止める",
        "Service & Lifecycle — shut down a runaway node",
      ),
      summary:
        "3 つのハック端末は std_srvs/srv/Trigger を呼んで /warden を一段階ずつ無力化するサービス呼び出し。" +
        "最後の脱出では lifecycle ノードへ shutdown 遷移を要求し、Finalized 状態へ移します。" +
        "これはノードの運用状態を管理する仕組みを教材向けに表現したもので、緊急停止装置そのものではありません。" +
        "Pub-Sub と違い、Service は「リクエストして応答を待つ」同期通信。",
      msgTypes: ["std_srvs/srv/Trigger", "lifecycle_msgs/srv/ChangeState"],
      cli: [
        "ros2 service list",
        "ros2 service type /warden/disable_camera",
        "ros2 service call /warden/disable_camera std_srvs/srv/Trigger",
        "ros2 lifecycle set /warden shutdown",
      ],
      python: `import rclpy
from rclpy.node import Node
from std_srvs.srv import Trigger

class Hacker(Node):
    def __init__(self):
        super().__init__('hacker')
        self.cli = self.create_client(
            Trigger, '/warden/disable_camera')

    async def hack(self):
        while not self.cli.wait_for_service(timeout_sec=0.5):
            self.get_logger().info('待機中…')
        req = Trigger.Request()
        future = self.cli.call_async(req)
        rclpy.spin_until_future_complete(self, future)
        return future.result().success`,
      realWorld: tx(
        "ServiceとLifecycleはノードの起動・停止や運用状態の管理に使えます。ただし、安全規格に対応する緊急停止やフェイルセーフには、ROS 2とは独立した安全回路や安全認証済み機器が必要です。",
        "Services and Lifecycle nodes can manage startup, shutdown, and operating state. Safety-rated emergency stops and fail-safes require independent safety circuits and certified hardware beyond ROS 2.",
      ),
      state: {
        nodes: ["/player", "/warden"],
        topics: [
          { name: "/cmd_vel", type: "geometry_msgs/msg/Twist", pub: ["/player"], sub: [] },
          {
            name: "/warden/pose",
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/warden"],
            sub: ["/player"],
          },
          {
            name: "/warden/state",
            type: "std_msgs/msg/String",
            pub: ["/warden"],
            sub: ["/player"],
          },
        ],
        services: [
          { name: "/warden/disable_camera", type: "std_srvs/srv/Trigger", node: "/warden" },
          { name: "/warden/disable_motor", type: "std_srvs/srv/Trigger", node: "/warden" },
          { name: "/warden/disable_brain", type: "std_srvs/srv/Trigger", node: "/warden" },
          { name: "/warden/change_state", type: "lifecycle_msgs/srv/ChangeState", node: "/warden" },
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
  order: 4,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="client triggers service, server responds">
  <defs>
    <marker id="ld-warden-arrow-req" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#5eead4"/>
    </marker>
    <marker id="ld-warden-arrow-res" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#fbbf24"/>
    </marker>
  </defs>
  <rect x="8" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#7dd3fc" stroke-width="1.5"/>
  <text x="82" y="56" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="12" font-weight="700">player</text>
  <text x="82" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Client</text>
  <rect x="264" y="26" width="148" height="68" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="338" y="56" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="12" font-weight="700">module</text>
  <text x="338" y="78" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="10">Server</text>
  <line x1="156" y1="50" x2="262" y2="50" stroke="#5eead4" stroke-width="2" marker-end="url(#ld-warden-arrow-req)"/>
  <line x1="262" y1="74" x2="156" y2="74" stroke="#fbbf24" stroke-width="2" marker-end="url(#ld-warden-arrow-res)"/>
  <text x="210" y="44" text-anchor="middle" fill="#5eead4" font-family="ui-monospace, monospace" font-size="11" font-weight="700">/hack (Trigger)</text>
  <text x="210" y="68" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="9">request →</text>
  <text x="210" y="92" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="9">← response</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "Service Trigger — 端末をハックする",
      en: "Service Trigger — hacking modules",
    },
    learn: {
      ja: "Serviceは、一つのRequestに対してResponseを返す「呼び出し型」の通信です。このGameでは、端末へ触れるとServiceを一度呼び出します。",
      en: "A Service is a request/response interface: one request produces one response. In this Game, touching a terminal makes one service call.",
    },
    goal: {
      ja: "WASD でこっそり移動。見張り (WARDEN) 5 体に見つからないように、3 つの端末を順番にハックして ESCAPE GATE から脱出!\n敵に触れる・視界に入って捕まるとやり直し。",
      en: "Sneak around with WASD. Avoid the 5 WARDEN patrols, hack all 3 terminals in order, then reach the ESCAPE GATE!\nGetting touched or spotted = retry.",
    },
    first: {
      ja: "端末 (α / β / γ) に WASD で近づくだけで Trigger が呼び出され、自動的にハックされます。",
      en: "Just drive up to a module (α / β / γ) with WASD — Trigger is called automatically on contact.",
    },
  },
  strings: {
    ja: {
      "crash.captured": "WARDEN UNIT に捕獲された",
      "crash.lockon": "ロックオンされた",
      "crash.wall": "壁に衝突",
      hint: "WASD 移動 / WARDEN UNITS x5 を回避 / 端末 3 つハック → ESCAPE",
      "status.disabled": "WARDEN UNITS 全機無力化 — ESCAPE GATE 開放",
      "status.escape_complete": "ESCAPE COMPLETE",
      "status.evade": "WARDEN UNITS x5 を回避して 3 端末をハック → ESCAPE",
      "status.hack_ok": "端末 {id} ハック成功 ({n}/3)",
      "status.offline": "WARDEN UNITS OFFLINE — 端末をハック → ESCAPE（練習モード）",
    },
    en: {
      "crash.captured": "Captured by a WARDEN unit",
      "crash.lockon": "Locked on",
      "crash.wall": "Crashed into wall",
      hint: "WASD to move / evade 5 WARDEN units / hack 3 modules → ESCAPE",
      "status.disabled": "All WARDEN units neutralized — ESCAPE GATE open",
      "status.escape_complete": "ESCAPE COMPLETE",
      "status.evade": "Evade 5 WARDEN units and hack 3 modules → ESCAPE",
      "status.hack_ok": "Module {id} hacked ({n}/3)",
      "status.offline": "WARDEN UNITS OFFLINE — hack the modules → ESCAPE (practice)",
    },
  },
  build: makeWarden,
});
