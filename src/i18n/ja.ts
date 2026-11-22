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
  "terminal.hint": "↑/↓で履歴・helpで一覧",
  "terminal.command": "コマンド",
  "terminal.select": "コマンドを選択…",
  "terminal.inspect": "観察",
  "terminal.run": "▶ 実行",
  "terminal.input": "ROS 2コマンドを入力（helpで一覧）",
  "terminal.welcome": "Robot System Quest ROS 2概念端末（シミュレーション）",
  "terminal.guide":
    "観察用の端末です。設定変更はステージの操作欄から行います。端末の操作中も自動実行・時間・メッセージ更新は続きますが、手動操作の入力は端末に渡されます。Esc / ゲームパッドB、またはゲーム画面・タッチパッドを押すと手動入力に戻れます。",
  "terminal.noMessages":
    "{topic} の保存ログはまだありません。ステージで操作してから再実行してください。",
  "terminal.snapshot": "# 実行時点の保存ログ：最新{count}件。更新するにはコマンドを再実行します。",
  "terminal.rateSnapshot":
    "# 保存ログの間隔から算出した値です。操作時だけ出るイベントは一定周期ではありません。",
  "terminal.noParameters": "{node} は、この教材で参照できるパラメータを公開していません。",
  "terminal.noLifecycle": "{node} は、この教材でライフサイクル状態を管理していません。",
  "terminal.doctor":
    "疑似グラフ：ノード{nodes}個・トピック{topics}個。実際のROS 2環境や実機の診断は行いません。",
  "terminal.unsupported":
    "{command}: この観察用端末では実行できません。設定変更や指令はステージの操作欄から行ってください。",
  "terminal.help.title": "観察用コマンド一覧（Esc / q / exitで端末への入力を終了）：",
  "terminal.help.clear": "表示ログを消去",
  "terminal.help.exit": "端末への入力を終了",
  "terminal.help.history": "↑ / ↓で入力履歴を選択",
  "terminal.help.inspectOnly": "値の変更や実行指令はステージの操作欄から行います。",
  "terminal.bye": "端末への入力を終了しました。",
  "terminal.tryHelp": "helpでコマンド一覧を確認してください。",
  "terminal.usage": "使い方: {command}",
  "terminal.commandNotFound": "コマンドが見つかりません: {command}",
  "terminal.notImplemented": "この端末では未対応です: {command}",
  "terminal.unknownVerb": "{command}: 未対応の操作です。helpで一覧を確認してください。",
  "terminal.missing": "未指定",
  "terminal.topicNotFound": "Topic '{name}' が見つかりません。",
  "terminal.nodeNotFound": "Node '{name}' が見つかりません。",
  "terminal.serviceNotFound": "Service '{name}' が見つかりません。",
  "terminal.actionNotFound": "Action '{name}' はこのステージにありません。",
  "terminal.parameterNotFound": "Parameter '{name}' が見つかりません。",
  "terminal.noTopics": "（このステージにはTopicがありません）",
  "terminal.noNodes": "（Nodeがありません）",
  "terminal.noServices": "（このステージにはServiceがありません）",
  "terminal.noActions": "（このステージにはActionがありません）",
  "terminal.notEnoughMessages":
    "（{topic} の保存ログが不足しています。ステージで操作してから再実行してください）",
  "terminal.interfaceDeclared": "# このシミュレーションで宣言されたインターフェース型です。",
  "terminal.interfaceOmitted": "# この教材では完全なフィールド定義を省略しています。",
  "terminal.interfaceNotFound": "インターフェース '{name}' はこの教材のデータベースにありません。",
  "terminal.available": "参照できる型:",
  "terminal.interfaceSummary":
    "# 簡略化した型の概要です。入れ子のフィールドは省略される場合があります。",

  // ── pubsub / service / action ──
  "puzzle.status.connect":
    "マウスでドラッグ、または↑↓←→＋Enter（A）で配線 / Backspace（B）でキャンセル・削除",

  // ── Shared block editor ──
  "block.program.empty_short": "空のプログラム",
  "block.program.empty_help": "BLOCKSからブロックを追加し、▶ RUNで実行します。",
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
  "ff_controller.move_start_on":
    "✋ START位置の移動 ON — WASD / 矢印キー / ゲームパッドで動かし、もう一度押して確定",
  "ff_controller.move_start_off": "START位置を確定。RUNでその位置から再生",

  // ── feedforward_mission ──
  "ff_mission.tip": "ブロックを並べて▶ RUN",
  "ff_mission.hint": "ブロックを編集 → ▶ RUN / Rで位置をリセット",
  "ff_mission.palette_hint": "geometry_msgs/msg/Twistをduration秒間publish",

  // ── feedback_controller ──
  "fb_controller.move_start_on":
    "✋ START位置の移動 ON — WASD / 矢印キー / ゲームパッドで動かし、もう一度押して確定",
  "fb_controller.move_start_off": "START位置を確定。RUNでその位置から再生",

  // ── feedback_mission ──
  "fb_mission.tip": "feedforward_missionと同じ問題をフィードバック制御で解こう",
  "fb_mission.hint": "go_straight / turn_left / turn_rightで壁を避けてGOALへ",
  "fb_mission.palette_hint": "/robot/odometry/odometryを使い、指定距離・角度で各動作を終える",
};
