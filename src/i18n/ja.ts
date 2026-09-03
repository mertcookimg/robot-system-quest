// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// JA dictionary — translation keys to Japanese strings
export const JA: Record<string, string> = {
  // ── Shared UI ──
  "ui.audio.on": "ON",
  "ui.audio.off": "OFF",
  "ui.help.title": "操作方法",
  "ui.help.close": "閉じる",
  "ui.intro.start": "START",
  "ui.clear.retry": "リトライ",
  "ui.clear.next": "次へ →",
  "ui.allclear.again": "もう一度プレイ",
  "ui.toast.perfect": "PERFECT",
  "ui.toast.starsupd": "スター更新",
  "ui.toast.newrecord": "ベスト更新",
  "terminal.title": "ROS 2概念端末（シミュレーション）",
  "terminal.stage": "ステージ: {name}",
  "terminal.hint": "クリックして入力・↑/↓で履歴・helpで一覧",
  "terminal.command": "コマンド",
  "terminal.select": "コマンドを選択…",
  "terminal.inspect": "観察",
  "terminal.run": "▶ 実行",
  "terminal.input": "ROS 2コマンドを入力（helpで一覧）",
  "terminal.welcome": "Robot System Quest ROS 2概念端末（シミュレーション）",
  "terminal.guide": "下からコマンドを選ぶか、直接入力してください。helpで一覧を表示します。",
  "terminal.unsupported":
    "{command}: このステージでは実行できません。観察用のコマンドを選んでください。",

  // ── pubsub / service / action ──
  "puzzle.status.connect":
    "マウスでドラッグ、または↑↓←→＋Enter（A）で配線 / Backspace（B）でキャンセル・削除",

  // ── Shared block editor ──
  "block.program.empty_short": "空のプログラム",
  "block.program.count": "{n}ブロック",
  "block.btn.up": "上に移動",
  "block.btn.down": "下に移動",
  "block.btn.remove": "削除",
  "block.empty": "プログラムが空です",
  "block.stop_aborted": "実行を停止しました",
  "block.stop_run": "停止 — RUNで再評価",
  "block.done": "プログラム終了 — 編集して再度RUN",
  "block.error": "実行エラー",
  "block.running": "実行中（{n}ブロック）",
  "block.running_program": "プログラム実行中（{n}ブロック）",
  "block.running_feedback": "フィードバック制御を実行中（{n}ブロック）",
  "block.running_lidar": "LiDAR障害物回避を実行中（{n}ブロック）",

  // ── feedforward_controller ──
  "ff_controller.tip": "自由実験エリア — ブロックを並べてRUN",
  "ff_controller.hint": "障害物もゴールもない自由実験。cmd_velの値を変えて試そう",
  "ff_controller.palette_hint": "ゴール・障害物なし。cmd_velで自由に試そう",
  "ff_controller.practice_on": "🔄 練習モード ON — 何度でもRUN可能、クリア画面なし",
  "ff_controller.practice_off": "🎯 ミッションモード ON — 直進・左旋回・右旋回をすべて使うとクリア",
  "ff_controller.practice_done": "プログラム終了 — ブロックを自由に編集して再度RUN",
  "ff_controller.need_all":
    "あと{n}/3パターンを使うとクリア — 直進（linear>0）・左旋回（angular>0）・右旋回（angular<0）",
  "ff_controller.move_start_on":
    "✋ START位置の移動 ON — WASD / 矢印キー / ゲームパッドで動かし、もう一度押して確定",
  "ff_controller.move_start_off": "START位置を確定。RUNでその位置から再生",

  // ── feedforward_mission ──
  "ff_mission.tip": "ブロックを並べて▶ RUN",
  "ff_mission.hint": "ブロックを編集 → ▶ RUN / Rで位置をリセット",
  "ff_mission.palette_hint": "geometry_msgs/msg/Twistをduration秒間publish",

  // ── feedback_controller ──
  "fb_controller.tip": "robot_feedback_controlを再現。Odometryのフィードバックによる動きを観察",
  "fb_controller.hint":
    "go_straight / turn_left / turn_rightを組み、Odometryのフィードバックで動かす",
  "fb_controller.palette_hint": "/odomを購読し、目標距離・角度に達したら止める",
  "fb_controller.practice_on": "🔄 練習モード ON — 何度でもRUN可能、クリア画面なし",
  "fb_controller.practice_off": "🎯 ミッションモード ON — 3種類のブロックをすべて使うとクリア",
  "fb_controller.practice_done": "プログラム終了 — ブロックを自由に編集して再度RUN",
  "fb_controller.need_all": "あと{n}/3種類を使うとクリア — go_straight / turn_left / turn_right",
  "fb_controller.move_start_on":
    "✋ START位置の移動 ON — WASD / 矢印キー / ゲームパッドで動かし、もう一度押して確定",
  "fb_controller.move_start_off": "START位置を確定。RUNでその位置から再生",

  // ── feedback_mission ──
  "fb_mission.tip": "feedforward_missionと同じ問題をフィードバック制御で解こう",
  "fb_mission.hint": "go_straight / turn_left / turn_rightで壁を避けてGOALへ",
  "fb_mission.palette_hint": "/odomのフィードバックで壁を避けてGOALへ",
};
