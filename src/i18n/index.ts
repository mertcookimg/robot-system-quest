// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// i18n: JA/EN language switching. Use `t(key)` to look up a translated
// string and `setLang()` to change language. CSS uses the body classes
// `lang-ja` / `lang-en` to swap visible UI. Dictionaries live in ./ja
// and ./en — add new keys to *both* files when extending.
import { JA } from "./ja";
import { EN } from "./en";
import { loadString, saveString, StorageKeys } from "../core/storage";

export type Lang = "ja" | "en";

function detectInitialLang(): Lang {
  const requested =
    typeof location === "undefined" ? null : new URLSearchParams(location.search).get("lang");
  if (requested === "ja" || requested === "en") {
    saveString(StorageKeys.lang, requested);
    return requested;
  }
  const saved = loadString(StorageKeys.lang);
  if (saved === "ja" || saved === "en") return saved;
  return typeof navigator !== "undefined" && navigator.language.startsWith("ja") ? "ja" : "en";
}

let lang: Lang = detectInitialLang();
const listeners: Array<(l: Lang) => void> = [];

/**
 * Returns one of two inline strings based on the current language. Used
 * for prose that's not worth a dictionary key (long lesson body text).
 */
export function tx(ja: string, en: string): string {
  return lang === "ja" ? ja : en;
}

/**
 * Look up a translated string by key.
 * - Missing keys fall back to EN, then to the key itself.
 * - `params` substitutes `{name}` placeholders in the template.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = lang === "ja" ? JA : EN;
  let s = dict[key];
  if (s == null) s = EN[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

export function getLang(): Lang {
  return lang;
}

/** Keep the selected language when crossing between the app and Guide. */
export function withLang(href: string): string {
  const base = typeof location === "undefined" ? document.baseURI : location.href;
  const url = new URL(href, base);
  url.searchParams.set("lang", lang);
  return url.href;
}

function syncLangUrl(): void {
  if (typeof location === "undefined" || typeof history === "undefined") return;
  try {
    // Preserve stage, direct-open, unrelated query parameters and the hash.
    history.replaceState(history.state, "", withLang(location.href));
  } catch {
    // Restricted browsing contexts may not allow history updates.
  }
}

/**
 * Merge additional translations into the runtime dictionaries. Used by the
 * `defineStage()` helper so each stage can declare its own strings inline
 * instead of having them all stored centrally in ./ja and ./en.
 */
export function registerLang(extras: {
  ja?: Record<string, string>;
  en?: Record<string, string>;
}): void {
  if (extras.ja) Object.assign(JA, extras.ja);
  if (extras.en) Object.assign(EN, extras.en);
}

export function setLang(l: Lang) {
  const changed = lang !== l;
  lang = l;
  saveString(StorageKeys.lang, l);
  syncLangUrl();
  applyBodyClass();
  if (changed) for (const fn of listeners) fn(l);
}

export function toggleLang() {
  setLang(lang === "ja" ? "en" : "ja");
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.push(fn);
  return () => {
    const idx = listeners.indexOf(fn);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

function applyBodyClass() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang;
  if (!document.body) return;
  document.body.classList.toggle("lang-en", lang === "en");
  document.body.classList.toggle("lang-ja", lang === "ja");
  for (const link of document.querySelectorAll<HTMLAnchorElement>("a[data-lang-link]")) {
    link.href = withLang(link.href);
  }
}
applyBodyClass();
