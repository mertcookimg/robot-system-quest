// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import type { GameContext, Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { mountLabCompletion, mountLabWorkbench } from "../../lib/lab_completion";
import { onLangChange, tx } from "../../i18n";
import { clearBackground, drawRobotBody } from "../../lib/draw";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";
import {
  VLA_WIDTH,
  VLA_HEIGHT,
  VLA_SCENES,
  renderVlaImage,
  predictVla,
  stepVla,
  type VlaScene,
  type VlaInstruction,
  type VlaAction,
} from "../../lib/vla_model";
import "../../styles/29-vla-lab.css";

type Prediction = ReturnType<typeof predictVla>;
type RunRecord = {
  layout: number;
  instruction: VlaInstruction;
  initialImage: number[];
  firstAction: VlaAction;
  arrived: VlaInstruction | null;
  success: boolean;
  steps: number;
};
const copyScene = (s: VlaScene): VlaScene => ({
  robot: { ...s.robot },
  red: { ...s.red },
  blue: { ...s.blue },
});
const samePoint = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  a.x === b.x && a.y === b.y;
const sameImage = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
const instructionName = (instruction: VlaInstruction) =>
  instruction === "red" ? tx("赤い箱へ", "Go to red") : tx("青い箱へ", "Go to blue");
const colorName = (instruction: VlaInstruction | null) =>
  instruction === "red"
    ? tx("赤い箱", "Red box")
    : instruction === "blue"
      ? tx("青い箱", "Blue box")
      : tx("未到達", "Neither box");
const actionName = (action: VlaAction) =>
  ({
    up: tx("↑ 上へ", "↑ Up"),
    right: tx("→ 右へ", "→ Right"),
    down: tx("↓ 下へ", "↓ Down"),
    left: tx("← 左へ", "← Left"),
    stop: tx("■ 止まる", "■ Stop"),
  })[action];
const STEP_SECONDS = 0.32;
const MAX_STEPS = 20;

export function makeVlaLab(): Stage {
  let g: GameContext;
  let root: HTMLElement | undefined, dock: HTMLElement;
  let offLang = () => {};
  let restoreCompletion = () => {};
  let restoreWorkbench = () => {};
  let layout = 0;
  let instruction: VlaInstruction = "red";
  let scene = copyScene(VLA_SCENES[0]);
  let pixels = renderVlaImage(scene);
  let prediction: Prediction = predictVla(pixels, instruction);
  let running = false,
    paused = false,
    details = false,
    cleared = false;
  let completionActive = false;
  let elapsed = 0,
    steps = 0,
    clock = 0;
  let previousPosition = { ...scene.robot };
  let path = [{ ...scene.robot }];
  let firstAction: VlaAction = prediction.action;
  let initialImage = Array.from(pixels);
  let lastRun: RunRecord | undefined;
  let pair: [RunRecord, RunRecord] | undefined;
  let languageCompared = false,
    visionCompared = false;
  let changed: "none" | "language" | "vision" | "both" = "none";
  let note: "ready" | "stopped" | "done" = "ready";

  const el = <T extends HTMLElement = HTMLElement>(key: string) =>
    root!.querySelector<T>(`[data-vla="${key}"]`)!;
  function button(action: string, label: string, primary = false): string {
    return `<button type="button" data-action="${action}" class="vla-button${primary ? " vla-primary" : ""}">${label}</button>`;
  }
  function focus(action: string): void {
    root
      ?.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
      ?.focus({ preventScroll: true });
  }
  function observe(): void {
    pixels = renderVlaImage(scene);
    prediction = predictVla(pixels, instruction);
  }
  function prepare(): void {
    scene = copyScene(VLA_SCENES[layout]);
    previousPosition = { ...scene.robot };
    path = [{ ...scene.robot }];
    steps = 0;
    clock = 0;
    note = "ready";
    observe();
    if (!lastRun) changed = "none";
    else {
      const imageChanged = !sameImage(lastRun.initialImage, Array.from(pixels));
      const languageChanged = lastRun.instruction !== instruction;
      changed =
        imageChanged && languageChanged
          ? "both"
          : imageChanged
            ? "vision"
            : languageChanged
              ? "language"
              : "none";
    }
  }
  function build(): void {
    if (root) {
      unregisterOverlayPad(root);
      root.remove();
    }
    dock = document.getElementById("stage-controls-dock") ?? g.overlay;
    dock.hidden = false;
    root = document.createElement("section");
    root.className = "vla-lab";
    root.setAttribute("aria-label", tx("VLAミニラボ", "VLA Mini Lab"));
    root.innerHTML = `
      <h3>${tx("同じロボット、ことばを変えると？", "Same robot. What if the instruction changes?")}</h3>
      <p class="vla-intro">${tx("画像と指示を一緒に受け取り、次の動きを決めます。一つずつ変えて、動きを比べましょう。", "The model uses the image and instruction together to choose the next move. Change one input at a time and compare.")}</p>
      <div class="vla-flow">
        <section class="vla-card"><h4><span>V</span> ${tx("見ている画像", "Image")}</h4><div data-vla="image" class="vla-pixels" role="img" aria-label="${tx("AIに入力する7×5のRGB画像", "The 7 by 5 RGB image input to the model")}"></div><p>${tx("AIにはこの35マスが見えます。緑はロボットの位置。", "The model sees these 35 cells. Green marks the robot.")}</p></section>
        <section class="vla-card"><h4><span>L</span> ${tx("ことばの指示", "Instruction")}</h4><div class="vla-instructions" role="group" aria-label="${tx("行き先の指示", "Destination instruction")}">${button("red", tx("赤い箱へ", "Go to red"))}${button("blue", tx("青い箱へ", "Go to blue"))}</div><p>${tx("同じ画像でも、指示を変えると？", "Same image, different instruction?")}</p></section>
        <section class="vla-card"><h4><span>A</span> ${tx("次の動き", "Next action")}</h4><strong data-vla="action" class="vla-action"></strong><p>${tx("画像＋指示からモデルが予測した操作です。", "This action is predicted from the image and instruction.")}</p></section>
      </div>
      <p data-vla="change" class="vla-change"></p>
      <p data-vla="status" class="vla-status" role="status" aria-live="polite"></p>
      <div class="vla-actions">${button("run", tx("動かす", "Run"), true)}${button("pause", tx("一時停止", "Pause"))}${button("stop", tx("中止", "Stop"))}${button("next-language", tx("指示だけ変える", "Change only the instruction"), true)}${button("next-vision", tx("配置だけ変える", "Change only the layout"), true)}${button("finish", tx("Lessonを完了", "Complete lesson"), true)}${button("replay", tx("同じ条件でもう一度", "Replay the same inputs"))}</div>
      <section data-vla="results" class="vla-results" hidden><h4>${tx("どう変わった？", "What changed?")}</h4><div data-vla="records" class="vla-records"></div><p data-vla="insight" class="vla-insight"></p></section>
      <div class="vla-checks" aria-label="${tx("比べたこと", "Comparisons tried")}"><span data-vla="language-check"></span><span data-vla="vision-check"></span></div>
      <p class="vla-scope">${tx("事前学習済みの小型モデルです。「赤い箱へ」「青い箱へ」の2つの指示に対応します。", "A small pretrained model for two instructions: Go to red and Go to blue.")}</p>
      <div class="vla-utilities">${button("details", tx("詳しく見る", "More details"))}${button("reset", tx("最初から", "Start over"))}</div>
      <section data-vla="details" id="vla-details" class="vla-details" hidden>
        <h4>${tx("画像と言葉の役割を分けて確かめる", "Check the roles of images and instructions")}</h4>
        <p>${tx("毎回、ロボットは中央の同じ位置から始めます。「指示だけ変える」では開始画像を同じにし、「配置だけ変える」では指示を同じにします。両方を変えた結果は、どちらの効果か分からないため比較の達成には数えません。", "Every run starts from the same center position. Change only the instruction keeps the initial image fixed; Change only the layout keeps the instruction fixed. Changing both cannot isolate either effect and does not count toward these comparisons.")}</p>
        <div class="vla-actions">${button("layout", tx("別の配置を試す", "Try another layout"))}</div>
        <p>${tx("Vには7×5のRGB画素を入力します。赤い成分は赤箱、青い成分は青箱、緑の成分はロボットです。同じマスでは色が重なります。左の大きな盤面は人が見る表示で、Vの簡略画像が実際の入力です。", "V contains 7 by 5 RGB pixels: red for the red box, blue for the blue box, and green for the robot. Colors combine when they overlap. The large board is for people; the simplified V image is the actual model input.")}</p>
        <p>${tx("モデルには画素と2種類の指示コードだけを渡し、箱の座標や正解経路は渡しません。合成したお手本操作から事前に模倣学習した重みを使い、実行中は学習しません。成功は指定した箱の位置への実到達で判定します。", "The model receives only pixels and one of two instruction codes, not object coordinates or a correct route. Its frozen weights were trained by imitation of synthetic demonstrations. Execution does not train it. Success requires actually reaching the requested box.")}</p>
        <p>${tx("VLAは画像・言葉から動作を出す構成、模倣学習・強化学習は動作を学ぶ方法です。このLessonは限定された教材モデルで、OpenVLAそのものや自由な文章を理解する汎用モデルではありません。", "VLA describes image-and-language inputs with action outputs; imitation and reinforcement learning are ways to learn actions. This is a restricted teaching model, not OpenVLA or a general language-understanding model.")}</p>
        <p>${tx("Tab / Enterで操作。ゲームパッドはAで設定へ。Rで最初からやり直します。Lessonを離れると実験の記録は消えます。", "Use Tab / Enter. Gamepad A opens controls. R starts over. Experiment records are cleared when leaving the lesson.")}</p>
      </section>`;
    for (let i = 0; i < VLA_WIDTH * VLA_HEIGHT; i++) {
      const pixel = document.createElement("span");
      pixel.setAttribute("aria-hidden", "true");
      el("image").append(pixel);
    }
    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (target && !target.disabled) act(target.dataset.action!);
    });
    dock.replaceChildren(root);
    registerOverlayPad(root, false);
    renderResults();
    refresh();
  }
  function refresh(): void {
    if (!root) return;
    root.inert = completionActive;
    Array.from(el("image").children).forEach((cell, i) => {
      (cell as HTMLElement).style.backgroundColor =
        `rgb(${Math.round(pixels[i * 3] * 255)}, ${Math.round(pixels[i * 3 + 1] * 255)}, ${Math.round(pixels[i * 3 + 2] * 255)})`;
    });
    el("action").textContent = actionName(prediction.action);
    el("action").dataset.action = prediction.action;
    for (const command of ["red", "blue"] as const) {
      const b = root.querySelector<HTMLButtonElement>(`button[data-action="${command}"]`)!;
      b.setAttribute("aria-pressed", String(instruction === command));
      b.disabled = running || cleared;
    }
    const changeText =
      changed === "language"
        ? tx(
            "変えたもの：指示だけ ／ 開始画像は同じ",
            "Changed: instruction only / Same starting image",
          )
        : changed === "vision"
          ? tx("変えたもの：配置だけ ／ 指示は同じ", "Changed: layout only / Same instruction")
          : changed === "both"
            ? tx("画像と指示の両方を変更しています。", "Both the image and instruction changed.")
            : "";
    el("change").textContent = changeText;
    el("change").hidden = !changeText;
    let status = cleared
      ? tx(
          "Lesson完了。結果を見返すか、「最初から」で再開できます。",
          "Lesson complete. Review the results or choose Start over.",
        )
      : paused
        ? tx(
            "一時停止中。画像と次の動きを見てみましょう。",
            "Paused. Inspect the image and next action.",
          )
        : running
          ? tx(
              `${instructionName(instruction)}：画像を見直しながら移動中`,
              `${instructionName(instruction)}: moving and observing again`,
            )
          : note === "stopped"
            ? tx(
                "中止しました。「動かす」で同じ開始位置から試せます。",
                "Stopped. Run again from the same starting position.",
              )
            : note === "done"
              ? languageCompared && visionCompared
                ? tx(
                    "画像と言葉、両方の役割を比べられました。",
                    "You compared the roles of both images and instructions.",
                  )
                : !languageCompared
                  ? tx(
                      "次は同じ画像で、指示だけ変えてみましょう。",
                      "Next, keep the image and change only the instruction.",
                    )
                  : tx(
                      "次は同じ指示で、配置だけ変えてみましょう。",
                      "Next, keep the instruction and change only the layout.",
                    )
              : tx(
                  `「${instructionName(instruction)}」で動かしてみましょう。`,
                  `Try running with “${instructionName(instruction)}”.`,
                );
    if (el("status").textContent !== status) el("status").textContent = status;
    const visibility: Record<string, boolean> = {
      run: !cleared && !running && note !== "done",
      replay: !cleared && !running && note === "done",
      pause: running,
      stop: running,
      "next-language": !running && !!lastRun && note === "done" && !languageCompared,
      "next-vision":
        !running && !!lastRun && note === "done" && languageCompared && !visionCompared,
      finish: !cleared && !running && languageCompared && visionCompared,
      reset: !running,
    };
    for (const [action, show] of Object.entries(visibility))
      root.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)!.hidden = !show;
    root.querySelector<HTMLButtonElement>('button[data-action="pause"]')!.textContent = paused
      ? tx("再開", "Resume")
      : tx("一時停止", "Pause");
    root.querySelector<HTMLButtonElement>('button[data-action="layout"]')!.disabled =
      running || cleared;
    el("details").hidden = !details;
    root
      .querySelector('button[data-action="details"]')!
      .setAttribute("aria-expanded", String(details));
    root
      .querySelector('button[data-action="details"]')!
      .setAttribute("aria-controls", "vla-details");
    el("results").hidden = !lastRun || running || note !== "done";
    el("language-check").textContent =
      `${languageCompared ? "✓" : "○"} ${tx("指示だけ変更", "Instruction only")}`;
    el("vision-check").textContent =
      `${visionCompared ? "✓" : "○"} ${tx("配置だけ変更", "Layout only")}`;
    g.setStatus(status);
    g.setHud([
      "Vision + Language → Action",
      instructionName(instruction),
      `${tx("次の動き", "Next action")}: ${actionName(prediction.action)}`,
      `${tx("操作回数", "Moves")}: ${steps}`,
    ]);
  }
  function renderResults(): void {
    if (!root) return;
    el("records").replaceChildren();
    if (!lastRun) return;
    const records = pair ?? [lastRun];
    records.forEach((record, i) => {
      const item = document.createElement("article");
      const title = pair
        ? i
          ? tx("今回", "Now")
          : tx("前回", "Before")
        : tx("今回の結果", "Result");
      item.innerHTML = `<h4>${title} · ${instructionName(record.instruction)}</h4><p>${tx("最初の動き", "First move")}: <strong>${actionName(record.firstAction)}</strong></p><p>${tx("到達", "Reached")}: <strong>${colorName(record.arrived)}</strong> ${record.success ? "✓" : ""}</p>`;
      const snapshot = document.createElement("div");
      snapshot.className = "vla-pixels vla-record-image";
      snapshot.setAttribute("role", "img");
      snapshot.setAttribute(
        "aria-label",
        tx("この走行の開始時に入力した画像", "Image input at the start of this run"),
      );
      for (let pixel = 0; pixel < VLA_WIDTH * VLA_HEIGHT; pixel++) {
        const cell = document.createElement("span");
        cell.style.backgroundColor = `rgb(${record.initialImage[pixel * 3] * 255}, ${record.initialImage[pixel * 3 + 1] * 255}, ${record.initialImage[pixel * 3 + 2] * 255})`;
        snapshot.append(cell);
      }
      const caption = document.createElement("p");
      caption.className = "vla-record-caption";
      caption.textContent = tx("開始時の画像", "Starting image");
      item.append(snapshot, caption);
      el("records").append(item);
    });
    if (pair) {
      const [a, b] = pair;
      el("insight").textContent =
        sameImage(a.initialImage, b.initialImage) && a.instruction !== b.instruction
          ? tx(
              "画像が同じでも、指示を変えると選ぶ対象が変わります。上の2回の結果を比べましょう。",
              "The instruction selects the target even when the image stays the same. Compare the two results above.",
            )
          : a.instruction === b.instruction && !sameImage(a.initialImage, b.initialImage)
            ? tx(
                "指示が同じでも、箱の位置が変わると進む方向が変わります。画像も行動を決める入力です。",
                "The same instruction can require a different direction when the boxes move. The image also determines the action.",
              )
            : sameImage(a.initialImage, b.initialImage) && a.instruction === b.instruction
              ? tx(
                  "同じ画像・同じ指示で、もう一度試した結果です。",
                  "This repeats the same image and the same instruction.",
                )
              : tx(
                  "今回は画像と指示を一緒に変えたので、どちらの効果かは分けられません。",
                  "Both inputs changed, so their effects cannot be separated in this comparison.",
                );
    } else
      el("insight").textContent = tx(
        "指示に合った箱へ到達したかを確認しましょう。",
        "Check whether it reached the requested box.",
      );
    if (!lastRun.success)
      el("insight").textContent += tx(
        " 今回は指定の箱へ到達しませんでした。この結果もそのまま比べます。",
        " This run did not reach the requested box. The result is kept as observed.",
      );
  }
  function completeRun(): void {
    running = false;
    paused = false;
    note = "done";
    const arrived = samePoint(scene.robot, scene.red)
      ? "red"
      : samePoint(scene.robot, scene.blue)
        ? "blue"
        : null;
    const record: RunRecord = {
      layout,
      instruction,
      initialImage: [...initialImage],
      firstAction,
      arrived,
      success: samePoint(scene.robot, scene[instruction]),
      steps,
    };
    pair = lastRun ? [lastRun, record] : undefined;
    if (lastRun) {
      if (
        sameImage(lastRun.initialImage, record.initialImage) &&
        lastRun.instruction !== record.instruction
      )
        languageCompared = true;
      if (
        !sameImage(lastRun.initialImage, record.initialImage) &&
        lastRun.instruction === record.instruction
      )
        visionCompared = true;
    }
    lastRun = record;
    renderResults();
    refresh();
    focus(!languageCompared ? "next-language" : !visionCompared ? "next-vision" : "finish");
  }
  function onCompletionClose(event: Event): void {
    if (!cleared) return;
    completionActive = false;
    refresh();
    const reason = (event as CustomEvent<{ reason: string }>).detail.reason;
    if (reason === "dismiss" || reason === "next") focus("reset");
  }
  function act(action: string): void {
    if (completionActive || (cleared && !["details", "reset"].includes(action))) return;
    if (action === "details") {
      details = !details;
      refresh();
      return;
    }
    if (action === "pause" && running) {
      paused = !paused;
      refresh();
      return;
    }
    if (action === "stop" && running) {
      running = false;
      paused = false;
      note = "stopped";
      refresh();
      focus("run");
      return;
    }
    if (running) return;
    if (action === "red" || action === "blue") {
      instruction = action;
      prepare();
    } else if (action === "layout" || action === "next-vision") {
      layout = (layout + 1) % VLA_SCENES.length;
      prepare();
    } else if (action === "next-language") {
      instruction = instruction === "red" ? "blue" : "red";
      prepare();
    } else if (action === "run" || action === "replay") {
      prepare();
      initialImage = Array.from(pixels);
      firstAction = prediction.action;
      running = true;
      paused = false;
      clock = 0;
    } else if (action === "reset") {
      (g.resetStage ?? reset)();
      focus("run");
      return;
    } else if (action === "finish" && languageCompared && visionCompared) {
      cleared = true;
      completionActive = true;
      details = false;
      g.awardStars(
        3,
        tx(
          "画像と指示を一つずつ変えて、動きの違いを確かめました。",
          "Changed image and instruction one at a time and compared the resulting actions.",
        ),
        0,
      );
    }
    refresh();
    if (action === "run" || action === "replay") {
      focus("pause");
    }
    if (action === "next-language" || action === "next-vision") focus("run");
  }
  function reset(): void {
    layout = 0;
    instruction = "red";
    running = false;
    paused = false;
    details = false;
    cleared = false;
    completionActive = false;
    elapsed = 0;
    lastRun = undefined;
    pair = undefined;
    languageCompared = false;
    visionCompared = false;
    prepare();
    build();
  }
  function pauseOnBlur(): void {
    if (running) {
      paused = true;
      refresh();
    }
  }
  function visibility(): void {
    if (document.hidden) pauseOnBlur();
  }
  function update(dt: number): void {
    if (cleared) return;
    if (!paused) elapsed += dt;
    if (!running || paused) return;
    clock += Math.min(dt, 0.1);
    if (clock < STEP_SECONDS) return;
    clock -= STEP_SECONDS;
    const action = prediction.action;
    previousPosition = { ...scene.robot };
    const transition = stepVla(scene, action, instruction);
    scene = transition.scene;
    steps++;
    path.push({ ...scene.robot });
    observe();
    const completed = transition.atTarget || action === "stop" || steps >= MAX_STEPS;
    g.publish(
      "/vla/action",
      `data: ${JSON.stringify(`instruction=${instruction} action=${action} step=${steps} at_target=${transition.atTarget} completed=${completed}`)}`,
    );
    if (completed) completeRun();
    else refresh();
  }
  function canvasText(value: string, x: number, y: number, size = 22, color = "#eef2ff"): void {
    const c = g.ctx;
    c.fillStyle = color;
    c.font = `600 ${size}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.fillText(value, x, y);
  }
  function draw(): void {
    const c = g.ctx;
    clearBackground(c);
    canvasText(
      instructionName(instruction),
      400,
      45,
      30,
      instruction === "red" ? "#fca5a5" : "#93c5fd",
    );
    const cell = 64,
      left = 176,
      top = 83;
    for (let row = 0; row < VLA_HEIGHT; row++)
      for (let col = 0; col < VLA_WIDTH; col++) {
        c.fillStyle = "#101b2e";
        c.fillRect(left + col * cell + 1, top + row * cell + 1, cell - 2, cell - 2);
      }
    for (const color of ["red", "blue"] as const) {
      const p = scene[color],
        x = left + (p.x + 0.5) * cell,
        y = top + (p.y + 0.5) * cell;
      c.fillStyle = color === "red" ? "#b93745" : "#285bc7";
      c.fillRect(x - 22, y - 22, 44, 44);
      c.strokeStyle = color === instruction ? "#f8fafc" : "#60718f";
      c.lineWidth = color === instruction ? 3 : 1;
      c.strokeRect(x - 24, y - 24, 48, 48);
      canvasText(color === "red" ? "R" : "B", x, y + 8, 25, "#fff");
    }
    c.strokeStyle = "#7dd3fc";
    c.lineWidth = 3;
    c.beginPath();
    path.forEach((p, i) => {
      const x = left + (p.x + 0.5) * cell,
        y = top + (p.y + 0.5) * cell;
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    });
    c.stroke();
    // Render the same discrete position encoded in V, including while paused.
    // An animation lag here would make the robot disagree with its input image.
    const rx = scene.robot.x;
    const ry = scene.robot.y;
    const dx = scene.robot.x - previousPosition.x,
      dy = scene.robot.y - previousPosition.y;
    c.save();
    c.translate(left + (rx + 0.5) * cell, top + (ry + 0.5) * cell);
    c.rotate(dx || dy ? Math.atan2(dy, dx) : 0);
    c.scale(1.8, 1.8);
    drawRobotBody(c, 0, elapsed);
    c.restore();
    canvasText(
      `${tx("画像", "Image")} + ${tx("指示", "Instruction")} → ${actionName(prediction.action)}`,
      400,
      449,
      25,
    );
    canvasText(
      tx(
        "下の V・L・A で、入力と動きを見比べよう",
        "Compare the inputs and action in V · L · A below",
      ),
      400,
      482,
      18,
      "#9aaecb",
    );
    if (paused) {
      c.fillStyle = "rgba(5,12,25,.8)";
      c.fillRect(250, 206, 300, 65);
      canvasText(tx("一時停止中", "Paused"), 400, 249, 28);
    }
  }
  return {
    id: "vla_lab",
    name: "VLA Mini Lab",
    lesson: "Vision + Language → Action",
    lessonCmd: "",
    get ros2() {
      return {
        title: tx("VLAミニラボ", "VLA Mini Lab"),
        summary: tx(
          "ブラウザ内の疑似ノードから、実行した動作・指示・到達判定を記録します。topic echoは直近の記録を表示します。実際のROS 2プロセスや実機には接続しません。",
          "A simulated browser node records executed actions, instructions and target arrival. Topic echo displays recent log snapshots; it does not connect to ROS 2 processes or physical hardware.",
        ),
        msgTypes: ["std_msgs/msg/String"],
        cli: [
          "ros2 topic echo /vla/action",
          "ros2 topic list -t",
          "ros2 topic info /vla/action",
          "ros2 topic type /vla/action",
          "ros2 node list",
          "ros2 node info /vla_policy",
          "ros2 interface show std_msgs/msg/String",
        ],
        realWorld: tx(
          "動作の指令と環境での結果を別々に確認するための診断ログです。VLAの入力画像そのものをROS画像トピックとして配信する実装ではありません。",
          "Diagnostic logs distinguish a chosen action from its observed outcome. This lesson does not publish its input pixels as a ROS image topic.",
        ),
        state: {
          nodes: ["/vla_policy"],
          topics: [
            { name: "/vla/action", type: "std_msgs/msg/String", pub: ["/vla_policy"], sub: [] },
          ],
          services: [],
        },
      };
    },
    init(ctx) {
      g = ctx;
      restoreWorkbench = mountLabWorkbench(g.canvas);
      reset();
      restoreCompletion = mountLabCompletion(onCompletionClose);
      offLang = onLangChange(build);
      window.addEventListener("blur", pauseOnBlur);
      document.addEventListener("visibilitychange", visibility);
    },
    update,
    draw,
    reset,
    dispose() {
      offLang();
      restoreCompletion();
      restoreWorkbench();
      window.removeEventListener("blur", pauseOnBlur);
      document.removeEventListener("visibilitychange", visibility);
      if (root) {
        unregisterOverlayPad(root);
        root.remove();
        root = undefined;
      }
      if (dock) dock.hidden = true;
    },
  };
}

export default defineStage({
  mode: "lesson",
  order: 23,
  build: makeVlaLab,
  lessonModal: {
    title: { ja: "VLAミニラボ", en: "VLA Mini Lab" },
    learn: {
      ja: "ロボットは画像と「赤い箱へ／青い箱へ」を一緒に受け取り、次の動きを決めます。",
      en: "The robot uses the image together with Go to red or Go to blue to decide its next move.",
    },
    goal: {
      ja: "指示だけ、配置だけを変えて、動きの違いを確かめます。",
      en: "Change only the instruction, then only the layout, and compare the actions.",
    },
    first: {
      ja: "「動かす」で赤い箱へ。そのあと「指示だけ変える」を試します。",
      en: "Choose Run to go to red, then try Change only the instruction.",
    },
  },
  diagram: `<svg viewBox="0 0 420 100" role="img" aria-label="画像＋指示から動作を出す / Image plus instruction produces action"><g fill="#15243b" stroke="#7dd3fc"><rect x="5" y="15" width="115" height="65" rx="8"/><rect x="152" y="15" width="115" height="65" rx="8"/><rect x="300" y="15" width="115" height="65" rx="8"/></g><g fill="#e0f2fe" font-family="system-ui" font-size="13" text-anchor="middle"><text x="62" y="42">V · 画像</text><text x="62" y="64">Vision</text><text x="136" y="53">＋</text><text x="210" y="42">L · 指示</text><text x="210" y="64">Language</text><text x="284" y="53">→</text><text x="357" y="42">A · 動作</text><text x="357" y="64">Action</text></g></svg>`,
});
