// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import type { Stage } from "../types";
import { getLang } from "../i18n";

export interface GuideCopy {
  overview: string;
  goals: [string, string, string];
  steps: [string, string, string];
  exercise: string;
  insight: string;
}

export interface CardPreview {
  icon: string;
  action: string;
}

const CARD_PREVIEW: Record<string, CardPreview> = {
  delivery: { icon: "📦", action: "荷物を拾ってゴールへ届ける" },
  follower: { icon: "◎", action: "動くターゲットを追いかける" },
  lidar_explorer: { icon: "⌁", action: "LiDARで障害物を避けて探索する" },
  patrol: { icon: "◈", action: "監視を避けて機能を停止する" },
  racing: { icon: "⚑", action: "経路を追従して最速ラップを狙う" },
  robo_soccer: { icon: "⚽", action: "仲間と連携してゴールを決める" },
  treasure_map: { icon: "◆", action: "地図を作りながら宝を集める" },
  tag_chase: { icon: "◉", action: "追跡ロボットから30秒逃げる" },
  sumo_battle: { icon: "土", action: "境界を守りながら相手を押し出す" },
  battery_rush: { icon: "▰", action: "残量を管理して充電地点を巡る" },
  robo_kitchen: { icon: "☷", action: "アームで食材を正しく積み上げる" },
  swarm_rescue: { icon: "⋈", action: "3台で役割分担して仲間を救う" },
  robo_baseball: { icon: "⚾", action: "投球を追跡し、照準とタイミングを合わせて打つ" },
  robo_tennis: { icon: "🎾", action: "ボールの高さと着地点を読み、ラリーを続ける" },
  pubsub_builder: { icon: "⇄", action: "PublisherとSubscriberを接続する" },
  service_builder: { icon: "↔", action: "RequestとResponseを正しくつなぐ" },
  tf_puzzle: { icon: "⌗", action: "座標フレームを正しい親子関係にする" },
  feedforward_controller: { icon: "△", action: "速度と時間を計算して正三角形を描く" },
  feedforward_mission: { icon: "┄", action: "計算した指令だけで目標位置に止める" },
  feedback_controller: { icon: "△", action: "距離と角度を測って同じ正三角形を描く" },
  feedback_mission: { icon: "⌖", action: "Odometryで距離と角度を測って目標へ進む" },
  lidar_avoidance: { icon: "⌁", action: "距離データから障害物の少ない方向を選ぶ" },
  param_tuner: { icon: "☷", action: "Parameterを変えて動きを調整する" },
  mapping_mission: { icon: "▦", action: "走行しながら部屋の地図を完成させる" },
  localization_mission: { icon: "⁙", action: "粒子を収束させて現在位置を見つける" },
  navigation: { icon: "⚑", action: "Goalを指定して自動で経路走行する" },
  image_processing: { icon: "▧", action: "ノイズを減らして、必要な輪郭を見つける" },
  edge_detection: { icon: "◫", action: "画像から物体の輪郭を取り出す" },
  object_detection: { icon: "▣", action: "画像に映った物体を検出する" },
  joint_teleop: { icon: "⌇", action: "関節角を操作してアームを動かす" },
  ik_reach: { icon: "✣", action: "手先目標から必要な関節角を求める" },
  pick_place: { icon: "♢", action: "物体を掴んで指定場所へ運ぶ" },
  action_builder: { icon: "▷", action: "Goal・Feedback・Resultを接続する" },
  behavior_tree: { icon: "⑂", action: "条件と行動を木構造で組み立てる" },
};

interface EnglishGuideSeed {
  action: string;
  goal: string;
  observe: string;
  exercise: string;
  insight: string;
}

const ENGLISH_GUIDE: Record<string, EnglishGuideSeed> = {
  delivery: {
    action: "Pick up the parcel and deliver it to the goal",
    goal: "Distinguish the roles of a Publisher and a Subscriber",
    observe: "Watch how linear.x and angular.z change the robot's motion",
    exercise:
      "Halve the forward speed. Predict how handling and collision risk will change, then test your prediction.",
    insight:
      "A Topic decouples the controller from the robot, so keyboard, gamepad, and autonomous control can share the same interface.",
  },
  follower: {
    action: "Follow a moving target while keeping a safe distance",
    goal: "Relate Pose, Twist, and relative coordinates",
    observe: "Watch how distance and heading error become velocity commands",
    exercise: "Reduce the following distance and observe what happens while the target turns.",
    insight:
      "Target following is a compact model of navigation and person tracking: measurements must be transformed into the robot's frame.",
  },
  lidar_explorer: {
    action: "Explore while avoiding obstacles with LiDAR",
    goal: "Read angles and ranges from a LaserScan",
    observe: "Compare the nearest ranges in front, left, and right",
    exercise: "Increase the safety distance and compare exploration time with collision risk.",
    insight:
      "Reactive obstacle avoidance can reduce collision risk without requiring a map, but it does not guarantee safety.",
  },
  patrol: {
    action: "Avoid the patrol robot and deactivate each system",
    goal: "Choose between Topic, Service, and lifecycle state transitions",
    observe: "Track continuous state updates and one-shot shutdown requests",
    exercise:
      "Decide whether motors, cameras, or decision logic should be stopped first, and explain why.",
    insight:
      "Real robots are collections of nodes. Managing components independently makes failures easier to isolate and recover from.",
  },
  racing: {
    action: "Follow the path and set the fastest stable lap",
    goal: "Connect path tracking, odometry, and velocity control",
    observe: "Watch the trade-off between straight-line speed and cornering stability",
    exercise:
      "Compare a constant-speed lap with a lap that slows down according to path curvature.",
    insight:
      "The largest command is not always the fastest solution; sensing error and control rate determine the speed that remains stable.",
  },
  robo_soccer: {
    action: "Coordinate the team and score a goal",
    goal: "Share world state across multiple robot nodes",
    observe: "Compare all-chase behavior with explicit attack and defense roles",
    exercise: "Run both strategies and record which one creates more useful space around the ball.",
    insight:
      "In multi-robot systems, shared information and role design often matter more than each robot's locally optimal action.",
  },
  treasure_map: {
    action: "Build a map while collecting the treasure",
    goal: "Understand how LaserScan and odometry form an OccupancyGrid",
    observe: "Watch unknown cells become free space or obstacles",
    exercise:
      "Revisit the same corridor and observe how repeated measurements affect map confidence.",
    insight:
      "An occupancy map is not just an image; every cell represents the robot's belief about the environment.",
  },
  tag_chase: {
    action: "Evade the chasing robots for 30 seconds",
    goal: "Use live Pose updates from multiple robots",
    observe: "Watch how prediction changes the chosen escape direction",
    exercise:
      "Compare reacting to current position only with reacting to both position and velocity.",
    insight:
      "For moving targets, predicting the near future is often more useful than responding only to the latest measurement.",
  },
  sumo_battle: {
    action: "Push the opponent out without crossing the boundary",
    goal: "Organize reactive behavior as explicit states and priorities",
    observe: "Watch the robot switch among search, attack, and boundary recovery",
    exercise: "Compare a safety-first policy with an attack-first policy over several rounds.",
    insight:
      "Even simple behavior becomes easier to test and tune when states and priorities are explicit.",
  },
  battery_rush: {
    action: "Visit chargers while managing the remaining battery",
    goal: "Use BatteryState as a planning constraint",
    observe: "Compare estimated travel cost with remaining energy",
    exercise: "Change the recharge threshold and compare efficiency with the risk of stopping.",
    insight:
      "Power, temperature, and communication quality are part of planning on a physical robot—not afterthoughts.",
  },
  robo_kitchen: {
    action: "Use the arm to stack ingredients in the correct order",
    goal: "Connect perception, transforms, IK, and grasp execution",
    observe: "Trace the object pose from the camera frame to the arm frame",
    exercise:
      "Move an ingredient slightly and decide which stage of the pipeline should correct the error.",
    insight:
      "Manipulation is a pipeline of perception, planning, and control rather than one isolated arm motion.",
  },
  swarm_rescue: {
    action: "Coordinate three robots to complete the rescue",
    goal: "Design roles and shared state for a multi-robot system",
    observe: "Track how Scout, Relay, and Carrier exchange information",
    exercise:
      "Compare one robot doing every task with three specialized robots, including failure cases.",
    insight:
      "Distributed design must specify what happens when information is delayed or unavailable, not only how work is divided.",
  },
  robo_baseball: {
    action: "Track the pitch and match both aim and swing timing",
    goal: "Use a predicted PointStamped crossing position for fast interception",
    observe: "Compare the live ball path, predicted target, and racket contact timing",
    exercise: "Aim at the same course with early, perfect, and late swings and compare the result.",
    insight:
      "Fast interception depends on predicting where an object will be, not chasing where it was measured.",
  },
  robo_tennis: {
    action: "Read the ball height and landing point to continue the rally",
    goal: "Track a flying object's 3D position and bounce state",
    observe: "Watch how x, y, z, velocity, and gravity determine the next contact point",
    exercise:
      "Compare moving to the current ball position with moving to its predicted landing point.",
    insight:
      "A useful tracker combines position with motion dynamics so the robot can arrive before contact.",
  },
  pubsub_builder: {
    action: "Connect a Publisher to a Subscriber through a Topic",
    goal: "Explain the relationship among Node, Topic, and Message",
    observe: "Watch one published message reach every compatible subscriber",
    exercise: "Connect two Subscribers to one Publisher and give each Subscriber a different job.",
    insight:
      "Pub/Sub is loosely coupled, so logging, visualization, and control nodes can be added without changing the Publisher.",
  },
  service_builder: {
    action: "Connect a Request and Response correctly",
    goal: "Distinguish Service Client and Server responsibilities",
    observe: "Follow one request from the Client through processing to its response",
    exercise:
      "Choose whether motor stop, temperature readings, and camera frames belong on a Service or Topic, and explain each choice.",
    insight:
      "Use Topics for streams, Services for short request/response operations, and Actions for long-running goals.",
  },
  tf_puzzle: {
    action: "Build the correct parent-child transform tree",
    goal: "Compose translation and rotation across coordinate frames",
    observe: "Watch sensor points snap into place when frame relationships are correct",
    exercise: "Sketch where a point one meter in front of the camera appears in base_link and map.",
    insight: "A correct value in the wrong frame is still wrong. frame_id is part of the data.",
  },
  feedforward_controller: {
    action: "Draw an equilateral triangle from velocity and duration",
    goal: "Calculate three 1.4 m sides and three 120° turns without reading pose",
    observe: "Watch the path follow a precomputed sequence of Twist commands",
    exercise: "Change velocity, recalculate duration, and close the same triangle again.",
    insight:
      "Open-loop motion is simple, but every side depends on the accuracy of the speed-and-time model.",
  },
  feedforward_mission: {
    action: "Stop at the target using only precomputed commands",
    goal: "Use the relationship among distance, speed, and time",
    observe: "Compare commanded motion with the final measured distance",
    exercise: "Reach the same distance at several speeds and record how stopping error changes.",
    insight:
      "Experimental results can improve the model; model identification is part of better control.",
  },
  feedback_controller: {
    action: "Draw the same triangle from measured distance and angle",
    goal: "Stop each 1.4 m side and 120° turn using /odom",
    observe: "Watch measurement, rather than elapsed time, advance each block",
    exercise:
      "Change velocity without changing distance and confirm that the triangle still closes.",
    insight:
      "This is simple position feedback: it uses measured results to decide when each motion is complete.",
  },
  feedback_mission: {
    action: "Reach the goal using odometry-based stopping",
    goal: "Stop each segment at its requested distance or angle",
    observe: "Watch odometry, rather than elapsed time, advance each block",
    exercise: "Change velocity while keeping distance and angle targets, then compare the route.",
    insight:
      "This lesson adds no disturbance. It demonstrates simple position feedback by using motion estimated from odometry to decide when each command ends.",
  },
  lidar_avoidance: {
    action: "Choose a direction with more clearance from LiDAR ranges",
    goal: "Turn LaserScan sectors into a reactive obstacle-avoidance decision",
    observe: "Watch the command switch between forward motion and turning",
    exercise: "Find a distance threshold that can pass narrow gaps while reducing collision risk.",
    insight:
      "A distance threshold changes both collision risk and reachable space. Increasing it with speed can reduce risk, but does not by itself guarantee safety.",
  },
  param_tuner: {
    action: "Tune robot behavior by changing Parameters",
    goal: "Explain how Parameters differ from Topics",
    observe: "Watch a runtime parameter event change the controller immediately",
    exercise: "Change one value at a time and record each result before choosing the best setting.",
    insight:
      "Good tuning is an experiment. If several values change at once, you lose the evidence needed to explain the result.",
  },
  mapping_mission: {
    action: "Drive through the room and complete the map",
    goal: "Project LaserScan measurements into an OccupancyGrid",
    observe: "Watch unknown, free, and occupied cells update as the robot moves",
    exercise:
      "Compare driving through the center with following the walls and measure map coverage.",
    insight: "A useful map requires evidence of free space as well as obstacles.",
  },
  localization_mission: {
    action: "Converge the particle cloud onto the robot's pose",
    goal: "Build an intuitive model of probabilistic localization",
    observe: "Watch particles spread or converge as measurements become more informative",
    exercise:
      "Compare convergence in a featureless corridor with convergence in a room containing several corners.",
    insight:
      "Robot pose is a probability distribution, not a perfect point. Visualizing uncertainty enables safer decisions.",
  },
  navigation: {
    action: "Set a Goal and let the robot plan and drive",
    goal: "Distinguish a Goal Pose, global Path, and local control",
    observe: "Watch the planner and controller update while the robot is moving",
    exercise:
      "Send the same position with different final orientations and compare the approach paths.",
    insight:
      "Navigation does not end when a path is created; it keeps updating decisions as obstacles and pose estimates change.",
  },
  image_processing: {
    action: "Reduce camera noise, then find useful edges",
    goal: "Explain why Gaussian blur is applied before Canny",
    observe: "Compare the detected edges with the target while tuning each value",
    exercise:
      "Raise Edge Match above 55%. Treat the percentage as similarity first; F1 is the metric used underneath.",
    insight:
      "Cleaning the image first makes the features needed by later perception stages easier to detect.",
  },
  edge_detection: {
    action: "Extract object contours from the image",
    goal: "Understand an edge as a sharp change between neighboring pixels",
    observe: "Watch low and high thresholds trade missed edges for false edges",
    exercise:
      "Adjust both thresholds and find a balance that preserves objects without preserving noise.",
    insight: "Well-designed preprocessing makes downstream perception simpler and more stable.",
  },
  object_detection: {
    action: "Detect and label objects in the camera image",
    goal: "Trace the path from image input to a labeled bounding box",
    observe: "Watch confidence filtering remove uncertain detections",
    exercise:
      "Change the confidence threshold and record how false positives and missed objects change.",
    insight:
      "AI output is an estimate with uncertainty. The behavior layer must decide how much confidence is enough to act.",
  },
  joint_teleop: {
    action: "Move the arm by commanding its joint angles",
    goal: "Distinguish joint space from Cartesian workspace",
    observe: "Watch one joint command move every downstream link",
    exercise:
      "Search for different joint configurations that place the end effector near the same point.",
    insight:
      "The controller moves joints, while the task is usually described at the end effector; kinematics connects the two.",
  },
  ik_reach: {
    action: "Solve joint angles from an end-effector target",
    goal: "Explain the difference between forward and inverse kinematics",
    observe: "Watch multiple elbow configurations reach the same target",
    exercise:
      "Compare elbow-up and elbow-down solutions, including clearance from nearby obstacles.",
    insight:
      "A mathematically reachable pose can still violate joint limits or collide with the environment.",
  },
  pick_place: {
    action: "Grasp an object and move it to the target zone",
    goal: "Break Pick & Place into safe, testable stages",
    observe: "Trace object pose, pre-grasp pose, grasp, lift, and placement",
    exercise: "Compare side and top approaches and record which is more reliable for each object.",
    insight:
      "Pre-grasp and retreat poses make manipulation safer and more repeatable than moving directly to the grasp point.",
  },
  action_builder: {
    action: "Connect Goal, Feedback, Result, and Cancel",
    goal: "Distinguish the four parts of an ROS 2 Action",
    observe: "Watch feedback stream while one long-running goal remains active",
    exercise:
      "Design a cancellation policy for the case where a new navigation goal arrives during execution.",
    insight:
      "An Action is not simply a long Service; progress reporting and cancellation are part of its communication model.",
  },
  behavior_tree: {
    action: "Build robot decisions from conditions and actions",
    goal: "Distinguish Sequence and Fallback control flow",
    observe: "Trace Success, Failure, and Running status from child nodes to the root",
    exercise: "Add a recovery branch that rotates and retries when no path can be found.",
    insight:
      "Behavior Trees make decision flow visible and let teams replace or test one branch without redesigning the whole policy.",
  },
};

const COPY: Record<string, GuideCopy> = {
  delivery: {
    overview:
      "キーボード入力を速度指令へ変換し、ロボットへ届ける最初のミッションです。荷物を運ぶ操作の裏側では、teleopノードがTwistメッセージを継続的にpublishし、robotノードがそれをsubscribeして車輪を動かしています。",
    goals: [
      "PublisherとSubscriberの役割を区別する",
      "Twistのlinear.xとangular.zを動きと対応させる",
      "一定周期で指令を送り続ける理由を理解する",
    ],
    steps: [
      "WASD入力を速度と角速度へ変換する",
      "/cmd_velへTwistメッセージをpublishする",
      "ロボットが指令を受け取り、姿勢を更新する",
    ],
    exercise:
      "前進速度を半分にした場合、操作感と壁への衝突しやすさがどう変わるか予想してから試してみましょう。",
    insight:
      "ROS 2では操作方法とロボット本体をTopicで分離できます。同じロボットにキーボード、ゲームパッド、自律走行を付け替えられるのはこのためです。",
  },
  follower: {
    overview:
      "移動するターゲットを追いかけながら、位置・向き・座標変換の関係を体験します。追従ノードはターゲットとの相対位置から速度指令を計算し、距離を保つようにロボットを制御します。",
    goals: [
      "PoseとTwistの違いを説明する",
      "相対座標から進行方向を求める",
      "TFが複数座標系をつなぐ理由を理解する",
    ],
    steps: [
      "ターゲットのPoseを受信する",
      "ロボット座標系から見た距離と角度を計算する",
      "誤差に応じた/cmd_velを出力する",
    ],
    exercise: "追従距離を短くしたとき、旋回中にどのような振る舞いが起きるか観察してみましょう。",
    insight:
      "追従はナビゲーションや人追跡の最小モデルです。観測した位置を、そのまま使わずロボット基準へ変換することが重要です。",
  },
  lidar_explorer: {
    overview:
      "LiDARの距離データを読み、見えない障害物を避けながら探索します。LaserScanは多数の距離値を角度順に並べたメッセージで、前方・左右の最短距離を比較するだけでも反応型の自律走行を作れます。",
    goals: [
      "LaserScanの角度と距離配列を読み取る",
      "センサー値から障害物判定を作る",
      "観測と速度指令の制御ループを理解する",
    ],
    steps: [
      "/scanから周囲の距離を受信する",
      "危険な方向と安全な方向を判定する",
      "旋回または前進のTwistをpublishする",
    ],
    exercise: "安全距離を大きくすると探索時間と衝突リスクがどう変わるか比較しましょう。",
    insight:
      "高度な地図がなくても現在のセンサー値へ反応して衝突リスクを減らせますが、安全を保証するものではありません。",
  },
  patrol: {
    overview:
      "監視ロボットを避けながら複数の機能を停止するミッションです。Topicによる連続データ、Serviceによる一回の要求、Lifecycleによる状態管理を一つのシステムとして扱います。",
    goals: [
      "TopicとServiceの使い分けを理解する",
      "Lifecycleノードの状態遷移を説明する",
      "複数ノードからなるシステムを俯瞰する",
    ],
    steps: [
      "監視状態と位置情報をTopicで観測する",
      "対象機能へService Requestを送る",
      "Lifecycle状態が変わり機能が停止する",
    ],
    exercise:
      "モーター、カメラ、判断機能のうち、どの順番で止めると安全か理由とともに考えましょう。",
    insight:
      "実際のロボットは一枚岩ではありません。センサー、判断、アクチュエーターを個別ノードとして管理すると故障時の切り分けが容易になります。",
  },
  racing: {
    overview:
      "経路に沿って高速走行し、ラップタイムを競います。位置推定、経路追従、速度制御が同時に働き、速さだけでなく安定して曲がるための制御設計が問われます。",
    goals: [
      "PathとOdometryの関係を理解する",
      "速度と旋回安定性のトレードオフを知る",
      "周期的な制御ループを体験する",
    ],
    steps: [
      "Odometryから現在位置を取得する",
      "Path上の追従目標を選ぶ",
      "操舵誤差から速度指令を更新する",
    ],
    exercise: "直線とカーブで同じ速度を使う場合と、曲率で減速する場合のタイムを比較しましょう。",
    insight:
      "最速の指令が最速の走行になるとは限りません。観測誤差や制御周期を含めて安定する速度を選ぶ必要があります。",
  },
  robo_soccer: {
    overview:
      "複数ロボットがボールとゴールの位置を共有して得点を狙います。各ロボットは同じ世界を別々の視点から観測し、Topicを通して状況を共有します。",
    goals: [
      "複数ノードで状態を共有する方法を知る",
      "Pose情報から行動目標を作る",
      "協調ロボットの役割分担を考える",
    ],
    steps: [
      "ボールと各ロボットのPoseを受信する",
      "攻撃・守備の目標位置を決定する",
      "各ロボットへ個別の速度指令を送る",
    ],
    exercise: "全員がボールへ向かう戦略と、役割分担する戦略の違いを観察しましょう。",
    insight: "協調では個々の最適行動より、チーム全体の情報共有と役割設計が重要になります。",
  },
  treasure_map: {
    overview:
      "未知の迷路を走りながら地図を作り、宝物を回収します。LiDAR、Odometry、OccupancyGridを組み合わせることで、センサーの点群が探索に使える地図へ変わります。",
    goals: [
      "OccupancyGridの意味を理解する",
      "観測と自己位置を組み合わせる",
      "探索と地図作成の関係を知る",
    ],
    steps: [
      "LiDARで障害物までの距離を測る",
      "自己位置を基準に観測を地図へ統合する",
      "未探索領域を選んで移動する",
    ],
    exercise: "同じ場所を何度も通ることが、地図の確かさにどんな影響を与えるか確認しましょう。",
    insight: "地図は単なる画像ではなく、各セルが障害物である確率を持つロボットの記憶です。",
  },
  tag_chase: {
    overview:
      "追跡ロボットから逃げ続けるリアルタイムミッションです。複数のPoseと速度指令が高頻度に更新され、遅延の少ない通信と予測的な行動が重要になります。",
    goals: [
      "Pose Topicをリアルタイムに扱う",
      "相手の進行方向を予測する",
      "複数ロボットの名前空間を理解する",
    ],
    steps: [
      "追跡者と逃走者の位置を受信する",
      "接近方向と逃げられる空間を評価する",
      "次の安全位置へ速度指令を出す",
    ],
    exercise: "現在位置だけを見る方法と、相手の速度も考慮する方法で生存時間を比較しましょう。",
    insight: "動く対象への対応では、現在の観測だけでなく少し先の状態を予測することが有効です。",
  },
  sumo_battle: {
    overview:
      "相手を土俵の外へ押し出しつつ、自分は境界を越えないように制御します。接触、境界検出、攻撃方向を同時に扱う反応型ロボットの課題です。",
    goals: [
      "センサーイベントから状態を切り替える",
      "攻撃と安全確保の優先順位を設計する",
      "有限状態機械として行動を整理する",
    ],
    steps: [
      "相手と土俵境界を検出する",
      "探索・接近・押し出し状態を選ぶ",
      "状態に応じた速度指令をpublishする",
    ],
    exercise: "境界回避を最優先にした場合と、攻撃を優先した場合の勝率を比べてみましょう。",
    insight: "単純な行動でも、状態と優先順位を明示すると予測可能で調整しやすいロボットになります。",
  },
  battery_rush: {
    overview:
      "残量と移動コストを見ながら充電地点を巡るエネルギー管理ミッションです。行動を続けるだけでなく、将来必要になる資源を見積もる計画性を学びます。",
    goals: [
      "BatteryStateを行動判断へ利用する",
      "距離と消費量から余裕を見積もる",
      "安全制約を含む計画を考える",
    ],
    steps: [
      "現在のバッテリー残量を観測する",
      "候補地点までの消費量を推定する",
      "到達可能な充電地点を選択する",
    ],
    exercise: "充電を始める残量の閾値を変えて、移動効率と停止リスクを比較しましょう。",
    insight: "実機では電力、温度、通信品質などの制約も行動計画の一部です。",
  },
  robo_kitchen: {
    overview:
      "注文に合わせてロボットアームで食材を選び、正しい順序に積み上げます。認識した位置をアームの座標へ変換し、関節を動かして把持する一連のManipulationを体験します。",
    goals: [
      "認識・座標変換・把持の流れを理解する",
      "JointStateと手先Poseを対応させる",
      "作業手順を失敗から回復できる形で設計する",
    ],
    steps: [
      "注文と食材位置を受信する",
      "手先の目標Poseと関節角を計算する",
      "把持・移動・配置を順番に実行する",
    ],
    exercise: "食材の位置が少しずれた場合、どの工程で補正するべきか考えてみましょう。",
    insight: "アーム作業は一つの動作ではなく、認識・計画・制御を連結したパイプラインです。",
  },
  swarm_rescue: {
    overview:
      "役割の異なる複数ロボットが情報を共有し、遭難ロボットを救助します。Scout、Carrier、Relayがそれぞれの得意な仕事を担当する分散システムです。",
    goals: [
      "マルチロボットの役割分担を理解する",
      "共有Topicでチーム状態を同期する",
      "一台の故障に強い構成を考える",
    ],
    steps: [
      "Scoutが地図と対象位置を発見する",
      "Relayが通信を維持して情報を中継する",
      "Carrierが位置情報を使って救助する",
    ],
    exercise: "一台で全作業を行う場合と、三台で分担する場合の長所と弱点を整理しましょう。",
    insight:
      "分散システムでは、能力を分けるだけでなく、情報が届かない場合の振る舞いも設計対象になります。",
  },
  pubsub_builder: {
    overview:
      "Publisher、Topic、Subscriberを正しく接続し、ROS 2の基本通信を組み立てます。送信側と受信側は互いを直接知らず、共通のTopic名とMessage型だけを約束します。",
    goals: [
      "Node・Topic・Messageの関係を説明する",
      "型が一致しない接続が成立しない理由を理解する",
      "一対多通信の特徴を知る",
    ],
    steps: [
      "PublisherがMessageを生成する",
      "DDSがTopic名とQoSに基づいて配送する",
      "SubscriberのCallbackがMessageを処理する",
    ],
    exercise: "一つのPublisherに二つのSubscriberを接続し、それぞれ別の処理をさせてみましょう。",
    insight: "Pub/Subの疎結合性により、記録・可視化・制御ノードを後から追加できます。",
  },
  service_builder: {
    overview:
      "Requestを送りResponseを受け取るService通信を組み立てます。連続的に流れるTopicと異なり、明確な完了結果が必要な一回の操作に適しています。",
    goals: [
      "Service ClientとServerの役割を区別する",
      "Request/Response型を理解する",
      "TopicとServiceの選択基準を説明する",
    ],
    steps: [
      "Clientが型に沿ったRequestを作る",
      "Serverが要求を処理する",
      "Responseを受け取り成功・失敗を判断する",
    ],
    exercise:
      "モーター停止、現在温度、カメラ画像のうちServiceに適するものを理由とともに選びましょう。",
    insight:
      "頻繁なセンサーデータはTopic、設定変更や一回の問い合わせはService、長時間処理はActionが基本です。",
  },
  tf_puzzle: {
    overview:
      "map、odom、base_link、sensorなどの座標フレームを正しく接続します。TFは、別々の場所と向きで測られたデータを同じ世界で比較するための座標変換システムです。",
    goals: [
      "親子フレームの関係を理解する",
      "平行移動と回転を順番に合成する",
      "TF Treeが木構造である理由を知る",
    ],
    steps: [
      "各センサー値が属するframe_idを確認する",
      "TF Treeから目的フレームまでの変換を探す",
      "変換を合成して座標を移す",
    ],
    exercise: "カメラ前方1mの点がbase_linkとmapでどこになるか、図を描いて考えましょう。",
    insight: "値が正しくても座標系を間違えるとロボットは誤動作します。frame_idはデータの一部です。",
  },
  feedforward_controller: {
    overview:
      "現在位置を見ず、速度と実行時間だけで1辺1.4mの正三角形を描きます。「距離＝速度×時間」「回転角＝角速度×時間」を使う、時間ベースの開ループ制御です。",
    goals: [
      "速度と時間から1.4mの直進を計算する",
      "角速度と時間から120°の回転を計算する",
      "計算した指令だけで始点へ戻る",
    ],
    steps: [
      "1辺を進むlinearとdurationを決める",
      "左へ120°回るangularとdurationを決める",
      "直進と回転を3回繰り返して軌跡を比較する",
    ],
    exercise: "linearを変え、同じ1.4mを進むdurationを計算し直して、もう一度三角形を閉じましょう。",
    insight: "センサーを見ないため、すべての辺は速度と時間のモデルが正しいことに依存します。",
  },
  feedforward_mission: {
    overview:
      "フィードフォワード制御だけで指定距離への停止に挑戦します。速度と時間の積で距離を作り、観測による修正がない制御の強みと限界を体験します。",
    goals: [
      "距離・速度・時間の関係を使う",
      "指令値と実際の移動量を比較する",
      "再現性と外乱の影響を評価する",
    ],
    steps: [
      "目標距離から走行時間を計算する",
      "一定速度を指定時間だけ出力する",
      "停止後の誤差を測定する",
    ],
    exercise: "異なる速度で同じ距離を狙い、停止誤差が速度にどう依存するか記録しましょう。",
    insight: "実験結果を使ってモデルを補正することも、制御系を改善する重要な方法です。",
  },
  feedback_controller: {
    overview:
      "Feedforward Controllerと同じ正三角形を、今度はOdometryが推定した移動距離と回転角を使って描きます。時間ではなく、各目標へ到達したと推定されたかどうかで停止する閉ループ制御です。",
    goals: [
      "Odometryから推定移動量を読む",
      "1.4mと120°を停止条件にする",
      "開ループとの情報の流れの違いを説明する",
    ],
    steps: [
      "go_straightで1.4mに達するまで進む",
      "turn_leftで120°に達するまで回る",
      "同じ動作を3回繰り返して始点へ戻る",
    ],
    exercise: "velocityだけを変え、distanceは1.4mのままで三角形が閉じるか確認しましょう。",
    insight:
      "これは測定結果を使って、各動作を終了するタイミングを決める単純な位置フィードバックです。",
  },
  feedback_mission: {
    overview:
      "Feedforward Missionと同じマップを、Odometryが推定した移動距離と旋回角度を使って進みます。時間ではなく、各ブロックの目標距離・目標角度へ到達したと推定されたかどうかで指令を止めるLessonです。",
    goals: [
      "Odometryから推定移動距離を読む",
      "旋回角度をROSの符号で扱う",
      "時間終了と位置終了の違いを説明する",
    ],
    steps: [
      "ブロック開始時の位置または角度を記録する",
      "現在のOdometryとの差を制御周期ごとに測る",
      "指定した距離または角度へ到達したら停止する",
    ],
    exercise:
      "distanceとangleを変えずにvelocityやyawrateだけを変え、同じ位置で各ブロックが終了するか確認しましょう。",
    insight:
      "このLessonには外乱を加えていません。測定結果を使って、それぞれの動作を終了するタイミングを決めます。",
  },
  lidar_avoidance: {
    overview:
      "LaserScanを購読し、前方の障害物へ反応して進行方向を変えます。センサー入力から判断、速度出力までを短い周期で繰り返すリアクティブ制御です。",
    goals: [
      "LaserScanから必要な角度範囲を抽出する",
      "閾値を使った障害物回避判定を設計する",
      "Callbackと制御周期の関係を理解する",
    ],
    steps: [
      "前方と左右の距離を集約する",
      "距離閾値を下回った方向を判定する",
      "空いている方向へ旋回指令を出す",
    ],
    exercise: "狭い通路を通れる距離閾値と、衝突リスクを抑える距離閾値の違いを探しましょう。",
    insight:
      "距離閾値は衝突リスクと行動可能範囲を同時に変えます。実機では速度に応じて閾値を変える設計も有効ですが、それだけで安全を保証するものではありません。",
  },
  param_tuner: {
    overview:
      "実行中のノードのParameterを変更し、ロボットの振る舞いを調整します。コードを書き換えずに速度、ゲイン、閾値を変更できるため、実験と調整を素早く繰り返せます。",
    goals: [
      "ParameterとTopicの違いを説明する",
      "実行時変更が制御へ反映される流れを知る",
      "複数の値を比較して調整する",
    ],
    steps: [
      "現在のParameter値を取得する",
      "新しい値をset_parametersへ送る",
      "Parameter Eventと挙動の変化を確認する",
    ],
    exercise: "一度に一つの値だけを変更し、結果を表に記録して最適値を探しましょう。",
    insight:
      "調整では変更前の値と結果を記録することが重要です。感覚だけで複数値を同時に変えると原因が分からなくなります。",
  },
  mapping_mission: {
    overview:
      "ロボットを遠隔操作しながらLiDAR観測を統合し、OccupancyGridを完成させます。SLAMのうち、自己位置を使って周囲の障害物を地図へ記録する部分を体験します。",
    goals: [
      "LaserScanを地図座標へ変換する",
      "未知・空き・障害物セルを区別する",
      "観測範囲を意識して探索する",
    ],
    steps: [
      "ロボットのPoseとLaserScanを同期する",
      "各レーザー終端を地図セルへ投影する",
      "未観測領域を減らすように走行する",
    ],
    exercise: "部屋の中央だけを走る場合と壁沿いを走る場合で、地図の完成度を比較しましょう。",
    insight: "よい地図には、障害物だけでなく空いている空間を観測することも必要です。",
  },
  localization_mission: {
    overview:
      "既存の地図とLiDAR観測を照合し、ロボットが自分の位置を推定します。AMCLは多数の位置候補を粒子として持ち、観測と合う候補を残して不確かさを縮めます。",
    goals: [
      "確率的な自己位置推定を直感的に理解する",
      "Particle Cloudの広がりを読み取る",
      "初期位置とセンサー観測の役割を知る",
    ],
    steps: [
      "地図上へ複数の位置候補を配置する",
      "各候補から予測されるLiDARと実測を比較する",
      "確からしい粒子を増やして位置を収束させる",
    ],
    exercise: "特徴の少ない長い廊下と、角が多い部屋で収束速度が違う理由を考えましょう。",
    insight:
      "ロボットの位置は一点ではなく確率分布です。不確かさを可視化すると安全な判断ができます。",
  },
  navigation: {
    overview:
      "地図上で指定したGoal Poseまで、自動で経路を計画して走行します。Nav2のGlobal Planner、Local Controller、速度指令という基本パイプラインを小さく再現しています。",
    goals: [
      "Goal PoseとPathの違いを理解する",
      "Global PlanとLocal Controlを区別する",
      "Actionが長時間処理に適する理由を知る",
    ],
    steps: [
      "/goal_poseまたはAction Goalを受け取る",
      "地図上で衝突しないPathを探索する",
      "Pathを追従する/cmd_velを連続出力する",
    ],
    exercise: "同じGoalへ異なる向きを指定し、最後の接近経路がどう変わるか観察しましょう。",
    insight:
      "ナビゲーションは経路を一度作って終わりではありません。障害物や位置誤差に応じて走行中も判断を更新します。",
  },
  image_processing: {
    overview:
      "カメラ画像には照明やセンサーによる細かなノイズが混ざります。そのまま輪郭を探すと、ノイズまで線として検出されます。このLessonでは、最初にgaussian_blurで画像をなめらかにし、その後cannyで明るさが大きく変わる場所を輪郭として取り出します。「画像を整える → 輪郭を探す」という基本の順番を体験します。",
    goals: [
      "ぼかしを先に行う理由を理解する",
      "見つけた輪郭とお手本を見比べる",
      "処理する順番で結果が変わることを知る",
    ],
    steps: [
      "ノイズのあるカメラ画像を見る",
      "gaussian_blurで細かなノイズを減らす",
      "cannyで輪郭を探してお手本と比べる",
    ],
    exercise:
      "まず輪郭の一致度を55%以上にしましょう。画面では分かりやすく百分率で表示します。採点にはF1スコアを使っていますが、最初は100%に近いほどお手本に近い、と考えれば大丈夫です。",
    insight:
      "先に画像を整えることで、後の処理が必要な特徴を見つけやすくなります。ロボットの画像認識でもよく使う考え方です。",
  },
  edge_detection: {
    overview:
      "画像の明るさが急に変化する場所を取り出し、物体の輪郭を検出します。処理前後の画像をTopicでつなぎ、画像処理パイプラインを構築します。",
    goals: [
      "エッジが画素の変化量であることを理解する",
      "Cannyの閾値と検出結果を対応させる",
      "画像処理を複数ノードへ分割する",
    ],
    steps: [
      "カラー画像をグレースケールへ変換する",
      "近傍画素の勾配を計算する",
      "閾値を超えた輪郭をImageとして出力する",
    ],
    exercise: "低い閾値と高い閾値を変更し、ノイズと必要な輪郭のバランスを探しましょう。",
    insight: "認識前の前処理を適切に設計すると、後段アルゴリズムを単純かつ安定にできます。",
  },
  object_detection: {
    overview:
      "カメラ画像から物体の種類と位置を検出し、検出結果をロボットが利用できる情報へ変換します。画像、推論結果、可視化画像を別Topicとして扱う構成を学びます。",
    goals: [
      "画像入力からBounding Boxまでの流れを理解する",
      "信頼度による検出選別を行う",
      "認識結果を行動ノードへ渡す方法を知る",
    ],
    steps: [
      "カメラ画像を推論モデルへ入力する",
      "クラス・信頼度・矩形を取得する",
      "検出結果と描画画像をpublishする",
    ],
    exercise: "信頼度閾値を変え、見逃しと誤検出がどう変化するか記録しましょう。",
    insight:
      "AIの出力は確定値ではなく信頼度を伴う推定です。行動側は不確かさを考慮する必要があります。",
  },
  joint_teleop: {
    overview:
      "関節角を直接操作し、ロボットアームの姿勢がどう変わるか観察します。JointStateは各関節の名前、角度、速度、力をまとめるアーム制御の基本メッセージです。",
    goals: [
      "関節空間と作業空間を区別する",
      "JointStateのnameとpositionを対応させる",
      "順運動学の考え方を理解する",
    ],
    steps: [
      "入力から各関節の目標角を作る",
      "関節角をControllerへ送る",
      "順運動学で手先位置を更新する",
    ],
    exercise: "同じ手先位置を作れそうな複数の関節姿勢を探してみましょう。",
    insight:
      "アームは関節を動かしますが、作業では手先の位置を考えます。この二つをつなぐのが運動学です。",
  },
  ik_reach: {
    overview:
      "指定された手先位置へ届く関節角を逆算します。Inverse Kinematicsは作業空間の目標Poseから関節空間の解を求める問題です。",
    goals: [
      "順運動学と逆運動学の違いを説明する",
      "到達可能範囲を理解する",
      "複数解と特異姿勢の存在を知る",
    ],
    steps: [
      "手先のTarget Poseを受け取る",
      "リンク長と幾何関係から関節角を求める",
      "Joint Controllerへ目標角を送る",
    ],
    exercise: "同じ目標に肘を上げる解と下げる解があるか試し、周囲との衝突を比較しましょう。",
    insight: "数学的に到達できても、関節制限や障害物によって実行できない場合があります。",
  },
  pick_place: {
    overview:
      "物体を認識し、アームで掴み、指定場所へ置くPick & Placeを完成させます。認識、TF、IK、Gripper、Actionを順番につなぐ総合的なManipulation課題です。",
    goals: [
      "Pick & Placeの処理を段階へ分解する",
      "物体Poseをアーム座標へ変換する",
      "失敗を検知して安全に回復する",
    ],
    steps: [
      "物体Poseから把持前Poseを計画する",
      "接近してGripperを閉じる",
      "持ち上げて配置Poseへ移動する",
    ],
    exercise: "物体へ真横から近づく場合と真上から近づく場合の成功率を比較しましょう。",
    insight:
      "直接把持点へ移動せず、把持前・把持・退避の中間Poseを設けると安全で再現性が高まります。",
  },
  action_builder: {
    overview:
      "時間のかかるGoalを送り、Feedbackを受けながら完了またはCancelを待つAction通信を組み立てます。ナビゲーションやアーム動作など、進捗が必要な処理に適しています。",
    goals: [
      "ActionのGoal・Feedback・Resultを区別する",
      "Cancel可能な処理を設計する",
      "Serviceとの使い分けを説明する",
    ],
    steps: [
      "ClientがAction ServerへGoalを送る",
      "実行中にFeedbackを繰り返し受け取る",
      "完了時にResult、必要ならCancelを処理する",
    ],
    exercise: "ナビゲーション中に新しいGoalが届いた場合のキャンセル方針を考えましょう。",
    insight:
      "ActionはServiceを長くしたものではなく、進捗確認と中断を通信モデルに含めた仕組みです。",
  },
  behavior_tree: {
    overview:
      "複数の行動を成功・失敗・実行中の状態で組み合わせ、ロボットの判断をBehavior Treeとして構築します。Nav2でもタスク実行の制御に使われています。",
    goals: [
      "SequenceとFallbackの違いを理解する",
      "Success・Failure・Runningを使い分ける",
      "再試行や回復行動を木構造で表す",
    ],
    steps: [
      "条件ノードで現在の状況を確認する",
      "Control Nodeが実行する子を選ぶ",
      "Action Nodeの結果を親へ返して次を決める",
    ],
    exercise: "経路が見つからない場合に、回転して再探索するRecoveryを追加しましょう。",
    insight: "Behavior Treeは判断の流れを可視化し、部分ごとに交換・テストできる点が強みです。",
  },
};

export function guideCopyFor(stage: Stage): GuideCopy {
  if (getLang() === "en") {
    const seed = ENGLISH_GUIDE[stage.id];
    const interfaceName = stage.ros2?.msgTypes[0]?.split("/").at(-1) ?? "ROS 2 data";
    if (seed) {
      const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
      return {
        overview: `Your task is to ${lowerFirst(seed.action)}. This stage helps you ${lowerFirst(seed.goal)}. ${seed.observe}, then connect what you see to the underlying ROS 2 data flow.`,
        goals: [
          seed.goal,
          `Connect the onscreen behavior to ${interfaceName} and the ROS 2 graph`,
          "Explain how the same design transfers from simulation to a physical robot",
        ],
        steps: [
          seed.action,
          seed.observe,
          "Compare the result with the mission goal, then adjust one variable at a time",
        ],
        exercise: seed.exercise,
        insight: seed.insight,
      };
    }
    return {
      overview: `Explore ${stage.name} while tracing the robot system from input through decision-making to output.`,
      goals: [
        `Explain the core ROS 2 concept behind ${stage.name}`,
        "Connect visible behavior with the messages exchanged by the nodes",
        "Describe how the same architecture can be used on a physical robot",
      ],
      steps: [
        "Provide an input or read the current sensor state",
        "Observe how the node updates its decision",
        "Inspect the resulting Topic, Service, or robot motion",
      ],
      exercise:
        "Change one input at a time, observe the result, and explain the causal relationship.",
      insight:
        "The browser simulation uses the same input–decision–output structure found in a physical ROS 2 system.",
    };
  }

  return (
    COPY[stage.id] ?? {
      overview:
        stage.ros2?.summary ??
        `${stage.name}を操作しながら、ロボットシステムの入力・判断・出力の流れを学びます。`,
      goals: [
        `${stage.name}で扱うROS 2概念を説明する`,
        "画面上の動きとMessageの変化を対応させる",
        "同じ仕組みを実機へ適用する方法を考える",
      ],
      steps: [
        "入力またはセンサーデータを受け取る",
        "ノード内で状態を判断する",
        "TopicやServiceを通して結果を出力する",
      ],
      exercise: "一つの値や操作を変更し、結果がどのように変わるか観察して説明してみましょう。",
      insight:
        "シミュレーションで見える動きの裏側には、実機と共通するROS 2の通信グラフがあります。",
    }
  );
}

export function cardPreviewFor(stage: Stage): CardPreview {
  if (getLang() === "en") {
    return {
      icon: CARD_PREVIEW[stage.id]?.icon ?? "◆",
      action: ENGLISH_GUIDE[stage.id]?.action ?? `Complete the ${stage.name} mission`,
    };
  }
  return (
    CARD_PREVIEW[stage.id] ?? {
      icon: "◆",
      action: `${stage.name}のミッションを操作する`,
    }
  );
}
