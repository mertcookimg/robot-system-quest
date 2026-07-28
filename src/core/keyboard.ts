// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Single keydown dispatcher. Each open overlay is a "consumer" with priority:
// the first one to claim the event gets it, and the event never reaches the
// game key handler. The order below is intentional and mirrors how the UI
// stacks visually.

import * as input from "./input";
import * as intro from "./intro";
import * as help from "./help";
import * as lessonModal from "./lesson_modal";
import * as allclear from "./allclear";
import * as clearOverlay from "./clear_overlay";
import * as stageMenu from "./stage_menu";
import * as crash from "./crash";
import { ui } from "./dom";
import { isNavpadActive, onNavpadKeyDown, onNavpadKeyUp } from "../lib/navpad";

interface Deps {
  getCurrentStageId: () => string;
  resetCurrentStage: () => void;
  startGame: () => void;
  restartFromAllClear: () => void;
}

const PREVENT_KEYS = [
  "w",
  "a",
  "s",
  "d",
  "x",
  "shift",
  " ",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  "r",
];

function isInInputField(): boolean {
  const ae = document.activeElement;
  return !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.tagName === "SELECT"));
}

export function setupKeyboard(deps: Deps): void {
  window.addEventListener("keydown", (e) => {
    // 1. Intro: ←→ pick GAME/LESSON, Space/Enter confirm.
    if (intro.isShown()) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        intro.stepFocus(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        intro.stepFocus(+1);
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        intro.stepFocus(e.shiftKey ? -1 : +1);
        return;
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        intro.confirm();
        return;
      }
      return;
    }

    // 2. Lesson modal: Enter / Space / Escape closes.
    if (lessonModal.isOpen()) {
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        lessonModal.dismiss(deps.getCurrentStageId());
      }
      return;
    }

    // 3. Stage menu: arrows / Enter / Escape.
    if (stageMenu.isOpen()) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        stageMenu.stepHorizontal(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        stageMenu.stepHorizontal(+1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        stageMenu.stepVertical(-1);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        stageMenu.stepVertical(+1);
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        stageMenu.confirm();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        stageMenu.closeMenu();
        return;
      }
      return;
    }

    // 4. All-clear screen: Enter triggers the restart button.
    if (allclear.isOpen()) {
      if (e.key === "Enter") {
        e.preventDefault();
        ui.allclearRestart.click();
        return;
      }
    }

    // 5. Navpad (Nav2 click-to-goal stage): consume arrows / Space / Enter / Escape
    //    when the user is not typing into a real input field.
    if (isNavpadActive() && !isInInputField()) {
      if (onNavpadKeyDown(e.key)) {
        e.preventDefault();
        return;
      }
    }

    // 6. Clear overlay: ←→ select Restart/Next, Enter/Space confirm.
    if (clearOverlay.isOpen()) {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        clearOverlay.setFocus("restart");
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        clearOverlay.setFocus("next");
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        clearOverlay.confirmFocus();
        return;
      }
      // R / Escape fall through to the global handler below (R = restart, Esc = close).
    }

    // 7. Input field focused: don't intercept game keys (terminal, block editor inputs).
    if (isInInputField()) return;

    // 8. Global modal close.
    if (e.key === "Escape") {
      help.close();
      clearOverlay.close();
      crash.clearCrashOverlay();
      return;
    }
    if (e.key === "?" || e.key === "/") {
      help.open();
      return;
    }

    const k = e.key.toLowerCase();
    if (PREVENT_KEYS.includes(k)) e.preventDefault();

    // Space = emergency stop: drop all keyboard-held drive keys.
    if (k === " ") {
      input.clearKb();
      return;
    }

    if (k === "r") {
      clearOverlay.close();
      allclear.hide();
      crash.clearCrashOverlay();
      deps.resetCurrentStage();
      return;
    }
    input.setKbKey(k, true);
  });

  window.addEventListener("keyup", (e) => {
    onNavpadKeyUp(e.key);
    input.setKbKey(e.key.toLowerCase(), false);
  });
}
