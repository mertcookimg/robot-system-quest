// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import type { GameContext, Stage } from "../../types";
import { defineStage } from "../../core/stage_def";
import { tx, onLangChange } from "../../i18n";
import { clearBackground, drawRobotBody } from "../../lib/draw";
import { registerOverlayPad, unregisterOverlayPad } from "../../lib/overlaypad";
import {
  WORLD_INITIAL,
  WORLD_HORIZON,
  WORLD_PUSH_SECONDS,
  WORLD_VIEW_MIN,
  WORLD_VIEW_MAX,
  WORLD_TARGET_X,
  WORLD_MODEL_INFO,
  predictWorldCandidates,
  planWorldAction,
  simulateWorldTrajectory,
  type WorldAction,
  type WorldGoal,
  type WorldState,
  type WorldTrajectory,
} from "../../lib/world_model";
import "../../styles/30-world-model.css";

type Rollout = WorldTrajectory;
type Selection = "plan" | "manual";
const EXPERIMENTS = ["near", "far", "moving"] as const;
type Experiment = (typeof EXPERIMENTS)[number];
type Candidates = ReturnType<typeof predictWorldCandidates>;
type Comparison = {
  experiment: Experiment;
  goal: WorldGoal;
  initial: WorldState;
  candidates: Candidates;
  action: WorldAction;
  source: Selection;
  prediction: Rollout;
  actual: Rollout;
  error: number;
};
const ACTIONS: readonly WorldAction[] = ["weak", "strong", "none"];
const goalName = (goal: WorldGoal) =>
  goal === "near" ? tx("近い目標", "Near target") : tx("遠い目標", "Far target");
const goalFor = (experiment: Experiment): WorldGoal => (experiment === "near" ? "near" : "far");
const initialFor = (experiment: Experiment): WorldState => ({
  ...WORLD_INITIAL,
  velocity: experiment === "moving" ? 1.2 : 0,
});
const experimentName = (experiment: Experiment) =>
  experiment === "near"
    ? tx("止まっている箱を押す", "Push a stationary box")
    : experiment === "far"
      ? tx("目標を遠くする", "Move the target farther away")
      : tx("動いている箱を押す", "Push a box already moving");
const initialName = (initial: WorldState) =>
  initial.velocity === 0
    ? tx("開始時：止まっている", "Initially: at rest")
    : tx(
        `開始時：右へ動いている（${initial.velocity.toFixed(1)} m/s）`,
        `Initially: ${initial.velocity.toFixed(1)} m/s right`,
      );
const experimentHint = (experiment: Experiment) =>
  experiment === "near"
    ? tx(
        "3つの押し方で、2秒後の場所を予想します。",
        "Predict the position after 2 s for three pushes.",
      )
    : experiment === "far"
      ? tx(
          "目標だけ遠くしました。同じ押し方の予想は変わる？",
          "Only the target changed. Will the same push's prediction change?",
        )
      : tx(
          "目標は同じ。最初から動いている箱なら、予想は変わる？",
          "Same target, but the box starts moving. Will predictions change?",
        );
const actionName = (action: WorldAction) =>
  action === "weak"
    ? tx("弱く押す", "Push gently")
    : action === "strong"
      ? tx("強く押す", "Push firmly")
      : tx("押さない", "Do not push");
const distance = (meters: number) =>
  meters > 0 && meters < 0.001 ? tx("0.001 m未満", "less than 0.001 m") : `${meters.toFixed(3)} m`;
const position = (x: number) => {
  const delta = x - WORLD_INITIAL.x;
  return Math.abs(delta) < 0.001
    ? tx("ほぼ開始位置（移動0.001 m未満）", "At the start (less than 0.001 m moved)")
    : delta >= 0
      ? tx(`開始位置から右へ ${distance(delta)}`, `${distance(delta)} right of the start`)
      : tx(`開始位置から左へ ${distance(-delta)}`, `${distance(-delta)} left of the start`);
};
const movement = (x: number) => {
  const meters = Math.abs(x - WORLD_INITIAL.x);
  return meters > 0 && meters < 0.001 ? "< 0.001 m" : distance(meters);
};

export function makeWorldModel(): Stage {
  let g: GameContext;
  let originalCanvasHeight = 500;
  let root: HTMLElement | undefined, dock: HTMLElement;
  let workbench: HTMLElement | undefined;
  let layoutSlots: Array<{ node: HTMLElement; marker: Comment }> = [];
  let completionSlot: { node: HTMLElement; marker: Comment } | undefined;
  let offLang = () => {};
  let experiment: Experiment = "near";
  let initial = initialFor(experiment);
  let goal: WorldGoal = "near";
  let action: WorldAction = "weak";
  let selection: Selection | undefined;
  let candidates: Candidates;
  let prediction: Rollout;
  let actual: Rollout | undefined;
  let records: Partial<Record<Experiment, Comparison>> = {};
  let running = false,
    paused = false,
    details = false,
    cleared = false,
    completionActive = false;
  let note: "ready" | "done" | "stopped" = "ready";
  let playback = 0,
    elapsed = 0;
  const count = () => Object.keys(records).length;
  const complete = () => count() === EXPERIMENTS.length;
  const nextExperiment = () => EXPERIMENTS.find((choice) => !records[choice]);
  const phase = () => (running ? 2 : note === "done" ? 3 : selection ? 1 : 0);
  const intent = () =>
    cleared
      ? "reset"
      : running
        ? "pause"
        : note === "done"
          ? complete()
            ? "finish"
            : "next"
          : selection
            ? "run"
            : "plan";
  const el = <T extends HTMLElement = HTMLElement>(key: string) =>
    root!.querySelector<T>(`[data-world="${key}"]`)!;
  const btn = (key: string) =>
    root!.querySelector<HTMLButtonElement>(`button[data-action="${key}"]`)!;
  const focus = (key: string) => btn(key).focus({ preventScroll: true });
  const button = (key: string, label: string, primary = false) =>
    `<button type="button" data-action="${key}" class="world-button${primary ? " world-primary" : ""}">${label}</button>`;
  function forecastComparison(from: Comparison, to: Experiment, forecasts: Candidates): string {
    const fromNumber = EXPERIMENTS.indexOf(from.experiment) + 1;
    const toNumber = EXPERIMENTS.indexOf(to) + 1;
    return tx(
      `弱く押す予想（${fromNumber}→${toNumber}回目）：${movement(from.candidates.weak.finalX)} → ${movement(forecasts.weak.finalX)}`,
      `Gentle push (${fromNumber}→${toNumber}): ${movement(from.candidates.weak.finalX)} → ${movement(forecasts.weak.finalX)}. Both predictions.`,
    );
  }
  function mountLayout(): void {
    // The completion lifecycle also applies when the controls use the fallback dock.
    const completion = document.getElementById("clear-overlay");
    if (completion?.parentElement) {
      const marker = document.createComment("world-model-completion-slot");
      completion.before(marker);
      completionSlot = { node: completion, marker };
      completion.classList.add("world-completion-layer");
      document.body.append(completion);
      completion.addEventListener("clear-overlay-close", onCompletionClose);
    }
    const scene = g.canvas.parentElement;
    const controls = document.getElementById("stage-controls-dock");
    // The fallback overlay may live inside the scene; never create a DOM cycle.
    if (
      !scene ||
      scene === document.body ||
      !controls ||
      !scene.parentElement ||
      !controls.parentElement ||
      scene.contains(controls) ||
      controls.contains(scene)
    )
      return;
    layoutSlots = [scene, controls].map((node) => {
      const marker = document.createComment("world-model-layout-slot");
      node.before(marker);
      return { node, marker };
    });
    workbench = document.createElement("div");
    workbench.className = "world-workbench";
    layoutSlots[0].marker.after(workbench);
    workbench.append(scene, controls);
  }
  function restoreLayout(): void {
    if (completionSlot) {
      const { node, marker } = completionSlot;
      node.removeEventListener("clear-overlay-close", onCompletionClose);
      node.classList.remove("world-completion-layer");
      marker.replaceWith(node);
      completionSlot = undefined;
    }
    for (const { node, marker } of layoutSlots) marker.replaceWith(node);
    layoutSlots = [];
    workbench?.remove();
    workbench = undefined;
  }
  function clearTrial(): void {
    paused = false;
    actual = undefined;
    playback = 0;
    note = "ready";
  }
  function prepare(next: WorldAction, source: Selection): void {
    action = next;
    selection = source;
    prediction = candidates[action];
    clearTrial();
  }
  function changeExperiment(next: Experiment): void {
    const nextInitial = initialFor(next);
    // Goals affect only the planner. Recompute forecasts only when the state changes.
    if (
      initial.x !== nextInitial.x ||
      initial.velocity !== nextInitial.velocity ||
      initial.time !== nextInitial.time
    )
      candidates = predictWorldCandidates(nextInitial);
    experiment = next;
    initial = nextInitial;
    goal = goalFor(next);
    selection = undefined;
    prediction = candidates[action];
    clearTrial();
  }
  function status(): string {
    if (cleared)
      return tx(
        "Lessonは完了しました。補足で結果を見返すか、最初から試せます。",
        "Lesson complete. Review the results in More, or start again.",
      );
    if (paused)
      return tx("一時停止中。再開して確かめましょう。", "Paused. Resume to check the motion.");
    if (running)
      return tx(
        "青い破線＝予想、黄色い箱＝実際。",
        "Blue outline: prediction. Yellow box: actual.",
      );
    if (note === "stopped")
      return records[experiment]
        ? tx(
            "再生を中止しました。前回の比較結果は残っています。",
            "Playback stopped. Your previous comparison is preserved.",
          )
        : tx(
            "途中で中止しました。この実行は比較に数えません。",
            "Stopped early. This run does not count as a comparison.",
          );
    if (note === "done")
      return complete()
        ? tx(
            "3回の比較ができました。Lessonを完了できます。",
            "Three trials checked. You can complete the lesson.",
          )
        : tx(
            "表の同じ行で、予想と実際を見比べましょう。",
            "Compare prediction and actual result in the same table row.",
          );
    return selection
      ? selection === "plan"
        ? tx(
            `「${actionName(action)}」の予想が目標に最も近いです。`,
            `Suggested: ${actionName(action)}. Closest to the target in prediction.`,
          )
        : tx(
            `自分で選択：「${actionName(action)}」。予想を確かめます。`,
            `Your choice: ${actionName(action)}. Check its prediction.`,
          )
      : experimentHint(experiment);
  }
  function build(): void {
    const active = document.activeElement as HTMLElement | null;
    const focusedAction = active && root?.contains(active) ? active.dataset.action : undefined;
    if (root) {
      unregisterOverlayPad(root);
      root.remove();
    }
    dock = document.getElementById("stage-controls-dock") ?? g.overlay;
    dock.hidden = false;
    root = document.createElement("section");
    root.className = "world-lab";
    root.setAttribute("aria-label", tx("世界モデルミニラボ", "World Model Mini Lab"));
    root.innerHTML = `
      <div class="world-heading"><h3 data-world="experiment"></h3><span data-world="progress" class="world-badge"></span></div>
      <p data-world="conditions" class="world-conditions"></p>
      <div class="world-next"><div class="world-actions">${button("continue", tx("予想を見る", "See predictions"), true)}${button("details", tx("補足", "More"))}</div></div>
      <p data-world="status" class="world-status" role="status" aria-live="polite"></p>
      <table data-world="candidates" class="world-candidates"><caption>${tx("開始位置から進む距離 · 2秒後", "Distance from the start · after 2 s")}</caption><thead><tr><th scope="col">${tx("押し方", "Push")}</th><th scope="col">${tx("予想", "Prediction")}</th><th scope="col">${tx("実際", "Actual")}</th></tr></thead><tbody>${ACTIONS.map((a) => `<tr data-candidate="${a}" data-selected="false"><th scope="row"><span data-pick aria-hidden="true"></span>${actionName(a)}</th><td><strong data-forecast></strong></td><td><strong data-actual></strong></td></tr>`).join("")}</tbody></table>
      <p data-world="forecast-comparison" class="world-comparison" hidden></p>
      <p data-world="insight" class="world-insight" hidden></p>
      <section data-world="details" id="world-details" class="world-details" hidden>
        <p class="world-intro">${tx("ボールを押すとき、動く先を想像しますね。ロボットにも、動きの記録から学んだしくみで、押した結果を予想させてみましょう。", "Before pushing a ball, you imagine where it will go. Let a robot predict a push using a mechanism learned from motion records.")}</p>
        <p data-world="experiment-hint"></p><p data-world="selection"></p>
        <h4>${tx("操作", "Controls")}</h4>
        <div class="world-actions world-utilities">${button("stop", tx("再生を中止", "Stop playback"))}${button("skip", tx("結果へ進む", "Skip to result"))}${button("retry", tx("この条件でもう一度", "Try this setup again"))}${button("review", tx("保存した結果を見る", "View saved result"))}${button("reset", tx("最初から", "Start over"))}</div>
        <section data-world="results" class="world-results"><h4>${tx("これまでの記録", "Saved results")}</h4><p class="world-scope">${tx("2秒時点の比較です。停止位置ではありません。実際の動きもシミュレーションです。", "Compared at 2 s, not the stopping position. Actual motion is simulated too.")}</p><div data-world="records" class="world-records"></div><p data-world="result-comparison" class="world-comparison"></p></section>
        <div data-world="model" class="world-model"><h4>${tx("世界モデルは学習済み", "The world model is pretrained")}</h4><p>${tx(`${WORLD_MODEL_INFO.samples.toLocaleString()}件の記録で「今の位置・速度 ＋ 力 → 次の位置・速度」を学んでいます。学習待ちはありません。`, `Trained on ${WORLD_MODEL_INFO.samples.toLocaleString()} records of position, velocity and force → next position and velocity. No training wait.`)}</p></div>
        <h4>${tx("任意：実験を選んで試す", "Optional: choose a trial")}</h4>
        <div class="world-choices" role="group" aria-label="${tx("実験の条件", "Trial setup")}">${EXPERIMENTS.map((key) => button(`experiment-${key}`, experimentName(key))).join("")}</div>
        <h4>${tx("任意：押し方を自分で選ぶ", "Optional: choose a push yourself")}</h4>
        <div class="world-choices" role="group" aria-label="${tx("押し方を手動で選ぶ", "Select a push manually")}">${ACTIONS.map((a) => button(a, actionName(a))).join("")}</div>
        <p>${tx("計画器の選択と違う押し方も試せます。目標から離れる結果でも、予測と実際の比較として記録します。", "You can try a different push from the planner's choice. A result far from the target still counts as a forecast comparison.")}</p>
        <h4 class="world-step">${tx("モデル・予測・計画は別の役割", "Model, forecast and planner have different roles")}</h4>
        <p>${tx("世界モデルは、環境の状態変化を表す内部モデルです。このLessonは数値状態の変化を学んだ小さな順モデルを使います。モデルが各候補の未来を予測し、別の計画器が予測位置と目標の距離で候補を選びます。目標はモデルの入力に含めず、選択の基準にだけ使います。", "A world model is an internal model of how the environment changes. This lesson uses a small learned forward model of numerical states. It predicts each candidate's future; a separate planner selects a candidate using the distance between forecast and target. The goal is a selection criterion, not a model input.")}</p>
        <p>${tx("この小型モデルは、シミュレーションで得た『今の位置・速度・力 → 次の位置・速度』のデータから事前学習しています。予測では学習したモデルを繰り返し使います。実際の動きを計算する物理シミュレータは別で、予測を正解に合わせ直すことはしません。", "This small model was trained on simulated transitions: current position, velocity and force → next position and velocity. Prediction repeatedly uses the learned model. The physical simulator that produces the actual motion is separate; predictions are not corrected to match its answer.")}</p>
        <p>${tx(`全実験の開始位置は同じ。実験1・2は静止、実験3は右へ1.2 m/sで動いている状態から始めます。全候補を同じ初期状態から予測し、選んだ1候補だけをその初期状態で実行します。押す場合は最初の${WORLD_PUSH_SECONDS}秒だけ力を加え、その後は滑って減速します。予測にも、この力を加える予定を使います。破線は実行前に予測した${WORLD_HORIZON}秒後の位置で、実行中も固定です。実際の同時刻の位置との差が予測誤差です。`, `All trials start at the same position. Trials 1–2 start at rest; trial 3 starts moving right at 1.2 m/s. Predict all candidates from the same initial state, then execute only the selected candidate from that state. Force is applied only during the first ${WORLD_PUSH_SECONDS} seconds, then the box coasts and slows. Prediction uses this force schedule too. The dashed box is the forecast at ${WORLD_HORIZON} seconds, saved before execution and held fixed. Its difference from the actual position at that time is prediction error.`)}</p>
        <p>${tx("これは3候補を比べる簡単な計画です。実行中に観測を使って計画を更新するMPCや、報酬で方策を学ぶ強化学習は行いません。実行後もモデルは更新しません。箱は2秒後に停止するとは限らず、計画器が評価するのはその時点の位置だけです。", "This is simple planning over three candidates. It does not replan from observations during execution as MPC does, or learn a policy from rewards. The model is not updated after a run. The box may still be moving after two seconds; only its position at that instant is scored.")}</p>
        <p>${tx("先の状態を繰り返し予測すると、誤差が積み重なって大きくなることがあります。今回選ばなかった候補は、この実行では確認していません。3つの実験で比較すれば完了でき、目標への到達や予測精度は完了条件にしません。同じ実験をやり直すと、その記録を更新します。", "Repeated forecasts can accumulate error. Candidates not selected in this run have not been verified by this execution. Compare all three trials to finish; reaching a target or achieving a particular prediction accuracy is not required. Repeating a trial replaces its record.")}</p>
        <p>${tx("自由に試すなら、実験3で『押さない』も選んでみましょう。最初から動いている箱は、押さなくても進みます。予測が実際に近いことと、目標に近いことは別です。", "For an extra comparison, select ‘Do not push’ in trial 3. A box already moving continues without a push. Predicting the result accurately and reaching the target are different things.")}</p>
        <p>${tx("位置と速度は数値で与え、画像から推定しません。破線は1つの予測位置で、不確実性の幅ではありません。VLAが動作を出す役割と、世界モデルが結果を予測する役割は組み合わせられます。本教材はDreamer全体や画像・動画生成モデル、実機の再現ではなく、ロボットの接触も簡略化しています。", "Position and velocity are given numerically, not estimated from images. A dashed box is a point prediction, not an uncertainty interval. VLA action generation and world-model prediction can be combined. This lesson does not reproduce Dreamer, image/video generation or physical hardware, and robot contact is simplified.")}</p>
        <h4>${tx("研究とのつながり", "Connection to research")}</h4>
        <p>${tx("世界モデルには数値状態・潜在表現・画像や動画を予測するものがあり、計画や方策学習などに使われます。", "World models predict numerical states, latent representations, or images/video, and can support planning or policy learning.")} <a href="https://www.nature.com/articles/s41586-025-08744-2" target="_blank" rel="noopener noreferrer">DreamerV3 (2025)</a> · <a href="https://arxiv.org/abs/2603.19312" target="_blank" rel="noopener noreferrer">LeWorldModel (2026)</a> ${tx("などが発展例です。このLessonは、学んだ状態変化から行動の結果を予測する基礎を扱います。", "are examples of more advanced systems. This lesson introduces prediction of action outcomes using learned state transitions.")}</p>
        <p>${tx("Tab / Enterで操作。ゲームパッドのAで設定へ。Rで最初から。Lessonを離れると比較記録は消えます。", "Use Tab / Enter. Gamepad A opens controls; R starts over. Comparison records are cleared when leaving this lesson.")}</p>
      </section>`;
    root.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>(
        "button[data-action]",
      );
      if (target && !target.disabled && !target.hidden) act(target.dataset.action!);
    });
    dock.replaceChildren(root);
    registerOverlayPad(root, false);
    renderResults();
    refresh();
    if (focusedAction && !btn(focusedAction).disabled) focus(focusedAction);
  }
  function refresh(): void {
    if (!root) return;
    root.inert = completionActive;
    const step = phase();
    root.dataset.phase = String(step);
    root.dataset.experiment = experiment;
    el("experiment").textContent = experimentName(experiment);
    const startLabel =
      initial.velocity === 0
        ? tx("開始：静止", "Start: at rest")
        : tx(
            `開始：右へ ${initial.velocity.toFixed(1)} m/s`,
            `Start: ${initial.velocity.toFixed(1)} m/s right`,
          );
    el("conditions").textContent =
      `${startLabel} · ${tx("目標", "Target")}: +${distance(WORLD_TARGET_X[goal] - initial.x)}`;
    el("experiment-hint").textContent = experimentHint(experiment);
    const baseline =
      experiment === "far" ? records.near : experiment === "moving" ? records.far : undefined;
    el("forecast-comparison").hidden = !baseline || !selection;
    el("forecast-comparison").textContent =
      baseline && selection ? forecastComparison(baseline, experiment, candidates) : "";
    for (const choice of ACTIONS) {
      const selected = !!selection && choice === action;
      btn(choice).setAttribute("aria-pressed", String(selected));
      btn(choice).disabled = running || cleared;
      const card = root.querySelector<HTMLElement>(`[data-candidate="${choice}"]`)!;
      card.dataset.selected = String(selected);
      card.querySelector<HTMLElement>("[data-forecast]")!.textContent = selection
        ? movement(candidates[choice].finalX)
        : "—";
      card.querySelector<HTMLElement>("[data-actual]")!.textContent =
        selected && note === "done" && actual
          ? movement(actual.finalX)
          : selected && running
            ? tx("確認中", "Checking")
            : tx("未確認", "Unchecked");
      card.querySelector<HTMLElement>("[data-pick]")!.textContent = selected ? "✓" : "";
      card
        .querySelector("th")!
        .setAttribute(
          "aria-label",
          selected
            ? `${actionName(choice)} · ${selection === "plan" ? tx("予想が目標に近い", "Closest prediction") : tx("自分で選択", "Your choice")}`
            : actionName(choice),
        );
    }
    for (const choice of EXPERIMENTS) {
      btn(`experiment-${choice}`).setAttribute("aria-pressed", String(choice === experiment));
      btn(`experiment-${choice}`).disabled = running || cleared;
    }
    el("selection").textContent = selection
      ? `${selection === "plan" ? tx("予想を比べて選択", "Suggested") : tx("自分で選択", "Your choice")}: ${actionName(action)}`
      : tx(
          "動く前の予想と、動かして確かめた結果を並べます。",
          "Keep the prediction and the checked result side by side.",
        );
    const message = status();
    if (el("status").textContent !== message) el("status").textContent = message;
    btn("continue").dataset.intent = intent();
    btn("continue").textContent = cleared
      ? tx("最初から試す", "Start again")
      : running
        ? paused
          ? tx("再開する", "Resume")
          : tx("一時停止", "Pause")
        : note === "done"
          ? complete()
            ? tx("Lessonを完了", "Complete lesson")
            : tx("次の条件を試す", "Try the next setup")
          : selection
            ? action === "none"
              ? tx("2秒待って確かめる", "Wait 2 s & check")
              : tx("2秒動かして確かめる", "Run for 2 s & check")
            : tx("予想を見る", "See predictions");
    btn("continue").disabled = completionActive;
    btn("stop").disabled = !running;
    btn("skip").disabled = !running;
    btn("retry").disabled = running || cleared;
    btn("review").disabled = running || count() === 0;
    btn("reset").disabled = running;
    btn("details").setAttribute("aria-expanded", String(details));
    btn("details").setAttribute("aria-controls", "world-details");
    el("details").hidden = !details;
    el("progress").textContent = tx(
      `実験 ${EXPERIMENTS.indexOf(experiment) + 1} / 3`,
      `Trial ${EXPERIMENTS.indexOf(experiment) + 1} / 3`,
    );
    el("insight").hidden = count() === 0;
    el("insight").textContent =
      count() > 0
        ? tx(
            "世界モデル＝動きの記録から学び、箱の状態と押し方から次の動きを予想するしくみ。",
            "World model: learned from motion records to predict what happens next from the box's state and push.",
          )
        : "";
    g.setStatus(message);
    g.setHud([
      tx("動かす前に結果を予想しよう", "Predict before moving"),
      `${initialName(initial)} · ${goalName(goal)}: ${position(WORLD_TARGET_X[goal])}`,
      selection ? actionName(action) : tx("まずは予想を見る", "First, see predictions"),
    ]);
  }
  function renderResults(): void {
    if (!root) return;
    el("records").replaceChildren();
    for (const choice of EXPERIMENTS) {
      const record = records[choice];
      if (!record) continue;
      const item = document.createElement("article");
      item.dataset.experiment = choice;
      item.dataset.goal = record.goal;
      item.dataset.choice = record.action;
      item.innerHTML = `<h4>${experimentName(choice)}</h4><small>${initialName(record.initial)} · ${tx("目標", "Target")} ${distance(WORLD_TARGET_X[record.goal] - record.initial.x)}</small><small>${actionName(record.action)} · ${record.source === "plan" ? tx("計画器の選択", "Planner's choice") : tx("手動の選択", "Manual choice")}</small><div class="world-metrics"><p data-result="prediction">${tx("予測", "Forecast")}<strong>${movement(record.prediction.finalX)}</strong></p><p data-result="actual">${tx("実際", "Actual")}<strong>${movement(record.actual.finalX)}</strong></p></div><p class="world-error">${tx("予測との差", "Prediction error")}: <strong>${distance(record.error)}</strong></p><p class="world-target-error">${tx("実際の位置から目標まで", "Actual distance to target")}: ${distance(Math.abs(record.actual.finalX - WORLD_TARGET_X[record.goal]))}</p>`;
      el("records").append(item);
    }
    const comparison =
      records.far && records.moving
        ? forecastComparison(records.far, "moving", records.moving.candidates)
        : records.near && records.far
          ? forecastComparison(records.near, "far", records.far.candidates)
          : "";
    el("result-comparison").hidden = !comparison;
    el("result-comparison").textContent = comparison;
  }
  function finishRun(): void {
    if (!actual || !selection) return;
    const returnToPrimary =
      document.activeElement === btn("stop") || document.activeElement === btn("skip");
    records[experiment] = {
      experiment,
      goal,
      initial: { ...initial },
      candidates: structuredClone(candidates),
      action,
      source: selection,
      prediction: structuredClone(prediction),
      actual: structuredClone(actual),
      error: Math.abs(prediction.finalX - actual.finalX),
    };
    g.publish(
      "/world_model/result",
      `data: ${JSON.stringify(`experiment=${experiment} goal=${goal} action=${action} source=${selection} predicted_x=${prediction.finalX} actual_x=${actual.finalX} prediction_error_m=${Math.abs(prediction.finalX - actual.finalX)}`)}`,
    );
    running = false;
    paused = false;
    note = "done";
    playback = WORLD_HORIZON;
    if (returnToPrimary) details = false;
    renderResults();
    refresh();
    // Only move focus if its control just became disabled. Let readers stay in More.
    if (returnToPrimary) focus("continue");
  }
  function onCompletionClose(event: Event): void {
    if (!cleared) return;
    completionActive = false;
    refresh();
    const reason = (event as CustomEvent<{ reason: string }>).detail.reason;
    if (reason === "dismiss" || reason === "next") focus("continue");
  }
  function act(key: string): void {
    if (completionActive) return;
    if (key === "continue") key = intent();
    if (cleared && !["details", "review", "reset"].includes(key)) return;
    if (key === "details") {
      details = !details;
      refresh();
      return;
    }
    if (key === "pause" && running) {
      paused = !paused;
      refresh();
      return;
    }
    if (key === "skip" && running) {
      details = false;
      finishRun();
      focus("continue");
      return;
    }
    if (key === "stop" && running) {
      running = false;
      paused = false;
      actual = undefined;
      playback = 0;
      note = "stopped";
      details = false;
      refresh();
      focus("continue");
      return;
    }
    if (running) return;
    if (ACTIONS.includes(key as WorldAction)) prepare(key as WorldAction, "manual");
    else if (key === "retry") changeExperiment(experiment);
    else if (key === "review" && count() > 0) {
      const saved =
        records[experiment] ??
        EXPERIMENTS.map((choice) => records[choice]).find((record) => !!record)!;
      experiment = saved.experiment;
      goal = saved.goal;
      initial = { ...saved.initial };
      candidates = saved.candidates;
      action = saved.action;
      selection = saved.source;
      prediction = saved.prediction;
      actual = saved.actual;
      playback = WORLD_HORIZON;
      note = "done";
      renderResults();
    } else if (EXPERIMENTS.some((choice) => key === `experiment-${choice}`))
      changeExperiment(key.slice("experiment-".length) as Experiment);
    else if (key === "plan")
      prepare(planWorldAction(candidates, WORLD_TARGET_X[goal]).action, "plan");
    else if (key === "next") {
      const next = nextExperiment();
      if (next) changeExperiment(next);
    } else if (key === "run" && selection) {
      // Keep the prediction snapshot from before execution. Only now simulate reality.
      actual = simulateWorldTrajectory(action, { ...initial });
      running = true;
      paused = false;
      note = "ready";
      playback = 0;
      g.publish(
        "/world_model/trial",
        `data: ${JSON.stringify(`experiment=${experiment} goal=${goal} initial_velocity=${initial.velocity} action=${action} source=${selection} predicted_x=${prediction.finalX}`)}`,
      );
      refresh();
      focus("continue");
      return;
    } else if (key === "reset") {
      (g.resetStage ?? reset)();
      focus("continue");
      return;
    } else if (key === "finish" && complete()) {
      cleared = true;
      completionActive = true;
      details = false;
      refresh();
      g.awardStars(
        3,
        tx(
          "目標と初速を分けて変え、同じ世界モデルの予測と動作の結果を3つの実験で比べました。",
          "Changed target and initial velocity separately, then compared the same world model's forecasts with action outcomes in three trials.",
        ),
        0,
      );
      refresh();
      return;
    }
    details = false;
    refresh();
    focus("continue");
  }
  function reset(): void {
    const wasMounted = !!root;
    records = {};
    running = false;
    paused = false;
    details = false;
    cleared = false;
    completionActive = false;
    elapsed = 0;
    experiment = "near";
    initial = initialFor(experiment);
    goal = goalFor(experiment);
    action = "weak";
    selection = undefined;
    candidates = predictWorldCandidates(initial);
    prediction = candidates[action];
    clearTrial();
    build();
    if (wasMounted) focus("continue");
  }
  function pauseOnBlur(): void {
    if (running) {
      paused = true;
      refresh();
    }
  }
  function onVisibility(): void {
    if (document.hidden) pauseOnBlur();
  }
  function update(dt: number): void {
    if (cleared) return;
    if (!paused) elapsed += dt;
    if (!running || paused) return;
    playback = Math.min(WORLD_HORIZON, playback + Math.max(0, Math.min(dt, 0.1)));
    if (playback >= WORLD_HORIZON - 1e-9) finishRun();
  }
  function trajectoryX(run: Rollout, time: number): number {
    const next = run.trajectory.findIndex((frame) => frame.time >= time);
    const b = run.trajectory[next < 0 ? run.trajectory.length - 1 : next];
    const a = run.trajectory[Math.max(0, next < 0 ? run.trajectory.length - 1 : next - 1)];
    const alpha = a.time === b.time ? 1 : (time - a.time) / (b.time - a.time);
    return a.x + (b.x - a.x) * alpha;
  }
  function text(
    value: string,
    x: number,
    y: number,
    size = 20,
    color = "#e2e8f0",
    align: CanvasTextAlign = "center",
  ): void {
    const c = g.ctx;
    c.fillStyle = color;
    c.font = `600 ${size}px system-ui, sans-serif`;
    c.textAlign = align;
    c.fillText(value, x, y);
  }
  function draw(): void {
    const c = g.ctx;
    clearBackground(c, g.canvas.width, g.canvas.height);
    const screenX = (x: number) =>
      70 + ((x - WORLD_VIEW_MIN) / (WORLD_VIEW_MAX - WORLD_VIEW_MIN)) * 660;
    const currentX = actual ? trajectoryX(actual, playback) : initial.x;
    const boxX = screenX(currentX),
      y = 145;
    const step = phase();
    const shownCandidates = selection ? ACTIONS : [];
    text(`${goalName(goal)} · ${distance(WORLD_TARGET_X[goal] - WORLD_INITIAL.x)}`, 400, 30, 24);
    c.fillStyle = "#142137";
    c.fillRect(46, y - 50, 708, 110);
    c.strokeStyle = "#334155";
    c.lineWidth = 1;
    for (let x = 70; x < 740; x += 33) {
      c.beginPath();
      c.moveTo(x, y + 43);
      c.lineTo(x, y + 49);
      c.stroke();
    }
    c.strokeStyle = "#64748b";
    c.setLineDash([3, 5]);
    c.beginPath();
    c.moveTo(screenX(initial.x), y - 52);
    c.lineTo(screenX(initial.x), y + 65);
    c.stroke();
    c.setLineDash([]);
    const targetX = screenX(WORLD_TARGET_X[goal]);
    c.strokeStyle = "#86efac";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(targetX, y - 55);
    c.lineTo(targetX, y + 65);
    c.moveTo(targetX - 10, y + 65);
    c.lineTo(targetX + 10, y + 65);
    c.stroke();
    text(
      tx(
        `目標 · ${distance(WORLD_TARGET_X[goal] - WORLD_INITIAL.x)}`,
        `Target · ${distance(WORLD_TARGET_X[goal] - WORLD_INITIAL.x)}`,
      ),
      targetX,
      y + 90,
      22,
      "#86efac",
    );
    // Keep the same predicted markers visible while the actual box moves.
    for (const choice of shownCandidates) {
      const x = screenX(candidates[choice].finalX);
      const selected = !!selection && choice === action;
      c.fillStyle = selected ? "rgba(125,211,252,.18)" : "rgba(125,211,252,.07)";
      c.fillRect(x - 20, y - 20, 40, 40);
      text(actionName(choice), x, 80, 22, selected ? "#7dd3fc" : "#94a3b8");
    }
    c.fillStyle = "#e9a54b";
    c.fillRect(boxX - 20, y - 20, 40, 40);
    c.strokeStyle = "#ffe4b5";
    c.lineWidth = 2;
    c.strokeRect(boxX - 20, y - 20, 40, 40);
    c.beginPath();
    c.moveTo(boxX - 20, y - 8);
    c.lineTo(boxX + 20, y - 8);
    c.stroke();
    // Same dimensions and center convention for both boxes. Draw the forecast
    // outline last so even overlapping predictions remain visible as a point.
    for (const choice of shownCandidates) {
      const selected = !!selection && choice === action;
      c.strokeStyle = selected ? "#7dd3fc" : "#64849c";
      c.lineWidth = selected ? 3 : 1;
      c.setLineDash([7, 5]);
      c.strokeRect(screenX(candidates[choice].finalX) - 20, y - 20, 40, 40);
    }
    c.setLineDash([]);
    // Illustrative robot contact follows only the initial applied-force interval.
    const robotBoxX =
      actual && action !== "none"
        ? trajectoryX(actual, Math.min(playback, WORLD_PUSH_SECONDS))
        : initial.x;
    c.save();
    c.translate(screenX(robotBoxX) - 50, y);
    c.scale(1.8, 1.8);
    drawRobotBody(c, 0, elapsed);
    c.restore();
    text(tx("開始", "Start"), screenX(initial.x), y + 90, 22, "#94a3b8");
    if (initial.velocity > 0 && step < 2) {
      const arrowX = screenX(initial.x) + 30;
      c.strokeStyle = "#f5c17a";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(arrowX, y);
      c.lineTo(arrowX + 45, y);
      c.lineTo(arrowX + 36, y - 6);
      c.moveTo(arrowX + 45, y);
      c.lineTo(arrowX + 36, y + 6);
      c.stroke();
    }
    const actualLabel =
      note === "done" && actual
        ? tx(`実際 · ${WORLD_HORIZON}秒後`, `Actual · after ${WORLD_HORIZON} s`)
        : running
          ? tx(
              `実際 · ${playback.toFixed(1)} / ${WORLD_HORIZON}秒`,
              `Actual · ${playback.toFixed(1)} / ${WORLD_HORIZON} s`,
            )
          : note === "stopped"
            ? tx("中止 · 開始位置に戻しました", "Stopped · returned to the start")
            : tx("まだ動かしていません", "Not executed yet");
    text(paused ? tx("一時停止中", "Paused") : actualLabel, 400, 275, 22, "#f5c17a");
  }
  return {
    id: "world_model",
    name: "World Model Mini Lab",
    lesson: "Use learned predictions to plan an action",
    lessonCmd: "",
    get ros2() {
      return {
        title: tx("世界モデルミニラボ", "World Model Mini Lab"),
        summary: tx(
          "ブラウザ内の疑似ノードが実行前の予測と、2秒後に確認した結果を別トピックへ記録します。topic echoは直近の記録を表示します。位置・誤差はm、初速はm/sです。実際のROS 2プロセスや実機には接続しません。",
          "A simulated browser node logs the forecast before execution and the checked result after 2 s on separate topics. Topic echo displays recent log snapshots. Positions and errors are in m; initial velocity is in m/s. No ROS 2 processes or physical hardware are connected.",
        ),
        msgTypes: ["std_msgs/msg/String"],
        cli: [
          "ros2 topic echo /world_model/result",
          "ros2 topic echo /world_model/trial",
          "ros2 topic list -t",
          "ros2 topic info /world_model/trial",
          "ros2 topic info /world_model/result",
          "ros2 topic type /world_model/trial",
          "ros2 topic type /world_model/result",
          "ros2 node list",
          "ros2 node info /world_model_planner",
          "ros2 interface show std_msgs/msg/String",
        ],
        realWorld: tx(
          "予測と実測を区別して記録するための診断ログです。この教材の実測もシミュレーションで、途中中止した実行は結果トピックへ記録しません。",
          "Diagnostic logs keep predictions separate from measurements. Measurements here are simulated too; an interrupted run does not publish a completed result.",
        ),
        state: {
          nodes: ["/world_model_planner"],
          topics: [
            {
              name: "/world_model/trial",
              type: "std_msgs/msg/String",
              pub: ["/world_model_planner"],
              sub: [],
            },
            {
              name: "/world_model/result",
              type: "std_msgs/msg/String",
              pub: ["/world_model_planner"],
              sub: [],
            },
          ],
          services: [],
        },
      };
    },
    init(ctx) {
      g = ctx;
      originalCanvasHeight = g.canvas.height;
      g.canvas.height = 300;
      mountLayout();
      reset();
      offLang = onLangChange(build);
      window.addEventListener("blur", pauseOnBlur);
      document.addEventListener("visibilitychange", onVisibility);
    },
    update,
    draw,
    reset,
    dispose() {
      offLang();
      g.canvas.height = originalCanvasHeight;
      window.removeEventListener("blur", pauseOnBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (root) {
        unregisterOverlayPad(root);
        root.remove();
        root = undefined;
      }
      if (dock) dock.hidden = true;
      restoreLayout();
    },
  };
}
export default defineStage({
  mode: "lesson",
  order: 24,
  build: makeWorldModel,
  lessonModal: {
    title: {
      ja: "世界モデルミニラボ",
      en: "World Model Mini Lab",
    },
    learn: {
      ja: "ボールを押すとき、動く先を想像しますね。ロボットにも、動きの記録から学んだしくみで、押した結果を予想させてみましょう。",
      en: "Before pushing a ball, you imagine where it will go. Let a robot predict a push using a mechanism learned from motion records.",
    },
    goal: {
      ja: "予想を見て、2秒動かして確かめます。目標が遠いとき、箱が最初から動いているときも比べましょう。",
      en: "See a prediction, run for two seconds and check. Then try a farther target and a box already moving.",
    },
    first: {
      ja: "「予想を見る」を押します。続いて同じ場所のボタンで箱を動かし、同じ表に入る結果を見ましょう。",
      en: "Select “See predictions”, then use the same button to move the box and check the result in the same table.",
    },
  },
  diagram: `<svg viewBox="0 0 420 110" role="img" aria-label="予想を見る、動かす、同じ表で比べる / Predict, run, compare in the same table"><g fill="#15243b" stroke="#7dd3fc"><rect x="5" y="15" width="115" height="80" rx="8"/><rect x="152" y="15" width="115" height="80" rx="8" stroke="#f5c17a"/><rect x="300" y="15" width="115" height="80" rx="8" stroke="#86efac"/></g><g fill="#e0f2fe" text-anchor="middle" font-family="system-ui" font-size="12"><text x="62" y="45">予想を見る</text><text x="62" y="70">Predict</text><text x="136" y="58">→</text><text x="210" y="45">2秒動かす</text><text x="210" y="70">Run for 2 s</text><text x="284" y="58">→</text><text x="357" y="45">同じ表で比べる</text><text x="357" y="70">Compare</text></g></svg>`,
});
