// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang } from "../i18n";
import type { Stage } from "../types";

interface JapaneseStageLabel {
  name: string;
  lesson: string;
}

const JAPANESE_STAGE_LABELS: Readonly<Record<string, JapaneseStageLabel>> = {
  delivery: { name: "配達ミッション", lesson: "荷物を拾ってゴールへ届ける" },
  follower: { name: "追従チャレンジ", lesson: "移動する目標を追いかける" },
  lidar_explorer: { name: "LiDAR探索", lesson: "障害物を避けながらフィールドを探索" },
  patrol: { name: "パトロール", lesson: "監視を避けて装置を停止する" },
  racing: { name: "ロボットレース", lesson: "コースを追従して最速ラップを狙う" },
  robo_soccer: { name: "ロボサッカー", lesson: "ロボット同士でゴールを競う" },
  treasure_map: { name: "宝探しマップ", lesson: "地図を作りながら宝を集める" },
  tag_chase: { name: "ロボット鬼ごっこ", lesson: "追跡ロボットから逃げ切る" },
  sumo_battle: { name: "ロボ相撲", lesson: "相手をフィールドの外へ押し出す" },
  battery_rush: { name: "バッテリーラッシュ", lesson: "残量を管理して充電地点を巡る" },
  robo_kitchen: { name: "ロボキッチン", lesson: "ロボットアームで食材を調理" },
  swarm_rescue: { name: "群ロボット救助隊", lesson: "複数のロボットで協力して救助" },
  robo_baseball: { name: "ロボ野球", lesson: "投球を予測してタイミングよく打つ" },
  robo_tennis: { name: "ロボテニス", lesson: "ボールの高さと着地点を予測して返球" },
  pubsub_builder: { name: "Pub/Subをつなぐ", lesson: "Publisher・Subscriberの基礎" },
  service_builder: { name: "Serviceをつなぐ", lesson: "Serviceの呼び出し" },
  tf_puzzle: { name: "TFパズル", lesson: "TF座標フレーム" },
  feedforward_controller: { name: "フィードフォワード制御", lesson: "予測による制御" },
  feedforward_mission: { name: "フィードフォワード実践", lesson: "目標位置への走行" },
  feedback_controller: { name: "フィードバック制御", lesson: "オドメトリによる補正" },
  feedback_mission: { name: "フィードバック実践", lesson: "計測しながら目標へ走行" },
  lidar_avoidance: { name: "LiDAR障害物回避", lesson: "距離センサーによる反応走行" },
  param_tuner: { name: "パラメータ調整", lesson: "ROS 2 Parameters" },
  mapping_mission: { name: "地図作成ミッション", lesson: "SLAMによる地図作成" },
  localization_mission: {
    name: "自己位置推定",
    lesson: "AMCL・パーティクルフィルタ",
  },
  navigation: { name: "ナビゲーション", lesson: "Nav2による自律走行" },
  image_processing: { name: "画像処理", lesson: "画像フィルターの基礎" },
  edge_detection: { name: "エッジ検出", lesson: "画像から輪郭を検出" },
  object_detection: { name: "物体検出", lesson: "カメラ画像から物体を検出" },
  joint_teleop: { name: "関節操作", lesson: "JointState・順運動学" },
  ik_reach: { name: "逆運動学", lesson: "目標位置から関節角を計算" },
  pick_place: { name: "ピック＆プレース", lesson: "把持・マニピュレーション" },
  action_builder: { name: "Actionをつなぐ", lesson: "Goal・Feedback・Result" },
  behavior_tree: { name: "ビヘイビアツリー", lesson: "条件と行動の組み立て" },
};

export function stageDisplayName(stage: Stage): string {
  if (getLang() !== "ja") return stage.name;
  const japaneseName = JAPANESE_STAGE_LABELS[stage.id]?.name;
  if (!japaneseName) return stage.name;
  return `${japaneseName} / ${stage.name}`;
}

export function stageDisplayLesson(stage: Stage): string {
  if (getLang() !== "ja") return stage.lesson;
  return JAPANESE_STAGE_LABELS[stage.id]?.lesson ?? stage.lesson;
}
