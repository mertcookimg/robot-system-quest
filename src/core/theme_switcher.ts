// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, onLangChange } from "../i18n";
import { StorageKeys } from "./storage";
import { getTheme, onThemeChange, restoreTheme, setTheme } from "./theme";

/** Explicit choices work with mouse, touch, keyboard, and native gamepad focus. */
export function setupThemeSwitchers(): () => void {
  restoreTheme();
  const groups = document.querySelectorAll<HTMLElement>("[data-theme-switcher]");
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    "[data-theme-switcher] button[data-theme-option]",
  );
  const refresh = (): void => {
    const ja = getLang() === "ja";
    for (const group of groups) {
      group.setAttribute("aria-label", ja ? "表示テーマ" : "Appearance");
    }
    for (const button of buttons) {
      const dark = button.dataset.themeOption === "dark";
      const label = ja ? (dark ? "ダーク" : "ライト") : dark ? "Dark" : "Light";
      const text = button.querySelector("[data-theme-label]");
      if (text) text.textContent = label;
      button.setAttribute("aria-label", ja ? `${label}テーマ` : `${label} theme`);
      button.setAttribute("aria-pressed", String(button.dataset.themeOption === getTheme()));
    }
  };
  const select = (event: Event): void => {
    const value = (event.currentTarget as HTMLButtonElement).dataset.themeOption;
    if (value === "light" || value === "dark") setTheme(value);
  };
  const syncStorage = (event: StorageEvent): void => {
    if (event.key === StorageKeys.theme || event.key === null) restoreTheme();
  };
  for (const button of buttons) button.addEventListener("click", select);
  window.addEventListener("storage", syncStorage);
  const stopTheme = onThemeChange(refresh);
  const stopLanguage = onLangChange(refresh);
  refresh();
  return () => {
    for (const button of buttons) button.removeEventListener("click", select);
    window.removeEventListener("storage", syncStorage);
    stopTheme();
    stopLanguage();
  };
}
