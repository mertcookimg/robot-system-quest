// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, onLangChange, setLang } from "./index";

/** Wire the same explicit JA / EN choices on Home, in the app, and in Guide. */
export function setupLanguageSwitchers(onSelect?: () => void): void {
  const buttons = document.querySelectorAll<HTMLButtonElement>(
    "[data-language-switcher] button[data-lang]",
  );
  const refresh = (): void => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.lang === getLang()));
    }
  };

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const lang = button.dataset.lang;
      if ((lang !== "ja" && lang !== "en") || lang === getLang()) return;
      setLang(lang);
      onSelect?.();
    });
  }
  refresh();
  onLangChange(refresh);
}
