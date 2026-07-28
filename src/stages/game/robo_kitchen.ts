// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// robo_kitchen — arm-powered cooking score attack. Read the live order, catch
// the right ingredients and stack them in sequence. A return conveyor loops
// every missed or dropped ingredient back into play, so no food is discarded.
import { W, H, type GameContext, type Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { clearBackground, drawGrid, drawHint } from "../../lib/draw";
import { Particles } from "../../lib/particles";
import { ARM, drawArm, drawWorkspace, fk, ik, slew } from "../../lib/arm";
import * as armpad from "../../lib/armpad";
import { withA } from "../../core/theme";
import { t, tx } from "../../i18n";

type Food = "bun" | "patty" | "cheese" | "lettuce" | "tomato";

interface Ingredient {
  kind: Food;
  x: number;
  y: number;
  angle: number;
}

interface Recipe {
  name: string;
  layers: Food[];
}

const FOOD: Record<Food, { color: string; label: string }> = {
  bun: { color: "#f6c66b", label: "BUN" },
  patty: { color: "#9a5b42", label: "MEAT" },
  cheese: { color: "#facc15", label: "CHEESE" },
  lettuce: { color: "#4ade80", label: "LETTUCE" },
  tomato: { color: "#fb7185", label: "TOMATO" },
};

const RECIPES: Recipe[] = [
  { name: "CLASSIC", layers: ["bun", "patty", "cheese", "bun"] },
  { name: "GARDEN", layers: ["bun", "lettuce", "tomato", "cheese", "bun"] },
  { name: "DOUBLE", layers: ["bun", "patty", "cheese", "patty", "bun"] },
  { name: "FRESH", layers: ["bun", "lettuce", "tomato", "bun"] },
];

const BELT = { x: 155, y: 330, w: 490, h: 54 };
const PLATE = { x: 400, y: 215, r: 48 };
const HOME = { x: 400, y: 275 };
const TOTAL_TIME = 75;
const GRAB_R = 28;
const CURSOR_SPEED = 290;

export function makeRoboKitchen(): Stage {
  let g!: GameContext;
  const particles = new Particles();
  let q1 = 0;
  let q2 = 0;
  let cursor = { ...HOME };
  let elbowUp = false;
  let ingredient: Ingredient | null = null;
  let held = false;
  let gripClosed = false;
  let recipeIdx = 0;
  let layerIdx = 0;
  let completed = 0;
  let score = 0;
  let combo = 0;
  let bestCombo = 0;
  let remaining = TOTAL_TIME;
  let spawnDelay = 0;
  let beltPhase = 0;
  let animTime = 0;
  let mistakeFlash = 0;
  let edgeFlash = 0;
  let cleared = false;
  let prevAction = false;
  let prevE = false;

  const recipe = () => RECIPES[recipeIdx];
  const needed = () => recipe().layers[layerIdx];

  function canvasCoords(e: MouseEvent) {
    const r = g.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * g.canvas.width) / r.width,
      y: ((e.clientY - r.top) * g.canvas.height) / r.height,
    };
  }

  function onMouseMove(e: MouseEvent) {
    const p = canvasCoords(e);
    cursor.x = Math.max(0, Math.min(W, p.x));
    cursor.y = Math.max(0, Math.min(H, p.y));
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 0 && !cleared) useGripper();
  }

  function spawnIngredient() {
    const kind = needed();
    ingredient = { kind, x: BELT.x + 18, y: BELT.y + 20, angle: 0 };
    held = false;
    gripClosed = false;
    g.setStatus(t("robo_kitchen.status.needed", { food: FOOD[kind].label }), FOOD[kind].color);
  }

  function nextIngredient(delay = 0.42) {
    ingredient = null;
    held = false;
    gripClosed = false;
    spawnDelay = delay;
  }

  function returnToBelt() {
    if (!ingredient) return;
    ingredient.x = BELT.x + 18;
    ingredient.y = BELT.y + 20;
    ingredient.angle = 0;
    held = false;
    gripClosed = false;
    mistakeFlash = 1;
    g.sfx.click();
    g.setStatus(t("robo_kitchen.status.returned"), "var(--warn)");
  }

  function completeDish() {
    completed++;
    combo++;
    bestCombo = Math.max(bestCombo, combo);
    const bonus = 500 + combo * 100 + Math.ceil(remaining) * 2;
    score += bonus;
    particles.burst(PLATE.x, PLATE.y, "#5eead4", 55, 270);
    g.sfx.deliver();
    recipeIdx = (recipeIdx + 1) % RECIPES.length;
    layerIdx = 0;
    g.setStatus(t("robo_kitchen.status.served", { n: completed, combo }), "var(--ok)");
    nextIngredient(1.0);
  }

  function useGripper() {
    if (!ingredient || spawnDelay > 0) return;
    const tip = fk(q1, q2).ee;
    if (!held) {
      if (Math.hypot(tip.x - ingredient.x, tip.y - ingredient.y) <= GRAB_R) {
        held = true;
        gripClosed = true;
        g.sfx.pickup();
      } else {
        g.sfx.click();
        g.setStatus(t("robo_kitchen.status.miss"), "var(--warn)");
      }
      return;
    }

    if (Math.hypot(tip.x - PLATE.x, tip.y - PLATE.y) <= PLATE.r) {
      if (ingredient.kind !== needed()) {
        returnToBelt();
        return;
      }
      const color = FOOD[ingredient.kind].color;
      particles.burst(PLATE.x, PLATE.y - 8 - layerIdx * 8, color, 20, 170);
      layerIdx++;
      score += 100 + combo * 20;
      g.sfx.deliver();
      if (layerIdx >= recipe().layers.length) completeDish();
      else {
        g.setStatus(
          t("robo_kitchen.status.layer", { food: FOOD[needed()].label }),
          FOOD[needed()].color,
        );
        nextIngredient();
      }
      return;
    }

    returnToBelt();
  }

  function reset() {
    cursor = { ...HOME };
    elbowUp = false;
    const seed = ik(cursor.x, cursor.y, elbowUp);
    q1 = seed.q1;
    q2 = seed.q2;
    ingredient = null;
    held = false;
    gripClosed = false;
    recipeIdx = 0;
    layerIdx = 0;
    completed = 0;
    score = 0;
    combo = 0;
    bestCombo = 0;
    remaining = TOTAL_TIME;
    spawnDelay = 0.6;
    beltPhase = 0;
    animTime = 0;
    mistakeFlash = 0;
    edgeFlash = 0;
    cleared = false;
    prevAction = false;
    prevE = false;
    armpad.reset();
    particles.reset();
    g.setStatus(t("robo_kitchen.status.start"), "");
  }

  function init(ctx: GameContext) {
    g = ctx;
    g.canvas.addEventListener("mousemove", onMouseMove);
    g.canvas.addEventListener("mousedown", onMouseDown);
    g.canvas.style.cursor = "none";
    reset();
  }

  function dispose() {
    g.canvas.removeEventListener("mousemove", onMouseMove);
    g.canvas.removeEventListener("mousedown", onMouseDown);
    g.canvas.style.cursor = "";
    armpad.reset();
  }

  function finish() {
    if (cleared) return;
    cleared = true;
    ingredient = null;
    const stars = completed >= 5 ? 3 : completed >= 3 ? 2 : 1;
    g.setStatus(t("robo_kitchen.status.timeup"), "var(--ok)");
    g.awardStars(
      stars,
      `Dishes <b>${completed}</b><br>` +
        `Score <b>${score}</b><br>` +
        `Best combo <b>x${bestCombo}</b><br>` +
        `Kitchen rank <b>${completed >= 5 ? "MASTER CHEF" : completed >= 3 ? "LINE COOK" : "ROOKIE"}</b>`,
    );
  }

  function update(dt: number) {
    armpad.poll();
    animTime += dt;
    particles.update(dt);
    beltPhase = (beltPhase + dt * (95 + completed * 5)) % 34;
    mistakeFlash = Math.max(0, mistakeFlash - dt * 2.5);
    edgeFlash = Math.max(0, edgeFlash - dt * 2);
    if (cleared) return;
    remaining -= dt;
    if (remaining <= 0) {
      remaining = 0;
      finish();
      return;
    }

    const k = g.keys;
    let dx = 0,
      dy = 0;
    if (k.has("arrowleft") || k.has("a")) dx--;
    if (k.has("arrowright") || k.has("d")) dx++;
    if (k.has("arrowup") || k.has("w")) dy--;
    if (k.has("arrowdown") || k.has("s")) dy++;
    if (dx || dy) {
      const n = Math.hypot(dx, dy);
      cursor.x = Math.max(0, Math.min(W, cursor.x + (dx / n) * CURSOR_SPEED * dt));
      cursor.y = Math.max(0, Math.min(H, cursor.y + (dy / n) * CURSOR_SPEED * dt));
    }

    const eNow = k.has("e");
    if ((eNow && !prevE) || armpad.buttonEdge(5)) {
      elbowUp = !elbowUp;
      g.sfx.click();
    }
    prevE = eNow;
    const actionNow = k.has(" ") || k.has("enter");
    if ((actionNow && !prevAction) || armpad.buttonEdge(0)) useGripper();
    prevAction = actionNow;

    const sol = ik(cursor.x, cursor.y, elbowUp);
    if (!sol.reachable) edgeFlash = 1;
    const step = ARM.maxJointSpeed * dt;
    q1 = slew(q1, sol.q1, step);
    q2 = slew(q2, sol.q2, step);
    const tip = fk(q1, q2).ee;

    if (spawnDelay > 0) {
      spawnDelay -= dt;
      if (spawnDelay <= 0) spawnIngredient();
    } else if (ingredient) {
      if (held) {
        ingredient.x = tip.x;
        ingredient.y = tip.y + 14;
        ingredient.angle += dt * 0.5;
      } else {
        ingredient.x += (82 + completed * 4) * dt;
        ingredient.angle = Math.sin(animTime * 5) * 0.04;
        if (ingredient.x > BELT.x + BELT.w - 8) {
          ingredient.x = BELT.x + 18;
          ingredient.y = BELT.y + 20;
          g.setStatus(t("robo_kitchen.status.looped"), "");
        }
      }
    }

    g.setHud([
      `TIME       ${remaining.toFixed(1)} s`,
      `SCORE      ${score}`,
      `DISHES     ${completed}   COMBO x${combo}`,
      `ORDER      ${recipe().name}`,
      `NEXT       ${FOOD[needed()].label}  (${layerIdx + 1}/${recipe().layers.length})`,
    ]);
  }

  function drawFood(
    c: CanvasRenderingContext2D,
    kind: Food,
    x: number,
    y: number,
    scale = 1,
    angle = 0,
  ) {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.scale(scale, scale);
    const col = FOOD[kind].color;
    c.fillStyle = col;
    c.strokeStyle = "#0a0f1f";
    c.lineWidth = 2.5;
    if (kind === "bun") {
      c.beginPath();
      c.roundRect(-16, -9, 32, 18, 9);
      c.fill();
      c.stroke();
      c.fillStyle = "#fff3";
      for (const sx of [-8, 0, 8]) c.fillRect(sx - 1, -5, 3, 2);
    } else if (kind === "cheese") {
      c.beginPath();
      c.moveTo(-17, -8);
      c.lineTo(17, -8);
      c.lineTo(13, 9);
      c.lineTo(-15, 7);
      c.closePath();
      c.fill();
      c.stroke();
    } else if (kind === "lettuce") {
      c.beginPath();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = i % 2 ? 12 : 17;
        const px = Math.cos(a) * r,
          py = Math.sin(a) * r * 0.55;
        i ? c.lineTo(px, py) : c.moveTo(px, py);
      }
      c.closePath();
      c.fill();
      c.stroke();
    } else {
      c.beginPath();
      c.roundRect(-16, -8, 32, 16, 6);
      c.fill();
      c.stroke();
    }
    c.restore();
  }

  function drawBelt(c: CanvasRenderingContext2D) {
    c.fillStyle = "#11182c";
    c.strokeStyle = mistakeFlash > 0 ? "#fb7185" : "#6e7a9c";
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(BELT.x, BELT.y, BELT.w, BELT.h, 8);
    c.fill();
    c.stroke();
    c.save();
    c.beginPath();
    c.rect(BELT.x + 5, BELT.y + 5, BELT.w - 10, BELT.h - 10);
    c.clip();
    c.strokeStyle = withA("#7dd3fc", 0.3);
    c.lineWidth = 3;
    for (let x = BELT.x - 40 + beltPhase; x < BELT.x + BELT.w + 40; x += 34) {
      c.beginPath();
      c.moveTo(x, BELT.y + 7);
      c.lineTo(x + 22, BELT.y + BELT.h - 7);
      c.stroke();
    }
    c.restore();
  }

  function drawOrder(c: CanvasRenderingContext2D) {
    c.fillStyle = "#11182ceF";
    c.strokeStyle = "#fbbf24";
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(18, 20, 210, 105, 9);
    c.fill();
    c.stroke();
    c.fillStyle = "#fbbf24";
    c.font = "800 13px ui-monospace, monospace";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(`ORDER: ${recipe().name}`, 31, 40);
    c.fillStyle = "#9aa6c8";
    c.font = "600 9px ui-monospace, monospace";
    c.fillText("BUILD LEFT → RIGHT", 31, 57);
    recipe().layers.forEach((kind, i) => {
      drawFood(c, kind, 48 + i * 35, 83, 0.62);
      c.strokeStyle = i === layerIdx ? "#eef2ff" : i < layerIdx ? "#5eead4" : "#394361";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(48 + i * 35, 83, 14, 0, Math.PI * 2);
      c.stroke();
    });
    c.fillStyle = FOOD[needed()].color;
    c.font = "800 10px ui-monospace, monospace";
    c.fillText(`NEXT: ${FOOD[needed()].label}`, 31, 108);
  }

  function drawPlate(c: CanvasRenderingContext2D) {
    c.fillStyle = "#dbeafe18";
    c.strokeStyle = "#dbeafe";
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(PLATE.x, PLATE.y + 17, 58, 20, 0, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    recipe()
      .layers.slice(0, layerIdx)
      .forEach((kind, i) => drawFood(c, kind, PLATE.x, PLATE.y + 5 - i * 10, 0.9));
    c.fillStyle = "#dbeafe";
    c.font = "800 10px ui-monospace, monospace";
    c.textAlign = "center";
    c.fillText("SERVE HERE", PLATE.x, PLATE.y + 52);
  }

  function drawGripper(c: CanvasRenderingContext2D) {
    const tip = fk(q1, q2).ee;
    const gap = gripClosed ? 5 : 11;
    c.strokeStyle = "#eef2ff";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(tip.x - gap, tip.y + 3);
    c.lineTo(tip.x - gap, tip.y + 16);
    c.lineTo(tip.x - gap + 5, tip.y + 19);
    c.moveTo(tip.x + gap, tip.y + 3);
    c.lineTo(tip.x + gap, tip.y + 16);
    c.lineTo(tip.x + gap - 5, tip.y + 19);
    c.stroke();
  }

  function drawCursor(c: CanvasRenderingContext2D) {
    c.strokeStyle = edgeFlash > 0 ? "#fb7185" : "#fbbf24";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cursor.x, cursor.y, 7, 0, Math.PI * 2);
    c.moveTo(cursor.x - 12, cursor.y);
    c.lineTo(cursor.x - 4, cursor.y);
    c.moveTo(cursor.x + 4, cursor.y);
    c.lineTo(cursor.x + 12, cursor.y);
    c.moveTo(cursor.x, cursor.y - 12);
    c.lineTo(cursor.x, cursor.y - 4);
    c.moveTo(cursor.x, cursor.y + 4);
    c.lineTo(cursor.x, cursor.y + 12);
    c.stroke();
  }

  function draw() {
    const c = g.ctx;
    clearBackground(c);
    drawGrid(c);
    drawWorkspace(c, edgeFlash);
    drawOrder(c);
    drawPlate(c);
    drawBelt(c);
    if (ingredient) drawFood(c, ingredient.kind, ingredient.x, ingredient.y, 1, ingredient.angle);
    particles.draw(c);
    drawArm(c, q1, q2);
    drawGripper(c);
    drawCursor(c);
    c.fillStyle = remaining < 10 ? "#fb7185" : "#eef2ff";
    c.font = "900 24px ui-monospace, monospace";
    c.textAlign = "right";
    c.textBaseline = "top";
    c.fillText(`${remaining.toFixed(1)}s`, W - 20, 20);
    drawHint(c, t("robo_kitchen.hint"));
  }

  return {
    id: "robo_kitchen",
    name: "Robo Kitchen",
    lesson: "Arm Cooking Challenge",
    lessonCmd:
      "ros2 action send_goal /gripper_controller/gripper_cmd control_msgs/action/GripperCommand '{command: {position: 0.0, max_effort: 20.0}}'",
    ros2: {
      title: tx("Robo Kitchen ・操作シーケンス", "Robo Kitchen — manipulation sequences"),
      summary: tx(
        "注文を工程へ分解し、知覚・把持・搬送を順番に実行する。実ロボットのタスクプランニングをスコアアタックにしたゲーム。",
        "Break an order into steps and execute perception, grasping and transport in sequence — task planning as a score attack.",
      ),
      msgTypes: ["geometry_msgs/msg/PoseStamped", "control_msgs/action/GripperCommand"],
      cli: [
        "ros2 action list -t",
        "ros2 topic echo /kitchen/order",
        "ros2 topic echo /joint_states",
      ],
      python: `for ingredient in order.recipe:\n    target = vision.wait_for(ingredient)\n    arm.pick(target.pose)\n    arm.place(plate_pose)\nchef.complete_order(order.id)`,
      realWorld: tx(
        "食品工場や物流セルでは、カメラ認識、MoveIt 2の軌道計画、グリッパーactionをタスクノードが同じように順序制御する。",
        "Food and logistics cells similarly orchestrate vision, MoveIt 2 planning and gripper actions from a task node.",
      ),
      state: {
        nodes: ["/robo_chef", "/ingredient_detector", "/move_group", "/gripper_controller"],
        topics: [
          {
            name: "/kitchen/order",
            type: "std_msgs/msg/String",
            pub: ["/order_server"],
            sub: ["/robo_chef"],
          },
          {
            name: "/ingredient_pose",
            type: "geometry_msgs/msg/PoseStamped",
            pub: ["/ingredient_detector"],
            sub: ["/robo_chef"],
          },
          {
            name: "/joint_states",
            type: "sensor_msgs/msg/JointState",
            pub: ["/arm_controller"],
            sub: ["/move_group"],
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
  order: 11,
  diagram: `
<svg viewBox="0 0 420 140" role="img" aria-label="read the recipe, catch the ingredient, and place it on the plate; missed food returns on the conveyor">
  <!-- order card -->
  <rect x="8" y="12" width="112" height="76" rx="7" fill="#181f3a" stroke="#fbbf24" stroke-width="1.5"/>
  <text x="18" y="30" fill="#fbbf24" font-family="ui-monospace,monospace" font-size="10" font-weight="700">ORDER: CLASSIC</text>
  <rect x="18" y="45" width="19" height="9" rx="4" fill="#f6c66b"/>
  <rect x="43" y="45" width="19" height="9" rx="4" fill="#9a5b42"/>
  <path d="M68 45h20l-3 9H70z" fill="#facc15"/>
  <rect x="94" y="45" width="19" height="9" rx="4" fill="#f6c66b"/>
  <circle cx="27" cy="68" r="9" fill="none" stroke="#eef2ff" stroke-width="2"/>
  <text x="42" y="72" fill="#eef2ff" font-family="ui-monospace,monospace" font-size="9">NEXT: BUN</text>
  <!-- arm and conveyor, matching the game layout -->
  <rect x="112" y="108" width="205" height="22" rx="5" fill="#181f3a" stroke="#6e7a9c"/>
  <path d="M118 117h192" stroke="#7dd3fc" stroke-width="3" stroke-dasharray="14 8" opacity=".45"/>
  <rect x="145" y="101" width="30" height="14" rx="7" fill="#f6c66b" stroke="#0a0f1f"/>
  <polygon points="210,132 238,132 233,117 215,117" fill="#181f3a" stroke="#7dd3fc"/>
  <line x1="224" y1="119" x2="254" y2="66" stroke="#7dd3fc" stroke-width="9" stroke-linecap="round"/>
  <line x1="254" y1="66" x2="164" y2="101" stroke="#c4b5fd" stroke-width="7" stroke-linecap="round"/>
  <circle cx="254" cy="66" r="6" fill="#eef2ff" stroke="#0a0f1f"/>
  <path d="M157 94v13m14-13v13" stroke="#eef2ff" stroke-width="3"/>
  <!-- plate and completed stack -->
  <ellipse cx="365" cy="119" rx="43" ry="12" fill="#dbeafe22" stroke="#dbeafe" stroke-width="2"/>
  <rect x="347" y="101" width="36" height="11" rx="5" fill="#f6c66b" stroke="#0a0f1f"/>
  <rect x="349" y="92" width="32" height="10" rx="4" fill="#9a5b42" stroke="#0a0f1f"/>
  <path d="M348 91h34l-4-9h-26z" fill="#facc15" stroke="#0a0f1f"/>
  <rect x="347" y="72" width="36" height="11" rx="6" fill="#f6c66b" stroke="#0a0f1f"/>
  <!-- clear three-step flow -->
  <text x="137" y="22" fill="#5eead4" font-family="ui-monospace,monospace" font-size="10" font-weight="700">1 READ</text>
  <path d="M122 35h35" stroke="#5eead4" stroke-width="2"/>
  <text x="173" y="22" fill="#5eead4" font-family="ui-monospace,monospace" font-size="10" font-weight="700">2 CATCH</text>
  <path d="M224 35h48" stroke="#5eead4" stroke-width="2"/>
  <text x="284" y="22" fill="#5eead4" font-family="ui-monospace,monospace" font-size="10" font-weight="700">3 PLACE &amp; SERVE</text>
  <path d="M177 96 Q267 40 344 75" fill="none" stroke="#5eead4" stroke-width="2" stroke-dasharray="5 4"/>
  <!-- return loop: no food waste -->
  <path d="M310 135 Q210 145 120 133" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="215" y="137" text-anchor="middle" fill="#a78bfa" font-family="ui-monospace,monospace" font-size="8">MISSED FOOD RETURNS</text>
</svg>`,
  lessonModal: {
    title: {
      ja: "Robo Kitchen — 75秒のアーム料理バトル",
      en: "Robo Kitchen — a 75-second arm cooking battle",
    },
    learn: {
      ja: "注文カードのNEXTを読み、必要な食材を正しい順番で皿へ積みます。食材は必要な分だけ供給され、取り逃しても回収コンベアで戻るため廃棄されません。",
      en: "Read NEXT on the order card and stack each required ingredient in sequence. Only needed food is supplied, and missed items return on a closed-loop conveyor instead of being discarded.",
    },
    goal: {
      ja: "75秒で料理を5皿完成すると★3。取り逃しや皿以外で放した食材は回収ラインへ戻ります。素早く連続完成してコンボボーナスを狙おう!",
      en: "Complete five dishes in 75 seconds for ★3. Missed or misplaced ingredients return to the line. Serve dishes quickly and consecutively for combo bonuses!",
    },
    first: {
      ja: "マウスか矢印で手先を動かし、クリック・Enter・Pad Aで把持／解放します。PadではRBで肘の向きを切り替えられます。まず注文カードのNEXTと同じ食材をつかみ、中央の皿へ置きましょう。",
      en: "Move the tip with the mouse or arrows; click, press Enter, or use pad A to grab/release. Pad RB flips the elbow. Catch the ingredient shown as NEXT and place it on the centre plate.",
    },
  },
  strings: {
    ja: {
      "status.start": "キッチンOPEN — 最初の注文を確認!",
      "status.needed": "必要な {food} が来た!",
      "status.miss": "グリッパーを食材へ近づけよう",
      "status.layer": "いいぞ! 次は {food}",
      "status.served": "料理完成! {n}皿目 ・ COMBO x{combo}",
      "status.returned": "食材を回収ラインへ戻した — 廃棄なし",
      "status.looped": "取り逃した食材が回収ラインから戻ってきた",
      "status.timeup": "KITCHEN CLOSED!",
      hint: "マウス / 矢印: 手先 ・ クリック / Enter / Pad A: つかむ／放す ・ E / RB: 肘反転 ・ R: リスタート",
    },
    en: {
      "status.start": "Kitchen open — check the first order!",
      "status.needed": "Your {food} is here!",
      "status.miss": "Move the gripper closer to the ingredient",
      "status.layer": "Nice! Next: {food}",
      "status.served": "Dish served! #{n} · COMBO x{combo}",
      "status.returned": "Ingredient returned to the recovery line — zero waste",
      "status.looped": "Missed ingredient has returned on the recovery line",
      "status.timeup": "KITCHEN CLOSED!",
      hint: "mouse / arrows: tip · click / Enter / pad A: grab/release · E / RB: flip elbow · R: restart",
    },
  },
  build: makeRoboKitchen,
});
