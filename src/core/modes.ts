// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// GAME / LESSON tab + the stage-pill selector beneath them.
//
// `gameIds` and `lessonIds` are derived from the registered stage manifests
// (see core/stage_def.ts) — each defineStage() call contributes a stage to
// its mode and an `order` decides display position. Adding a new stage
// requires *no edits to this file*.

import { sfx } from "./audio";
import { ui } from "./dom";
import { loadProgress } from "./progress";
import { StorageKeys, loadString, saveString } from "./storage";
import { getStageModes, getStages } from "./stage_def";
import { stageDisplayLesson, stageDisplayName } from "./stage_labels";
import * as stageMenu from "./stage_menu";
import { setupCardDemos } from "../guide/card_demos";
import { onLangChange } from "../i18n";
import type { Stage } from "../types";

export type Mode = "game" | "lesson";

function deriveIds(mode: Mode): readonly string[] {
  // getStages() returns stages already sorted by mode then order, so we
  // just filter to the requested mode and read off the ids.
  const modes = getStageModes();
  return getStages()
    .filter((s) => modes.get(s.id) === mode)
    .map((s) => s.id);
}

let _gameIds: readonly string[] | null = null;
let _lessonIds: readonly string[] | null = null;

export function getGameIds(): readonly string[] {
  if (!_gameIds) _gameIds = deriveIds("game");
  return _gameIds;
}
export function getLessonIds(): readonly string[] {
  if (!_lessonIds) _lessonIds = deriveIds("lesson");
  return _lessonIds;
}

const initialSaved = loadString(StorageKeys.mode);
let currentMode: Mode = initialSaved === "lesson" ? "lesson" : "game";

export function getMode(): Mode {
  return currentMode;
}

export function modeIds(m: Mode): readonly string[] {
  return m === "game" ? getGameIds() : getLessonIds();
}

export function isGameStage(stageId: string): boolean {
  return getGameIds().includes(stageId);
}

export function isLessonStage(stageId: string): boolean {
  return getLessonIds().includes(stageId);
}

interface Deps {
  stages: readonly Stage[];
  getCurrentStageId: () => string;
  loadStage: (id: string) => void;
}

let deps: Deps | null = null;
let disposeStageDemos: () => void = () => {};
const PAD_2P_GAMES = new Set(["racing", "robo_soccer", "tag_chase", "sumo_battle"]);
const STAGE_PREVIEW_ICONS: Readonly<Record<string, string>> = {
  delivery: "📦",
  follower: "◎",
  lidar_explorer: "⌁",
  patrol: "◈",
  racing: "⚑",
  robo_soccer: "⚽",
  treasure_map: "◆",
  tag_chase: "◉",
  sumo_battle: "土",
  battery_rush: "▰",
  robo_kitchen: "☷",
  swarm_rescue: "⋈",
  robo_baseball: "⚾",
  robo_tennis: "🎾",
  pubsub_builder: "⇄",
  service_builder: "↔",
  tf_puzzle: "⌗",
  feedforward_controller: "△",
  feedforward_mission: "┄",
  feedback_controller: "△",
  feedback_mission: "⌖",
  lidar_avoidance: "⌁",
  param_tuner: "☷",
  mapping_mission: "▦",
  localization_mission: "⁙",
  navigation: "⚑",
  image_processing: "▧",
  edge_detection: "◫",
  object_detection: "▣",
  joint_teleop: "⌇",
  ik_reach: "✣",
  pick_place: "♢",
  action_builder: "▷",
  behavior_tree: "⑂",
};
/** Switch the visible tab + stage selector without loading a stage. */
export function setModeView(m: Mode): void {
  currentMode = m;
  saveString(StorageKeys.mode, m);
  ui.modeTabs.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === m);
  });
  renderSelector();
}

/** Switch tab and, if needed, hop to that mode's first stage. */
export function setMode(m: Mode): void {
  setModeView(m);
  if (!deps) return;
  const ids = modeIds(m);
  if (!ids.includes(deps.getCurrentStageId())) deps.loadStage(ids[0]);
}

export function renderSelector(): void {
  if (!deps) return;
  const progress = loadProgress();
  disposeStageDemos();
  ui.stageSelector.innerHTML = "";
  const ids = modeIds(currentMode);
  const prefix = currentMode === "game" ? "G" : "L";

  const heading = document.createElement("div");
  heading.className = "stage-menu-heading";
  heading.innerHTML = `
    <span class="stage-menu-kicker">${currentMode === "game" ? "GAME MISSIONS" : "ROS 2 LESSONS"}</span>
    <strong>
      <span class="i18n-ja">${currentMode === "game" ? "ゲームを選択" : "レッスンを選択"}</span>
      <span class="i18n-en">Select ${currentMode === "game" ? "a game" : "a lesson"}</span>
    </strong>
    <span class="stage-menu-count">${ids.length} STAGES</span>
    <button class="stage-menu-close" type="button" aria-label="Close stage menu">×</button>
  `;
  heading.querySelector<HTMLButtonElement>(".stage-menu-close")?.addEventListener("click", () => {
    sfx.click();
    stageMenu.closeMenu();
  });
  ui.stageSelector.appendChild(heading);

  ids.forEach((id, localIdx) => {
    const s = deps!.stages.find((st) => st.id === id);
    if (!s) return;
    const stars = progress[s.id]?.stars ?? 0;
    const displayName = stageDisplayName(s);
    const displayLesson = stageDisplayLesson(s);
    const pill = document.createElement("button");
    pill.className = "stage-pill" + (s.id === deps!.getCurrentStageId() ? " active" : "");
    pill.innerHTML = `
      <span class="stage-card-preview" aria-hidden="true">
        <canvas class="card-demo" width="320" height="104" data-stage-demo="${s.id}"></canvas>
        <span class="stage-card-icon">${STAGE_PREVIEW_ICONS[s.id] ?? "◆"}</span>
      </span>
      <span class="stage-pill-meta">
        <span class="num">${prefix}${localIdx + 1}</span>
        <span class="ministar">${["★", "★", "★"]
          .map((c, i) => `<span class="${i < stars ? "on" : ""}">${c}</span>`)
          .join("")}</span>
      </span>
      <span class="info">
        <span class="name">${displayName}</span>
        <span class="lesson">${displayLesson}</span>
        ${PAD_2P_GAMES.has(s.id) ? '<span class="multiplayer-badge">🎮 2P PAD</span>' : ""}
      </span>
    `;
    if (PAD_2P_GAMES.has(s.id)) {
      pill.setAttribute("aria-label", `${displayName} — 2-player gamepad battle`);
    }
    pill.addEventListener("click", () => {
      stageMenu.closeMenu();
      deps!.loadStage(s.id);
    });
    pill.addEventListener("mouseenter", () => sfx.hover());
    ui.stageSelector.appendChild(pill);
  });
  disposeStageDemos = setupCardDemos(ui.stageSelector);
}

export function setupModes(d: Deps): void {
  deps = d;
  onLangChange(renderSelector);
  ui.modeTabs.querySelectorAll<HTMLButtonElement>(".mode-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === currentMode);
    btn.addEventListener("click", () => {
      sfx.click();
      // Tab click opens the stage popup with that mode pre-selected.
      // The current stage isn't replaced until the user picks a pill.
      const target = btn.dataset.mode as Mode;
      if (stageMenu.isOpen()) stageMenu.closeMenu();
      else stageMenu.openMenu(target);
    });
    btn.addEventListener("mouseenter", () => sfx.hover());
  });
  renderSelector();
}
