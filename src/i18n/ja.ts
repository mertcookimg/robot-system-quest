// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// JA dictionary — translation keys to Japanese strings
export const JA: Record<string, string> = {
  // ── Shared UI ──
  "ui.audio.on": "ON",
  "ui.audio.off": "OFF",
  "ui.help.title": "How to Play",
  "ui.help.close": "閉じる",
  "ui.intro.start": "START",
  "ui.clear.retry": "リトライ",
  "ui.clear.next": "次へ →",
  "ui.allclear.again": "もう一度プレイ",
  "ui.toast.perfect": "PERFECT",
  "ui.toast.starsupd": "スター更新",
  "ui.toast.newrecord": "ベスト更新",
  "terminal.title": "ROS 2 コンセプト端末・シミュレーション",
  "terminal.stage": "ステージ: {name}",
  "terminal.hint": "クリックで入力・↑/↓ 履歴・helpで一覧",
  "terminal.command": "コマンド",
  "terminal.select": "コマンドを選択…",
  "terminal.inspect": "観察",
  "terminal.run": "▶ 実行",
  "terminal.input": "ROS 2コマンドを入力（helpで一覧）",
  "terminal.welcome": "ROS 2コンセプト（シミュレーション）・Robot System Quest端末",
  "terminal.guide": "下からコマンドを選ぶか、直接入力してください。helpで一覧を表示します。",
  "terminal.unsupported":
    "{command}: このゲーム内では実行できません。観察コマンドを選んでください。",

  // ── pubsub / service / action ──
  "puzzle.status.connect":
    "マウスドラッグ または ↑↓←→ + Enter (A) で配線 / Backspace (B) でキャンセル・削除",

  // ── Shared block editor ──
  "block.program.empty_short": "空のプログラム",
  "block.program.count": "{n} ブロック",
  "block.btn.up": "上に移動",
  "block.btn.down": "下に移動",
  "block.btn.remove": "削除",
  "block.empty": "プログラムが空です",
  "block.stop_aborted": "実行を停止しました",
  "block.stop_run": "停止 — RUN で再評価",
  "block.done": "プログラム終了 — 編集して再 RUN",
  "block.error": "実行エラー",
  "block.running": "実行中 ({n} ブロック)",
  "block.running_program": "プログラム実行中 ({n} ブロック)",
  "block.running_feedback": "feedback control 実行中 ({n} ブロック)",
  "block.running_lidar": "LiDAR avoidance 実行中 ({n} ブロック)",

  // ── feedforward_controller ──
  "ff_controller.tip": "自由実験エリア — ブロックを並べて RUN",
  "ff_controller.hint": "障害物なし・ゴールなしの自由実験。cmd_vel の値を変えて試そう",
  "ff_controller.palette_hint": "ゴール / 障害物なし。cmd_vel で自由に試そう",
  "ff_controller.practice_on": "🔄 練習モード ON — 何度でも RUN OK、クリア画面なし",
  "ff_controller.practice_off": "🎯 ミッションモード ON — 直進・左旋回・右旋回 を全部使うとクリア",
  "ff_controller.practice_done": "プログラム終了 — 自由にブロックを編集して再 RUN",
  "ff_controller.need_all":
    "あと {n}/3 パターン使うとクリア — 直進(linear>0)・左旋回(angular>0)・右旋回(angular<0)",
  "ff_controller.move_start_on":
    "✋ START 移動 ON — WASD / 矢印 / パッドで動かす。もう一度押して確定",
  "ff_controller.move_start_off": "START 位置を確定。RUN でその位置から再生",

  // ── feedforward_mission ──
  "ff_mission.tip": "ブロックを並べて ▶ RUN",
  "ff_mission.hint": "ブロックを編集 → ▶ RUN / R で位置リセット",
  "ff_mission.palette_hint": "geometry_msgs/msg/Twist を duration 秒間 publish",

  // ── feedback_controller ──
  "fb_controller.tip": "robot_feedback_control を再現。odom feedback で動く挙動を観察",
  "fb_controller.hint": "go_straight / turn_left / turn_right を組んで odom feedback で動かす",
  "fb_controller.palette_hint": "/odom を購読して目標距離/角度に達したら止める",
  "fb_controller.practice_on": "🔄 練習モード ON — 何度でも RUN OK、クリア画面なし",
  "fb_controller.practice_off": "🎯 ミッションモード ON — 3 種ブロック全部使うとクリア",
  "fb_controller.practice_done": "プログラム終了 — 自由にブロックを編集して再 RUN",
  "fb_controller.need_all": "あと {n}/3 種類使うとクリア — go_straight / turn_left / turn_right",
  "fb_controller.move_start_on":
    "✋ START 移動 ON — WASD / 矢印 / パッドで動かす。もう一度押して確定",
  "fb_controller.move_start_off": "START 位置を確定。RUN でその位置から再生",

  // ── feedback_mission ──
  "fb_mission.tip": "feedforward_mission と同じ問題を feedback で解こう",
  "fb_mission.hint": "go_straight / turn_left / turn_right で壁を避けて GOAL へ",
  "fb_mission.palette_hint": "/odom feedback で壁を避け GOAL へ",
};
