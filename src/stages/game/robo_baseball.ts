// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// robo_baseball: a ten-pitch timing and aim challenge.
// Move the batting reticle onto the incoming pitch, then swing at the plate.
// The simulated vision node publishes a predicted crossing point for each pitch.
import { H, W, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { t, tx } from "../../i18n";
import { clearBackground, drawHint, drawRobotBody } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { defineRos2Concept, state, topic } from "../../lib/ros2_concept";
import { baseballStars, classifyBaseballSwing } from "../../lib/baseball_rules";

const TOTAL_PITCHES = 10;
const RELEASE_X = 196;
const ZONE = { x: 610, y: 258, w: 96, h: 122 };
const AIM_SPEED = 190;
const USE_PERSPECTIVE_FIELD = false;

type Phase = "ready" | "pitch" | "result" | "finished";
type ResultKind = "homer" | "hit" | "foul" | "miss" | "ball" | "strike";

interface Pitch {
  targetX: number;
  targetY: number;
  curve: number;
  duration: number;
  progress: number;
  inZone: boolean;
}

interface FlyBall {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: Array<{ x: number; y: number }>;
}

export function makeRoboBaseball(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  const pitch: Pitch = {
    targetX: ZONE.x + ZONE.w / 2,
    targetY: ZONE.y + ZONE.h / 2,
    curve: 0,
    duration: 1.15,
    progress: 0,
    inZone: true,
  };
  const fly: FlyBall = { active: false, x: 0, y: 0, vx: 0, vy: 0, trail: [] };

  let phase: Phase = "ready";
  let aimX = ZONE.x + ZONE.w / 2;
  let aimY = ZONE.y + ZONE.h / 2;
  let pitchNumber = 0;
  let score = 0;
  let homers = 0;
  let hits = 0;
  let strikes = 0;
  let combo = 0;
  let bestCombo = 0;
  let phaseTimer = 0;
  let elapsed = 0;
  let animTime = 0;
  let lastSwing = false;
  let flash = 0;
  let result: ResultKind | null = null;
  let resultText = "";
  let pubAcc = 0;
  let pointerSwingPending = false;
  let lastPadSwing = false;
  let onPointerMove: ((event: PointerEvent) => void) | null = null;
  let onPointerDown: ((event: PointerEvent) => void) | null = null;
  let onActionKeyDown: ((event: KeyboardEvent) => void) | null = null;

  function reset(): void {
    phase = "ready";
    aimX = ZONE.x + ZONE.w / 2;
    aimY = ZONE.y + ZONE.h / 2;
    pitchNumber = 0;
    score = 0;
    homers = 0;
    hits = 0;
    strikes = 0;
    combo = 0;
    bestCombo = 0;
    phaseTimer = 0.75;
    elapsed = 0;
    animTime = 0;
    lastSwing = false;
    flash = 0;
    result = null;
    resultText = "";
    pubAcc = 0;
    pointerSwingPending = false;
    lastPadSwing = false;
    particles.reset();
    fly.active = false;
    fly.trail.length = 0;
    g.ghost.startRecording();
    g.setStatus(t("robo_baseball.status.ready"), "");
  }

  function init(ctx: GameContext): void {
    g = ctx;
    const updatePointerAim = (event: PointerEvent): void => {
      const rect = g.canvas.getBoundingClientRect();
      aimX = Math.max(
        ZONE.x - 34,
        Math.min(ZONE.x + ZONE.w + 34, ((event.clientX - rect.left) / rect.width) * W),
      );
      aimY = Math.max(
        ZONE.y - 34,
        Math.min(ZONE.y + ZONE.h + 34, ((event.clientY - rect.top) / rect.height) * H),
      );
    };
    onPointerMove = (event) => updatePointerAim(event);
    onPointerDown = (event) => {
      event.preventDefault();
      updatePointerAim(event);
      pointerSwingPending = true;
    };
    g.canvas.addEventListener("pointermove", onPointerMove);
    g.canvas.addEventListener("pointerdown", onPointerDown);
    onActionKeyDown = (event) => {
      if ((event.key === " " || event.key.toLowerCase() === "e") && !event.repeat) {
        pointerSwingPending = true;
      }
    };
    window.addEventListener("keydown", onActionKeyDown);
    reset();
  }

  function makePitch(): void {
    pitchNumber++;
    const outside = Math.random() < 0.18;
    pitch.inZone = !outside;
    if (outside) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) {
        pitch.targetX = ZONE.x - 18;
        pitch.targetY = ZONE.y + 25 + Math.random() * (ZONE.h - 50);
      } else if (side === 1) {
        pitch.targetX = ZONE.x + ZONE.w + 18;
        pitch.targetY = ZONE.y + 25 + Math.random() * (ZONE.h - 50);
      } else if (side === 2) {
        pitch.targetX = ZONE.x + 20 + Math.random() * (ZONE.w - 40);
        pitch.targetY = ZONE.y - 18;
      } else {
        pitch.targetX = ZONE.x + 20 + Math.random() * (ZONE.w - 40);
        pitch.targetY = ZONE.y + ZONE.h + 18;
      }
    } else {
      pitch.targetX = ZONE.x + 14 + Math.random() * (ZONE.w - 28);
      pitch.targetY = ZONE.y + 15 + Math.random() * (ZONE.h - 30);
    }
    pitch.curve = (Math.random() - 0.5) * 66;
    pitch.duration = Math.max(0.82, 1.18 - pitchNumber * 0.022 + Math.random() * 0.12);
    pitch.progress = 0;
    phase = "pitch";
    result = null;
    resultText = "";
    g.sfx.start();
    g.setStatus(t("robo_baseball.status.pitch", { n: pitchNumber, total: TOTAL_PITCHES }), "");
  }

  function finish(): void {
    phase = "finished";
    fly.active = false;
    const stars = baseballStars(score);
    g.setStatus(t("robo_baseball.status.finished"), "var(--ok)");
    g.awardStars(
      stars,
      `${t("robo_baseball.stats.score")} <b>${score.toLocaleString()}</b><br>` +
        `${t("robo_baseball.stats.homers")} <b>${homers}</b> / ${TOTAL_PITCHES}<br>` +
        `${t("robo_baseball.stats.combo")} <b>${bestCombo}</b>`,
    );
  }

  function setResult(kind: ResultKind, text: string, delay = 1.15): void {
    phase = "result";
    phaseTimer = delay;
    result = kind;
    resultText = text;
    if (kind === "miss" || kind === "strike") {
      combo = 0;
      strikes++;
      g.sfx.bump();
    }
    if (kind === "ball") g.sfx.click();
    g.setStatus(text, kind === "homer" || kind === "hit" ? "var(--ok)" : "var(--warn)");
  }

  function launchBall(power: number, quality: number): void {
    fly.active = true;
    fly.x = aimX;
    fly.y = aimY;
    fly.vx = -(310 + power * 300);
    fly.vy = -(230 + power * 210) + (aimY - pitch.targetY) * 2;
    fly.trail.length = 0;
    particles.burst(fly.x, fly.y, quality > 0.86 ? "#fbbf24" : "#7dd3fc", 24, 260);
  }

  function swing(): void {
    if (phase !== "pitch") return;
    const aimError = Math.hypot(aimX - pitch.targetX, aimY - pitch.targetY);
    g.publish(
      "/bat/swing",
      `timing=${pitch.progress.toFixed(3)} aim_error=${aimError.toFixed(1)}px`,
    );

    const swingResult = classifyBaseballSwing(pitch.progress, aimError);
    if (swingResult.contact === "miss") {
      setResult("miss", t("robo_baseball.result.miss"));
      g.shake(0.3);
      return;
    }

    const quality = swingResult.quality;
    if (swingResult.contact === "homer") {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      homers++;
      hits++;
      const gained = 1000 + (combo - 1) * 120;
      score += gained;
      flash = 0.45;
      launchBall(1, quality);
      g.sfx.victory();
      g.shake(0.8);
      setResult("homer", t("robo_baseball.result.homer", { points: gained }), 1.55);
    } else if (swingResult.contact === "hit") {
      combo++;
      bestCombo = Math.max(bestCombo, combo);
      hits++;
      const gained = 420 + (combo - 1) * 70;
      score += gained;
      launchBall(0.55, quality);
      g.sfx.deliver();
      setResult("hit", t("robo_baseball.result.hit", { points: gained }), 1.3);
    } else {
      combo = 0;
      launchBall(0.2, quality);
      g.sfx.bump();
      setResult("foul", t("robo_baseball.result.foul"));
    }
  }

  function updateAim(dt: number): void {
    const dx =
      (g.keys.has("d") || g.keys.has("arrowright") ? 1 : 0) -
      (g.keys.has("a") || g.keys.has("arrowleft") ? 1 : 0);
    const dy =
      (g.keys.has("s") || g.keys.has("arrowdown") ? 1 : 0) -
      (g.keys.has("w") || g.keys.has("arrowup") ? 1 : 0);
    aimX = Math.max(ZONE.x - 34, Math.min(ZONE.x + ZONE.w + 34, aimX + dx * AIM_SPEED * dt));
    aimY = Math.max(ZONE.y - 34, Math.min(ZONE.y + ZONE.h + 34, aimY + dy * AIM_SPEED * dt));
  }

  function updateFlyBall(dt: number): void {
    if (!fly.active) return;
    fly.trail.push({ x: fly.x, y: fly.y });
    if (fly.trail.length > 18) fly.trail.shift();
    fly.x += fly.vx * dt;
    fly.y += fly.vy * dt;
    fly.vy += 430 * dt;
    if (fly.x < -30 || fly.y > H + 30) fly.active = false;
  }

  function update(dt: number): void {
    animTime += dt;
    particles.update(dt);
    updateFlyBall(dt);
    if (flash > 0) flash = Math.max(0, flash - dt);
    if (phase === "finished") return;
    elapsed += dt;
    updateAim(dt);

    const swingHeld = g.keys.has("shift") || g.keys.has("x") || g.keys.has("e") || g.keys.has(" ");
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = Array.from(pads).find((candidate): candidate is Gamepad => candidate !== null);
    const padSwing = (pad?.buttons[0]?.pressed ?? false) || (pad?.buttons[2]?.pressed ?? false);
    if (pointerSwingPending || (swingHeld && !lastSwing) || (padSwing && !lastPadSwing)) {
      swing();
    }
    pointerSwingPending = false;
    lastSwing = swingHeld;
    lastPadSwing = padSwing;

    if (phase === "ready" || phase === "result") {
      phaseTimer -= dt;
      if (phaseTimer <= 0) {
        if (pitchNumber >= TOTAL_PITCHES) finish();
        else makePitch();
      }
      return;
    }

    pitch.progress += dt / pitch.duration;
    pubAcc += dt;
    if (pubAcc >= 0.1) {
      pubAcc = 0;
      g.publish(
        "/pitch/trajectory",
        `crossing_point: {x: ${pitch.targetX.toFixed(1)}, y: ${pitch.targetY.toFixed(1)}} progress: ${pitch.progress.toFixed(2)}`,
      );
    }
    if (pitch.progress > 1.08) {
      if (pitch.inZone) setResult("strike", t("robo_baseball.result.strike"));
      else setResult("ball", t("robo_baseball.result.ball"));
    }

    g.setHud([
      `PITCH  ${Math.min(pitchNumber, TOTAL_PITCHES)} / ${TOTAL_PITCHES}`,
      `SCORE  ${score.toString().padStart(5, "0")}`,
      `HR     ${homers}`,
      `COMBO  x${combo}`,
      `VISION (${Math.round(pitch.targetX)}, ${Math.round(pitch.targetY)})`,
    ]);
  }

  function drawFieldPerspective(c: CanvasRenderingContext2D): void {
    clearBackground(c);
    const sky = c.createLinearGradient(0, 0, 0, 260);
    sky.addColorStop(0, "#071126");
    sky.addColorStop(0.7, "#173452");
    sky.addColorStop(1, "#31536a");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, 270);

    // Soft night glow above the stadium roof.
    const glow = c.createRadialGradient(400, 80, 10, 400, 80, 360);
    glow.addColorStop(0, "rgba(125, 211, 252, 0.16)");
    glow.addColorStop(1, "rgba(125, 211, 252, 0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, W, 260);

    // Proper floodlight towers with visible trusses.
    for (const x of [55, 745]) {
      c.strokeStyle = "#94a3b8";
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(x - 7, 205);
      c.lineTo(x - 2, 48);
      c.moveTo(x + 7, 205);
      c.lineTo(x + 2, 48);
      c.stroke();
      c.strokeStyle = "rgba(148, 163, 184, 0.45)";
      c.lineWidth = 1;
      for (let y = 70; y < 190; y += 24) {
        c.beginPath();
        c.moveTo(x - 5, y);
        c.lineTo(x + 5, y + 12);
        c.moveTo(x + 5, y);
        c.lineTo(x - 5, y + 12);
        c.stroke();
      }
      c.fillStyle = "rgba(219, 234, 254, 0.12)";
      c.beginPath();
      c.moveTo(x - 54, 45);
      c.lineTo(x + 54, 45);
      c.lineTo(x + 145, 285);
      c.lineTo(x - 145, 285);
      c.fill();
      c.fillStyle = "#1e293b";
      c.beginPath();
      c.roundRect(x - 49, 27, 98, 25, 4);
      c.fill();
      for (let i = 0; i < 5; i++) {
        c.fillStyle = "#e0f2fe";
        c.shadowColor = "#bae6fd";
        c.shadowBlur = 12;
        c.fillRect(x - 40 + i * 18, 33, 12, 12);
      }
      c.shadowBlur = 0;
    }

    // Upper deck, fascia and a central electronic scoreboard.
    c.fillStyle = "#0f172a";
    c.beginPath();
    c.moveTo(0, 188);
    c.quadraticCurveTo(400, 145, 800, 188);
    c.lineTo(800, 275);
    c.lineTo(0, 275);
    c.closePath();
    c.fill();
    c.strokeStyle = "#334155";
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = "#111c38";
    c.beginPath();
    c.moveTo(0, 214);
    c.quadraticCurveTo(400, 178, 800, 214);
    c.lineTo(800, 269);
    c.lineTo(0, 269);
    c.closePath();
    c.fill();

    // Crowd rows follow the curve instead of forming a flat pixel strip.
    const crowdColors = ["#7dd3fc", "#fbbf24", "#f472b6", "#c4b5fd", "#e2e8f0"];
    for (let row = 0; row < 4; row++) {
      for (let x = 8 + (row % 2) * 7; x < W; x += 18) {
        const curveY = 215 + row * 13 - 22 * (1 - Math.pow((x - 400) / 400, 2));
        c.fillStyle = crowdColors[((x / 2 + row) % crowdColors.length) | 0];
        c.beginPath();
        c.arc(x, curveY, 2.2, 0, Math.PI * 2);
        c.fill();
      }
    }

    c.fillStyle = "#050914";
    c.beginPath();
    c.roundRect(296, 166, 208, 66, 6);
    c.fill();
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "#94a3b8";
    c.font = "700 7px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("ROBOT LEAGUE // VISION ARENA", 400, 181);
    c.fillStyle = "#fbbf24";
    c.font = "900 18px ui-monospace, monospace";
    c.fillText("R-BALL STADIUM", 400, 203);
    c.fillStyle = "#5eead4";
    c.font = "700 8px ui-monospace, monospace";
    c.fillText("HOME  0 0 0   •   GUEST  0 0 0", 400, 219);

    // Padded outfield wall with distance marks.
    c.fillStyle = "#123d42";
    c.beginPath();
    c.moveTo(0, 265);
    c.quadraticCurveTo(400, 228, 800, 265);
    c.lineTo(800, 322);
    c.lineTo(0, 322);
    c.closePath();
    c.fill();
    c.strokeStyle = "#5eead4";
    c.lineWidth = 2;
    c.stroke();
    for (let x = 0; x <= W; x += 80) {
      c.strokeStyle = "rgba(94, 234, 212, 0.2)";
      c.beginPath();
      c.moveTo(x, 263);
      c.lineTo(x, 322);
      c.stroke();
    }
    c.fillStyle = "#a7f3d0";
    c.font = "700 8px ui-monospace, monospace";
    c.fillText("325", 86, 289);
    c.fillText("400", 400, 272);
    c.fillText("325", 714, 289);

    // Layered turf with mowing stripes creates depth.
    const grass = c.createLinearGradient(0, 300, 0, H);
    grass.addColorStop(0, "#247346");
    grass.addColorStop(1, "#0b3b27");
    c.fillStyle = grass;
    c.fillRect(0, 305, W, H - 305);
    for (let i = -2; i < 9; i++) {
      c.fillStyle = i % 2 ? "rgba(110, 231, 183, 0.055)" : "rgba(0, 0, 0, 0.05)";
      c.beginPath();
      c.moveTo(400, 305);
      c.lineTo(i * 130, H);
      c.lineTo(i * 130 + 105, H);
      c.closePath();
      c.fill();
    }

    // Infield dirt follows the actual diamond instead of a single triangle.
    c.fillStyle = "#a87348";
    c.beginPath();
    c.moveTo(400, 315);
    c.lineTo(682, 430);
    c.lineTo(400, 493);
    c.lineTo(118, 430);
    c.closePath();
    c.fill();
    c.fillStyle = "#155c38";
    c.beginPath();
    c.moveTo(400, 340);
    c.lineTo(622, 428);
    c.lineTo(400, 468);
    c.lineTo(178, 428);
    c.closePath();
    c.fill();

    // Pitching lane, mound, batter's circle and crisp chalk.
    c.fillStyle = "#aa754c";
    c.beginPath();
    c.ellipse(198, 326, 52, 17, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(642, 421);
    c.lineTo(400, 315);
    c.lineTo(158, 421);
    c.moveTo(642, 421);
    c.lineTo(400, 493);
    c.lineTo(158, 421);
    c.stroke();
    c.fillStyle = "#f8fafc";
    c.fillRect(188, 323, 20, 3);
    for (const [x, y] of [
      [400, 315],
      [158, 421],
      [400, 493],
    ]) {
      c.save();
      c.translate(x, y);
      c.rotate(Math.PI / 4);
      c.fillStyle = "#f8fafc";
      c.fillRect(-6, -6, 12, 12);
      c.restore();
    }

    // Home plate and batter's box.
    c.strokeStyle = "rgba(255,255,255,0.8)";
    c.lineWidth = 1.5;
    c.strokeRect(671, 339, 91, 91);
    c.fillStyle = "#f8fafc";
    c.beginPath();
    c.moveTo(642, 411);
    c.lineTo(652, 415);
    c.lineTo(649, 426);
    c.lineTo(635, 426);
    c.lineTo(632, 415);
    c.closePath();
    c.fill();

    // Ceiling-mounted stereo camera tracking the ball.
    c.save();
    c.translate(410, 126);
    c.strokeStyle = "rgba(125, 211, 252, 0.28)";
    c.lineWidth = 1;
    c.setLineDash([4, 5]);
    c.beginPath();
    c.moveTo(-15, 12);
    c.lineTo(ZONE.x, ZONE.y + ZONE.h / 2);
    c.moveTo(15, 12);
    c.lineTo(RELEASE_X, 250);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#111827";
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(-31, -13, 62, 26, 7);
    c.fill();
    c.stroke();
    for (const x of [-17, 17]) {
      c.fillStyle = "#020617";
      c.beginPath();
      c.arc(x, 0, 8, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#5eead4";
      c.beginPath();
      c.arc(x, 0, 4 + Math.sin(animTime * 4) * 0.7, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = "#5eead4";
    c.fillRect(-2, -3, 4, 6);
    c.font = "700 8px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("STEREO VISION", 0, -20);
    c.restore();
  }

  function drawField(c: CanvasRenderingContext2D): void {
    if (USE_PERSPECTIVE_FIELD) {
      drawFieldPerspective(c);
      return;
    }
    clearBackground(c);

    // Flat 2D side-view: every gameplay element shares the same picture plane.
    const sky = c.createLinearGradient(0, 0, 0, 250);
    sky.addColorStop(0, "#071126");
    sky.addColorStop(0.65, "#18324f");
    sky.addColorStop(1, "#31566d");
    c.fillStyle = sky;
    c.fillRect(0, 0, W, 260);

    // Moon glow and a few restrained stars.
    const moonGlow = c.createRadialGradient(400, 68, 4, 400, 68, 180);
    moonGlow.addColorStop(0, "rgba(186, 230, 253, 0.18)");
    moonGlow.addColorStop(1, "rgba(186, 230, 253, 0)");
    c.fillStyle = moonGlow;
    c.fillRect(190, 0, 420, 220);
    c.fillStyle = "rgba(224, 242, 254, 0.7)";
    for (const [x, y, r] of [
      [128, 65, 1],
      [244, 102, 1.3],
      [553, 72, 1],
      [665, 118, 1.2],
      [352, 43, 0.8],
    ]) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }

    // Symmetrical floodlights frame the 2D playfield.
    for (const x of [52, 748]) {
      c.strokeStyle = "#64748b";
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(x, 265);
      c.lineTo(x, 55);
      c.stroke();
      c.strokeStyle = "rgba(148, 163, 184, 0.45)";
      c.lineWidth = 1;
      for (let y = 82; y < 245; y += 25) {
        c.beginPath();
        c.moveTo(x - 4, y);
        c.lineTo(x + 4, y + 13);
        c.moveTo(x + 4, y);
        c.lineTo(x - 4, y + 13);
        c.stroke();
      }
      c.fillStyle = "#111827";
      c.beginPath();
      c.roundRect(x - 43, 35, 86, 28, 4);
      c.fill();
      for (let i = 0; i < 4; i++) {
        c.fillStyle = "#e0f2fe";
        c.shadowColor = "#bae6fd";
        c.shadowBlur = 12;
        c.fillRect(x - 34 + i * 18, 42, 12, 13);
      }
      c.shadowBlur = 0;
      c.fillStyle = "rgba(219, 234, 254, 0.08)";
      c.beginPath();
      c.moveTo(x - 39, 62);
      c.lineTo(x + 39, 62);
      c.lineTo(x + 140, 350);
      c.lineTo(x - 140, 350);
      c.closePath();
      c.fill();
    }

    // Grandstand roof and three horizontal seating tiers.
    c.fillStyle = "#0a1020";
    c.fillRect(0, 166, W, 18);
    c.strokeStyle = "#334155";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 166);
    c.lineTo(W, 166);
    c.stroke();
    const tierColors = ["#111b34", "#16213d", "#1a2747"];
    for (let tier = 0; tier < 3; tier++) {
      const y = 184 + tier * 34;
      c.fillStyle = tierColors[tier];
      c.fillRect(0, y, W, 34);
      c.fillStyle = "rgba(125, 211, 252, 0.1)";
      c.fillRect(0, y + 31, W, 3);
    }

    // Crowd dots are aligned to seats, reinforcing the deliberately flat style.
    const crowd = ["#7dd3fc", "#fbbf24", "#f472b6", "#c4b5fd", "#e2e8f0"];
    for (let row = 0; row < 6; row++) {
      for (let x = 8 + (row % 2) * 6; x < W; x += 17) {
        c.fillStyle = crowd[(x + row * 3) % crowd.length];
        c.fillRect(x, 192 + row * 15, 4, 4);
      }
    }

    // Scoreboard sits behind play without competing with the game HUD.
    c.fillStyle = "#030712";
    c.beginPath();
    c.roundRect(310, 179, 180, 68, 6);
    c.fill();
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "#94a3b8";
    c.font = "700 7px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("ROBOT LEAGUE", 400, 193);
    c.fillStyle = "#fbbf24";
    c.font = "900 17px ui-monospace, monospace";
    c.fillText("R-BALL", 400, 214);
    c.fillStyle = "#5eead4";
    c.font = "700 8px ui-monospace, monospace";
    c.fillText("H  0 0 0   •   G  0 0 0", 400, 232);

    // Flat padded outfield wall, including seams and distance signs.
    c.fillStyle = "#0d4845";
    c.fillRect(0, 286, W, 64);
    c.fillStyle = "#0f5b50";
    c.fillRect(0, 286, W, 8);
    c.fillStyle = "#5eead4";
    c.fillRect(0, 347, W, 3);
    for (let x = 0; x <= W; x += 80) {
      c.strokeStyle = "rgba(167, 243, 208, 0.22)";
      c.beginPath();
      c.moveTo(x, 286);
      c.lineTo(x, 350);
      c.stroke();
    }
    c.fillStyle = "#a7f3d0";
    c.font = "800 9px ui-monospace, monospace";
    c.fillText("325", 102, 320);
    c.fillText("400", 400, 320);
    c.fillText("325", 698, 320);

    // Horizontal field layers replace the pseudo-3D diamond.
    const turf = c.createLinearGradient(0, 350, 0, H);
    turf.addColorStop(0, "#237346");
    turf.addColorStop(1, "#0d422b");
    c.fillStyle = turf;
    c.fillRect(0, 350, W, H - 350);
    for (let y = 350; y < H; y += 24) {
      c.fillStyle = (y / 24) % 2 < 1 ? "rgba(110, 231, 183, 0.045)" : "rgba(0,0,0,0.035)";
      c.fillRect(0, y, W, 24);
    }

    // Clay track, mound and batter's box all sit on one horizontal baseline.
    c.fillStyle = "#9f704b";
    c.fillRect(0, 414, W, 86);
    c.fillStyle = "#b98557";
    c.beginPath();
    c.ellipse(RELEASE_X, 414, 59, 17, 0, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(650, 418, 97, 23, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.82)";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 414);
    c.lineTo(W, 414);
    c.stroke();
    c.fillStyle = "#f8fafc";
    c.fillRect(RELEASE_X - 11, 407, 22, 4);
    c.strokeStyle = "rgba(255,255,255,0.72)";
    c.strokeRect(665, 340, 96, 78);
    c.beginPath();
    c.moveTo(638, 407);
    c.lineTo(649, 411);
    c.lineTo(646, 423);
    c.lineTo(631, 423);
    c.lineTo(628, 411);
    c.closePath();
    c.fill();

    // Stereo vision bar is part of the stadium infrastructure.
    c.save();
    c.translate(410, 128);
    c.strokeStyle = "rgba(125, 211, 252, 0.24)";
    c.lineWidth = 1;
    c.setLineDash([4, 5]);
    c.beginPath();
    c.moveTo(-15, 12);
    c.lineTo(ZONE.x, ZONE.y + ZONE.h / 2);
    c.moveTo(15, 12);
    c.lineTo(RELEASE_X, 340);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "#111827";
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(-31, -13, 62, 26, 7);
    c.fill();
    c.stroke();
    for (const x of [-17, 17]) {
      c.fillStyle = "#020617";
      c.beginPath();
      c.arc(x, 0, 8, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#5eead4";
      c.beginPath();
      c.arc(x, 0, 4 + Math.sin(animTime * 4) * 0.7, 0, Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = "#5eead4";
    c.fillRect(-2, -3, 4, 6);
    c.font = "700 8px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("STEREO VISION", 0, -20);
    c.restore();
  }

  function drawPitcher(c: CanvasRenderingContext2D): void {
    const windup = phase === "pitch" ? Math.sin(Math.min(1, pitch.progress * 2) * Math.PI) : 0;
    c.save();
    c.translate(RELEASE_X, 382);
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.ellipse(0, 24, 30, 8, 0, 0, Math.PI * 2);
    c.fill();
    // Reuse the same mascot body as the movement games, facing the batter.
    c.save();
    c.scale(2.35, 2.35);
    drawRobotBody(c, 0, animTime);
    c.restore();

    // A small pop-out pitching arm is the only baseball-specific attachment.
    const handX = 33 + windup * 17;
    const handY = -5 - windup * 25;
    c.strokeStyle = "#e8d5c4";
    c.lineWidth = 8;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(15, -7);
    c.lineTo(27, -13);
    c.lineTo(handX, handY);
    c.stroke();
    c.fillStyle = "#2d2540";
    c.beginPath();
    c.arc(27, -13, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#7dd3fc";
    c.beginPath();
    c.arc(handX, handY, 5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#eef2ff";
    c.font = "800 7px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("P-01", 0, 39);
    c.restore();
  }

  function drawBatter(c: CanvasRenderingContext2D): void {
    const swinging =
      phase === "result" && (result === "homer" || result === "hit" || result === "foul");
    const batAngle = swinging ? Math.PI + 0.12 : -0.98 + Math.sin(animTime * 2) * 0.025;
    const grip = swinging ? { x: -22, y: -8 } : { x: 19, y: -24 };
    const crouch = swinging ? 0 : 2 + Math.sin(animTime * 2.4);
    c.save();
    c.translate(714, 382 + crouch);

    // Wide wheel stance reads like a batter setting its base.
    c.fillStyle = "#2d2540";
    c.beginPath();
    c.roundRect(-38, 20, 22, 8, 3);
    c.roundRect(17, 20, 22, 8, 3);
    c.fill();
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-34, 28);
    c.lineTo(-18, 28);
    c.moveTo(20, 28);
    c.lineTo(36, 28);
    c.stroke();

    // Same exact body and face used by Delivery, rotated to face the pitcher.
    c.save();
    c.rotate(Math.PI);
    c.scale(2.7, 2.7);
    drawRobotBody(c, 0, animTime);
    c.restore();

    // Two compact arms meet at the bat handle.
    const elbows = swinging
      ? [
          [-28, -15],
          [-10, 4],
        ]
      : [
          [-7, -27],
          [26, -14],
        ];
    c.strokeStyle = "#e8d5c4";
    c.lineWidth = 8;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-17, -10);
    c.lineTo(elbows[0][0], elbows[0][1]);
    c.lineTo(grip.x, grip.y);
    c.moveTo(16, -9);
    c.lineTo(elbows[1][0], elbows[1][1]);
    c.lineTo(grip.x + 3, grip.y + 3);
    c.stroke();
    for (const [x, y] of elbows) {
      c.fillStyle = "#2d2540";
      c.beginPath();
      c.arc(x, y, 4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#7dd3fc";
      c.beginPath();
      c.arc(x, y, 2, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = "#fef3e8";
    c.beginPath();
    c.arc(grip.x, grip.y, 5, 0, Math.PI * 2);
    c.fill();

    // The bat rests high over the rear wheel and sweeps through the strike zone.
    c.translate(grip.x, grip.y);
    c.rotate(batAngle);
    const batGradient = c.createLinearGradient(0, 0, 92, 0);
    batGradient.addColorStop(0, "#475569");
    batGradient.addColorStop(0.7, "#fbbf24");
    batGradient.addColorStop(1, "#fef3c7");
    c.strokeStyle = batGradient;
    c.lineCap = "round";
    c.lineWidth = 9;
    c.beginPath();
    c.moveTo(-4, 0);
    c.lineTo(92, 0);
    c.stroke();
    c.strokeStyle = "rgba(255,255,255,0.65)";
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(24, -3);
    c.lineTo(84, -3);
    c.stroke();
    c.restore();

    c.save();
    c.translate(714, 382 + crouch);
    c.fillStyle = "#eef2ff";
    c.font = "800 7px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("B-09", 0, 41);
    c.restore();
  }

  function pitchPosition(): { x: number; y: number; r: number } {
    const p = Math.max(0, Math.min(1, pitch.progress));
    const eased = p * p * (3 - 2 * p);
    const x = RELEASE_X + (pitch.targetX - RELEASE_X) * eased;
    const baseY = 340 + (pitch.targetY - 340) * eased;
    const y = baseY + Math.sin(p * Math.PI) * pitch.curve;
    return { x, y, r: 4 + p * 7 };
  }

  function drawStrikeZone(c: CanvasRenderingContext2D): void {
    c.save();
    // The predictor exposes where the tracked pitch should cross the plate.
    if (phase === "pitch") {
      const ball = pitchPosition();
      const lockPulse = 0.55 + Math.sin(animTime * 8) * 0.2;
      c.strokeStyle = `rgba(94, 234, 212, ${lockPulse})`;
      c.lineWidth = 1.5;
      c.setLineDash([4, 6]);
      c.beginPath();
      c.moveTo(ball.x, ball.y);
      c.lineTo(pitch.targetX, pitch.targetY);
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = "#5eead4";
      c.lineWidth = 2;
      const r = 11;
      c.beginPath();
      c.moveTo(pitch.targetX - r, pitch.targetY - r / 2);
      c.lineTo(pitch.targetX - r, pitch.targetY - r);
      c.lineTo(pitch.targetX - r / 2, pitch.targetY - r);
      c.moveTo(pitch.targetX + r / 2, pitch.targetY - r);
      c.lineTo(pitch.targetX + r, pitch.targetY - r);
      c.lineTo(pitch.targetX + r, pitch.targetY - r / 2);
      c.moveTo(pitch.targetX - r, pitch.targetY + r / 2);
      c.lineTo(pitch.targetX - r, pitch.targetY + r);
      c.lineTo(pitch.targetX - r / 2, pitch.targetY + r);
      c.moveTo(pitch.targetX + r / 2, pitch.targetY + r);
      c.lineTo(pitch.targetX + r, pitch.targetY + r);
      c.lineTo(pitch.targetX + r, pitch.targetY + r / 2);
      c.stroke();
      c.fillStyle = "#5eead4";
      c.font = "700 7px ui-monospace, monospace";
      c.textAlign = "left";
      c.fillText("PREDICT", pitch.targetX + 14, pitch.targetY - 8);
      c.fillStyle = "rgba(94, 234, 212, 0.7)";
      c.fillText(
        `${Math.round(pitch.targetX)},${Math.round(pitch.targetY)}`,
        pitch.targetX + 14,
        pitch.targetY + 3,
      );
    }

    c.strokeStyle = "rgba(125, 211, 252, 0.72)";
    c.lineWidth = 2;
    c.setLineDash([6, 5]);
    c.strokeRect(ZONE.x, ZONE.y, ZONE.w, ZONE.h);
    c.setLineDash([]);
    c.strokeStyle = "rgba(125, 211, 252, 0.18)";
    c.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      c.beginPath();
      c.moveTo(ZONE.x + (ZONE.w * i) / 3, ZONE.y);
      c.lineTo(ZONE.x + (ZONE.w * i) / 3, ZONE.y + ZONE.h);
      c.moveTo(ZONE.x, ZONE.y + (ZONE.h * i) / 3);
      c.lineTo(ZONE.x + ZONE.w, ZONE.y + (ZONE.h * i) / 3);
      c.stroke();
    }

    const pulse = 1 + Math.sin(animTime * 6) * 0.12;
    c.translate(aimX, aimY);
    c.scale(pulse, pulse);
    c.strokeStyle = "#fbbf24";
    c.lineWidth = 2.5;
    c.beginPath();
    c.arc(0, 0, 17, 0, Math.PI * 2);
    c.moveTo(-25, 0);
    c.lineTo(-8, 0);
    c.moveTo(8, 0);
    c.lineTo(25, 0);
    c.moveTo(0, -25);
    c.lineTo(0, -8);
    c.moveTo(0, 8);
    c.lineTo(0, 25);
    c.stroke();
    c.restore();
  }

  function drawBall(c: CanvasRenderingContext2D): void {
    if (phase === "pitch") {
      const b = pitchPosition();
      c.save();
      c.shadowColor = "#ffffff";
      c.shadowBlur = 10;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = "#ef4444";
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(b.x - b.r * 0.22, b.y, b.r * 0.62, -1.2, 1.2);
      c.stroke();
      c.restore();
    }
    if (fly.active) {
      c.save();
      for (let i = 0; i < fly.trail.length; i++) {
        c.globalAlpha = ((i + 1) / fly.trail.length) * 0.32;
        c.fillStyle = "#fbbf24";
        c.beginPath();
        c.arc(fly.trail[i].x, fly.trail[i].y, 3 + i * 0.15, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      c.shadowColor = "#fbbf24";
      c.shadowBlur = 15;
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(fly.x, fly.y, 8, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }

  function drawHud(c: CanvasRenderingContext2D): void {
    c.save();
    c.fillStyle = "rgba(3, 7, 18, 0.82)";
    c.strokeStyle = "rgba(125, 211,252,0.28)";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(18, 16, 286, 64, 10);
    c.fill();
    c.stroke();
    c.fillStyle = "#fbbf24";
    c.font = "800 20px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(`${score.toString().padStart(5, "0")} PTS`, 34, 44);
    c.fillStyle = "#eef2ff";
    c.font = "700 12px ui-monospace, monospace";
    c.fillText(`PITCH ${Math.min(pitchNumber, TOTAL_PITCHES)}/${TOTAL_PITCHES}`, 34, 65);
    c.fillStyle = "#7dd3fc";
    c.fillText(`HR ${homers}`, 150, 65);
    c.fillStyle = combo > 1 ? "#f472b6" : "#94a3b8";
    c.fillText(`COMBO x${combo}`, 208, 65);

    // Robot diagnostics: makes the batting system feel active even between pitches.
    c.fillStyle = "rgba(3, 7, 18, 0.78)";
    c.strokeStyle = "rgba(94, 234, 212, 0.35)";
    c.beginPath();
    c.roundRect(W - 178, 16, 160, 54, 9);
    c.fill();
    c.stroke();
    const locked = phase === "pitch";
    c.fillStyle = locked ? "#5eead4" : "#64748b";
    c.beginPath();
    c.arc(W - 160, 34, 4, 0, Math.PI * 2);
    c.fill();
    c.font = "700 9px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillText(locked ? "VISION // TRACKING" : "VISION // STANDBY", W - 149, 37);
    c.fillStyle = "#94a3b8";
    c.font = "700 8px ui-monospace, monospace";
    c.fillText("B-09  SERVO", W - 162, 55);
    c.fillStyle = "rgba(125, 211,252,0.18)";
    c.fillRect(W - 89, 49, 56, 7);
    c.fillStyle = "#7dd3fc";
    c.fillRect(W - 89, 49, 49 + Math.sin(animTime * 3) * 3, 7);

    if (resultText) {
      const color = result === "homer" ? "#fbbf24" : result === "hit" ? "#7dd3fc" : "#eef2ff";
      const size = result === "homer" ? 42 : 28;
      c.fillStyle = "rgba(3, 7, 18, 0.72)";
      c.fillRect(0, 92, W, 58);
      c.fillStyle = color;
      c.font = `900 ${size}px ui-monospace, monospace`;
      c.textAlign = "center";
      c.shadowColor = color;
      c.shadowBlur = result === "homer" ? 20 : 8;
      c.fillText(resultText, W / 2, 132);
    }
    c.restore();
  }

  function draw(): void {
    const c = g.ctx;
    drawField(c);
    drawPitcher(c);
    drawStrikeZone(c);
    drawBatter(c);
    drawBall(c);
    particles.draw(c);
    drawHud(c);
    if (flash > 0) {
      c.fillStyle = `rgba(251, 191, 36, ${flash * 0.38})`;
      c.fillRect(0, 0, W, H);
    }
    drawHint(c, t("robo_baseball.hint"));
  }

  function dispose(): void {
    if (onPointerMove) g.canvas.removeEventListener("pointermove", onPointerMove);
    if (onPointerDown) g.canvas.removeEventListener("pointerdown", onPointerDown);
    if (onActionKeyDown) window.removeEventListener("keydown", onActionKeyDown);
    onPointerMove = null;
    onPointerDown = null;
    onActionKeyDown = null;
  }

  return {
    id: "robo_baseball",
    name: "Robo Baseball",
    lesson: "Vision tracking — predict the pitch crossing point",
    lessonCmd: "ros2 topic echo /pitch/trajectory",
    ros2: defineRos2Concept({
      title: tx(
        "Vision Tracking — 投球の到達点を予測する",
        "Vision Tracking — predict where the pitch will cross",
      ),
      summary: tx(
        "カメラ追跡ノードがボールの軌道を推定し、ストライクゾーンを通過する座標を publish します。照準を予測座標へ合わせ、タイミングよくスイングしましょう。",
        "A camera tracking node estimates the ball trajectory and publishes its predicted crossing point. Match the reticle to that prediction and time the swing.",
      ),
      msgTypes: ["geometry_msgs/msg/PointStamped", "std_msgs/msg/Float32"],
      cli: ["ros2 topic list", "ros2 topic echo /pitch/trajectory", "ros2 topic echo /bat/swing"],
      python: "",
      realWorld: tx(
        "高速な物体追跡では、現在位置だけでなく速度から少し先の位置を予測して制御します。",
        "High-speed object tracking predicts a future position from velocity instead of reacting only to the current position.",
      ),
      state: state({
        nodes: ["/ball_camera", "/trajectory_predictor", "/robot_batter"],
        topics: [
          topic("/pitch/trajectory", "geometry_msgs/msg/PointStamped", {
            pub: ["/trajectory_predictor"],
            sub: ["/robot_batter"],
          }),
          topic("/bat/swing", "std_msgs/msg/Float32", {
            pub: ["/robot_batter"],
          }),
        ],
      }),
    }),
    init,
    update,
    draw,
    reset,
    dispose,
  };
}

export default defineStage({
  mode: "game",
  order: 13,
  diagram: `
<svg viewBox="0 0 420 120" role="img" aria-label="camera predicts the pitch crossing point and sends it to the robot batter">
  <defs>
    <marker id="baseball-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
      <polygon points="0 0, 10 4, 0 8" fill="#7dd3fc"/>
    </marker>
  </defs>
  <rect x="8" y="25" width="112" height="70" rx="8" fill="#181f3a" stroke="#c4b5fd" stroke-width="1.5"/>
  <text x="64" y="52" text-anchor="middle" fill="#c4b5fd" font-family="ui-monospace, monospace" font-size="11" font-weight="700">ball_camera</text>
  <text x="64" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">trajectory</text>
  <rect x="300" y="25" width="112" height="70" rx="8" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="356" y="52" text-anchor="middle" fill="#fbbf24" font-family="ui-monospace, monospace" font-size="11" font-weight="700">robot_batter</text>
  <text x="356" y="72" text-anchor="middle" fill="#9aa6c8" font-family="ui-monospace, monospace" font-size="9">aim + swing</text>
  <line x1="120" y1="60" x2="298" y2="60" stroke="#7dd3fc" stroke-width="2" marker-end="url(#baseball-arrow)"/>
  <circle r="4" fill="#ffffff" stroke="#ef4444">
    <animateMotion dur="1.3s" repeatCount="indefinite" path="M 126 60 L 290 60"/>
  </circle>
  <text x="210" y="45" text-anchor="middle" fill="#7dd3fc" font-family="ui-monospace, monospace" font-size="10" font-weight="700">/pitch/trajectory</text>
  <text x="210" y="82" text-anchor="middle" fill="#6e7a9c" font-family="ui-monospace, monospace" font-size="8">predicted crossing point</text>
</svg>
`,
  lessonModal: {
    title: {
      ja: "ロボ・ベースボール — 10球ホームランチャレンジ",
      en: "Robo Baseball — ten-pitch home run challenge",
    },
    learn: {
      ja: "ビジョンノードが publish する投球の予測到達点へ照準を合わせることで、未来位置を使った高速物体追跡を体験します。",
      en: "Experience fast object tracking by aiming at the predicted crossing point published by the vision node.",
    },
    goal: {
      ja: "10球の投球で高得点を狙いましょう。照準とタイミングの両方が正確ならホームランです。ボール球は見送れます。",
      en: "Score high over ten pitches. Accurate aim plus timing makes a home run; you can take pitches outside the zone.",
    },
    first: {
      ja: "WASD・矢印・PAD・マウス・画面タッチで黄色い照準を動かし、ボールが届く直前にE・Space・Shift・PAD A/X・クリックまたはタップでスイングします。",
      en: "Aim with WASD, arrows, a pad, mouse, or touch, then swing with E, Space, Shift, pad A/X, click, or tap just before the ball arrives.",
    },
  },
  strings: {
    ja: {
      "status.ready": "バッターボックスへ！ 第1球を待とう",
      "status.pitch": "第{n}球 / {total} — コースを読んでスイング！",
      "status.finished": "ゲームセット！ ナイスバッティング",
      "result.homer": "HOME RUN! +{points}",
      "result.hit": "NICE HIT! +{points}",
      "result.foul": "FOUL",
      "result.miss": "SWING & MISS",
      "result.strike": "STRIKE",
      "result.ball": "BALL — ナイス選球眼",
      "stats.score": "スコア",
      "stats.homers": "ホームラン",
      "stats.combo": "ベストコンボ",
      hint: "WASD・矢印・PAD・マウス/タッチ: 照準 ｜ E・Space・Shift・PAD A/X・クリック/タップ: スイング ｜ R: リスタート",
    },
    en: {
      "status.ready": "Step into the box! Get ready for pitch one",
      "status.pitch": "Pitch {n} / {total} — read the course and swing!",
      "status.finished": "BALL GAME! Nice batting",
      "result.homer": "HOME RUN! +{points}",
      "result.hit": "NICE HIT! +{points}",
      "result.foul": "FOUL",
      "result.miss": "SWING & MISS",
      "result.strike": "STRIKE",
      "result.ball": "BALL — good eye",
      "stats.score": "Score",
      "stats.homers": "Home runs",
      "stats.combo": "Best combo",
      hint: "WASD/arrows/pad/mouse/touch: aim | E/Space/Shift/pad A/X/click/tap: swing | R: restart",
    },
  },
  build: makeRoboBaseball,
});
