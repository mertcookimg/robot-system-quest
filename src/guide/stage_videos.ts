// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, onLangChange, withLang, type Lang } from "../i18n";
import { stageDisplayName } from "../core/stage_labels";
import type { StageMeta } from "../types";
import { guideText as gt } from "./localization";

interface VideoCopy {
  title: string;
  introduction: string;
  description: string;
  tip: string;
  playerLabel: string;
  kicker: string;
  badges: string[];
}

interface StageVideoOptions {
  mode: "game" | "lesson";
  stages: StageMeta[];
  numbers: ReadonlyMap<string, number>;
  starts: Readonly<Record<string, number>>;
  videos: Partial<Record<Lang, string>>;
  copy(): VideoCopy;
  format(edition: Lang): string;
}

function timestamp(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function watchUrl(videoId: string, start = 0): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${start}s`;
}

export function stageVideoLink(
  starts: Readonly<Record<string, number>>,
  videoId: string,
  stageId: string,
): { href: string; time: string } | undefined {
  const start = starts[stageId];
  if (start === undefined) return;
  return { href: watchUrl(videoId, start), time: timestamp(start) };
}

/** One player implementation keeps Game and Lesson chapter navigation consistent. */
export function setupStageVideos(options: StageVideoOptions): void {
  const { mode, numbers, starts, videos } = options;
  const root = document.getElementById(`${mode}-video-content`)!;
  const chapters = options.stages
    .filter((stage) => starts[stage.id] !== undefined)
    .sort((a, b) => starts[a.id] - starts[b.id]);
  const editions = (Object.keys(videos) as Lang[]).filter((lang) => videos[lang]);
  if (!chapters.length || !editions.length) return;
  const preferredEdition = () => (videos[getLang()] ? getLang() : editions[0]);
  let edition = preferredEdition();
  let selected = chapters[0];
  let loaded = false;
  const stageCode = (stage: StageMeta) =>
    `${mode === "game" ? "G" : "L"}${String(numbers.get(stage.id)).padStart(2, "0")}`;
  const editionName = (lang: Lang) =>
    lang === "ja" ? gt("日本語版", "Japanese edition") : gt("英語版", "English edition");

  function renderPlayer(autoplay = false): void {
    const player = root.querySelector<HTMLElement>(".lesson-video-player")!;
    const start = starts[selected.id];
    const videoId = videos[edition]!;
    const label = `${options.copy().playerLabel} — ${editionName(edition)}`;
    root.querySelector<HTMLImageElement>(".stage-video-summary-thumbnail img")!.src =
      `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    player.replaceChildren();
    player.setAttribute("aria-label", label);
    if (loaded) {
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?start=${start}&autoplay=${autoplay ? 1 : 0}&rel=0`;
      iframe.title = `${label} — ${stageDisplayName(selected)}`;
      iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = "strict-origin-when-cross-origin";
      player.append(iframe);
    } else {
      const poster = document.createElement("button");
      poster.type = "button";
      poster.className = "lesson-video-poster";
      poster.dataset.videoPlay = "";
      poster.setAttribute("aria-label", `${label}${gt("を再生", ": play video")}`);
      const thumbnail = document.createElement("img");
      thumbnail.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      thumbnail.alt = "";
      thumbnail.width = 480;
      thumbnail.height = 360;
      thumbnail.loading = "lazy";
      const icon = document.createElement("span");
      icon.className = "lesson-video-play-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▶";
      const caption = document.createElement("span");
      caption.className = "lesson-video-poster-label";
      caption.textContent = `${editionName(edition)} · ${gt("動画を再生", mode === "game" ? "Play showcase" : "Play walkthrough")}`;
      poster.append(thumbnail, icon, caption);
      player.append(poster);
    }
    root.querySelectorAll<HTMLButtonElement>("[data-video-lang]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.videoLang === edition));
    });
    root.querySelector(".lesson-video-format")!.textContent = options.format(edition);
    const youtube = root.querySelector<HTMLAnchorElement>(".lesson-video-youtube")!;
    youtube.href = watchUrl(videoId, start);
    youtube.textContent = `${gt("YouTubeで見る", "Watch on YouTube")} · ${editionName(edition)} ↗`;
    const playStage = root.querySelector<HTMLAnchorElement>(".lesson-video-lesson")!;
    playStage.href = withLang(`../?direct=stage#${encodeURIComponent(selected.id)}`);
    playStage.dataset.guidePlayStage = selected.id;
    const tryLabel =
      mode === "game"
        ? gt("このGameを試す", "Try this game")
        : gt("このLessonを試す", "Try this lesson");
    playStage.textContent = `${tryLabel} · ${stageCode(selected)} ↗`;
    playStage.setAttribute(
      "aria-label",
      `${playStage.textContent} — ${stageDisplayName(selected)}`,
    );
    root.querySelectorAll<HTMLButtonElement>("[data-video-chapter]").forEach((button) => {
      if (loaded && button.dataset.videoChapter === selected.id)
        button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function render(): void {
    const expanded =
      root.querySelector<HTMLDetailsElement>(".lesson-video-chapters")?.open ?? false;
    const panelOpen =
      root.querySelector<HTMLDetailsElement>(".stage-video-disclosure")?.open ??
      window.location.hash === `#${mode}-videos`;
    if (!panelOpen) loaded = false;
    const copy = options.copy();
    root.innerHTML = `
      <details class="stage-video-disclosure">
        <summary class="stage-video-summary">
          <h2 class="stage-video-summary-heading">
            <span class="stage-video-summary-thumbnail" aria-hidden="true">
              <img alt="" width="480" height="360" loading="lazy" decoding="async" />
              <span class="stage-video-summary-icon">▶</span>
            </span>
            <span class="stage-video-summary-copy">
              <span id="${mode}-videos-title" class="stage-video-summary-title">${copy.title}</span>
              <span class="stage-video-summary-meta">${chapters.length} ${gt("チャプター", "chapters")} · ${editions.map((lang) => (lang === "ja" ? gt("日本語", "Japanese") : gt("英語", "English"))).join(" / ")}</span>
              <span class="stage-video-summary-action" aria-hidden="true">
                <span class="stage-video-expand-label">${gt("動画を見る", "Watch video")}</span>
                <span class="stage-video-collapse-label">${gt("閉じる", "Close")}</span>
                <span class="stage-video-chevron">⌄</span>
              </span>
            </span>
          </h2>
        </summary>
        <div class="stage-video-body">
      <div class="lesson-video-heading">
        <p class="section-kicker ${mode}-text">${copy.kicker}</p>
        <p>${copy.introduction}</p>
      </div>
      <div class="lesson-video-layout">
        <div id="${mode}-video-player" class="lesson-video-player" role="group" tabindex="-1"></div>
        <div class="lesson-video-info">
          <div class="lesson-video-meta">${copy.badges.map((badge) => `<span>${badge}</span>`).join("")}</div>
          <p>${copy.description}</p>
          ${editions.length > 1 ? `<div class="lesson-video-editions" role="group" aria-label="${gt("動画の言語", "Video language")}">${editions.map((lang) => `<button type="button" data-video-lang="${lang}">${editionName(lang)}</button>`).join("")}</div>` : ""}
          <p class="lesson-video-format"></p>
          <div class="lesson-video-actions">
            <a class="lesson-video-youtube" target="_blank" rel="noopener noreferrer"></a>
            <a class="lesson-video-lesson" data-lang-link data-stage-mode="${mode}"></a>
          </div>
          <p class="lesson-video-tip">${copy.tip}</p>
        </div>
      </div>
      <details class="lesson-video-chapters">
        <summary>${mode === "game" ? gt("ゲームを選んで見る", "Jump to a game") : gt("レッスンを選んで見る", "Jump to a lesson")} <span>${chapters.length} CHAPTERS</span></summary>
        <ol class="lesson-video-chapter-list"></ol>
      </details>
        </div>
      </details>
    `;
    const disclosure = root.querySelector<HTMLDetailsElement>(".stage-video-disclosure")!;
    disclosure.open = panelOpen;
    disclosure.addEventListener("toggle", (event) => {
      if (event.target !== disclosure || disclosure.open || !disclosure.isConnected) return;
      const summary = disclosure.querySelector<HTMLElement>("summary")!;
      const restoreFocus =
        disclosure.contains(document.activeElement) && !summary.contains(document.activeElement);
      // Hiding an iframe does not stop its audio. Unload on close, retaining
      // the selected chapter and edition for a deliberate next play.
      loaded = false;
      renderPlayer();
      if (restoreFocus) summary.focus({ preventScroll: true });
    });
    root.querySelector<HTMLDetailsElement>(".lesson-video-chapters")!.open = expanded;
    const list = root.querySelector("ol")!;
    for (const stage of chapters) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-video-chapter";
      button.dataset.videoChapter = stage.id;
      const number = document.createElement("span");
      number.className = "video-chapter-number";
      number.textContent = stageCode(stage);
      const name = document.createElement("span");
      name.className = "video-chapter-name";
      name.textContent = stageDisplayName(stage);
      const time = document.createElement("time");
      time.dateTime = `PT${starts[stage.id]}S`;
      time.textContent = timestamp(starts[stage.id]);
      const play = document.createElement("span");
      play.className = "video-chapter-play";
      play.setAttribute("aria-hidden", "true");
      play.textContent = "▶";
      button.append(number, name, time, play);
      row.append(button);
      list.append(row);
    }
    renderPlayer();
  }

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    const lang = button.dataset.videoLang;
    if ((lang === "ja" || lang === "en") && videos[lang]) {
      if (edition === lang) return;
      edition = lang;
      renderPlayer();
      return;
    }
    const chapter = chapters.find((stage) => stage.id === button.dataset.videoChapter);
    if (!chapter && !button.hasAttribute("data-video-play")) return;
    if (chapter) selected = chapter;
    root.querySelector<HTMLDetailsElement>(".stage-video-disclosure")!.open = true;
    loaded = true;
    renderPlayer(true);
    const player = root.querySelector<HTMLElement>(".lesson-video-player")!;
    player.focus({ preventScroll: true });
    player.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  });

  document.addEventListener("click", (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      `a[href="#${mode}-videos"]`,
    );
    if (link) root.querySelector<HTMLDetailsElement>(".stage-video-disclosure")!.open = true;
  });

  onLangChange(() => {
    edition = preferredEdition();
    render();
  });
  render();
}
