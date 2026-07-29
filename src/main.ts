// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Robot System Quest — entry point.
//
// Responsibilities here are intentionally narrow: collect every stage via
// import.meta.glob (each stage file calls defineStage() at module load),
// initialize the core modules in the right order, wire the cross-module
// callbacks, and start the loop. All real logic lives in src/core.

// Auto-discovers stage files. Each `defineStage()` call inside a stage
// module registers itself with the runtime registry (see core/stage_def.ts),
// so adding a new file under src/stages/{game,lesson}/ is enough — no edits
// to this file, modes.ts, or i18n dictionaries needed.
import "./core/stage_collect";
import { getStages as getRegisteredStages, getStageModes } from "./core/stage_def";

import { ui } from "./core/dom";
import { applyThemeVars } from "./core/theme";
import { setupAudio } from "./core/audio";
import { setupGhostToggle } from "./core/ghost";
import { setupToast } from "./core/toast";
import { setupAmbient } from "./core/ambient";
import { setupCrash } from "./core/crash";
import { setupIntro, show as showIntro, start as startIntro, renderStageList } from "./core/intro";
import { setupIntroRobot } from "./core/intro_robot";
import { setupHelp } from "./core/help";
import { setupLessonModal } from "./core/lesson_modal";
import { setupAllClear, show as showAllClear } from "./core/allclear";
import { setupClearOverlay } from "./core/clear_overlay";
import { setupModes, isLessonStage, setMode, setModeView, isGameStage } from "./core/modes";
import * as lessonModal from "./core/lesson_modal";
import { setupStageMenu } from "./core/stage_menu";
import { setupTerminal } from "./core/terminal_ui";
import { setupKeyboard } from "./core/keyboard";
import { setupGamepad } from "./core/gamepad";
import { setupBlockpad } from "./lib/blockpad";
import { setNavpadCanvas } from "./lib/navpad";
import { setupTouchpad } from "./lib/touchpad";
import { setupCanvasTouch } from "./lib/canvas_touch";
import { shake } from "./core/dom";
import {
  setStages,
  buildGameContext,
  loadStage,
  loadNextStage,
  resetCurrent,
  getCurrentId,
  getStages,
} from "./core/stage_manager";
import { startLoop } from "./core/loop";
import { isAllCleared } from "./core/progress";
import { sfx } from "./core/audio";
import { getLang, toggleLang, onLangChange } from "./i18n";
import type { Stage } from "./types";
import { setupAnalytics, trackStageExit, trackStageStart } from "./core/analytics";

setupAnalytics();

// 0. Apply the background theme tokens to :root before anything paints.
applyThemeVars();

// 1. Refresh the language toggle label and language-dependent links.
function refreshLangLabel(): void {
  const lang = getLang();
  ui.langToggle.textContent = lang === "ja" ? "JA" : "EN";
  const languageLabel =
    lang === "ja" ? "表示言語: 日本語（英語に切り替え）" : "Language: English (switch to Japanese)";
  ui.langToggle.title = languageLabel;
  ui.langToggle.setAttribute("aria-label", languageLabel);
  ui.introLangToggle.textContent = lang === "ja" ? "JA" : "EN";
  ui.homeToggle.textContent = lang === "ja" ? "ホーム" : "HOME";
  ui.homeToggle.title = lang === "ja" ? "ホーム / 概要へ戻る" : "Back to Home overview";
  const authorLink = document.getElementById("intro-author-link") as HTMLAnchorElement | null;
  const authorUrl =
    lang === "ja" ? "https://mertcookimg.github.io/" : "https://mertcookimg.github.io/en/";
  for (const id of ["brand-author", "footer-author"]) {
    const a = document.getElementById(id) as HTMLAnchorElement | null;
    if (a) a.href = authorUrl;
  }
  if (authorLink) authorLink.href = authorUrl;
}
refreshLangLabel();
const handleToggleLang = (): void => {
  toggleLang();
  refreshLangLabel();
  sfx.click();
};
ui.langToggle.addEventListener("click", handleToggleLang);
ui.introLangToggle.addEventListener("click", handleToggleLang);
onLangChange(refreshLangLabel);

// 2. Audio + ghost (state-bearing, persisted).
setupAudio(ui.audioToggle);
setupGhostToggle(ui.ghostToggle, () => sfx.click());
ui.ghostToggle.addEventListener("mouseenter", () => sfx.hover());

// 3. Toast + ambient background canvas + crash overlay.
setupToast(ui.toastContainer);
setupAmbient(ui.ambient);
setupCrash({
  overlay: ui.crashOverlay,
  sub: ui.crashSub,
  shake,
  onReset: resetCurrent,
});

// 4. Modal screens.
setupIntro({
  onSelectMode: (mode) => setMode(mode),
  // After the intro fades out, kick the first-visit lesson popup for the
  // current stage (if not yet seen). Without this, the popup is suppressed
  // because intro was on screen when the stage initially loaded.
  onDismiss: () => {
    const id = getCurrentId();
    trackStageStart(id, isGameStage(id) ? "game" : "lesson");
    lessonModal.maybeAutoOpen(id, isGameStage(id), {
      introOpen: false,
      allclearOpen: false,
      helpOpen: false,
    });
  },
});
setupIntroRobot();
setupHelp();
setupLessonModal(getCurrentId, resetCurrent);
setupAllClear(() => loadStage("delivery"));

// 5. Stage list — auto-collected from defineStage() manifests.
const stages: Stage[] = getRegisteredStages();
setStages(stages);
renderStageList(stages, getStageModes());

// 6. Build GameContext (must happen before loadStage).
const ctx2d = ui.canvas.getContext("2d")!;
buildGameContext(ui.canvas, ctx2d);

// 7. Modes / stage selector / stage menu.
setupModes({
  stages,
  getCurrentStageId: getCurrentId,
  loadStage,
});
setupStageMenu({
  getCurrentStageId: getCurrentId,
  loadStage,
});

// 8. Clear overlay buttons.
setupClearOverlay({
  onRestart: resetCurrent,
  onNext: loadNextStage,
  isAllCleared: () => isAllCleared(getStages().map((s) => s.id)),
  showAllClear: () => showAllClear(getStages()),
});

// 9. Terminal.
setupTerminal({
  getConcept: () => {
    const id = getCurrentId();
    return getStages().find((s) => s.id === id)?.ros2;
  },
  getStageName: () => getStages().find((s) => s.id === getCurrentId())?.name ?? "—",
});

// 10. Input dispatchers.
setupKeyboard({
  getCurrentStageId: getCurrentId,
  resetCurrentStage: resetCurrent,
  startGame: startIntro,
  restartFromAllClear: () => loadStage("delivery"),
});
setupGamepad({
  startGame: startIntro,
  resetCurrentStage: resetCurrent,
});
ui.homeToggle.addEventListener("click", () => {
  trackStageExit();
  showIntro();
  sfx.click();
});

// 11. Boot the libs that are not core/.
setupBlockpad();
setNavpadCanvas(ui.canvas);
setupCanvasTouch(ui.canvas);
setupTouchpad();

// 12. Initial stage from URL hash, falling back to delivery.
const explicitHash = location.hash.replace("#", "");
const initial = explicitHash || "delivery";
const directStageOpen = new URLSearchParams(location.search).get("direct") === "stage";

// Keep the tab and stage selector aligned with a stage opened from a URL,
// including direct links from the learning guide.
if (explicitHash) setModeView(isLessonStage(initial) ? "lesson" : "game");

// Normal visits still open Home. Guide links carry `?direct=stage`, which
// intentionally skips Home and opens the selected Game/Lesson immediately.
if (!directStageOpen) showIntro();
loadStage(initial);

// Consume the one-shot direct-open flag. A later reload of the same stage
// returns to the normal Home-first behavior.
if (directStageOpen) {
  history.replaceState(null, "", location.pathname + location.hash);
}

// `loadStage` calls `history.replaceState(...#${id})` which would append
// `#delivery` to the URL even when the user just opened "/". If the visitor
// did NOT specify a stage in the URL, restore "/" so the intro screen looks
// like a clean landing page (no surprise hash change).
if (!explicitHash) {
  history.replaceState(null, "", location.pathname + location.search);
}

// 13. Off we go.
startLoop();
console.log("[Robot System Quest] booted");
