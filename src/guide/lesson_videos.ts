// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang, type Lang } from "../i18n";
import type { StageMeta } from "../types";
import { guideText as gt } from "./localization";
import { setupStageVideos, stageVideoLink } from "./stage_videos";

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

export function lessonVideoFor(stageId: string): { href: string; time: string } | undefined {
  return stageVideoLink(CHAPTER_STARTS, VIDEO_IDS[getLang()], stageId);
}

export function setupLessonVideos(lessons: StageMeta[], numbers: Map<string, number>): void {
  setupStageVideos({
    mode: "lesson",
    stages: lessons,
    numbers,
    starts: CHAPTER_STARTS,
    videos: VIDEO_IDS,
    copy: () => ({
      title: gt("全24レッスンを、動画でたどる", "All 24 lessons, one walkthrough"),
      introduction: gt(
        "通信から制御・認識・アーム・学習まで。実際の操作を見て、気になるところから試してみよう。",
        "From communication to control, vision, manipulation and learning. Watch the experiments, then try them yourself.",
      ),
      description: gt(
        "メッセージの流れ、ロボットの動き、センサー表示を見ながら、設定と結果を比較します。最後の4つのミニラボでは、実演・報酬・画像と言葉・動作予測を、小さな教材用モデルで確かめます。",
        "Follow messages, robot motion and sensor displays, and compare settings with outcomes. The final four mini labs explore demonstrations, rewards, vision-language-action inputs and motion predictions using small educational models.",
      ),
      tip: gt(
        "動画を一時停止して実験。結果を予想 → 入力や設定を1つ変える → 動きを比べる。学習モデルは得点だけでなく、比較条件と結果にも注目。",
        "Pause the video and experiment: predict → change one input or setting → compare the motion. In learning labs, examine conditions and outcomes as well as scores.",
      ),
      playerLabel: gt("全Lessonの解説動画", "All lessons walkthrough"),
      kicker: "WATCH / TRY / COMPARE",
      badges: ["24 LESSONS", gt("27分13.8秒", "27:13.8")],
    }),
    format: (edition) =>
      edition === "ja"
        ? gt(
            "英語の操作画面に、日本語の解説・字幕。BGMあり、音声ナレーションなし。",
            "English interface with Japanese explanations and captions. Background music; no spoken narration.",
          )
        : gt(
            "英語の操作画面・解説・字幕。BGMあり、音声ナレーションなし。",
            "English interface, explanations and captions. Background music; no spoken narration.",
          ),
  });
}
