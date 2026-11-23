// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import type { StageMeta } from "../types";
import { guideText as gt } from "./localization";
import { setupStageVideos, stageVideoLink } from "./stage_videos";

// This showcase has English on-screen text in both Guide interface languages.
const VIDEO_ID = "bTiUXUTwiko";
const CHAPTER_STARTS: Readonly<Record<string, number>> = {
  delivery: 0,
  follower: 16,
  lidar_explorer: 32,
  patrol: 54,
  racing: 73,
  robo_soccer: 111,
  treasure_map: 145,
  tag_chase: 165,
  sumo_battle: 201,
  battery_rush: 225,
  robo_kitchen: 270,
  swarm_rescue: 315,
  robo_baseball: 340,
  robo_tennis: 368,
};

export function gameVideoFor(stageId: string): { href: string; time: string } | undefined {
  return stageVideoLink(CHAPTER_STARTS, VIDEO_ID, stageId);
}

export function setupGameVideos(games: StageMeta[]): void {
  setupStageVideos({
    mode: "game",
    stages: games,
    numbers: new Map(games.map((stage, index) => [stage.id, index + 1])),
    starts: CHAPTER_STARTS,
    videos: { en: VIDEO_ID },
    copy: () => ({
      title: gt("全14ゲームを、動画で体験", "All 14 games, one showcase"),
      introduction: gt(
        "レース、LiDARでの探索、ロボットアームでの料理、サッカー・相撲・テニスの対戦。気になるゲームのプレイを見て、自分でも挑戦しよう。",
        "Race robots, explore with LiDAR, cook with a robot arm, and compete in soccer, sumo and tennis. Watch a game that catches your eye, then try it yourself.",
      ),
      description: gt(
        "接戦のレース、サッカーの0–2からの逆転、ぎりぎりの逃走、デュースまでもつれるテニス。14のゲームを通して、ロボットの動作制御・センシング・地図作成・チームワークに触れます。",
        "Watch a tight race finish, a 0–2 soccer comeback, close escapes and a tennis battle through deuce. These 14 games introduce motion control, sensing, mapping and teamwork.",
      ),
      tip: gt(
        "チャプターからゲームを選び、「このGameを試す」で同じステージへ。動画の動きをヒントに、操作や作戦を試してみよう。",
        "Choose a chapter, then use “Try this game” to open the same stage. Use the gameplay as a starting point for your own controls and tactics.",
      ),
      playerLabel: gt("全Gameのプレイ動画", "All games gameplay showcase"),
      kicker: "WATCH / PLAY / EXPLORE",
      badges: ["14 GAMES", "ENGLISH", "DARK MODE"],
    }),
    format: () =>
      gt(
        "英語の画面テキスト・ダークモードでのプレイ動画。オリジナルのインストゥルメンタルBGMあり、音声ナレーションなし。",
        "English on-screen text in dark mode. Original instrumental background music; no spoken narration.",
      ),
  });
}
