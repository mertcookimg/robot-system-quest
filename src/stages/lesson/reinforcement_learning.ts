// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import type { GameContext, Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { mountLabCompletion, mountLabWorkbench } from "../../lib/lab_completion";
import { onLangChange, tx } from "../../i18n";
import { clearBackground, drawRobotBody } from "../../lib/draw";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";
import {
  RL_WIDTH,
  RL_HEIGHT,
  RL_STARTS,
  RL_GOAL,
  RL_WALLS,
  RL_BONUS,
  RL_EPISODES,
  RL_MAX_STEPS,
  RL_ALPHA,
  RL_GAMMA,
  createReinforcementTrainer,
  evaluateReinforcement,
  type RewardPreset,
  type GridPosition,
} from "../../lib/reinforcement_model";
import "../../styles/28-reinforcement-learning.css";

type Trainer = ReturnType<typeof createReinforcementTrainer>;
type Policy = ReturnType<Trainer["snapshot"]>;
type Run = ReturnType<typeof evaluateReinforcement>;
type Model = {
  policy: Policy;
  history: Trainer["history"];
  example: Trainer["lastUpdate"];
  lastRun: Run | null;
};
type Comparison = { models: [Policy, Policy]; runs: [Run[], Run[]]; previous: boolean };
const TRAINING_EPISODES_PER_SECOND = 300;
const PREVIEW_MOVES = 16;
const PREVIEW_STEP_SECONDS = 0.18;
const same = (a: GridPosition, b: GridPosition) => a.x === b.x && a.y === b.y;
const presetName = (p: RewardPreset) =>
  p === "goal" ? tx("ゴール重視", "Goal reward") : tx("ボーナス追加", "Bonus reward");
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const actionName = (a: string) =>
  ({
    up: tx("↑ 上", "↑ Up"),
    right: tx("→ 右", "→ Right"),
    down: tx("↓ 下", "↓ Down"),
    left: tx("← 左", "← Left"),
  })[a] ?? a;

export function makeReinforcementLearning(): Stage {
  let g: GameContext;
  let root: HTMLElement | undefined;
  let dock: HTMLElement;
  let offLang = () => {};
  let restoreCompletion = () => {};
  let restoreWorkbench = () => {};
  let completionActive = false;
  let selected: RewardPreset = "goal";
  let current: Model | undefined, previous: Model | undefined;
  let trainer: Trainer | undefined;
  let trainingExample: Trainer["lastUpdate"] = null;
  let comparison: Comparison | undefined;
  let mode: "idle" | "training" | "compare" = "idle";
  let paused = false,
    cleared = false,
    details = false,
    settings = true;
  let evaluated = false;
  let trial = 0,
    frame = 0,
    clock = 0,
    uiClock = 0;
  let speed = 1;
  let reflection: boolean | undefined;
  let undo: (() => void) | undefined;
  let note: "" | "stopped" | "restored" = "";

  const busy = () => mode !== "idle";
  const dirty = () => !!current && current.policy.preset !== selected;
  const el = <T extends HTMLElement = HTMLElement>(name: string) =>
    root!.querySelector<T>(`[data-rl="${name}"]`)!;
  function button(action: string, text: string, primary = false): string {
    return `<button type="button" data-action="${action}" class="rl-button${primary ? " rl-primary" : ""}">${text}</button>`;
  }
  function focusAction(action: string): void {
    root
      ?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)
      ?.focus({ preventScroll: true });
  }
  function build(): void {
    if (root) {
      unregisterOverlayPad(root);
      root.remove();
    }
    dock = document.getElementById("stage-controls-dock") ?? g.overlay;
    dock.hidden = false;
    root = document.createElement("section");
    root.className = "reinforcement-lab";
    root.setAttribute("aria-label", tx("強化学習ミニラボ", "Reinforcement Learning Mini Lab"));
    root.innerHTML = `
      <ol class="rl-workflow" aria-label="${tx("実験の進み方", "Experiment steps")}"><li>1 ${tx("ごほうび", "Reward")}</li><li>2 ${tx("学習", "Learn")}</li><li>3 ${tx("動きを見る", "Watch")}</li></ol>
      <h3>${tx("ごほうびで、ロボットにゴールを教えよう", "Teach the robot to reach the goal with rewards")}</h3>
      <p class="rl-intro">${tx("ロボットは自分で動いて、点数がもらえる行動を覚えます。この「ごほうび」を使った学び方が強化学習です。", "The robot tries moving and learns which actions earn points. Learning from these rewards is called reinforcement learning.")}</p>
      <div data-rl="settings" class="rl-section">
        <h4>${tx("どこでごほうびをあげる？", "Where should it earn rewards?")}</h4>
        <div class="rl-choice" role="group" aria-label="${tx("報酬の設定", "Reward setting")}">
          ${button("goal", `<strong>${tx("ゴールで +10", "+10 at the goal")}</strong><span>${tx("まずはこちら", "Start here")}</span>`)}${button("bonus", `<strong>${tx("★ の寄り道にも +2", "+2 at the star, too")}</strong><span>${tx("何度でももらえる", "Every visit earns points")}</span>`)}
        </div>
        <p data-rl="rule" class="rl-rule"></p>
      </div>
      <p data-rl="status" class="rl-status" role="status" aria-live="polite"></p>
      <div data-rl="live-comparison" class="rl-live" hidden></div>
      <div data-rl="progress-area" class="rl-section" hidden>
        <label for="rl-progress" data-rl="progress-label"></label>
        <progress id="rl-progress" data-rl="progress" max="${RL_EPISODES}" value="0"></progress>
        <p class="rl-muted">${tx("いろいろな動きを試しています。画面は直近の練習のようすです。", "Trying different moves. The map shows the latest practice run.")}</p>
      </div>
      <div class="rl-actions">
        ${button("train", tx("学習する（約2秒）", "Learn (about 2 sec)"), true)}
        ${button("compare", tx("動きを見る", "Watch the robots"), true)}
        ${button("show-results", tx("再生を終えて結果を見る", "Skip to results"))}
        ${button("cancel-change", tx("変更をやめて結果に戻る", "Cancel change and return"))}
        ${button("pause", tx("一時停止", "Pause"))}
        ${button("stop", tx("中止", "Stop"))}
        <label data-rl="speed-control">${tx("再生速度", "Playback speed")} <select data-rl="speed" aria-label="${tx("再生速度", "Playback speed")}"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>
      </div>
      <div data-rl="results" class="rl-section" hidden>
        <h4>${tx("ゴールに着けるようになった？", "Can it reach the goal now?")}</h4>
        <p class="rl-muted">${tx("同じ3つのスタート位置で確認した結果です。", "Results from the same three starting positions.")}</p>
        <div data-rl="cards" class="rl-results"></div>
        <p data-rl="result-note" class="rl-callout"></p>
        <p class="rl-muted">${tx("ここで基本Lessonは完了です。発展：ごほうびを変えて、もう一度比べられます。", "The core lesson is complete here. Optional: change the reward and compare again.")}</p>
        <div class="rl-actions">${button("finish", tx("Lessonを完了", "Complete lesson"), true)}${button("change", tx("発展：★にもごほうび", "Optional: reward the star"))}</div>
      </div>
      <div class="rl-utilities">${button("details", tx("詳しく見る", "More details"))}${button("reset", tx("やり直す", "Reset experiment"))}${button("undo", tx("リセットを取り消す", "Undo reset"))}</div>
      <div data-rl="details" id="rl-details" class="rl-section" hidden>
        <div data-rl="replay-options" hidden>
          <h4>${tx("別のスタート位置の動き", "Watch another starting position")}</h4>
          <div class="rl-actions">${button("case-0", tx("上から", "Top"))}${button("case-1", tx("真ん中から", "Middle"))}${button("case-2", tx("下から", "Bottom"))}${button("replay", tx("もう一度見る", "Replay comparison"))}</div>
        </div>
        <div data-rl="learning" class="rl-section" hidden>
          <h4>${tx("学習の記録", "Learning records")}</h4>
          <p data-rl="learning-summary"></p>
          <div data-rl="chart" class="rl-chart"></div>
          <p class="rl-muted">${tx("横軸：試行回数／縦軸：25試行ごとの平均報酬合計。探索ありの学習記録で、ゴール成功率ではありません。", "Horizontal: trials. Vertical: mean reward total per 25 trials. These are exploratory training records, not a goal success rate.")}</p>
          <p data-rl="example" class="rl-example"></p>
        </div>
        <p>${tx("灰色は壁、旗はゴール、★は寄り道地点です。詳細を開くと、各マスで選ぶ行動を矢印で表示します。座標は左から列・上から行を1から数えます。", "Gray cells are walls, the flag is the goal, and the star is a detour. With details open, arrows show the action chosen in each cell. Coordinates count columns and rows from 1.")}</p>
        <p>${tx("ゴール +10、1手 −0.1、壁・外周への衝突はさらに −1。ボーナス追加では★に入るたび +2です。", "Goal +10, each move −0.1, wall or boundary collision an extra −1. Bonus reward adds +2 each time the robot enters the star.")}</p>
        <p>${tx("評価は3地点それぞれゴールか80手まで計算済みです。動画は選んだ1地点の最初の16手までを抜粋します。比較中は探索も学習も行いません。学習にも使う同じマップなので、未知の場所での成功は示しません。", "Evaluation is already computed for all three starts, up to the goal or 80 moves each. Playback shows only the first 16 moves of one selected start. No exploration or learning occurs during evaluation. This is the training map, not evidence of success in unseen places.")}</p>
        <p data-rl="score-note"></p>
        <div data-rl="run-details"></div>
        <div data-rl="reflection-area" hidden>
        <div class="rl-reflection">
          <h4>${tx("振り返り：報酬が高ければ、必ずゴールできる？", "Reflect: does a high reward guarantee reaching the goal?")}</h4>
          <div class="rl-actions">${button("always", tx("必ずできる", "Always"))}${button("depends", tx("報酬の付け方による", "It depends on the reward"))}</div>
          <p data-rl="reflection" aria-live="polite"></p>
        </div>
        </div>
        <p>${tx("毎回すべてのQ値を0に戻し、同じ乱数seedから学習します。学習前の比較では、全行動が同じ値なので同点ルールで「上」を選びます。", "Every fit resets all Q values to zero and uses the same random seed. Before training, equal Q values use a fixed tie rule that selects Up.")}</p>
        <p>${tx("状況はマスの位置、行動は上下左右。Q値は、その行動から先にもらえる割引累積報酬の見積もりです。表形式のQ学習なので、ニューラルネットや正解の操作列は使いません。", "The state is the grid position and actions are four directions. Q estimates discounted future rewards from an action. This is tabular Q-learning: no neural network or correct action sequence is supplied.")}</p>
        <p class="rl-formula">Q(s,a) ← Q(s,a) + ${RL_ALPHA} [r + ${RL_GAMMA} max Q(s′,a′) − Q(s,a)]</p>
        <p>${tx("ゴール到達後の将来価値は0。80手の打切りはゴールとは区別します。報酬合計の表示は割引なしで、Q値そのものではありません。600回で最適な行動を保証するものでもありません。", "Future value is zero after reaching the goal. The 80-move cutoff is separate from a goal terminal. Displayed reward totals are undiscounted, not Q values. 600 trials do not guarantee an optimal policy.")}</p>
        <p data-rl="q-update"></p>
        <p class="rl-input-help">${tx("Tab / Enterで操作。ゲームパッドはAで設定、方向キーで選択。Rは実験をリセット（取り消し可能）。このLessonを離れると学習モデルは消えます。", "Use Tab / Enter. Gamepad: A opens settings, directions select. R resets the experiment (undo available). Models are discarded when leaving this lesson.")}</p>
      </div>
      `;
    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (target && !target.disabled) act(target.dataset.action!);
    });
    el<HTMLSelectElement>("speed").value = String(speed);
    el("speed").addEventListener("change", () => {
      speed = Number(el<HTMLSelectElement>("speed").value);
    });
    dock.replaceChildren(root);
    registerOverlayPad(root, false);
    renderEvidence();
    renderResults();
    refresh();
  }
  function refresh(): void {
    if (!root) return;
    root.inert = completionActive;
    const active = busy();
    el("settings").hidden = !settings;
    for (const p of ["goal", "bonus"] as const) {
      const b = root.querySelector<HTMLButtonElement>(`[data-action="${p}"]`)!;
      b.setAttribute("aria-pressed", String(selected === p));
      b.disabled = active || cleared;
    }
    el("rule").textContent =
      selected === "bonus"
        ? tx(
            "ゴールに加えて、★へ行くたびにもごほうび。どんな動きになるでしょう？",
            "Reward the star on every visit as well as the goal. What will the robot do?",
          )
        : tx(
            "旗のゴールに着いたら、ごほうびをあげます。",
            "Give a reward when it reaches the flag.",
          );
    const status = cleared
      ? tx(
          "Lesson完了。結果を見返すか、「やり直す」で再開できます。",
          "Lesson complete. Review the results or reset the experiment.",
        )
      : (note === "stopped"
          ? tx(
              "中止しました。途中の学習は保存せず、最後に学習を完了したモデルを保持しています。",
              "Stopped. Partial training was discarded; the last completed model is retained.",
            )
          : note === "restored"
            ? tx(
                "完了済みの学習と比較を復元しました。",
                "Restored completed training and comparison.",
              )
            : "") ||
        (mode === "training"
          ? tx("ごほうびがもらえる動きを練習中…", "Practicing moves that earn rewards…")
          : mode === "compare"
            ? tx(
                "動きを短く再生しています。3地点の結果は下に表示済みです。",
                "Playing a short preview. Results for all 3 starts are already shown below.",
              )
            : dirty()
              ? tx(
                  "ごほうびを変えました。もう一度「学習する」を押しましょう。",
                  "Reward changed. Press Learn to try it.",
                )
              : current && !evaluated
                ? tx(
                    "学習できました。「動きを見る」で確かめましょう。",
                    "Learning complete. Watch the robots to see what changed.",
                  )
                : evaluated
                  ? tx(
                      "結果が出ました。ごほうびを変える実験もできます。",
                      "Results are ready. You can also try changing the reward.",
                    )
                  : tx(
                      "「学習する」を押すと、ロボットが自分で練習します。",
                      "Press Learn and the robot will practice on its own.",
                    ));
    const statusText = paused
      ? tx("一時停止中。続きから再開できます。", "Paused. Resume to continue.")
      : status;
    if (el("status").textContent !== statusText) el("status").textContent = statusText;
    el("progress-area").hidden = mode !== "training";
    el<HTMLProgressElement>("progress").value = trainer?.episode ?? 0;
    el("progress-label").textContent = tx(
      `練習中 ${Math.round((100 * (trainer?.episode ?? 0)) / RL_EPISODES)}%`,
      `Practicing ${Math.round((100 * (trainer?.episode ?? 0)) / RL_EPISODES)}%`,
    );
    el("speed-control").hidden = mode !== "compare";
    el("live-comparison").hidden = !comparison || mode === "training" || dirty();
    if (comparison && mode !== "training" && !dirty()) {
      el("live-comparison").replaceChildren();
      const caption = document.createElement("p");
      caption.className = "rl-muted";
      caption.textContent = tx(
        `再生：スタート${trial + 1}の最初の${previewLength()}手まで（続きは省略）。結果は3地点・各${RL_MAX_STEPS}手まで確認済みです。`,
        `Preview: first ${previewLength()} moves of start ${trial + 1}; the rest is omitted. Results cover all 3 starts, up to ${RL_MAX_STEPS} moves each.`,
      );
      el("live-comparison").append(caption);
      comparison.runs.forEach((runs, i) => {
        const run = runs[trial];
        const count = Math.min(frame, run.steps);
        const line = document.createElement("p");
        line.textContent =
          `${label(i)}: ${count}${tx("手", " moves")} / ` +
          (count >= run.steps
            ? run.success
              ? tx("ゴール到達", "Goal reached")
              : tx("打切り", "Move limit")
            : mode === "idle"
              ? tx("続きは省略", "Rest omitted")
              : tx("移動中", "Moving"));
        el("live-comparison").append(line);
      });
    }
    const hasResults = !!comparison && evaluated && mode !== "training" && !dirty();
    el("run-details").hidden = !hasResults;
    el("score-note").hidden = !hasResults;
    el("reflection-area").hidden = !hasResults;
    el("replay-options").hidden = !hasResults || cleared;
    for (let i = 0; i < RL_STARTS.length; i++) {
      root
        .querySelector(`[data-action="case-${i}"]`)!
        .setAttribute("aria-pressed", String(trial === i));
    }
    const visibility: Record<string, boolean> = {
      train: !cleared && !active && (!current || dirty() || settings),
      compare: !active && !!current && !dirty() && !evaluated,
      "cancel-change": !active && !!current && settings,
      pause: active,
      stop: mode === "training",
      "show-results": mode === "compare",
      undo: !cleared && !active && !!undo,
      reset: !active,
    };
    for (const [action, visible] of Object.entries(visibility))
      root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.hidden = !visible;
    for (const action of ["change", "finish"])
      root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.hidden = cleared;
    root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.textContent = paused
      ? tx("再開する", "Resume")
      : tx("一時停止", "Pause");
    root.querySelector<HTMLButtonElement>('[data-action="change"]')!.textContent =
      current?.policy.preset === "bonus"
        ? tx("発展：ゴールだけに戻す", "Optional: reward only the goal")
        : tx("発展：★にもごほうび", "Optional: reward the star");
    el("results").hidden = !hasResults;
    el("learning").hidden = !current && !trainer;
    el("details").hidden = !details;
    const detailButton = root.querySelector<HTMLButtonElement>('[data-action="details"]')!;
    detailButton.setAttribute("aria-expanded", String(details));
    detailButton.setAttribute("aria-controls", "rl-details");
    for (const [i, li] of Array.from(root.querySelectorAll(".rl-workflow li")).entries()) {
      if (
        i ===
        (active
          ? mode === "training"
            ? 1
            : 2
          : evaluated && !dirty()
            ? 2
            : current && !dirty()
              ? 1
              : 0)
      )
        li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    }
    g.setStatus(el("status").textContent ?? "");
    g.setHud([
      tx("強化学習 / Q-learning", "Reinforcement / Q-learning"),
      `${tx("報酬", "Reward")}: ${presetName(trainer ? selected : (current?.policy.preset ?? selected))}`,
      `${tx("試行", "Trials")}: ${trainer?.episode ?? current?.policy.episodes ?? 0}/${RL_EPISODES}`,
      tx("状態：位置 / 行動：上下左右", "State: position / Actions: 4 directions"),
    ]);
  }
  function renderEvidence(): void {
    if (!root) return;
    const history = trainer?.history ?? current?.history ?? [];
    const example = trainer ? (trainingExample ?? trainer.lastUpdate) : current?.example;
    el("learning-summary").textContent = tx(
      `${presetName(trainer ? selected : (current?.policy.preset ?? selected))}：${history.length}回の実際の試行から更新。探索中は、学んだ行動以外も試すため失敗することがあります。`,
      `${presetName(trainer ? selected : (current?.policy.preset ?? selected))}: updated from ${history.length} actual trials. Exploration can still fail by trying other actions.`,
    );
    const chart = el("chart");
    chart.replaceChildren();
    if (history.length) {
      const means: number[] = [];
      for (let i = 0; i < history.length; i += 25) {
        const batch = history.slice(i, i + 25);
        means.push(batch.reduce((sum, e) => sum + e.return, 0) / batch.length);
      }
      const min = Math.min(0, ...means),
        max = Math.max(1, ...means);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 640 128");
      svg.setAttribute("role", "img");
      svg.setAttribute(
        "aria-label",
        tx(
          `学習中の平均報酬。最初 ${means[0].toFixed(1)}、直近 ${means.at(-1)!.toFixed(1)}`,
          `Mean training reward: first ${means[0].toFixed(1)}, latest ${means.at(-1)!.toFixed(1)}`,
        ),
      );
      const line = document.createElementNS(svg.namespaceURI, "polyline");
      line.setAttribute(
        "points",
        means
          .map(
            (v, i) =>
              `${54 + (i * 570) / Math.max(1, Math.ceil(RL_EPISODES / 25) - 1)},${99 - (78 * (v - min)) / (max - min)}`,
          )
          .join(" "),
      );
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("stroke-width", "3");
      svg.append(line);
      for (const [x, y, value] of [
        [3, 24, max.toFixed(1)],
        [3, 99, min.toFixed(1)],
        [54, 123, "1"],
        [585, 123, String(RL_EPISODES)],
      ] as const) {
        const text = document.createElementNS(svg.namespaceURI, "text");
        text.setAttribute("x", String(x));
        text.setAttribute("y", String(y));
        text.setAttribute("fill", "currentColor");
        text.setAttribute("font-size", "16");
        text.textContent = value;
        svg.append(text);
      }
      chart.append(svg);
    }
    if (example) {
      const t = example.transition;
      el("example").textContent = tx(
        `学習の実例1件（${example.episode}回目）：位置 (${t.state.x + 1},${t.state.y + 1}) → ${actionName(t.action)} → 報酬 ${signed(t.reward)}。将来の報酬の見積もり（Q）は ${example.qBefore.toFixed(3)} → ${example.qAfter.toFixed(3)} に更新。`,
        `One actual update (trial ${example.episode}): position (${t.state.x + 1},${t.state.y + 1}) → ${actionName(t.action)} → reward ${signed(t.reward)}. Estimated future reward (Q): ${example.qBefore.toFixed(3)} → ${example.qAfter.toFixed(3)}.`,
      );
      el("q-update").textContent =
        `Q: ${example.qBefore.toFixed(3)} → ${example.qAfter.toFixed(3)} / ${tx("報酬の内訳", "Reward breakdown")}: ${tx("1手", "move")} ${signed(t.rewards.step)}, ${tx("衝突", "collision")} ${signed(t.rewards.wall)}, B ${signed(t.rewards.bonus)}, G ${signed(t.rewards.goal)}. ` +
        tx(
          "これは1件の更新で、学習全体の改善を示す値ではありません。",
          "This is one update, not evidence of overall improvement.",
        );
    } else {
      el("example").textContent = "";
      el("q-update").textContent = "";
    }
  }
  function label(index: number): string {
    if (!comparison) return "";
    return index === 0
      ? comparison.previous
        ? tx("前回", "Previous")
        : tx("学習前", "Before")
      : comparison.previous
        ? tx("今回", "Current")
        : tx("学習後", "After training");
  }
  function renderResults(): void {
    if (!root) return;
    el("cards").replaceChildren();
    el("run-details").replaceChildren();
    if (!comparison || !evaluated || mode === "training") return;
    comparison.runs.forEach((runs, i) => {
      const card = document.createElement("article");
      card.className = "rl-result-card";
      const total = runs.reduce((n, r) => n + r.return, 0) / runs.length;
      card.innerHTML = `<h4>${label(i)}</h4><strong>${tx("ゴール到達", "Goals reached")} ${runs.filter((r) => r.success).length}/3</strong><p>${presetName(comparison!.models[i].preset)}</p>`;
      el("cards").append(card);
      const list = document.createElement("p");
      list.textContent =
        `${label(i)} · ${presetName(comparison!.models[i].preset)} (${comparison!.models[i].episodes} ${tx("回学習", "training trials")}): ${tx("平均報酬", "Mean reward")} ${signed(total)} / ★ ${runs.reduce((n, r) => n + r.bonusVisits, 0)} ${tx("回", "visits")}. ` +
        runs
          .map(
            (r, j) =>
              `${j + 1}: ${r.success ? tx("到達", "goal") : tx("80手で打切り", "80-move cutoff")} / ${r.steps}${tx("手", " moves")} / ${signed(r.return)}`,
          )
          .join(" · ");
      el("run-details").append(list);
    });
    const changed = comparison.models[0].preset !== comparison.models[1].preset;
    const loops = comparison.runs[1].some((r) => !r.success && r.bonusVisits > 3);
    el("score-note").textContent = changed
      ? tx(
          "報酬の採点が異なるため、点数の大小を直接比較できません。同じゴールへの到達と、Bを訪れた回数を比べましょう。",
          "Reward rules differ, so their scores cannot be directly ranked. Compare goal reaching and visits to the star.",
        )
      : tx(
          "同じ採点での比較です。報酬合計とゴール到達は、別の指標として確認しましょう。",
          "The reward rule is identical. Inspect reward totals and goal reaching as separate measures.",
        );
    const reached = comparison.runs[1].filter((r) => r.success).length;
    el("result-note").textContent = loops
      ? tx(
          "★を行ったり来たりして、ごほうびを集めました。点数がもらえても、ゴールへ行くとは限らないんですね。",
          "It went back and forth to the star to collect rewards. Earning points does not always mean reaching the goal.",
        )
      : reached === RL_STARTS.length
        ? tx(
            "3つのスタートからゴールに着けました！ 次は★にもごほうびをあげると、どう変わるでしょう？",
            "It reached the goal from all 3 starts! What happens if the star gives rewards too?",
          )
        : tx(
            `${reached}/3地点からゴールに着けました。ごほうびの付け方を変えて、動きを比べてみましょう。`,
            `It reached the goal from ${reached}/3 starts. Try another reward and compare the behavior.`,
          );
    renderReflection();
  }
  function renderReflection(): void {
    if (!root) return;
    el("reflection").textContent =
      reflection === undefined
        ? tx(
            "走行に失敗しても、比較を終えればLessonを完了できます。",
            "A failed run is still a valid experiment; you can complete the lesson after comparing.",
          )
        : (reflection ? tx("その通り。", "Yes. ") : tx("必ずではありません。", "Not always. ")) +
          tx(
            "報酬は目的の代理です。★に何度でも点数を付けると、ゴールせず点数を集める行動も学べます。",
            "Rewards stand in for the task. Repeated points at the star can teach the robot to collect points without reaching the goal.",
          );
  }
  function previewLength(): number {
    return comparison
      ? Math.min(PREVIEW_MOVES, Math.max(...comparison.runs.map((r) => r[trial].steps)))
      : 0;
  }
  function playPreview(start: number): void {
    trial = start;
    frame = 0;
    clock = 0;
    mode = "compare";
    paused = false;
  }
  function endPreview(): void {
    frame = previewLength();
    clock = 0;
    mode = "idle";
    paused = false;
  }
  function startComparison(): void {
    if (!current || dirty()) return;
    const base = previous?.policy ?? createReinforcementTrainer(current.policy.preset).snapshot();
    comparison = {
      models: [base, current.policy],
      runs: [
        RL_STARTS.map((s) => evaluateReinforcement(base, s)),
        RL_STARTS.map((s) => evaluateReinforcement(current!.policy, s)),
      ],
      previous: !!previous,
    };
    g.publish(
      "/rl/evaluation",
      `data: ${JSON.stringify(`event=evaluation_complete preset=${current.policy.preset} baseline=${previous ? "previous" : "untrained"} baseline_success=${comparison.runs[0].filter((run) => run.success).length}/${RL_STARTS.length} current_success=${comparison.runs[1].filter((run) => run.success).length}/${RL_STARTS.length} episodes=${current.policy.episodes}`)}`,
    );
    playPreview(0);
    evaluated = true;
    settings = false;
    renderResults();
  }
  function act(action: string): void {
    if (
      completionActive ||
      (cleared && !["details", "reset", "always", "depends"].includes(action))
    )
      return;
    if (action === "details") {
      details = !details;
      refresh();
      return;
    }
    if (
      (action === "always" || action === "depends") &&
      evaluated &&
      !dirty() &&
      mode !== "training"
    ) {
      reflection = action === "depends";
      renderReflection();
      return;
    }
    if (action === "pause" && busy()) {
      paused = !paused;
      refresh();
      return;
    }
    if (
      mode === "compare" &&
      (["show-results", "change", "finish", "replay"].includes(action) ||
        /^case-[012]$/.test(action))
    )
      endPreview();
    if (action === "show-results") {
      refresh();
      focusAction("finish");
      return;
    }
    if (action === "stop" && busy()) {
      if (mode === "compare") comparison = undefined;
      if (mode === "training") settings = true;
      trainer = undefined;
      mode = "idle";
      paused = false;
      note = "stopped";
      renderEvidence();
      renderResults();
      refresh();
      focusAction(current && !dirty() ? "compare" : "train");
      return;
    }
    if (busy()) return;
    if (action !== "undo" && action !== "reset") undo = undefined;
    note = "";
    if (action === "goal" || action === "bonus") {
      selected = action;
      settings = true;
    } else if (action === "train") {
      trainer = createReinforcementTrainer(selected);
      trainingExample = null;
      mode = "training";
      paused = false;
      clock = 0;
      settings = false;
      renderEvidence();
      renderResults();
    } else if (action === "compare") startComparison();
    else if ((action === "replay" || /^case-[012]$/.test(action)) && comparison && !dirty()) {
      playPreview(action === "replay" ? trial : Number(action.slice(-1)));
    } else if (action === "cancel-change" && current) {
      selected = current.policy.preset;
      settings = false;
      renderResults();
    } else if (action === "change") {
      selected = current?.policy.preset === "goal" ? "bonus" : "goal";
      settings = true;
    } else if (action === "reset") {
      (g.resetStage ?? reset)();
      focusAction("train");
      return;
    } else if (action === "undo") {
      const restore = undo;
      undo = undefined;
      restore?.();
      build();
      return;
    } else if (action === "finish" && evaluated && !dirty()) {
      cleared = true;
      completionActive = true;
      details = false;
      g.awardStars(
        3,
        tx(
          "報酬を使って学習し、学習前後の動きを3地点で比較しました。",
          "Learned from rewards and compared behavior before and after training at three starts.",
        ),
        0,
      );
    }
    refresh();
    if (
      action === "train" ||
      action === "compare" ||
      action === "replay" ||
      action.startsWith("case-")
    ) {
      focusAction(action === "train" ? "pause" : "show-results");
    }
    if (action === "change") focusAction("bonus" === selected ? "bonus" : "goal");
  }
  function onCompletionClose(event: Event): void {
    if (!cleared) return;
    completionActive = false;
    refresh();
    const reason = (event as CustomEvent<{ reason: string }>).detail.reason;
    if (reason === "dismiss" || reason === "next") focusAction("reset");
  }
  function reset(): void {
    if (current || comparison) {
      const saved = {
        current,
        previous,
        comparison: evaluated ? comparison : undefined,
        selected,
        evaluated,
        reflection,
        details,
        settings,
        trial,
        frame,
      };
      undo = () => {
        ({
          current,
          previous,
          comparison,
          selected,
          evaluated,
          reflection,
          details,
          settings,
          trial,
          frame,
        } = saved);
        note = "restored";
      };
    } else undo = undefined;
    selected = "goal";
    current = undefined;
    previous = undefined;
    trainer = undefined;
    trainingExample = null;
    comparison = undefined;
    mode = "idle";
    paused = false;
    cleared = false;
    completionActive = false;
    evaluated = false;
    details = false;
    settings = true;
    reflection = undefined;
    trial = 0;
    frame = 0;
    clock = 0;
    uiClock = 0;
    note = "";
    build();
  }
  function pauseHidden(): void {
    if (busy()) {
      paused = true;
      refresh();
    }
  }
  function visibility(): void {
    if (document.hidden) pauseHidden();
  }
  function update(dt: number): void {
    if (cleared) return;
    if (!paused) {
      clock += Math.min(dt, 0.1);
      if (mode === "training" && trainer && clock >= 1 / TRAINING_EPISODES_PER_SECOND) {
        const count = Math.floor(clock * TRAINING_EPISODES_PER_SECOND);
        clock -= count / TRAINING_EPISODES_PER_SECOND;
        trainer.step(count);
        const update = trainer.lastUpdate;
        if (!trainingExample && update && Math.abs(update.qAfter - update.qBefore) > 0.001)
          trainingExample = update;
        if (trainer.done) {
          previous = current;
          current = {
            policy: trainer.snapshot(),
            history: [...trainer.history],
            example: trainingExample ?? trainer.lastUpdate,
            lastRun: trainer.lastEpisode,
          };
          g.publish(
            "/learning",
            `data: ${JSON.stringify(`event=training_complete preset=${current.policy.preset} episodes=${current.policy.episodes} last_return=${current.lastRun!.return.toFixed(1)} last_success=${current.lastRun!.success}`)}`,
          );
          trainer = undefined;
          comparison = undefined;
          mode = "idle";
          evaluated = false;
          reflection = undefined;
          renderEvidence();
          renderResults();
          refresh();
          focusAction("compare");
        }
      } else if (mode === "compare" && comparison && clock >= PREVIEW_STEP_SECONDS / speed) {
        const steps = Math.floor(clock / (PREVIEW_STEP_SECONDS / speed));
        clock -= (steps * PREVIEW_STEP_SECONDS) / speed;
        frame += steps;
        if (frame >= previewLength()) {
          endPreview();
          refresh();
          focusAction("finish");
        }
      }
    }
    uiClock += dt;
    if (uiClock > 0.2) {
      uiClock = 0;
      if (mode === "training") renderEvidence();
      if (busy()) {
        refresh();
        g.publish(
          "/learning",
          `data: ${JSON.stringify(`phase=${mode} episodes=${trainer?.episode ?? current?.policy.episodes ?? 0} exploration=${mode === "training"} paused=${paused}`)}`,
        );
      }
    }
  }
  function text(value: string, x: number, y: number, size = 20, color = "#eef2ff"): void {
    const c = g.ctx;
    c.fillStyle = color;
    c.font = `600 ${size}px system-ui, sans-serif`;
    c.textAlign = "center";
    c.fillText(value, x, y);
  }
  function board(
    x: number,
    y: number,
    cell: number,
    run: Run | undefined,
    at: number,
    color: string,
    policy?: Policy,
  ): void {
    const c = g.ctx;
    for (let row = 0; row < RL_HEIGHT; row++)
      for (let col = 0; col < RL_WIDTH; col++) {
        const p = { x: col, y: row };
        c.fillStyle = RL_WALLS.some((w) => same(w, p))
          ? "#475569"
          : same(p, RL_GOAL)
            ? "#135a46"
            : same(p, RL_BONUS)
              ? "#70511b"
              : "#142339";
        c.fillRect(x + col * cell + 1, y + row * cell + 1, cell - 2, cell - 2);
        if (same(p, RL_GOAL)) {
          const gx = x + (col + 0.34) * cell,
            gy = y + (row + 0.22) * cell;
          c.strokeStyle = "#a7f3d0";
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(gx, gy);
          c.lineTo(gx, gy + cell * 0.56);
          c.stroke();
          c.fillStyle = "#5eead4";
          c.beginPath();
          c.moveTo(gx, gy);
          c.lineTo(gx + cell * 0.4, gy + cell * 0.15);
          c.lineTo(gx, gy + cell * 0.3);
          c.fill();
        } else if (same(p, RL_BONUS))
          text("★", x + (col + 0.5) * cell, y + (row + 0.66) * cell, cell * 0.48, "#fbbf24");
        else if (policy && !RL_WALLS.some((w) => same(w, p))) {
          const arrow = { up: "↑", right: "→", down: "↓", left: "←" }[policy(p)];
          text(arrow, x + (col + 0.5) * cell, y + (row + 0.65) * cell, cell * 0.36, "#657e9a");
        }
      }
    const position = Math.min(Math.floor(at), run?.steps ?? 0);
    const path = run?.path.slice(0, position + 1) ?? [RL_STARTS[0]];
    if (path.length) {
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.beginPath();
      path.forEach((p, i) => {
        const a = x + (p.x + 0.5) * cell,
          b = y + (p.y + 0.5) * cell;
        if (!i) c.moveTo(a, b);
        else c.lineTo(a, b);
      });
      c.stroke();
      const p = path.at(-1)!;
      const next = run?.path[position + 1] ?? p;
      const fraction = Math.min(1, at - position);
      const rx = x + (p.x + (next.x - p.x) * fraction + 0.5) * cell,
        ry = y + (p.y + (next.y - p.y) * fraction + 0.5) * cell;
      const previousPosition = path.at(-2) ?? p;
      const dx = next.x !== p.x || next.y !== p.y ? next.x - p.x : p.x - previousPosition.x;
      const dy = next.x !== p.x || next.y !== p.y ? next.y - p.y : p.y - previousPosition.y;
      c.save();
      c.translate(rx, ry);
      c.rotate(dx || dy ? Math.atan2(dy, dx) : 0);
      c.scale(cell / 36, cell / 36);
      drawRobotBody(c, 0, at * PREVIEW_STEP_SECONDS);
      c.restore();
    }
  }
  function draw(): void {
    const c = g.ctx;
    clearBackground(c);
    if (comparison && mode !== "training" && !dirty()) {
      text(tx(`同じ開始地点 ${trial + 1} / 3`, `Same start ${trial + 1} / 3`), 400, 47, 25);
      [0, 1].forEach((i) => {
        const x = 35 + i * 395;
        text(label(i), x + 168, 94, 23, i ? "#7dd3fc" : "#c4b5fd");
        board(
          x,
          120,
          48,
          comparison!.runs[i][trial],
          Math.min(
            previewLength(),
            frame + (mode === "compare" && !paused ? (clock * speed) / PREVIEW_STEP_SECONDS : 0),
          ),
          i ? "#7dd3fc" : "#c4b5fd",
          details ? comparison!.models[i] : undefined,
        );
        const run = comparison!.runs[i][trial];
        text(`${Math.min(frame, run.steps)} ${tx("手", "moves")}`, x + 168, 396, 21);
        if (frame >= run.steps)
          text(
            run.success ? tx("ゴール到達", "Goal reached") : tx("打切り", "Move limit"),
            x + 168,
            429,
            22,
            run.success ? "#5eead4" : "#fbbf24",
          );
        else if (mode === "idle")
          text(tx("続きは省略", "Rest omitted"), x + 168, 429, 22, "#fbbf24");
      });
      text(
        tx(
          `最初の${previewLength()}手を抜粋。全3地点の結果は下へ`,
          `First ${previewLength()} moves. All 3 results are below.`,
        ),
        400,
        478,
        19,
      );
    } else {
      text(
        mode === "training"
          ? tx("試して、報酬から学ぶ", "Try actions. Learn from rewards.")
          : tx("旗のゴールへ行けるかな？", "Can the robot reach the flag?"),
        400,
        48,
        27,
      );
      const sample = trainer?.lastEpisode ?? current?.lastRun ?? undefined;
      board(204, 92, 56, sample, sample?.steps ?? 0, "#7dd3fc");
      text(
        mode === "training"
          ? tx(
              `直近の1試行 · ${trainer?.episode ?? 0}/${RL_EPISODES}`,
              `Latest trial · ${trainer?.episode ?? 0}/${RL_EPISODES}`,
            )
          : tx("旗 = ゴール ／ ★ = 寄り道", "Flag = goal / ★ = detour"),
        400,
        415,
        23,
      );
      text(
        mode === "training"
          ? tx("軌跡は実際の学習記録です", "Path from an actual training trial")
          : current && !dirty()
            ? tx("学習完了。「動きを見る」を押そう", "Learning complete. Choose Watch the robots.")
            : tx("下のパネルから学習を始めます", "Start learning in the panel below"),
        400,
        458,
        20,
      );
    }
    if (paused) {
      c.fillStyle = "rgba(5,12,25,.75)";
      c.fillRect(240, 205, 320, 68);
      text(tx("一時停止中", "Paused"), 400, 249, 28, "#fff");
    }
  }
  return {
    id: "reinforcement_learning",
    name: "Reinforcement Learning Mini Lab",
    lesson: "Q-learning: learn from rewards, then evaluate goal reaching",
    lessonCmd: "ros2 topic echo /learning",
    get ros2() {
      return {
        title: tx("強化学習ミニラボ", "Reinforcement Learning Mini Lab"),
        summary: tx(
          "ブラウザ内の疑似ノードが学習の進行・完了と、3つの開始位置での比較結果を通知します。ターミナルで直近の文字列メッセージを確認できます。実際のROS 2プロセスへの接続ではありません。",
          "A simulated browser node reports training progress and completion, and comparison results from three starting positions. The terminal inspects recent string messages; it is not connected to ROS 2 processes.",
        ),
        msgTypes: ["std_msgs/msg/String"],
        cli: [
          "ros2 topic echo /learning",
          "ros2 topic echo /rl/evaluation",
          "ros2 topic list -t",
          "ros2 topic type /learning",
          "ros2 topic info /learning",
          "ros2 node info /rl_lab",
          "ros2 interface show std_msgs/msg/String",
        ],
        realWorld: tx(
          "ROS 2と連携する学習システムでは、学習状況と評価結果をトピックで共有できます。このLessonは、その通知をブラウザ内で再現します。ターミナルから報酬やQ値を書き換えることはしません。",
          "A learning system integrated with ROS 2 can share training status and evaluation results through topics. This lesson represents those notifications inside the browser; the terminal does not modify rewards or Q values.",
        ),
        state: {
          nodes: ["/rl_lab"],
          topics: ["/learning", "/rl/evaluation"].map((name) => ({
            name,
            type: "std_msgs/msg/String",
            pub: ["/rl_lab"],
          })),
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
      window.addEventListener("blur", pauseHidden);
      document.addEventListener("visibilitychange", visibility);
    },
    update,
    draw,
    reset,
    dispose() {
      offLang();
      restoreCompletion();
      restoreWorkbench();
      window.removeEventListener("blur", pauseHidden);
      document.removeEventListener("visibilitychange", visibility);
      trainer = undefined;
      undo = undefined;
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
  order: 22,
  build: makeReinforcementLearning,
  lessonModal: {
    title: {
      ja: "強化学習ミニラボ",
      en: "Reinforcement Learning Mini Lab",
    },
    learn: {
      ja: "ゴールに着いたらごほうび。ロボットは自分で練習して、点数がもらえる動きを覚えます。",
      en: "Give a reward at the goal. The robot practices on its own and learns moves that earn points.",
    },
    goal: {
      ja: "学習前と学習後の動きを3地点で比較します。ごほうびの変更は発展実験です。",
      en: "Compare behavior before and after training at three starts. Changing rewards is an optional extension.",
    },
    first: {
      ja: "「学習する（約2秒）」を押して、次に「動きを見る」を押します。",
      en: "Press Learn (about 2 sec), then Watch the robots.",
    },
  },
  diagram: `<svg viewBox="0 0 420 100" role="img" aria-label="ごほうびを選ぶ、学習する、動きを見る / Choose reward, learn, watch"><g fill="#15243b" stroke="#7dd3fc"><rect x="5" y="15" width="115" height="65" rx="8"/><rect x="152" y="15" width="115" height="65" rx="8"/><rect x="300" y="15" width="115" height="65" rx="8"/></g><g fill="#e0f2fe" font-family="system-ui" font-size="12" text-anchor="middle"><text x="62" y="43">① ごほうび</text><text x="62" y="64">Reward +10</text><text x="136" y="53">→</text><text x="210" y="43">② 学習する</text><text x="210" y="64">Learn · ~2 sec</text><text x="284" y="53">→</text><text x="357" y="43">③ 動きを見る</text><text x="357" y="64">Watch the robot</text></g></svg>`,
});
