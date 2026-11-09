// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, onLangChange, withLang, type Lang } from "../i18n";
import { stageDisplayName } from "../core/stage_labels";
import type { StageMeta } from "../types";
import { guideText as gt } from "./localization";

const VIDEO_IDS: Record<Lang, string> = { ja: "YJ34tb8ADns", en: "k5dfFVgThU8" };

// Chapters belong to these recordings, so keep their times tied to stage IDs.
const CHAPTER_STARTS: Readonly<Record<string, number>> = {
  pubsub_builder: 0,
  service_builder: 67,
  action_builder: 139,
  param_tuner: 206,
  feedforward_controller: 285,
  feedforward_mission: 356,
  feedback_controller: 426,
  feedback_mission: 491,
  lidar_avoidance: 552,
  tf_puzzle: 612,
  mapping_mission: 673,
  localization_mission: 735,
  navigation: 795,
  image_processing: 858,
  edge_detection: 921,
  object_detection: 991,
  behavior_tree: 1064,
  joint_teleop: 1134,
  ik_reach: 1199,
  pick_place: 1262,
  imitation_learning: 1333,
  reinforcement_learning: 1433,
  vla_lab: 1495,
  world_model: 1555,
};

function timestamp(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function watchUrl(lang: Lang, start = 0): string {
  return `https://www.youtube.com/watch?v=${VIDEO_IDS[lang]}&t=${start}s`;
}

export function lessonVideoFor(stageId: string): { href: string; time: string } | undefined {
  const start = CHAPTER_STARTS[stageId];
  if (start === undefined) return;
  return { href: watchUrl(getLang(), start), time: timestamp(start) };
}

export function setupLessonVideos(lessons: StageMeta[], numbers: Map<string, number>): void {
  const root = document.getElementById("lesson-video-content")!;
  const chapters = lessons
    .filter((stage) => CHAPTER_STARTS[stage.id] !== undefined)
    .sort((a, b) => CHAPTER_STARTS[a.id] - CHAPTER_STARTS[b.id]);
  let edition = getLang();
  let selected = chapters[0];
  let loaded = false;

  function renderPlayer(autoplay = false): void {
    const player = root.querySelector<HTMLElement>(".lesson-video-player")!;
    const start = CHAPTER_STARTS[selected.id];
    const editionName =
      edition === "ja" ? gt("日本語版", "Japanese edition") : gt("英語版", "English edition");
    const label = `${gt("全Lessonの解説動画", "All lessons walkthrough")} — ${editionName}`;
    player.replaceChildren();
    player.setAttribute("aria-label", label);
    if (loaded) {
      const iframe = document.createElement("iframe");
      iframe.src = `https://www.youtube-nocookie.com/embed/${VIDEO_IDS[edition]}?start=${start}&autoplay=${autoplay ? 1 : 0}&rel=0`;
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
      thumbnail.src = `https://i.ytimg.com/vi/${VIDEO_IDS[edition]}/hqdefault.jpg`;
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
      caption.textContent = `${editionName} · ${gt("動画を再生", "Play walkthrough")}`;
      poster.append(thumbnail, icon, caption);
      player.append(poster);
    }
    root.querySelectorAll<HTMLButtonElement>("[data-video-lang]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.videoLang === edition));
    });
    root.querySelector(".lesson-video-format")!.textContent =
      edition === "ja"
        ? gt(
            "英語の操作画面に、日本語の解説・字幕。BGMあり、音声ナレーションなし。",
            "English interface with Japanese explanations and captions. Background music; no spoken narration.",
          )
        : gt(
            "英語の操作画面・解説・字幕。BGMあり、音声ナレーションなし。",
            "English interface, explanations and captions. Background music; no spoken narration.",
          );
    const youtube = root.querySelector<HTMLAnchorElement>(".lesson-video-youtube")!;
    youtube.href = watchUrl(edition, start);
    youtube.textContent = `${gt("YouTubeで見る", "Watch on YouTube")} · ${editionName} ↗`;
    const lesson = root.querySelector<HTMLAnchorElement>(".lesson-video-lesson")!;
    lesson.href = withLang(`../?direct=stage#${encodeURIComponent(selected.id)}`);
    lesson.dataset.guidePlayStage = selected.id;
    lesson.textContent = `${gt("このLessonを試す", "Try this lesson")} · L${String(numbers.get(selected.id)).padStart(2, "0")} ↗`;
    lesson.setAttribute("aria-label", `${lesson.textContent} — ${stageDisplayName(selected)}`);
    root.querySelectorAll<HTMLButtonElement>("[data-video-chapter]").forEach((button) => {
      if (loaded && button.dataset.videoChapter === selected.id)
        button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function render(): void {
    const expanded = root.querySelector<HTMLDetailsElement>("details")?.open ?? false;
    root.innerHTML = `
      <div class="lesson-video-heading">
        <p class="section-kicker lesson-text">WATCH / TRY / COMPARE</p>
        <h2 id="lesson-videos-title">${gt("全24レッスンを、動画でたどる", "All 24 lessons, one walkthrough")}</h2>
        <p>${gt("通信から制御・認識・アーム・学習まで。実際の操作を見て、気になるところから試してみよう。", "From communication to control, vision, manipulation and learning. Watch the experiments, then try them yourself.")}</p>
      </div>
      <div class="lesson-video-layout">
        <div id="lesson-video-player" class="lesson-video-player" role="group" tabindex="-1"></div>
        <div class="lesson-video-info">
          <div class="lesson-video-meta"><span>24 LESSONS</span><span>${gt("27分13.8秒", "27:13.8")}</span></div>
          <p>${gt("メッセージの流れ、ロボットの動き、センサー表示を見ながら、設定と結果を比較します。最後の4つのミニラボでは、実演・報酬・画像と言葉・動作予測を、小さな教材用モデルで確かめます。", "Follow messages, robot motion and sensor displays, and compare settings with outcomes. The final four mini labs explore demonstrations, rewards, vision-language-action inputs and motion predictions using small educational models.")}</p>
          <div class="lesson-video-editions" role="group" aria-label="${gt("動画の言語", "Video language")}">
            <button type="button" data-video-lang="ja">${gt("日本語版", "Japanese edition")}</button>
            <button type="button" data-video-lang="en">${gt("英語版", "English edition")}</button>
          </div>
          <p class="lesson-video-format"></p>
          <div class="lesson-video-actions">
            <a class="lesson-video-youtube" target="_blank" rel="noopener noreferrer"></a>
            <a class="lesson-video-lesson" data-lang-link data-stage-mode="lesson"></a>
          </div>
          <p class="lesson-video-tip">${gt("見たら、一時停止して実験。結果を予想 → 入力や設定を1つ変える → 動きを比べる。学習モデルは得点だけでなく、比較条件と結果にも注目。", "Pause and experiment: predict → change one input or setting → compare the motion. In learning labs, examine conditions and outcomes as well as scores.")}</p>
        </div>
      </div>
      <details class="lesson-video-chapters">
        <summary>${gt("レッスンを選んで見る", "Jump to a lesson")} <span>24 CHAPTERS</span></summary>
        <ol class="lesson-video-chapter-list"></ol>
      </details>
    `;
    root.querySelector<HTMLDetailsElement>("details")!.open = expanded;
    const list = root.querySelector("ol")!;
    for (const stage of chapters) {
      const row = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lesson-video-chapter";
      button.dataset.videoChapter = stage.id;
      const number = document.createElement("span");
      number.className = "video-chapter-number";
      number.textContent = `L${String(numbers.get(stage.id)).padStart(2, "0")}`;
      const name = document.createElement("span");
      name.className = "video-chapter-name";
      name.textContent = stageDisplayName(stage);
      const time = document.createElement("time");
      time.dateTime = `PT${CHAPTER_STARTS[stage.id]}S`;
      time.textContent = timestamp(CHAPTER_STARTS[stage.id]);
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
    if (lang === "ja" || lang === "en") {
      if (edition === lang) return;
      edition = lang;
      renderPlayer();
      return;
    }
    const chapter = chapters.find((stage) => stage.id === button.dataset.videoChapter);
    if (!chapter && !button.hasAttribute("data-video-play")) return;
    if (chapter) selected = chapter;
    loaded = true;
    renderPlayer(true);
    const player = root.querySelector<HTMLElement>(".lesson-video-player")!;
    player.focus({ preventScroll: true });
    player.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
  });

  onLangChange(() => {
    edition = getLang();
    render();
  });
  render();
}
