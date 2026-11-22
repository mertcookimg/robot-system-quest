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
import { isStageInteractionBlocked, ownsNativeKey, setupInputGuard } from "../lib/input_guard";
import { releaseStageInputs } from "./input_reset";

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

export function setupKeyboard(deps: Deps): void {
  setupInputGuard(releaseStageInputs);
  window.addEventListener("keydown", (e) => {
    // 1. Intro: ←→ pick GAME/LESSON, Space/Enter confirm.
    if (intro.isShown()) {
      if (e.key === "Tab") {
        e.preventDefault();
        intro.stepTab(e.shiftKey ? -1 : +1);
        return;
      }
      // Settings buttons and links retain their native activation behavior.
      if (ownsNativeKey(e)) return;
      if (
        (e.target as Element | null)?.closest?.(
          "[data-language-switcher], [data-theme-switcher], a[href]",
        )
      )
        return;
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

    if (help.isOpen()) {
      if (e.key === "Escape") {
        e.preventDefault();
        help.close();
      }
      return;
    }

    // 3. Stage menu: arrows / Enter / Escape.
    if (stageMenu.isOpen()) {
      if (e.key === "Tab") {
        e.preventDefault();
        stageMenu.stepTab(e.shiftKey ? -1 : 1);
        return;
      }
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
      if (ownsNativeKey(e)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        ui.allclearRestart.click();
        return;
      }
    }

    // Completion owns input before the canvas, including Navigation's cursor.
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

    // Browser and OS shortcuts (Ctrl/Cmd/Alt + key, e.g. Ctrl+R, Cmd+D) are
    // never stage input: keep their native behavior and do not register the
    // letter as a held drive key. Shift stays allowed for boost and "?".
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if ((clearOverlay.isOpen() || allclear.isOpen()) && e.key.toLowerCase() === "r") {
      e.preventDefault();
      // Holding R auto-repeats keydown; restart only once per press.
      if (e.repeat) return;
      clearOverlay.close("restart");
      allclear.hide();
      crash.clearCrashOverlay();
      deps.resetCurrentStage();
      return;
    }

    // Native buttons/links keep Enter and Space; text controls keep their keys.
    if (ownsNativeKey(e)) return;

    // 8. Global modal close.
    if (e.key === "Escape") {
      if (!isStageInteractionBlocked() && isNavpadActive() && onNavpadKeyDown(e.key)) {
        e.preventDefault();
        return;
      }
      help.close();
      clearOverlay.close();
      crash.dismissCrashOverlay();
      return;
    }
    if (e.key === "?" || e.key === "/") {
      help.open();
      return;
    }

    if (isStageInteractionBlocked()) return;
    if (isNavpadActive() && onNavpadKeyDown(e.key)) {
      e.preventDefault();
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
      // Holding R auto-repeats keydown; reset only once per press.
      if (e.repeat) return;
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
    // macOS does not send keyup for letter keys released while Cmd is held,
    // so a drive key pressed before Cmd could stay "held". Drop them all.
    if (e.key === "Meta") {
      input.clearKb();
      return;
    }
    input.setKbKey(e.key.toLowerCase(), false);
  });
}
