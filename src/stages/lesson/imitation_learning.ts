// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import type { Stage, GameContext } from "../../types";
import { defineStage } from "../../core/stage_def";
import { mountLabCompletion } from "../../lib/lab_completion";
import { tx, onLangChange } from "../../i18n";
import { clearBackground, drawRobotBody } from "../../lib/draw";
import { theme, withA } from "../../core/theme";
import {
  registerOverlayPad,
  unregisterOverlayPad,
  deactivateOverlayPad,
  isOverlayPadActive,
} from "../../lib/overlaypad";
import {
  IMITATION_DT,
  IMITATION_SPEED,
  IMITATION_TESTS,
  laneCenter,
  makeLearnerRobot,
  observeLearner,
  stepLearner,
  collectRecoveryDemos,
  createCloningTrainer,
  BC_EPOCHS,
  replayAction,
  imitationSuccess,
  type Demonstration,
  type ClonedPolicy,
  type LearnerRobot,
} from "../../lib/imitation_model";
import {
  IMITATION_SOURCES,
  MAX_SAMPLES_PER_CATEGORY,
  emptyImitationCounts,
  defaultImitationSelection,
  countImitationData,
  countManualActions,
  changedImitationSources,
  appendCategoryData,
  selectImitationData,
  imitationTrainingKey,
  type ImitationSource as Source,
  type ImitationCounts as Counts,
  type CategorizedDemonstration,
} from "../../lib/imitation_data";
import { drawImitationExplainer, drawImitationText } from "../../lib/imitation_visuals";
import "../../styles/27-imitation-learning.css";

type Action =
  | `toggle-${Source}`
  | "answer-always"
  | "answer-depends"
  | "toggle-details"
  | "toggle-results"
  | "toggle-test-options"
  | "edit-data"
  | "close-editor"
  | "toggle-help"
  | "toggle-management"
  | "undo-reset"
  | "view-results"
  | "view-data"
  | "view-learning"
  | "add-recovery"
  | "manual"
  | "start"
  | "cancel"
  | "recovery"
  | "train"
  | "compare"
  | "pause"
  | "stop"
  | "reset-data"
  | "reset-learning"
  | "restart"
  | "finish";
type Mode = "idle" | "prepare" | "countdown" | "manual" | "training" | "compare" | "paused";
type Panel = "data" | "learn" | "test" | "help";
interface Model {
  policy: ClonedPolicy;
  initialPolicy: ClonedPolicy;
  revision: number;
  dataKey: string;
  counts: Counts;
  versions: Counts;
  samples: number;
}
interface Entrant {
  model?: Model;
  actions?: number[];
  role: "initial" | "previous" | "current" | "replay";
}
interface Comparison {
  entrants: Entrant[];
  runs: LearnerRobot[][];
}
function comparisonDataText(result: Comparison): string {
  const [a, b] = result.entrants;
  if (a.role !== "previous" || !a.model || !b.model) return "";
  const before = a.model;
  const after = b.model;
  const changed = changedImitationSources(
    before.counts,
    before.versions,
    after.counts,
    after.versions,
  );
  if (!changed.length)
    return tx(
      "同じ記録と初期状態から学び直した比較です。",
      "Both models were trained from the same records and initial state.",
    );
  const parts: string[] = [];
  if (before.counts.manual && after.counts.manual)
    parts.push(
      changed.includes("manual")
        ? tx("操作データは記録し直しています。", "Your driving records were updated.")
        : tx("操作データは同じです。", "Your driving records are unchanged."),
    );
  else if (changed.includes("manual"))
    parts.push(
      after.counts.manual
        ? tx("操作データを追加しました。", "Your driving data was added.")
        : tx("操作データを外しました。", "Your driving data was excluded."),
    );
  if (changed.includes("recovery"))
    parts.push(
      !after.counts.recovery
        ? tx("復帰データを外しました。", "Recovery data was excluded.")
        : !before.counts.recovery
          ? tx("復帰データを追加しました。", "Recovery data was added.")
          : tx("復帰データを用意し直しました。", "Recovery data was generated again."),
    );
  parts.push(
    before.samples !== after.samples
      ? tx(
          "件数と内容を変えた比較なので、量だけの効果は分かりません。",
          "Both the amount and content changed; this comparison cannot isolate the effect of quantity.",
        )
      : tx("学習に使った件数は同じです。", "Both used the same number of training pairs."),
  );
  return parts.join(tx("", " "));
}
const COLORS = ["#b8c2d8", "#7dd3fc"];
const emptyCounts = emptyImitationCounts;
const timeInLane = (runs: LearnerRobot[]): number => {
  const duration = runs.reduce((sum, r) => sum + r.ticks * IMITATION_DT, 0);
  return duration
    ? Math.max(
        0,
        Math.min(100, 100 * (1 - runs.reduce((sum, r) => sum + r.outsideSeconds, 0) / duration)),
      )
    : 0;
};
const successes = (runs: LearnerRobot[]): number => runs.filter(imitationSuccess).length;
function sourceName(source: Source): string {
  return source === "manual" ? tx("操作", "Your controls") : tx("復帰", "Recovery");
}
function conditionDetails(counts: Counts): string {
  return IMITATION_SOURCES.filter((source) => counts[source] > 0)
    .map((source) => `${sourceName(source)} ${counts[source]}${tx("件", " samples")}`)
    .join(" + ");
}
function entrantName(entrant: Entrant): string {
  if (entrant.role === "initial") return tx("学習前", "Before training");
  if (entrant.role === "replay") return tx("操作の再生", "Action replay");
  const sources = IMITATION_SOURCES.filter((source) => entrant.model!.counts[source] > 0).map(
    (source) => (source === "manual" ? tx("自分の操作", "Your controls") : sourceName(source)),
  );
  if (sources.length === 1) return tx(`${sources[0]}のみ`, `${sources[0]} only`);
  return sources.join(tx("＋", " + ")) || tx("データなし", "No data");
}
function actionDescription(action: number): string {
  const direction =
    Math.abs(action) < 0.05
      ? tx("— 入力ほぼなし", "— Almost no input")
      : action < 0
        ? tx("↑ 上へ", "↑ Up")
        : tx("↓ 下へ", "↓ Down");
  return `${direction} (${action.toFixed(2)})`;
}
function positionDescription(offset: number): string {
  return Math.abs(offset) < 0.01
    ? tx("ほぼ中央", "Near center")
    : offset > 0
      ? tx("中央より上", "Above center")
      : tx("中央より下", "Below center");
}
function motionDescription(velocity: number): string {
  return Math.abs(velocity) < 0.01
    ? tx("ほぼ静止", "Nearly stationary")
    : velocity > 0
      ? tx("下向き", "Moving down")
      : tx("上向き", "Moving up");
}
function caseName(index: number): string {
  return [
    tx("下から復帰", "Recover from below"),
    tx("上から復帰", "Recover from above"),
    tx("大きなずれ", "Large starting offset"),
  ][index];
}
function fitEvidenceText(policy: ClonedPolicy): string {
  const { initialLoss, finalLoss } = policy.report;
  // Compare this fit with its own initialization on the same frozen training set.
  // This is neither driving success nor a comparison between different datasets.
  const tolerance = 1e-6 * Math.max(1, initialLoss, finalLoss);
  return Math.abs(finalLoss - initialLoss) <= tolerance
    ? tx("記録全体との操作のずれ：ほぼ同じ", "Action error on all training records: unchanged")
    : finalLoss < initialLoss
      ? tx(
          "記録全体との操作のずれ：小さくなった",
          "Action error on all training records: decreased",
        )
      : tx(
          "記録全体との操作のずれ：大きくなった",
          "Action error on all training records: increased",
        );
}

export function makeImitationLearning(): Stage {
  let g!: GameContext,
    root: HTMLElement | undefined,
    dock: HTMLElement,
    offLang = () => {};
  let restoreCompletion = () => {};
  let completionActive = false;
  let lastStatus = "";
  let panel: Panel = "data";
  let editingData = false,
    helpOpen = false,
    manageOpen = false,
    reviewingLearning = false;
  let samples: CategorizedDemonstration[] = [],
    counts = emptyCounts(),
    recorded: number[] = [],
    pending: number[] = [];
  let lastRecordedAction = 0;
  let current: Model | undefined,
    previous: Model | undefined,
    revision = 0;
  let useSources = defaultImitationSelection(),
    versions = emptyCounts();
  let fittingSet: Omit<Model, "policy" | "revision"> | undefined;
  let reflection: "always" | "depends" | undefined;
  let showDetails = false;
  let showResultDetails = false;
  let showTestOptions = false;
  const steeringPointers = new Map<number, number>();
  const steeringKeys = new Set<number>();
  const releaseSteering = () => {
    steeringPointers.clear();
    steeringKeys.clear();
    root
      ?.querySelectorAll(".il-steering .is-held")
      .forEach((button) => button.classList.remove("is-held"));
  };
  const releaseHiddenSteering = () => {
    if (document.hidden) releaseSteering();
  };
  let undoReset: (() => void) | undefined;
  let trainer: ReturnType<typeof createCloningTrainer> | undefined;
  let displayedPolicy: ClonedPolicy | undefined;
  let mode: Mode = "idle",
    resumeMode: "manual" | "compare" = "compare",
    view: "manual" | "compare" = "manual";
  let countdown = 3,
    speed = 1,
    selected: "initial" | "previous" | "replay" = "initial",
    cleared = false;
  let robots = [makeLearnerRobot(), makeLearnerRobot()],
    trails: [number, number][][] = [[], []];
  let course = 0,
    testIndex = 0,
    accumulator = 0,
    uiClock = 0,
    betweenCases = 0;
  let entrants: Entrant[] = [],
    evaluations: LearnerRobot[][] = [[], []],
    results: Comparison[] = [];
  let note:
    | "ready"
    | "added"
    | "trained"
    | "collected"
    | "stopped"
    | "done"
    | "data-reset"
    | "learning-reset"
    | "restored" = "ready";
  const selectedData = () => selectImitationData(samples, useSources);
  const selectedCounts = () => countImitationData(selectedData());
  const trainingKey = () => imitationTrainingKey(counts, versions, useSources);
  const dirty = () => !!current && current.dataKey !== trainingKey();
  const latest = () => results.at(-1);
  const evaluated = () => !!current && results.some((r) => r.entrants[1].model === current);
  const active = () => mode !== "idle";
  function allowed(action: Action): boolean {
    if (completionActive) return false;
    if (cleared)
      return [
        "restart",
        "toggle-help",
        "toggle-details",
        "toggle-results",
        "view-learning",
        "view-results",
        "answer-always",
        "answer-depends",
      ].includes(action);
    if (["edit-data", "close-editor", "toggle-help", "toggle-management"].includes(action))
      return !active();
    if (action === "toggle-details") return !!current || !!trainer;
    if (action === "toggle-results") return !!latest();
    if (action === "toggle-test-options") return !active();
    if (action === "undo-reset") return !!undoReset && !active();
    if (action === "view-results") return !!latest() && !active();
    if (action === "view-data") return !active();
    if (action === "view-learning") return !!current && !dirty() && !active();
    if (action === "reset-data") return samples.length > 0 || !!current || active();
    if (action === "reset-learning") return !!current || !!trainer;
    if (action === "start" || action === "cancel") return mode === "prepare";
    if (action === "stop")
      return (
        mode === "countdown" ||
        mode === "manual" ||
        mode === "training" ||
        mode === "compare" ||
        mode === "paused"
      );
    if (action === "pause") return mode === "manual" || mode === "compare" || mode === "paused";
    if (active()) return false;
    if (action === "recovery" || action === "add-recovery" || action === "toggle-recovery")
      return counts.manual >= 20;
    if (action.startsWith("answer-")) return !!latest();
    if (action === "train") return selectedData().length >= 20 && (!current || dirty());
    if (action === "compare")
      return (
        !!current &&
        !dirty() &&
        (selected === "previous" ? !!previous : selected === "replay" ? recorded.length > 0 : true)
      );
    if (action === "finish") return evaluated() && !dirty();
    return true;
  }
  function primary(): { action: Action; label: string; hint: string } {
    if (!active() && reviewingLearning)
      return {
        action: "view-results",
        label: tx("走行の結果に戻る", "Back to driving results"),
        hint: tx(
          "記録への当てはまりと、走行結果を見比べましょう。",
          "Compare the fit to examples with the driving results.",
        ),
      };
    if (!active() && helpOpen)
      return {
        action: "toggle-help",
        label: tx("実験に戻る", "Back to the experiment"),
        hint: tx(
          "記録の操作をまねることと、走行の成功は別に確認します。",
          "Check imitation and driving success separately.",
        ),
      };
    if (!active() && manageOpen)
      return {
        action: "toggle-management",
        label: tx("実験に戻る", "Back to the experiment"),
        hint: tx("消す範囲を確認してから選びましょう。", "Choose what to clear before resetting."),
      };
    if (cleared)
      return {
        action: "restart",
        label: tx("最初から", "Start over"),
        hint: tx(
          "Lesson完了。結果と学習の記録を見返せます。",
          "Lesson complete. Review the results and learning records.",
        ),
      };
    if (!active() && editingData)
      return {
        action: "close-editor",
        label: tx("この選択で続ける", "Continue with this selection"),
        hint: tx(
          "「使う」にしたデータだけが学習の対象です。",
          "Only enabled examples are used for training.",
        ),
      };
    if (active())
      return {
        action:
          mode === "prepare"
            ? "start"
            : mode === "training" || mode === "countdown"
              ? "stop"
              : "pause",
        label:
          mode === "prepare"
            ? tx("記録を始める", "Start recording")
            : mode === "training"
              ? tx("学習を中止", "Stop training")
              : mode === "countdown"
                ? tx("記録を中止", "Cancel recording")
                : mode === "paused"
                  ? tx("再開する", "Resume")
                  : tx("一時停止", "Pause"),
        hint:
          mode === "prepare"
            ? tx(
                "開始すると、3秒のカウントダウンの後に走り出します。",
                "Recording starts after a three-second countdown.",
              )
            : mode === "training"
              ? tx("実演の操作に予測を近づけています。", "Fitting the demonstrated actions.")
              : tx("ここで一時停止・再開できます。", "Pause or resume here."),
      };
    if (
      selectedData().length < 20 &&
      counts.manual > 0 &&
      useSources.manual &&
      !useSources.recovery
    )
      return {
        action: "manual",
        label: tx("もう一度、自分で記録する", "Record another demonstration"),
        hint: tx(
          "学習には20場面以上が必要です。少し長めに運転してみましょう。",
          "Training needs at least 20 moments. Drive a little longer.",
        ),
      };
    if (samples.length === 0)
      return {
        action: "manual",
        label: tx("操作データを集める", "Record your driving"),
        hint: tx(
          "まずは自分で運転します。操作方法を確認してから記録を始めましょう。",
          "Drive the robot yourself. Review the controls before recording.",
        ),
      };
    if (selectedData().length < 20)
      return {
        action: "edit-data",
        label: tx("学習に使うデータを選ぶ", "Choose training data"),
        hint: tx(
          "カテゴリの「使う／使わない」で、合計20件以上を選びましょう。",
          "Use the category toggles to select at least 20 examples.",
        ),
      };
    if (!current || dirty())
      return {
        action: "train",
        label: current
          ? tx("選択したデータで再学習", "Retrain with selected data")
          : tx("学習する", "Train"),
        hint: current
          ? tx(
              "前のAIを残し、選んだ全データで新しいAIを初期状態から学び直します。",
              "Keep the previous AI and train a new one from the same initial state using all selected examples.",
            )
          : tx(
              "選んだデータに記録された操作を学習します。",
              "Learn which action was recorded for each situation.",
            ),
      };
    if (!evaluated())
      return {
        action: "compare",
        label:
          previous && selected === "previous"
            ? tx("前回と今回を比べる", "Compare both models")
            : selected === "replay"
              ? tx("操作の再生と学習モデルを走らせる", "Run replay and the trained model")
              : tx("学習前後を比べる", "Compare before and after"),
        hint:
          selected === "replay"
            ? tx(
                "状況を見ない操作の再生と、状況から操作を選ぶモデルを比べます。",
                "Compare timed action replay with a model that responds to the current situation.",
              )
            : previous && selected === "previous"
              ? tx(
                  "同じ3コースを自動で走ります。テスト中は学習しません。",
                  "Both drive the same three courses automatically. No learning happens during the tests.",
                )
              : tx(
                  "同じ3コースで、走り方の違いを確かめます。",
                  "Compare how both models drive the same 3 courses.",
                ),
      };
    if (current.counts.recovery === 0)
      return {
        action: "add-recovery",
        label: tx("復帰データを追加する", "Add recovery data"),
        hint: tx(
          "任意：プログラムで生成した「ずれから戻る操作」100件を追加します。自分の記録は残ります。",
          "Optional: add 100 program-generated recovery pairs. Your own records are kept.",
        ),
      };
    return {
      action: "finish",
      label: tx("Lessonを完了", "Complete lesson"),
      hint: tx(
        "記録への近さと、走行の結果を分けて確かめました。自分の記録を変えて、さらに試せます。",
        "You checked how closely it imitates your records and how it drives. Try changing your records to explore further.",
      ),
    };
  }
  function statusText(): string {
    if (cleared)
      return tx(
        "Lesson完了。記録を見返すか、「最初から」で再開できます。",
        "Lesson complete. Review the records or choose Start over.",
      );
    if (mode === "training")
      return tx(
        `学習の進み具合 ${Math.round((trainer!.epoch / BC_EPOCHS) * 100)}% — 記録と近い操作になるよう調整しています。`,
        `Training progress: ${Math.round((trainer!.epoch / BC_EPOCHS) * 100)}% — adjusting predictions toward demonstrated actions.`,
      );
    if (mode === "prepare")
      return tx(
        "まだ記録していません。操作を確認してから、記録を始めましょう。",
        "Recording has not started. Review the controls, then choose Start recording.",
      );
    if (mode === "countdown")
      return tx(
        "開始まであと少し。上下の操作キーに指を置きましょう。",
        "Get ready. Place your fingers on the up/down controls.",
      );
    if (mode === "manual")
      return tx(
        "記録中：右へ自動で進みます。上下に操舵して、中央の点線をたどりましょう。",
        "Recording: forward motion is automatic. Steer up/down along the dashed center line.",
      );
    if (mode === "paused")
      return tx(
        "一時停止中。左右の軌跡をゆっくり確認できます。",
        "Paused. Take your time to inspect the trajectories.",
      );
    if (mode === "compare")
      return `${tx("テスト", "Test")} ${testIndex + 1}/3 — ${caseName(testIndex)} · ${tx("同じコース・同じ開始位置・同じ速度", "Same course, start and speed")}`;
    if (dirty())
      return tx(
        "学習データの選択または内容が変わりました。再学習すると「前回」と「今回」を比較できます。",
        "The training selection or its data has changed. Retrain to compare the previous and current models.",
      );
    if (note === "data-reset")
      return tx(
        "データ・学習済みモデル・比較結果をリセットしました。新しい記録から始められます。",
        "Demonstrations, learned models and comparison results were reset. Start with new examples.",
      );
    if (note === "learning-reset")
      return tx(
        "学習をリセットしました。記録は残っています。このデータで再び学習できます。",
        "Learning was reset. Your demonstrations are retained and ready to train again.",
      );
    if (note === "restored")
      return tx(
        "リセット前のデータと完了済みの学習・比較を戻しました。途中の実行は再開しません。",
        "Restored the data, completed models and comparisons from before reset. Unfinished work is not resumed.",
      );
    if (note === "done")
      return tx(
        "比較完了。下の結果で「何が変わったか」を確認しましょう。",
        "Comparison complete. See what changed in the results below.",
      );
    if (note === "trained")
      return tx(
        "学習しました。比較をスタートして、記録を反映した動きを確認しましょう。",
        "Training complete. Start a comparison to see how the demonstrations affect behavior.",
      );
    if (note === "collected")
      return tx(
        "操作を保存しました。次は、このデータで学習します。",
        "Demonstration recorded. Next, learn from this data.",
      );
    if (note === "stopped")
      return tx(
        "中止しました。記録は保持し、途中の学習・テストは採用しません。",
        "Stopped. Demonstrations are retained; unfinished fitting and tests are discarded.",
      );
    if (!samples.length)
      return tx(
        "まずは自分の操作を記録し、そのデータでAIを学習させよう。",
        "First record your own driving, then train the AI on your actions.",
      );
    if (note === "added")
      return tx(
        `${selectedData().length}件の記録を用意しました。次は、このデータでAIを学習します。`,
        `${selectedData().length} examples are ready. Next, train an AI on this data.`,
      );
    return tx(
      "記録を変えると、ロボットの行動はどう変わる？",
      "How do different demonstrations change the robot’s behavior?",
    );
  }
  function button(action: Action, label: string, kind = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.action = action;
    b.className = `il-button ${kind}`;
    b.textContent = label;
    b.onclick = () => act(action);
    // Keep native Space activation instead of the global driving emergency stop.
    b.addEventListener("keydown", (event) => {
      if (event.key === " ") event.stopPropagation();
    });
    return b;
  }
  function section(title: string, description: string): HTMLElement {
    const el = document.createElement("section");
    el.className = "il-section";
    const h = document.createElement("h3");
    h.textContent = title;
    const p = document.createElement("p");
    p.textContent = description;
    el.append(h, p);
    return el;
  }
  function resetControl(
    action: "reset-data" | "reset-learning",
    label: string,
    description: string,
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "il-reset-row";
    const help = document.createElement("p");
    help.id = `il-${action}-help`;
    help.textContent = description;
    const control = button(action, label, "il-reset-button");
    control.setAttribute("aria-describedby", help.id);
    row.append(control, help);
    return row;
  }
  function stat(label: string, value: string): HTMLElement {
    const el = document.createElement("div");
    el.className = "il-stat";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    el.append(strong, span);
    return el;
  }
  function buildPanel(): void {
    releaseSteering();
    lastStatus = "";
    if (root) {
      unregisterOverlayPad(root);
      root.remove();
    }
    dock = document.getElementById("stage-controls-dock") ?? g.overlay;
    dock.hidden = false;
    root = document.createElement("section");
    root.className = "stage-tool-panel imitation-lab";
    root.setAttribute("aria-label", tx("模倣学習ミニラボ", "Imitation Learning Mini Lab"));
    const workflow = document.createElement("ol");
    workflow.className = "il-workflow";
    workflow.setAttribute("aria-label", tx("実験の進み方", "Experiment steps"));
    [tx("データ", "Data"), tx("学習", "Train"), tx("比較", "Compare")].forEach((label, i) => {
      const item = document.createElement("li");
      const number = document.createElement("span");
      number.className = "il-workflow-number";
      number.textContent = String(i + 1);
      const name = document.createElement("span");
      name.textContent = label;
      item.append(number, name);
      workflow.append(item);
    });
    const concept = section(
      tx("教える内容を変えると、走り方は変わる？", "Do different examples change how it drives?"),
      tx(
        "自分の操作を記録し、AIに「この状況では、この操作」を学習させます。操作を記録 → 学習する → 走らせる、の順に進めましょう。",
        "Record your own actions and teach the AI which action was chosen in each situation. Record → train → compare driving.",
      ),
    );
    concept.classList.add("il-concept");
    const purpose = document.createElement("p");
    purpose.textContent = tx(
      "記録をまねることと、うまく走れることは別。失敗した操作も学習するのが、この実験のポイントです。",
      "Imitating an action and driving successfully are different. Mistakes in the examples are learned too.",
    );
    concept.append(purpose);
    const observationHelp = document.createElement("p");
    observationHelp.textContent = tx(
      "AIへの入力は、中央線に対する位置と動きの2つです。画面の画像や先のコース、経過時間は入力しません。",
      "The AI receives two measurements: position and motion relative to the lane center. Images, the road ahead and elapsed time are not inputs.",
    );
    concept.append(observationHelp);
    const example = document.createElement("div");
    example.className = "il-example";
    example.textContent = tx(
      "データ1件の例：「中央より下で、さらに下へ動いている」→「↑ 上へ操作した」。100件は100回の走行ではなく、こんな場面が100組という意味です。",
      "One example: ‘Below the center and moving further down’ → ‘Steered ↑ up’. 100 pairs means 100 recorded moments, not 100 complete drives.",
    );
    concept.append(example);
    const next = document.createElement("div");
    next.className = "il-next";
    const lead = document.createElement("p");
    lead.dataset.nextHint = "";
    next.append(lead, button("manual", "", "il-primary"));
    const undo = button("undo-reset", tx("リセットを取り消す", "Undo reset"));
    undo.classList.add("il-undo");
    undo.title = tx("次の実験操作まで取り消せます", "Available until the next experiment action");
    const brief = section(
      tx("記録の前に、操作を確認", "Before recording: learn the controls"),
      tx(
        "右への移動は自動です。あなたは上下だけを操作します。",
        "Forward movement is automatic. You only control up and down.",
      ),
    );
    brief.classList.add("il-brief");
    brief.hidden = true;
    const keys = document.createElement("div");
    keys.className = "il-key-grid";
    for (const [symbol, label, detail] of [
      ["↑ / W", tx("上へ操舵", "Steer up"), tx("スティックを上へ", "Stick up")],
      ["↓ / S", tx("下へ操舵", "Steer down"), tx("スティックを下へ", "Stick down")],
    ]) {
      const key = document.createElement("div");
      const k = document.createElement("kbd");
      k.textContent = symbol;
      const strong = document.createElement("strong");
      strong.textContent = label;
      const small = document.createElement("span");
      small.textContent = detail;
      key.append(k, strong, small);
      keys.append(key);
    }
    const instructions = document.createElement("p");
    instructions.textContent = tx(
      "中央の点線をたどろう。タッチは「上へ／下へ」を長押し。離しても慣性で動き、「入力なし」も記録されます。約11秒間、失敗も含めて記録し、新しい100件を残します。",
      "Follow the dashed center line. Hold Up or Down on touch screens. Releasing leaves some inertia, and no input is recorded too. Record about 11 seconds, including mistakes; keep the newest 100 pairs.",
    );
    const inputPair = document.createElement("p");
    inputPair.className = "il-input-pair";
    inputPair.textContent = tx(
      "保存する組：中央に対する位置・動き → その時の操作",
      "Each record: position + motion relative to center → your action",
    );
    brief.append(keys, instructions, inputPair);
    const recordSummary = document.createElement("section");
    recordSummary.className = "il-record-summary";
    recordSummary.setAttribute("aria-label", tx("保存した操作の内訳", "Recorded actions"));
    const actionCounts = document.createElement("p");
    actionCounts.dataset.actionCounts = "";
    const recordingNote = document.createElement("p");
    recordingNote.dataset.recordingNote = "";
    recordSummary.append(actionCounts, recordingNote);
    const workshop = document.createElement("div");
    workshop.className = "il-workshop";
    const data = section(
      tx("学習データ", "Training data"),
      tx(
        "1件＝そのときの状況と操作。各100件まで。「使う」を選んだデータだけで学習します。",
        "One pair = a situation and an action. Up to 100 per category. Only enabled data is used for training.",
      ),
    );
    const distribution = document.createElement("div");
    distribution.className = "il-distribution";
    for (const source of IMITATION_SOURCES) {
      const row = document.createElement("div");
      row.className = "il-category";
      row.dataset.category = source;
      const info = document.createElement("div");
      const label = document.createElement("strong");
      label.textContent =
        source === "manual"
          ? tx("操作データ", "Your driving data")
          : tx("復帰データ", "Recovery data");
      const count = document.createElement("span");
      count.className = "il-category-count";
      const description = document.createElement("span");
      description.className = "il-category-description";
      description.textContent =
        source === "manual"
          ? tx("あなたの操作。失敗もそのまま記録", "Your own actions, including mistakes")
          : tx(
              "制御ルールで生成した、ずれから戻る操作",
              "Recovery actions generated by a control rule",
            );
      info.append(label, description, count);
      const toggle = button(`toggle-${source}`, "", "il-category-toggle");
      toggle.setAttribute("role", "checkbox");
      toggle.setAttribute(
        "aria-label",
        tx(`${label.textContent}を学習に使う`, `Use ${label.textContent} for training`),
      );
      const collect = button(
        source === "manual" ? "manual" : source,
        source === "manual" ? tx("自分で記録", "Record yours") : tx("データを用意", "Get data"),
      );
      const actions = document.createElement("div");
      actions.className = "il-category-actions";
      actions.append(toggle, collect);
      row.append(info, actions);
      distribution.append(row);
    }
    const selectionSummary = document.createElement("p");
    selectionSummary.className = "il-selection-summary";
    const modelState = document.createElement("p");
    modelState.className = "il-model-state";
    const collectionHelp = document.createElement("p");
    collectionHelp.className = "il-data-help";
    collectionHelp.textContent = tx(
      "操作データは新しい100件を保持します。復帰データは、あらかじめ決めた制御ルールで、ずれた位置から中央へ戻る操作を生成した100件です。再取得すると入れ替わります。",
      "The newest 100 driving pairs are retained. Recovery supplies 100 pairs generated by a fixed control rule that returns from offset positions toward the center. Recollection replaces them.",
    );
    data.append(distribution, selectionSummary, modelState);
    concept.append(collectionHelp);
    const dataReset = resetControl(
      "reset-data",
      tx("最初からやり直す", "Start over"),
      tx(
        "記録・学習済みモデル・比較結果を消去します。実行中の処理も停止します。",
        "Clears demonstrations, learned models and comparison results. Stops any active run or fitting.",
      ),
    );
    const test = section(
      tx("学習したら、3つの条件でテスト", "After training: test 3 conditions"),
      tx(
        "データの種類とは別の、3つの走行テストです。学習に使わないコースで、開始位置を変えます。左右は同じ条件です。",
        "These 3 driving tests are separate from the data categories. Use courses excluded from training and different start offsets. Both sides get identical conditions.",
      ),
    );
    const targetLabel = document.createElement("label");
    targetLabel.textContent = tx("比較相手", "Compare against");
    const target = document.createElement("select");
    target.dataset.comparison = "";
    for (const [value, label] of [
      ["initial", tx("学習前のモデル（初期状態）", "Before training (initial model)")],
      ["previous", tx("前回の学習モデル", "Previous learned model")],
      ["replay", tx("操作再生（学習なしの比較用）", "Action replay (no learning baseline)")],
    ]) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = label;
      target.append(o);
    }
    target.value = selected;
    target.onchange = () => {
      selected = target.value as typeof selected;
      refresh();
    };
    targetLabel.append(target);
    const speedLabel = document.createElement("label");
    speedLabel.textContent = tx("再生速度", "Playback speed");
    const speeds = document.createElement("select");
    speeds.dataset.speed = "";
    for (const n of [0.5, 1, 2]) {
      const o = document.createElement("option");
      o.value = String(n);
      o.textContent = `${n}×${n === 1 ? tx("（標準）", " (normal)") : ""}`;
      speeds.append(o);
    }
    speeds.value = String(speed);
    speeds.onchange = () => {
      speed = Number(speeds.value);
      refresh();
    };
    speedLabel.append(speeds);
    const testActions = document.createElement("div");
    testActions.className = "il-actions";
    testActions.append(button("toggle-test-options", tx("比較の設定", "Test settings")));
    const options = document.createElement("div");
    options.id = "il-test-options";
    options.className = "il-test-options";
    options.append(targetLabel, speedLabel);
    testActions
      .querySelector<HTMLButtonElement>('[data-action="toggle-test-options"]')!
      .setAttribute("aria-controls", options.id);
    test.append(testActions, options);
    const cases = document.createElement("ol");
    cases.className = "il-cases";
    IMITATION_TESTS.forEach((test, index) => {
      const item = document.createElement("li");
      const title = document.createElement("strong");
      title.textContent = `${index + 1}. ${caseName(index)}`;
      const description = document.createElement("span");
      description.textContent = tx(
        `中央より${test.offset > 0 ? "下" : "上"}${index === 2 ? "に大きく離れて" : "から"}開始`,
        `Start ${index === 2 ? "far " : ""}${test.offset > 0 ? "below" : "above"} the center`,
      );
      item.append(title, description);
      cases.append(item);
    });
    concept.append(cases);
    workshop.append(data, test);
    const live = document.createElement("div");
    live.className = "il-live";
    live.setAttribute("aria-label", tx("現在の試験", "Current test"));
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute("aria-label", tx("走行の進捗", "Run progress"));
    const liveLabel = document.createElement("span");
    live.append(liveLabel, progress);
    const result = document.createElement("section");
    result.className = "il-results";
    result.setAttribute("aria-label", tx("比較結果", "Comparison results"));
    const fitting = document.createElement("section");
    fitting.className = "il-section il-fitting";
    fitting.setAttribute("aria-label", tx("学習の結果", "Training results"));
    const evidence = document.createElement("div");
    evidence.className = "il-fit-evidence";
    const learningReset = resetControl(
      "reset-learning",
      tx("学習結果だけ消す", "Clear learned results"),
      tx(
        "記録を残し、重み・学習曲線・比較結果を消去します。実行中の処理も停止します。",
        "Keeps demonstrations; clears weights, loss curves and comparison results. Stops any active run or fitting.",
      ),
    );
    fitting.append(evidence);
    const detailsToggle = button("toggle-details", tx("学習の詳細", "Learning details"));
    detailsToggle.classList.add("il-details-toggle");
    detailsToggle.setAttribute("aria-controls", "il-fit-details");
    const advanced = document.createElement("div");
    advanced.id = "il-fit-details";
    advanced.className = "il-fit-details";
    fitting.append(detailsToggle, advanced);
    const help = document.createElement("small");
    help.textContent = tx(
      "Tab / Enterで操作。ゲームパッドはAで設定、Bで走行に戻る。Rで実験を初期化。",
      "Tab / Enter for controls. Gamepad: A for settings, B to return. R resets the experiment.",
    );
    const body = document.createElement("div");
    body.className = "il-body";
    const content = document.createElement("div");
    content.className = "il-content";
    for (const key of ["data", "learn", "test", "help"] as Panel[]) {
      const pane = document.createElement("section");
      pane.id = `il-pane-${key}`;
      pane.dataset.pane = key;
      pane.tabIndex = -1;
      pane.setAttribute(
        "aria-label",
        key === "data"
          ? tx("記録", "Demonstrations")
          : key === "learn"
            ? tx("学習", "Learning")
            : key === "test"
              ? tx("比較結果", "Comparison results")
              : tx("説明", "Explanation"),
      );
      if (key === "data") {
        test.classList.add("il-test-setup");
        workshop.replaceChildren(data, test);
        pane.append(brief, recordSummary, workshop);
      }
      if (key === "learn") pane.append(fitting);
      if (key === "test") {
        pane.append(result);
      }
      if (key === "help") pane.append(concept, help);
      content.append(pane);
    }
    body.append(content);
    const secondary = document.createElement("div");
    secondary.className = "il-secondary";
    secondary.append(
      button("manual", tx("もう一度記録", "Record again")),
      button("cancel", tx("記録せずに戻る", "Back without recording")),
      button("stop", tx("中止", "Stop")),
      button("finish", tx("ここでLessonを完了", "Finish this lesson")),
      button("compare", tx("もう一度走らせる", "Run again")),
    );
    const utilities = document.createElement("div");
    utilities.className = "il-utilities";
    utilities.append(
      button("edit-data", tx("データ・記録", "Data")),
      button("toggle-help", tx("しくみ", "How it works")),
      button("toggle-management", tx("リセット", "Reset")),
    );
    const management = section(
      tx("どこからやり直す？", "What would you like to reset?"),
      tx(
        "消す範囲を選びます。直後なら取り消せます。",
        "Choose what to clear. You can undo the reset immediately afterwards.",
      ),
    );
    management.classList.add("il-management");
    management.append(learningReset, dataReset);
    const steering = document.createElement("div");
    steering.className = "il-steering";
    steering.setAttribute("aria-label", tx("手動の上下操作", "Manual steering"));
    for (const direction of [-1, 1]) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "il-button touch-button";
      control.textContent = direction < 0 ? tx("↑ 上へ", "↑ Up") : tx("↓ 下へ", "↓ Down");
      control.setAttribute(
        "aria-label",
        direction < 0
          ? tx("上へ操舵：押している間", "Steer up while held")
          : tx("下へ操舵：押している間", "Steer down while held"),
      );
      control.dataset.steer = String(direction);
      control.onpointerdown = (event) => {
        if (mode !== "manual" && mode !== "countdown") return;
        event.preventDefault();
        deactivateOverlayPad();
        control.setPointerCapture(event.pointerId);
        steeringPointers.set(event.pointerId, direction);
        control.classList.add("is-held");
      };
      const release = (event: PointerEvent) => {
        steeringPointers.delete(event.pointerId);
        control.classList.remove("is-held");
      };
      control.onpointerup = release;
      control.onpointercancel = release;
      control.onlostpointercapture = release;
      control.onkeydown = (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (mode === "manual" || mode === "countdown") steeringKeys.add(direction);
      };
      control.onkeyup = () => steeringKeys.delete(direction);
      control.onblur = () => steeringKeys.delete(direction);
      steering.append(control);
    }
    root.append(workflow, live, body, management, steering, next, secondary, undo, utilities);
    dock.replaceChildren(root);
    root.addEventListener("keydown", (event) => {
      if (event.key === " " && event.target instanceof HTMLButtonElement) event.stopPropagation();
      if (event.key === "Escape" && mode === "prepare") {
        event.preventDefault();
        event.stopPropagation();
        act("cancel");
      }
    });
    refresh();
    renderFitting();
    renderResults();
    registerOverlayPad(root, false);
  }
  function syncView(focus = false): void {
    if (!root) return;
    refresh();
    const running =
      mode === "countdown" || mode === "manual" || mode === "compare" || mode === "paused";
    const visualStep =
      !editingData &&
      !helpOpen &&
      !manageOpen &&
      mode !== "prepare" &&
      (panel === "data" || panel === "learn");
    const anchor = running || visualStep ? g.canvas.parentElement! : root;
    const rect = anchor.getBoundingClientRect();
    const actionBottom = root
      .querySelector<HTMLElement>(".il-next")!
      .getBoundingClientRect().bottom;
    if (
      rect.top < 0 ||
      rect.bottom > window.innerHeight ||
      (visualStep && actionBottom > window.innerHeight)
    )
      anchor.scrollIntoView({
        block: running || visualStep ? "start" : "nearest",
        behavior: "instant",
      });
    if (focus)
      root.querySelector<HTMLElement>(`[data-pane=${panel}]`)!.focus({ preventScroll: true });
  }
  function refresh(): void {
    if (!root) return;
    const running =
      mode === "countdown" || mode === "manual" || mode === "compare" || mode === "paused";
    const currentResult = latest()?.entrants[1].model === current && !!current && !dirty();
    // Normal navigation follows the experiment state. Only optional editors can override it.
    panel = helpOpen
      ? "help"
      : mode === "prepare" || editingData
        ? "data"
        : mode === "training"
          ? "learn"
          : running
            ? "test"
            : !current || dirty() || selectedData().length < 20
              ? "data"
              : currentResult && !reviewingLearning
                ? "test"
                : "learn";
    const next = primary(),
      nextButton = root.querySelector<HTMLButtonElement>(".il-next button")!;
    const step =
      mode === "prepare" || (view === "manual" && running) || editingData
        ? 0
        : mode === "training" || reviewingLearning
          ? 1
          : running || currentResult
            ? 2
            : current && !dirty()
              ? 1
              : 0;
    root.querySelectorAll<HTMLElement>(".il-workflow li").forEach((item, i) => {
      if (i === step) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    });
    nextButton.dataset.action = next.action;
    nextButton.onclick = () => act(next.action);
    nextButton.textContent = next.label;
    root.querySelector<HTMLElement>("[data-next-hint]")!.textContent = next.hint;
    root.querySelector<HTMLElement>(".il-next")!.hidden = false;
    root.inert = completionActive;
    root.querySelector<HTMLElement>(".il-brief")!.hidden = mode !== "prepare";
    root.querySelector<HTMLElement>(".il-workshop")!.hidden = !editingData || mode === "prepare";
    const recordSummary = root.querySelector<HTMLElement>(".il-record-summary")!;
    recordSummary.hidden = mode !== "idle" || editingData || !useSources.manual || !counts.manual;
    if (!recordSummary.hidden) {
      const actions = countManualActions(samples);
      root.querySelector<HTMLElement>("[data-action-counts]")!.textContent = tx(
        `保存した操作：↑ ${actions.up}・入力なし ${actions.neutral}・↓ ${actions.down}`,
        `Recorded: ↑ ${actions.up} · no input ${actions.neutral} · ↓ ${actions.down}`,
      );
      const recordingNote = root.querySelector<HTMLElement>("[data-recording-note]")!;
      recordingNote.textContent =
        actions.neutral === counts.manual
          ? tx(
              "入力なしだけの記録です。このまま学習するか、もう一度操作して記録できます。",
              "Only no-input actions were recorded. You can train on these, or record again using the controls.",
            )
          : actions.up === counts.manual || actions.down === counts.manual
            ? tx(
                "一方向だけの操作が記録されています。この操作もそのまま学習対象になります。",
                "Only one direction was recorded. Those actions remain the learning targets.",
              )
            : "";
      recordingNote.hidden = !recordingNote.textContent;
    }
    root.querySelector<HTMLElement>(".il-undo")!.hidden = !undoReset;
    root.dataset.panel = panel;
    root.dataset.running = String(running);
    root.dataset.recording = String(running && view === "manual");
    root.dataset.hasResults = String(currentResult);
    root.dataset.editing = String(editingData);
    root.dataset.intro = String(
      !samples.length && !active() && !editingData && !helpOpen && !manageOpen && !cleared,
    );
    root.querySelector<HTMLElement>(".il-body")!.hidden = manageOpen;
    root.querySelector<HTMLElement>(".il-management")!.hidden = !manageOpen;
    root.querySelector<HTMLElement>(".il-utilities")!.hidden = active();
    root.querySelectorAll<HTMLButtonElement>(".il-utilities button").forEach((button) => {
      button.hidden = cleared && button.dataset.action !== "toggle-help";
    });
    root.querySelector<HTMLElement>(".il-secondary")!.hidden =
      helpOpen || editingData || manageOpen || reviewingLearning || cleared;
    root.querySelectorAll<HTMLButtonElement>(".il-secondary button").forEach((b) => {
      const a = b.dataset.action;
      b.hidden =
        a === "manual"
          ? mode !== "idle" || panel !== "data" || !counts.manual || next.action === "manual"
          : a === "cancel"
            ? mode !== "prepare"
            : a === "stop"
              ? !running
              : a === "finish"
                ? !currentResult || active() || next.action === "finish"
                : !currentResult || active();
    });
    root.querySelectorAll<HTMLElement>("[data-pane]").forEach((pane) => {
      pane.hidden = pane.dataset.pane !== panel || running;
    });
    root.querySelector<HTMLElement>(".il-results")!.hidden = !currentResult;
    root.querySelector<HTMLElement>(".il-test-setup")!.hidden = !current || dirty() || cleared;
    root.querySelector<HTMLElement>(".il-test-options")!.hidden = !showTestOptions;
    root
      .querySelector<HTMLButtonElement>('[data-action="toggle-test-options"]')!
      .setAttribute("aria-expanded", String(showTestOptions));
    const evaluationState = root.querySelector<HTMLElement>(".il-test-setup > p")!;
    evaluationState.textContent = !current
      ? tx(
          "まず記録を用意して学習しましょう。学習後に3条件で走行を比べます。",
          "Prepare examples and train first, then compare driving in 3 conditions.",
        )
      : dirty()
        ? tx(
            "データの変更はまだ学習していません。再学習してから比較しましょう。",
            "Data changes are not trained yet. Retrain before comparing.",
          )
        : !currentResult
          ? tx(
              `v${current.revision} はまだ走行テスト前です。学習に使わない3コースを、同じ開始位置で比べます。`,
              `v${current.revision} has not been tested yet. Compare on 3 courses excluded from training, using identical starts.`,
            )
          : tx(
              `v${current.revision} の結果を表示中。条件を変えて再比較できます。`,
              `Showing results for v${current.revision}. You can change the baseline and compare again.`,
            );
    const detailsToggle = root.querySelector<HTMLButtonElement>("[data-action=toggle-details]")!;
    detailsToggle.hidden = !current && !trainer;
    detailsToggle.setAttribute("aria-expanded", String(showDetails));
    root.querySelector<HTMLElement>(".il-fit-details")!.hidden =
      !showDetails || (!current && !trainer);
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((b) => {
      b.disabled = !allowed(b.dataset.action as Action);
      if (b.dataset.action === "pause")
        b.textContent = mode === "paused" ? tx("再開", "Resume") : tx("一時停止", "Pause");
    });
    const msg = statusText();
    if (lastStatus !== msg) {
      lastStatus = msg;
      g.setStatus(msg);
    }
    g.setHud([
      `${tx("今回使うデータ", "Selected data")}: ${selectedData().length} / ${MAX_SAMPLES_PER_CATEGORY * IMITATION_SOURCES.length}`,
      `${tx("学習済み", "Trained")}: ${current?.samples ?? 0}`,
      `${tx("比較対象", "Comparison")}: ${selected === "previous" ? tx("前回 → 今回", "Previous → current") : selected === "initial" ? tx("学習前 → 学習後", "Untrained → trained") : tx("操作再生 → 学習", "Replay → learned")}`,
    ]);
    for (const source of IMITATION_SOURCES) {
      const row = root.querySelector<HTMLElement>(`[data-category=${source}]`)!;
      if (source === "recovery")
        row.querySelector<HTMLElement>(".il-category-description")!.textContent =
          counts.manual < 20
            ? tx("操作データを20件集めると追加できます", "Record 20 driving pairs to unlock")
            : tx("ずれから戻る、生成した補助データ", "Generated examples of returning to the lane");
      row.querySelector<HTMLElement>(".il-category-count")!.textContent =
        `${counts[source]} / ${MAX_SAMPLES_PER_CATEGORY} ${tx("件", "pairs")}`;
      row.classList.toggle("is-selected", useSources[source]);
      const toggle = row.querySelector<HTMLButtonElement>("button")!;
      toggle.setAttribute("aria-checked", String(useSources[source]));
      toggle.textContent = useSources[source] ? tx("✓ 使う", "✓ Use") : tx("使わない", "Exclude");
    }
    const selectedSize = selectedData().length;
    root.querySelector<HTMLElement>(".il-selection-summary")!.textContent = selectedSize
      ? `${tx("今回使うデータ", "Selected for training")}: ${conditionDetails(selectedCounts())} · ${tx("計", "Total")} ${selectedSize}${tx("件", " pairs")}`
      : samples.length
        ? tx(
            "学習に使うデータが0件です。データのあるカテゴリを「使う」にしてください。",
            "No training data selected. Enable a category with recorded data.",
          )
        : tx(
            "まだデータがありません。「自分で記録」から操作データを集めましょう。",
            "No data yet. Choose Record yours to collect your driving data.",
          );
    root.querySelector<HTMLElement>(".il-model-state")!.textContent = dirty()
      ? tx("● 選択・データの変更は未学習です", "● Selection or data changes are not trained yet")
      : current
        ? `${tx("学習済み", "Trained")} v${current.revision} · ${conditionDetails(current.counts)}`
        : tx(
            "学習前 · 選択したデータが20件以上で学習できます",
            "Not trained · select at least 20 pairs to train",
          );
    root.querySelector<HTMLElement>(".il-model-state")!.classList.toggle("is-dirty", dirty());
    const target = root.querySelector<HTMLSelectElement>("[data-comparison]")!;
    target.value = selected;
    target.disabled = active() || cleared;
    target.querySelector<HTMLOptionElement>("option[value=previous]")!.disabled = !previous;
    target.querySelector<HTMLOptionElement>("option[value=replay]")!.disabled = !recorded.length;
    root.querySelector<HTMLSelectElement>("[data-speed]")!.disabled =
      mode === "manual" ||
      mode === "prepare" ||
      mode === "countdown" ||
      mode === "training" ||
      cleared;
    const live = root.querySelector<HTMLElement>(".il-live")!;
    live.hidden = mode === "idle" || mode === "prepare" || mode === "training";
    live.querySelector("span")!.textContent =
      view === "compare"
        ? `${tx("テスト", "Test")} ${Math.min(testIndex + 1, 3)} / 3`
        : mode === "countdown"
          ? `${tx("開始まで", "Starting in")} ${Math.ceil(countdown)}`
          : tx("操作を記録中", "Recording your demonstration");
    live.querySelector("progress")!.value = Math.min(
      100,
      view === "compare"
        ? ((testIndex + (robots[0].x - 60) / 680) / 3) * 100
        : ((robots[0].x - 60) / 680) * 100,
    );
    root.dataset.mode = mode;
    root.dataset.cleared = String(cleared);
  }
  function renderFitting(): void {
    if (!root) return;
    const host = root.querySelector<HTMLElement>(".il-fit-evidence")!;
    const details = root.querySelector<HTMLElement>(".il-fit-details")!;
    details.replaceChildren();
    host.replaceChildren();
    const policy = mode === "training" ? trainer!.snapshot() : current?.policy;
    displayedPolicy = policy;
    if (!policy) {
      const p = document.createElement("p");
      p.className = "il-empty";
      p.textContent = tx(
        "学習すると、実測の誤差と実演・予測の対応を表示します。",
        "Train to see measured action error and demonstration/prediction pairs.",
      );
      host.append(p);
      return;
    }
    const report = policy.report;
    const sample = report.examples[0];
    const probe = document.createElement("div");
    probe.className = "il-probe";
    if (sample) {
      const situation = document.createElement("p");
      const [offset, velocity] = sample.observation;
      situation.textContent = tx(
        `保存した最初の場面：${positionDescription(offset)}。中央に対して${motionDescription(velocity)}。`,
        `First recorded situation: ${positionDescription(offset)}; ${motionDescription(velocity).toLowerCase()} relative to the center.`,
      );
      const cards = document.createElement("div");
      cards.className = "il-probe-cards";
      const initial = mode === "training" ? fittingSet!.initialPolicy : current!.initialPolicy;
      for (const [label, value] of [
        [tx("記録した操作", "Recorded action"), sample.action],
        [tx("学習前の予測", "Before training"), initial(sample.observation)],
        [
          mode === "training"
            ? tx("学習中の予測", "During training")
            : tx("学習後の予測", "After training"),
          policy(sample.observation),
        ],
      ] as const)
        cards.append(stat(label, actionDescription(value)));
      const caveat = document.createElement("p");
      caveat.textContent = tx(
        "矢印は向き、括弧内は強さ（−1〜＋1）。これは学習に使った1件の例です。全データの誤差は詳細で確認できます。",
        "Arrows show direction; numbers show strength (−1 to +1). This is one training example. See details for error across all training data.",
      );
      probe.append(situation, cards, caveat);
    }
    const metrics = document.createElement("div");
    metrics.className = "il-result-metrics";
    metrics.append(
      stat(tx("学習前の操作MSE", "Initial action MSE"), report.initialLoss.toFixed(5)),
      stat(tx("現在の操作MSE", "Current action MSE"), report.finalLoss.toFixed(5)),
    );
    const caption = document.createElement("p");
    caption.className = "il-result-caption";
    caption.textContent = `${tx("学習データ：", "Training data: ")}${conditionDetails(mode === "training" ? fittingSet!.counts : current!.counts)}`;
    const fitEvidence = document.createElement("p");
    fitEvidence.className = "il-fit-takeaway";
    fitEvidence.textContent = fitEvidenceText(policy);
    const trainingInfo = document.createElement("p");
    trainingInfo.textContent = `${mode === "training" ? tx("学習中", "Fitting") : `v${current!.revision}`} · ${report.epochs}/${BC_EPOCHS} ${tx("エポック（データ全体を繰り返した回数）", "epochs (passes through the full dataset)")}`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 620 140");
    svg.classList.add("il-loss-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      tx(
        "横軸はエポック、縦軸は学習データの操作MSE。実際に計算した誤差の推移。",
        "Epochs on the horizontal axis, training action MSE on the vertical axis. Measured loss history.",
      ),
    );
    const max = Math.max(...report.losses, 0.00001);
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute(
      "d",
      report.losses
        .map(
          (loss, i) => `${i ? "L" : "M"}${65 + (i / BC_EPOCHS) * 535},${112 - (loss / max) * 100}`,
        )
        .join(" "),
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#5eead4");
    path.setAttribute("stroke-width", "2");
    svg.append(path);
    for (const [x, y, label] of [
      [4, 16, max.toFixed(5)],
      [35, 115, "0"],
      [65, 135, "0"],
      [535, 135, `${BC_EPOCHS} epoch`],
    ] as const) {
      const text = document.createElementNS(svg.namespaceURI, "text");
      text.setAttribute("x", String(x));
      text.setAttribute("y", String(y));
      text.setAttribute("fill", "#b0c1d8");
      text.setAttribute("font-size", "12");
      text.textContent = label;
      svg.append(text);
    }
    const explanation = document.createElement("p");
    explanation.className = "il-result-caption";
    explanation.textContent = tx(
      "これは学習に使ったデータへの当てはまりです。未経験の場面での成功率ではありません。矛盾する実演や表現力・学習回数の限界で、操作が完全には一致しないこともあります。",
      "This measures fit to the training data, not success in unseen situations. Conflicting demonstrations, model capacity and finite training can prevent an exact match.",
    );
    const rule = document.createElement("p");
    rule.textContent = tx(
      "収録順から等間隔に抜粋。ずれ＝中央−ロボット位置、速度＝コース中央に対する相対速度。操作は −1：上、0：入力なし、+1：下。予測は連続値です。",
      "Examples evenly spaced in recording order. Offset = lane center minus robot position; velocity is relative to the lane center. Actions: −1 up, 0 no input, +1 down. Predictions are continuous.",
    );
    const wrap = document.createElement("div");
    wrap.className = "il-table-wrap";
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    [
      tx("位置", "Position"),
      tx("中央に対する動き", "Relative motion"),
      tx("実演の操作", "Demo action"),
      tx("予測した操作", "Predicted action"),
    ].forEach((label) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = label;
      head.append(th);
    });
    const body = table.createTBody();
    report.examples.forEach((example) => {
      const row = body.insertRow();
      [
        positionDescription(example.observation[0]),
        motionDescription(example.observation[1]),
        example.action.toFixed(3),
        policy(example.observation).toFixed(3),
      ].forEach((value) => {
        row.insertCell().textContent = value;
      });
    });
    wrap.append(table);
    const method = document.createElement("p");
    method.textContent = tx(
      "実装：2入力→12中間ユニット→1出力のニューラルネット（tanh）。49個の重み・バイアスを、実演の操作に対するMSEで更新（Adam）。毎回同じ初期値から学習し、試験結果やデータ生成用の制御式は学習に渡しません。",
      "Implementation: a 2→12→1 tanh network. Adam updates 49 weights and biases using demonstrated-action MSE. Every fit starts from the same initialization. Test results and the data-generation control rule are not supplied to training.",
    );
    const metricMeaning = document.createElement("p");
    metricMeaning.textContent = tx(
      "操作誤差（MSE）は「予測−記録」の二乗の平均。小さいほど操作が近く、0なら全件で一致します。成功率ではありません。",
      "Action MSE is the mean squared prediction error. Smaller means closer actions; zero means all targets match exactly. It is not a success rate.",
    );
    details.append(
      probe,
      trainingInfo,
      metricMeaning,
      metrics,
      svg,
      explanation,
      rule,
      wrap,
      method,
    );
    host.append(caption, fitEvidence);
  }
  function renderResults(): void {
    if (!root) return;
    const host = root.querySelector<HTMLElement>(".il-results")!;
    host.replaceChildren();
    const result = latest();
    if (!result) {
      const p = document.createElement("p");
      p.className = "il-empty";
      p.textContent = tx(
        "比較すると、学習条件の違いと結果がここに表示されます。",
        "After a comparison, the training conditions and results appear here.",
      );
      host.append(p);
      return;
    }
    const title = document.createElement("h3");
    title.textContent = tx("同じ3条件で比較", "Comparison on the same 3 courses");
    const fitEvidence = document.createElement("p");
    fitEvidence.className = "il-fit-takeaway";
    fitEvidence.textContent = `${tx("今回のAI — ", "Current AI — ")}${fitEvidenceText(result.entrants[1].model!.policy)}`;
    const distinction = document.createElement("p");
    distinction.className = "il-result-caption";
    distinction.textContent = tx(
      "記録の操作をまねることと、走行の成功は別です。失敗した操作も学習対象になります。",
      "Imitating recorded actions and driving successfully are different. Mistakes are learned too.",
    );
    const cards = document.createElement("div");
    cards.className = "il-result-cards";
    result.entrants.forEach((entrant, i) => {
      const card = document.createElement("article");
      card.className = `il-result-card il-side-${i}`;
      const h = document.createElement("h4");
      const name = entrantName(entrant);
      h.textContent = `${i === 0 ? "A" : "B"}  ${name}`;
      const context = document.createElement("p");
      context.textContent =
        entrant.role === "initial"
          ? tx("記録から、まだ学習していない状態。", "Before learning from any examples.")
          : entrant.model
            ? conditionDetails(entrant.model.counts)
            : tx(
                "最後の完走実演を、同じ時刻で再生",
                "Replay the last complete demonstration by time",
              );
      const metrics = document.createElement("div");
      metrics.className = "il-result-metrics";
      metrics.append(
        stat(tx("成功したコース", "Successful courses"), `${successes(result.runs[i])}/3`),
        stat(
          tx("コース内の時間", "Time within the lane"),
          `${timeInLane(result.runs[i]).toFixed(1)}%`,
        ),
      );
      card.append(h, context, metrics);
      cards.append(card);
    });
    // Match the precision of the metrics shown in the two cards.
    const delta = Number(
      (
        Number(timeInLane(result.runs[1]).toFixed(1)) -
        Number(timeInLane(result.runs[0]).toFixed(1))
      ).toFixed(1),
    );
    const successDelta = successes(result.runs[1]) - successes(result.runs[0]);
    const insight = document.createElement("div");
    insight.className = `il-insight ${successDelta > 0 ? "is-better" : successDelta < 0 ? "is-worse" : ""}`;
    const strong = document.createElement("strong");
    const successSummary =
      successDelta === 0
        ? tx(
            `成功はどちらも${successes(result.runs[0])}/3。`,
            `Both passed ${successes(result.runs[0])}/3 conditions.`,
          )
        : tx(
            `成功は${successes(result.runs[0])}/3 → ${successes(result.runs[1])}/3。`,
            `Passes: ${successes(result.runs[0])}/3 → ${successes(result.runs[1])}/3.`,
          );
    const errorSummary =
      delta === 0
        ? tx(
            "コース内の時間も、表示精度では同じでした。",
            "Time within the lane is also equal at the displayed precision.",
          )
        : tx(
            `コース内の時間は、Bが${Math.abs(delta).toFixed(1)}ポイント${delta > 0 ? "上がりました" : "下がりました"}。`,
            `B spent ${Math.abs(delta).toFixed(1)} percentage points ${delta > 0 ? "more" : "less"} time within the lane.`,
          );
    strong.textContent = successSummary;
    const detail = document.createElement("p");
    detail.textContent = errorSummary;
    const metricDefinition = document.createElement("p");
    metricDefinition.className = "il-result-caption";
    metricDefinition.textContent = tx(
      "コース内の時間＝3コースの総走行時間のうち、帯の中を走った割合。成功率ではありません。",
      "Time within the lane = the share of total driving time spent inside the band across all 3 courses. It is not a success rate.",
    );
    insight.append(strong, detail);
    const dataChange = document.createElement("p");
    dataChange.className = "il-comparison-change il-result-caption";
    dataChange.textContent = comparisonDataText(result);
    dataChange.hidden = !dataChange.textContent;
    const wrap = document.createElement("div");
    wrap.className = "il-table-wrap";
    const table = document.createElement("table");
    const caption = document.createElement("caption");
    caption.textContent = tx(
      "コース別の結果 · 帯の中を走った時間の割合",
      "Results by course · share of time inside the lane band",
    );
    const head = document.createElement("thead");
    const hr = document.createElement("tr");
    [
      tx("試験条件", "Test condition"),
      "A",
      "B",
      tx("時間割合の差 B − A", "Time share B − A"),
    ].forEach((s) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = s;
      hr.append(th);
    });
    head.append(hr);
    const body = document.createElement("tbody");
    for (let i = 0; i < 3; i++) {
      const tr = document.createElement("tr");
      const a = result.runs[0][i],
        b = result.runs[1][i];
      const diff = Number(
        (Number(timeInLane([b]).toFixed(1)) - Number(timeInLane([a]).toFixed(1))).toFixed(1),
      );
      const values = [
        `${i + 1}. ${caseName(i)}`,
        ...[a, b].map(
          (r) =>
            `${imitationSuccess(r) ? tx("成功", "Pass") : tx("未達", "Miss")} · ${timeInLane([r]).toFixed(1)}%`,
        ),
        `${diff > 0 ? "+" : ""}${diff.toFixed(1)} ${tx("ポイント", "pp")}`,
      ];
      values.forEach((v, j) => {
        const td = document.createElement(j === 0 ? "th" : "td");
        td.textContent = v;
        if (j === 0) td.setAttribute("scope", "row");
        if (j === 3) td.className = diff > 0 ? "il-good" : diff < 0 ? "il-warn" : "";
        tr.append(td);
      });
      body.append(tr);
    }
    table.append(caption, head, body);
    wrap.append(table);
    const rule = document.createElement("p");
    rule.className = "il-result-caption";
    rule.textContent = tx(
      "成功＝完走し、コースの帯から外れた時間の合計が0.8秒未満。固定した3条件を各1回試した結果です。",
      "Pass = finish with less than 0.8 s spent outside the lane band. Each of 3 fixed conditions is tested once.",
    );
    const reflectionBox = section(
      tx("最後に、1つ考えてみよう", "One question to reflect on"),
      tx(
        "記録の操作をよくまねられたら、必ずうまく走れる？",
        "If it imitates the demonstrated actions closely, will it always drive successfully?",
      ),
    );
    reflectionBox.classList.add("il-reflection");
    const answers = document.createElement("div");
    answers.className = "il-actions";
    answers.append(
      button("answer-always", tx("必ずうまく走れる", "Always succeeds")),
      button("answer-depends", tx("記録や状況による", "Depends on examples and situation")),
    );
    const feedback = document.createElement("p");
    feedback.className = "il-reflection-feedback";
    feedback.setAttribute("role", "status");
    if (reflection)
      feedback.textContent =
        reflection === "depends"
          ? tx(
              "その通り。失敗した操作も学習します。また、学習時と違う状況では予測が外れることがあります。",
              "Yes. Mistakes are learned too, and predictions can fail in situations unlike the training examples.",
            )
          : tx(
              "失敗した操作も学習するため、記録をよくまねても走行に失敗することがあります。操作の模倣と、走行の成功は別に確かめましょう。",
              "If the example itself fails, imitating it may fail too. Check imitation and driving success separately.",
            );
    reflectionBox.append(answers, feedback);
    const details = document.createElement("div");
    details.id = "il-result-details";
    details.className = "il-result-details";
    details.hidden = !showResultDetails;
    details.append(
      metricDefinition,
      wrap,
      rule,
      button("view-learning", tx("学習の中身を見返す", "Review learning evidence")),
      reflectionBox,
    );
    const toggle = button(
      "toggle-results",
      tx("コース別の結果・振り返りを見る", "Show course results and reflection"),
    );
    toggle.setAttribute("aria-expanded", String(showResultDetails));
    toggle.setAttribute("aria-controls", details.id);
    host.append(title, fitEvidence, distinction, cards, insight, dataChange, toggle, details);
  }
  function appendData(data: Demonstration[], source: Source): void {
    samples = appendCategoryData(samples, data, source);
    counts = countImitationData(samples);
    versions[source]++;
    // Manual samples arrive during driving; summarize those once the run ends.
    if (source !== "manual") publishData("examples_added", source);
  }
  function publishData(event: string, source: Source): void {
    g.publish(
      "/imitation/data",
      `data: ${JSON.stringify(`event=${event} source=${source} retained=${counts[source]} total=${samples.length}`)}`,
    );
  }
  function newTrial(): void {
    const test = IMITATION_TESTS[testIndex];
    course = test.course;
    robots = entrants.map(() => makeLearnerRobot(course, test.offset));
    trails = [[], []];
    accumulator = 0;
    betweenCases = 0;
  }
  function act(action: Action): void {
    if (!allowed(action)) return;
    if (action === "restart") {
      (g.resetStage ?? reset)();
      root!.querySelector<HTMLButtonElement>(".il-next button")!.focus({ preventScroll: true });
      return;
    }
    if (
      [
        "edit-data",
        "close-editor",
        "toggle-help",
        "toggle-management",
        "view-data",
        "view-results",
        "view-learning",
      ].includes(action)
    ) {
      reviewingLearning = action === "view-learning";
      if (action === "edit-data" || action === "view-data") {
        editingData = true;
        helpOpen = false;
        manageOpen = false;
      } else if (action === "close-editor" || action === "view-results") {
        editingData = false;
        helpOpen = false;
        manageOpen = false;
      } else if (action === "toggle-help") {
        helpOpen = !helpOpen;
        editingData = false;
        manageOpen = false;
      } else if (action === "toggle-management") {
        manageOpen = !manageOpen;
        editingData = false;
        helpOpen = false;
      } else {
        editingData = false;
        helpOpen = false;
        manageOpen = false;
      }
      syncView();
      return;
    }
    if (action === "toggle-details") {
      showDetails = !showDetails;
      refresh();
      return;
    }
    if (action === "toggle-test-options") {
      showTestOptions = !showTestOptions;
      refresh();
      return;
    }
    if (action === "toggle-results") {
      showResultDetails = !showResultDetails;
      root!.querySelector<HTMLElement>(".il-result-details")!.hidden = !showResultDetails;
      root!
        .querySelector<HTMLButtonElement>("[data-action=toggle-results]")!
        .setAttribute("aria-expanded", String(showResultDetails));
      return;
    }
    if (action === "undo-reset") {
      undoReset!();
      renderFitting();
      renderResults();
      syncView();
      root!.querySelector<HTMLButtonElement>(".il-next button")!.focus({ preventScroll: true });
      return;
    }
    if (action === "answer-always" || action === "answer-depends") {
      reflection = action === "answer-always" ? "always" : "depends";
      renderResults();
      root!
        .querySelector<HTMLButtonElement>(`[data-action=${action}]`)!
        .focus({ preventScroll: true });
      return;
    }
    undoReset = undefined;
    if (action.startsWith("toggle-")) {
      const source = action.slice(7) as Source;
      useSources[source] = !useSources[source];
      refresh();
      return;
    }
    switch (action) {
      case "reset-data":
      case "reset-learning": {
        const restore = captureReset();
        deactivateOverlayPad();
        clearExperiment(action === "reset-learning");
        undoReset = restore;
        note = action === "reset-learning" ? "learning-reset" : "data-reset";
        renderFitting();
        renderResults();
        syncView();
        registerOverlayPad(root!, false);
        root!.querySelector<HTMLButtonElement>(".il-next button")!.focus({ preventScroll: true });
        return;
      }
      case "manual":
        editingData = false;
        helpOpen = false;
        manageOpen = false;
        mode = "prepare";
        view = "manual";
        course = 0;
        robots = [makeLearnerRobot(), makeLearnerRobot()];
        trails = [[], []];
        break;
      case "start":
        useSources.manual = true;
        mode = "countdown";
        countdown = 3;
        pending = [];
        lastRecordedAction = 0;
        accumulator = 0;
        deactivateOverlayPad();
        registerOverlayPad(root!, false);
        (document.activeElement as HTMLElement | null)?.blur();
        break;
      case "cancel":
        mode = "idle";
        registerOverlayPad(root!, false);
        break;
      case "recovery":
        appendData(collectRecoveryDemos(), "recovery");
        note = "added";
        break;
      case "add-recovery":
        if (!counts.recovery) appendData(collectRecoveryDemos(), "recovery");
        useSources.recovery = true;
        note = "added";
        break;
      case "train": {
        editingData = false;
        helpOpen = false;
        manageOpen = false;
        const data = selectedData();
        trainer = createCloningTrainer(data);
        fittingSet = {
          dataKey: trainingKey(),
          counts: countImitationData(data),
          versions: { ...versions },
          samples: data.length,
          initialPolicy: trainer.snapshot(),
        };
        mode = "training";
        renderFitting();
        break;
      }
      case "compare": {
        editingData = false;
        helpOpen = false;
        manageOpen = false;
        const baseline: Entrant =
          selected === "previous"
            ? { model: previous!, role: "previous" }
            : selected === "initial"
              ? { model: current!, role: "initial" }
              : { actions: [...recorded], role: "replay" };
        entrants = [baseline, { model: current!, role: "current" }];
        evaluations = [[], []];
        testIndex = 0;
        mode = "compare";
        view = "compare";
        newTrial();
        deactivateOverlayPad();
        (document.activeElement as HTMLElement | null)?.blur();
        break;
      }
      case "pause":
        releaseSteering();
        if (mode === "paused") mode = resumeMode;
        else {
          resumeMode = mode as "manual" | "compare";
          mode = "paused";
        }
        deactivateOverlayPad();
        break;
      case "stop":
        releaseSteering();
        if (
          (mode === "manual" || (mode === "paused" && resumeMode === "manual")) &&
          pending.length > 0
        )
          publishData("recording_stopped", "manual");
        trainer = undefined;
        fittingSet = undefined;
        mode = "idle";
        note = "stopped";
        betweenCases = 0;
        renderFitting();
        break;
      case "finish":
        cleared = true;
        completionActive = true;
        g.awardStars(
          3,
          tx(
            "同じ条件でモデルを比べ、実演と行動の関係を確認しました。",
            "Compared models under identical conditions and explored how demonstrations affect actions.",
          ),
          0,
        );
        break;
    }
    refresh();
    if (["manual", "start", "train", "compare", "cancel", "stop"].includes(action)) syncView();
    if (action === "manual" || action === "cancel") {
      registerOverlayPad(root!, false);
      root!.querySelector<HTMLButtonElement>(".il-next button")!.focus({ preventScroll: true });
    }
  }
  function captureReset(): () => void {
    // Models contain immutable weight snapshots. Copy mutable selection/version maps.
    const saved = {
      samples: [...samples],
      counts: { ...counts },
      recorded: [...recorded],
      useSources: { ...useSources },
      versions: { ...versions },
      current,
      previous,
      revision,
      results: [...results],
      reflection,
      selected,
      showDetails,
      reviewingLearning,
      editingData,
      helpOpen,
      manageOpen,
    };
    return () => {
      clearExperiment(false);
      samples = saved.samples;
      counts = saved.counts;
      recorded = saved.recorded;
      useSources = saved.useSources;
      versions = saved.versions;
      current = saved.current;
      previous = saved.previous;
      revision = saved.revision;
      results = saved.results;
      reflection = saved.reflection;
      selected = saved.selected;
      showDetails = saved.showDetails;
      reviewingLearning = saved.reviewingLearning;
      editingData = saved.editingData;
      helpOpen = saved.helpOpen;
      manageOpen = saved.manageOpen;
      note = "restored";
    };
  }
  function completeRun(): void {
    releaseSteering();
    if (mode === "manual") {
      recorded = [...pending];
      publishData("recording_complete", "manual");
      mode = "idle";
      note = "collected";
      syncView(true);
      return;
    }
    robots.forEach((r, i) => evaluations[i].push({ ...r }));
    if (testIndex < 2) {
      betweenCases = 1;
      return;
    }
    results.push({ entrants: [...entrants], runs: evaluations.map((r) => [...r]) });
    g.publish(
      "/imitation/evaluation",
      `data: ${JSON.stringify(`event=evaluation_complete baseline=${entrants[0].role} baseline_success=${evaluations[0].filter(imitationSuccess).length}/${IMITATION_TESTS.length} current_success=${evaluations[1].filter(imitationSuccess).length}/${IMITATION_TESTS.length} revision=${current!.revision}`)}`,
    );
    reflection = undefined;
    showResultDetails = false;
    showTestOptions = false;
    results = results.slice(-4);
    mode = "idle";
    note = "done";
    renderResults();
    syncView(true);
  }
  function clearExperiment(keepData: boolean): void {
    releaseSteering();
    showResultDetails = false;
    showTestOptions = false;
    editingData = false;
    helpOpen = false;
    manageOpen = false;
    reviewingLearning = false;
    undoReset = undefined;
    showDetails = false;
    if (!keepData) {
      samples = [];
      counts = emptyCounts();
      recorded = [];
      versions = emptyCounts();
      useSources = defaultImitationSelection();
    }
    pending = [];
    lastRecordedAction = 0;
    displayedPolicy = undefined;
    current = undefined;
    trainer = undefined;
    fittingSet = undefined;
    previous = undefined;
    revision = 0;
    mode = "idle";
    resumeMode = "compare";
    view = "manual";
    countdown = 3;
    selected = "initial";
    reflection = undefined;
    cleared = false;
    completionActive = false;
    robots = [makeLearnerRobot(), makeLearnerRobot()];
    trails = [[], []];
    course = 0;
    testIndex = 0;
    accumulator = 0;
    uiClock = 0;
    betweenCases = 0;
    entrants = [];
    evaluations = [[], []];
    results = [];
    note = "ready";
  }
  function reset(): void {
    clearExperiment(false);
    speed = 1;
    buildPanel();
  }
  function onCompletionClose(event: Event): void {
    if (!cleared) return;
    completionActive = false;
    refresh();
    const reason = (event as CustomEvent<{ reason: string }>).detail.reason;
    if (reason === "dismiss" || reason === "next")
      root?.querySelector<HTMLButtonElement>(".il-next button")?.focus({ preventScroll: true });
  }
  function update(dt: number): void {
    if (cleared) return;
    const step = Math.min(dt, 0.1);
    if (mode === "training") {
      // Work is spread across frames; the progress and curve reflect actual updates.
      trainer!.step(2);
      if (trainer!.done) {
        previous = current;
        current = {
          policy: trainer!.snapshot(),
          revision: ++revision,
          ...fittingSet!,
        };
        g.publish(
          "/imitation/training",
          `data: ${JSON.stringify(`event=training_complete revision=${current.revision} samples=${current.samples} epochs=${current.policy.report.epochs} initial_mse=${current.policy.report.initialLoss.toFixed(6)} final_mse=${current.policy.report.finalLoss.toFixed(6)}`)}`,
        );
        trainer = undefined;
        fittingSet = undefined;
        selected = previous ? "previous" : "initial";
        root!.querySelector<HTMLSelectElement>("[data-comparison]")!.value = selected;
        mode = "idle";
        note = "trained";
        renderFitting();
        refresh();
      }
    } else if (mode === "countdown") {
      countdown -= step;
      if (countdown <= 0) {
        mode = "manual";
        accumulator = 0;
        refresh();
      }
    } else if ((mode === "manual" || mode === "compare") && !isOverlayPadActive()) {
      if (betweenCases > 0) {
        betweenCases -= step;
        if (betweenCases <= 0) {
          testIndex++;
          newTrial();
          refresh();
        }
      } else {
        accumulator += step * (mode === "manual" ? 1 : speed);
        while (accumulator >= IMITATION_DT) {
          accumulator -= IMITATION_DT;
          if (mode === "manual") {
            const observation = observeLearner(robots[0], 0);
            const touchDirections = [...steeringPointers.values(), ...steeringKeys];
            const action =
              Number(g.keys.has("s") || g.keys.has("arrowdown") || touchDirections.includes(1)) -
              Number(g.keys.has("w") || g.keys.has("arrowup") || touchDirections.includes(-1));
            if (robots[0].ticks % 3 === 0) {
              appendData([{ observation, action }], "manual");
              pending.push(action);
              lastRecordedAction = action;
            }
            stepLearner(robots[0], action, 0);
          } else
            robots.forEach((robot, i) => {
              const entrant = entrants[i];
              const action = entrant.model
                ? (entrant.role === "initial" ? entrant.model.initialPolicy : entrant.model.policy)(
                    observeLearner(robot, course),
                  )
                : replayAction(entrant.actions!, robot.ticks);
              stepLearner(robot, action, course);
            });
          if (robots[0].ticks % 3 === 0) robots.forEach((r, i) => trails[i].push([r.x, r.y]));
          if (robots[0].x >= 740) {
            completeRun();
            break;
          }
        }
      }
    }
    uiClock += step;
    if (uiClock > 0.2) {
      uiClock = 0;
      refresh();
      if (mode === "training") renderFitting();
    }
  }
  function drawRoad(
    c: CanvasRenderingContext2D,
    index: number,
    robotScale = 2,
    preview = false,
  ): void {
    const roadCourse = preview ? 0 : course;
    // The visible band matches the vertical distance used by the success check.
    c.beginPath();
    for (let x = 60; x <= 740; x += 4) {
      if (x === 60) c.moveTo(x, laneCenter(x, roadCourse) - 44);
      else c.lineTo(x, laneCenter(x, roadCourse) - 44);
    }
    for (let x = 740; x >= 60; x -= 4) c.lineTo(x, laneCenter(x, roadCourse) + 44);
    c.closePath();
    c.fillStyle = withA("#7dd3fc", 0.07);
    c.fill();
    c.strokeStyle = withA("#7dd3fc", 0.18);
    c.lineWidth = 1.5;
    c.stroke();
    c.beginPath();
    for (let x = 60; x <= 740; x += 4) {
      if (x === 60) c.moveTo(x, laneCenter(x, roadCourse));
      else c.lineTo(x, laneCenter(x, roadCourse));
    }
    c.setLineDash([5, 12]);
    c.strokeStyle = withA("#b8c2d8", 0.5);
    c.lineWidth = 1.5;
    c.stroke();
    c.setLineDash([]);
    c.strokeStyle = withA("#7dd3fc", 0.6);
    c.beginPath();
    c.moveTo(740, laneCenter(740, roadCourse) - 44);
    c.lineTo(740, laneCenter(740, roadCourse) + 44);
    c.stroke();
    const color = view === "manual" ? "#7dd3fc" : COLORS[index];
    c.strokeStyle = color;
    c.lineWidth = 3;
    c.lineCap = "round";
    c.beginPath();
    if (!preview) trails[index].forEach(([x, y], j) => (j ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    const robot = preview ? makeLearnerRobot() : robots[index];
    c.save();
    c.translate(robot.x, robot.y);
    c.rotate(Math.atan2(robot.vy, IMITATION_SPEED));
    c.scale(robotScale, robotScale);
    drawRobotBody(c, 0, robot.ticks * IMITATION_DT);
    c.restore();
  }
  function draw(): void {
    const c = g.ctx;
    clearBackground(c);
    const activeRun =
      mode === "manual" || mode === "compare" || mode === "paused" || mode === "countdown";
    if (!activeRun && (mode !== "idle" || note !== "done" || dirty() || reviewingLearning)) {
      if (mode === "idle" && !samples.length) {
        drawImitationExplainer(c, { phase: "ready" });
        return;
      }
      if (mode === "training" || (mode === "idle" && current && !dirty())) {
        const policy = mode === "training" ? displayedPolicy : current!.policy;
        const example = policy?.report.examples[0];
        if (policy && example) {
          const initial = mode === "training" ? fittingSet!.initialPolicy : current!.initialPolicy;
          drawImitationExplainer(c, {
            phase: mode === "training" ? "training" : "learned",
            example,
            counts: mode === "training" ? fittingSet!.counts : current!.counts,
            before: initial(example.observation),
            prediction: policy(example.observation),
            epochs: policy.report.epochs,
            totalEpochs: BC_EPOCHS,
          });
          return;
        }
      }
      const example = selectedData()[0];
      if (mode === "idle" && example) {
        drawImitationExplainer(c, { phase: "data", example, counts: selectedCounts() });
        return;
      }
      drawImitationExplainer(c, { phase: "ready" });
      return;
    }
    const title = view === "manual" ? tx("操作を記録", "Record actions") : caseName(testIndex);
    drawImitationText(c, title, 24, 42, { size: 20, minCss: 14, weight: 600 });
    drawImitationText(
      c,
      view === "manual" ? `${counts.manual} / ${MAX_SAMPLES_PER_CATEGORY}` : `${speed}×`,
      776,
      42,
      { size: 18, minCss: 13, align: "right", mono: true, color: "#9aa6c8" },
    );
    if (view === "compare" && entrants.length) {
      for (let i = 0; i < 2; i++) {
        const x = 16 + i * 392;
        c.fillStyle = theme.canvasPanel;
        c.beginPath();
        c.roundRect(x, 76, 376, 344, 10);
        c.fill();
        drawImitationText(c, `${i === 0 ? "A" : "B"}  ${entrantName(entrants[i])}`, x + 16, 116, {
          size: 18,
          minCss: 13,
          color: COLORS[i],
          maxWidth: 344,
          maxLines: 2,
          weight: 600,
        });
        c.save();
        c.beginPath();
        c.rect(x + 8, 164, 360, 206);
        c.clip();
        c.translate(x + 8, 164);
        c.scale(0.45, 0.45);
        drawRoad(c, i, 3);
        c.restore();
        const robot = robots[i];
        drawImitationText(
          c,
          robot.x >= 740
            ? imitationSuccess(robot)
              ? tx("成功", "Pass")
              : tx("未達", "Miss")
            : robot.outside
              ? tx("コース外", "Outside lane")
              : tx("走行中", "Driving"),
          x + 16,
          398,
          { size: 16, minCss: 12, color: robot.outside ? "#fda4af" : COLORS[i] },
        );
        drawImitationText(c, `${timeInLane([robot]).toFixed(0)}%`, x + 360, 398, {
          size: 20,
          minCss: 14,
          align: "right",
          mono: true,
          color: COLORS[i],
        });
      }
      drawImitationText(
        c,
        tx("割合：このコースで帯の中を走った時間", "Percent: time inside this course's band"),
        24,
        465,
        { size: 16, minCss: 12, maxWidth: 752, maxLines: 1, color: "#9aa6c8" },
      );
    } else {
      drawRoad(c, 0);
      const inputLabel =
        lastRecordedAction < 0 ? "↑" : lastRecordedAction > 0 ? "↓" : tx("なし", "none");
      drawImitationText(
        c,
        pending.length
          ? tx(`直近の記録：${inputLabel}`, `Last recorded: ${inputLabel}`)
          : tx("記録待ち", "Ready to record"),
        24,
        465,
        {
          size: 18,
          minCss: 13,
          color: "#9aa6c8",
        },
      );
      drawImitationText(c, tx("右へは自動", "Forward: automatic"), 776, 465, {
        size: 18,
        minCss: 13,
        align: "right",
        color: "#9aa6c8",
      });
    }
    if (mode === "countdown" || mode === "paused") {
      c.fillStyle = withA(theme.scrim, 0.92);
      c.beginPath();
      c.roundRect(160, 168, 480, 154, 10);
      c.fill();
      drawImitationText(
        c,
        mode === "countdown" ? String(Math.ceil(countdown)) : tx("一時停止", "Paused"),
        400,
        245,
        { size: 36, minCss: 20, align: "center", weight: 600 },
      );
    }
  }
  return {
    id: "imitation_learning",
    name: "Imitation Learning Mini Lab",
    lesson: "Behavior cloning: imitate demonstrated actions, then evaluate driving",
    lessonCmd: "ros2 topic echo /imitation/data",
    get ros2() {
      return {
        title: tx("模倣学習ミニラボ", "Imitation Learning Mini Lab"),
        summary: tx(
          "記録の追加・学習完了・比較完了を、ブラウザ内の疑似ノードが文字列メッセージとして通知します。ターミナルでは直近の通知を確認できます。実際のROS 2プロセスへの接続ではありません。",
          "A simulated browser node reports added demonstrations, completed training and completed comparisons as string messages. The terminal inspects recent messages; it is not connected to ROS 2 processes.",
        ),
        msgTypes: ["std_msgs/msg/String"],
        cli: [
          "ros2 topic echo /imitation/data",
          "ros2 topic echo /imitation/training",
          "ros2 topic echo /imitation/evaluation",
          "ros2 topic list -t",
          "ros2 topic type /imitation/data",
          "ros2 topic info /imitation/data",
          "ros2 node info /imitation_lab",
          "ros2 interface show std_msgs/msg/String",
        ],
        realWorld: tx(
          "ROS 2と連携する学習システムでは、記録・学習・評価の状態をトピックで共有できます。このLessonでは、その通知をブラウザ内のログとして再現します。",
          "A learning system integrated with ROS 2 can share recording, training and evaluation status through topics. This lesson represents those notifications as browser logs.",
        ),
        state: {
          nodes: ["/imitation_lab"],
          topics: ["/imitation/data", "/imitation/training", "/imitation/evaluation"].map(
            (name) => ({
              name,
              type: "std_msgs/msg/String",
              pub: ["/imitation_lab"],
            }),
          ),
          services: [],
        },
      };
    },
    init(ctx) {
      g = ctx;
      window.addEventListener("blur", releaseSteering);
      document.addEventListener("visibilitychange", releaseHiddenSteering);
      lastStatus = "";
      reset();
      restoreCompletion = mountLabCompletion(onCompletionClose);
      offLang = onLangChange(buildPanel);
    },
    update,
    draw,
    reset,
    dispose() {
      offLang();
      restoreCompletion();
      window.removeEventListener("blur", releaseSteering);
      document.removeEventListener("visibilitychange", releaseHiddenSteering);
      releaseSteering();
      trainer = undefined;
      fittingSet = undefined;
      undoReset = undefined;
      if (root) {
        unregisterOverlayPad(root);
        unregisterOverlayPad(root.querySelector<HTMLElement>(".il-brief") ?? undefined);
        root.remove();
        root = undefined;
      }
      if (dock) dock.hidden = true;
    },
  };
}

export default defineStage({
  mode: "lesson",
  order: 21,
  build: makeImitationLearning,
  lessonModal: {
    title: {
      ja: "模倣学習ミニラボ",
      en: "Imitation Learning Mini Lab",
    },
    learn: {
      ja: "自分でロボットを操作し、「状況→操作」の記録からAIを学習させます（Behavior Cloning）。失敗した操作も学習対象です。学習前後を同じ3条件で比べます。",
      en: "Drive the robot yourself, then train the AI on your recorded situation–action pairs through Behavior Cloning. Mistakes are learned too. Compare before and after training in the same 3 conditions.",
    },
    goal: {
      ja: "学習前後を3条件で比べ、走り方の変化を確かめる。",
      en: "Compare before and after training in 3 conditions to see how driving changes.",
    },
    first: {
      ja: "「操作データを集める」で上下の操作を確認し、記録を始めます。",
      en: "Select Record your driving, review the up/down controls, then start recording.",
    },
  },
  diagram: `<svg viewBox="0 0 420 100" role="img" aria-label="自分で操作を記録、AIを学習、3条件で走らせて比較 / Record your actions, train the AI, compare driving in 3 conditions"><g fill="#15243b" stroke="#7dd3fc"><rect x="5" y="15" width="110" height="65" rx="8"/><rect x="155" y="15" width="110" height="65" rx="8"/><rect x="305" y="15" width="110" height="65" rx="8"/></g><g fill="#e0f2fe" font-family="system-ui" font-size="11" text-anchor="middle"><text x="60" y="42">① 自分で記録</text><text x="60" y="62">Record actions</text><text x="135" y="52">→</text><text x="210" y="42">② AIを学習</text><text x="210" y="62">Train the AI</text><text x="285" y="52">→</text><text x="360" y="42">③ 走らせて比較</text><text x="360" y="62">Test 3 conditions</text></g></svg>`,
});
