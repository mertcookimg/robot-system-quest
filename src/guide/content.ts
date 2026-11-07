// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import type { StageMeta } from "../types";
import { getLang } from "../i18n";

export interface GuideCopy {
  overview: string;
  goals: [string, string, string];
  steps: [string, string, string];
  exercise: string;
  insight: string;
  details?: string[];
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
  service_builder: { icon: "↔", action: "接続してServiceを1回呼び出す" },
  tf_puzzle: { icon: "⌗", action: "センサーの位置と向きを調整し、壁に点群を合わせる" },
  feedforward_controller: { icon: "△", action: "速度と時間を計算して正三角形を描く" },
  feedforward_mission: { icon: "┄", action: "計算した指令だけで目標位置に止める" },
  feedback_controller: { icon: "△", action: "距離と角度を測って同じ正三角形を描く" },
  feedback_mission: { icon: "⌖", action: "Odometryで距離と角度を測って目標へ進む" },
  lidar_avoidance: { icon: "⌁", action: "距離データから障害物の少ない方向を選ぶ" },
  param_tuner: { icon: "☷", action: "Parameterを変えて動きを調整する" },
  mapping_mission: { icon: "▦", action: "走行しながら部屋の地図を完成させる" },
  localization_mission: { icon: "⁙", action: "粒子を収束させて現在位置を見つける" },
  navigation: { icon: "⚑", action: "Goalを指定して経路を計画・走行する" },
  image_processing: { icon: "▧", action: "ノイズを減らして、必要な輪郭を見つける" },
  edge_detection: { icon: "◫", action: "画像から物体の輪郭を取り出す" },
  object_detection: { icon: "▣", action: "画像に映った物体を検出する" },
  joint_teleop: { icon: "⌇", action: "関節角を操作してアームを動かす" },
  ik_reach: { icon: "✣", action: "手先目標から必要な関節角を求める" },
  pick_place: { icon: "♢", action: "物体をつかんで指定場所へ運ぶ" },
  action_builder: { icon: "▷", action: "Actionを接続してGoalから完了まで確認する" },
  behavior_tree: { icon: "⑂", action: "条件と行動を木構造で組み立てる" },
};

interface EnglishGuideSeed {
  action: string;
  goal: string;
  observe: string;
  exercise: string;
  insight: string;
  goals?: [string, string, string];
  steps?: [string, string, string];
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
    goal: "Explain how Node, Topic, Message type, and compatible QoS relate",
    observe: "Compare the robot and /cmd_vel log before and after connecting the two ports",
    exercise:
      "Connect the Publisher's output to the Subscriber's input, then inspect /cmd_vel. Explain why the robot did not move before the connection.",
    goals: [
      "Identify the Publisher, Subscriber and Topic",
      "Check that the Topic name and message type match",
      "Relate the connection to the robot's motion and saved messages",
    ],
    steps: [
      "Find the /cmd_vel output and input ports",
      "Connect the ports with the same Topic name and message type",
      "Watch the robot move and inspect the /cmd_vel log",
    ],
    insight:
      "Pub/Sub is loosely coupled, so logging, visualization, and control nodes can be added without changing the Publisher.",
  },
  service_builder: {
    action: "Connect a Service Client and Server, then make one explicit call",
    goal: "Distinguish Service Client and Server responsibilities",
    observe: "Follow one request from the Client through processing to its response",
    exercise:
      "Choose whether motor stop, temperature readings, and camera frames belong on a Service or Topic, and explain each choice.",
    insight:
      "Use Topics for streams, Services for short request/response operations, and Actions for long-running goals.",
  },
  tf_puzzle: {
    action: "Adjust the sensor's position and rotation to align its scan with the walls",
    goal: "Relate the base_link to laser transform to the scan's placement",
    observe: "Change tx, ty and yaw one at a time and watch the scan move",
    exercise:
      "Change only yaw, then only tx or ty. Explain which setting rotates the scan and which shifts it.",
    goals: [
      "Identify the fixed parent base_link and child laser frames",
      "Distinguish translation from rotation",
      "Align the observed scan with the walls by changing the transform",
    ],
    steps: [
      "Compare the shifted scan with the walls",
      "Adjust tx, ty and yaw with the sliders",
      "Align the scan and inspect the resulting /tf log",
    ],
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
    observe: "Watch A* create a path, then the controller follow it and align the final heading",
    exercise:
      "Reset before each run and send the same goal position with a different heading. Observe the same planned path followed by a different final rotation.",
    steps: [
      "Click and drag to publish a position and heading on /goal_pose",
      "Inspect the A* path on /plan and the driving commands on /cmd_vel",
      "Reach five goals requiring movement or rotation; an already-satisfied goal does not count again",
    ],
    insight:
      "This lesson plans a path when you send a goal, then updates the velocity command while following it. The goal heading controls the final in-place rotation. Full navigation systems can also replan as obstacles or pose estimates change.",
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
      "A detector output is an estimate, not guaranteed ground truth. Its confidence score is not necessarily a calibrated probability, so behavior logic must account for false positives and missed detections.",
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
    action: "Connect an Action and trace its Goal, Feedback and Result",
    goal: "Distinguish goal acceptance, progress feedback and completion",
    observe: "Watch this simulation emit periodic feedback while one goal remains active",
    exercise:
      "Inspect /action_builder/events after connecting the ports. Identify the goal_accepted, feedback and result events, and explain which can occur repeatedly.",
    goals: [
      "Connect an Action Client and Server with the same name and type",
      "Distinguish Goal, Feedback and Result",
      "Explain why progress feedback is useful for a long-running task",
    ],
    steps: [
      "Connect the matching /navigate_to_pose ports to start the goal",
      "Watch the robot and the changing distance_remaining feedback",
      "Inspect the final result and SUCCEEDED status in the diagnostic log",
    ],
    insight:
      "Actions support progress feedback and cancellation in ROS 2. This lesson demonstrates goal acceptance, feedback and successful completion; cancellation is not an available control here.",
  },
  behavior_tree: {
    action: "Build robot decisions from conditions and actions",
    goal: "Explain how condition order determines the selected action",
    observe: "Watch which rule becomes active and which velocity command it selects",
    exercise:
      "Swap an obstacle-avoidance rule and a goal-direction rule between the upper and lower rows. Compare which action wins when both conditions are true.",
    goals: [
      "Pair sensor conditions with movement actions",
      "Explain why the first matching rule takes priority",
      "Compare the selected rule with the robot's motion",
    ],
    steps: [
      "Choose a condition and action for each rule",
      "Place higher-priority rules in the upper rows and choose a default action",
      "Run the robot and watch the highlighted rule and /cmd_vel",
    ],
    insight:
      "This lesson simplifies a Behavior Tree to ordered condition-action rules: the first match selects a velocity, otherwise the default action runs. General Behavior Trees also propagate Success, Failure and Running, and can express retries and recovery; those mechanisms are not controls in this lesson.",
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
      "ROS 2では操作方法とロボット本体をTopicで分離できます。同じロボットでキーボード、ゲームパッド、自律走行を切り替えて使えるのはこのためです。",
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
      "高度な地図がなくても現在のセンサー値に応じて動くことで衝突リスクを減らせますが、安全を保証するものではありません。",
  },
  patrol: {
    overview:
      "監視ロボットを避けながら複数の機能を停止するミッションです。Topicによる連続データ、Serviceによる単発の要求、Lifecycleによる状態管理を一つのシステムとして扱います。",
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
    exercise: "同じ場所を何度も通ることが、地図の精度にどのような影響を与えるか確認しましょう。",
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
      "Publisher、Topic、Subscriberを正しく接続し、ROS 2の基本通信を組み立てます。送信側と受信側は互いを直接知らず、同じTopic名とMessage型に加えて、互換性のあるQoSを使って通信します。このレッスンではTopic名と型を一致させる操作を行います。",
    goals: [
      "Node・Topic・Messageの関係を説明する",
      "型が一致しない接続が成立しない理由を理解する",
      "接続とロボットの動き・ログを対応させる",
    ],
    steps: [
      "/cmd_velの出力ポートと入力ポートを見つける",
      "Topic名とMessage型が同じポート同士を接続する",
      "ロボットの動きと/cmd_velのログを確認する",
    ],
    exercise:
      "Publisherの出力をSubscriberの入力へ接続し、/cmd_velのログを見ましょう。接続する前にロボットが動かなかった理由を説明してみましょう。",
    insight: "Pub/Subの疎結合性により、記録・可視化・制御ノードを後から追加できます。",
  },
  service_builder: {
    overview:
      "Requestを送りResponseを受け取るService通信を組み立てます。連続的に流れるTopicと異なり、短時間で完了する単発の問い合わせや操作に適しています。接続しただけでは実行されず、CALLを押すたびに一組のRequest/Responseが発生します。",
    goals: [
      "Service ClientとServerの役割を区別する",
      "Request/Response型を理解する",
      "TopicとServiceの選択基準を説明する",
    ],
    steps: [
      "Clientが型に沿ったRequestを作る",
      "Serverが要求を処理する",
      "CALLを実行し、対応するResponseを1回受け取る",
    ],
    exercise:
      "モーター停止、現在温度、カメラ画像のうちServiceに適するものを理由とともに選びましょう。",
    insight:
      "頻繁なセンサーデータはTopic、設定変更や単発の問い合わせはService、長時間処理はActionが基本です。",
  },
  tf_puzzle: {
    overview:
      "センサーの位置と向きを調整し、ずれている点群を壁に合わせます。このLessonでは親のbase_linkと子のlaserは固定されており、その間の平行移動tx・tyと回転yawをスライダーで変えます。TFが測定値の見える位置を変えることを確かめましょう。",
    goals: [
      "親base_linkと子laserの関係を確認する",
      "平行移動と回転の違いを理解する",
      "座標変換を調整して点群を壁へ合わせる",
    ],
    steps: [
      "ずれた点群と壁の位置を見比べる",
      "tx・ty・yawのスライダーを一つずつ調整する",
      "点群を壁に合わせ、/tfのログで変換を確認する",
    ],
    exercise:
      "yawだけを変えたときと、txまたはtyだけを変えたときを比べましょう。点群を回転させる値と、平行に移動させる値を説明してみましょう。",
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
      "時間による終了と位置による終了の違いを説明する",
    ],
    steps: [
      "ブロック開始時の位置または角度を記録する",
      "現在のOdometryとの差を制御周期ごとに測る",
      "指定した距離または角度へ到達したら停止する",
    ],
    exercise:
      "distanceとangleを変えずにvelocityやyawrateだけを変え、同じ位置で各ブロックが終了するか確認しましょう。",
    insight:
      "このレッスンには外乱を加えていません。測定結果を使って、それぞれの動作を終了するタイミングを決めます。",
  },
  lidar_avoidance: {
    overview:
      "LaserScanを購読し、前方の障害物を検知して進行方向を変えます。センサー入力から判断、速度出力までを短い周期で繰り返すリアクティブ制御です。",
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
      "ロボットの位置は一点ではなく、確率分布として表します。不確かさを可視化すると、より安全な判断につなげられます。",
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
      "クリックとドラッグで位置・向きを/goal_poseへ送る",
      "A*の経路/planと、走行中の速度指令/cmd_velを観察する",
      "移動か回転が必要なゴールを5回達成する（すでに満たしているゴールは加算なし）",
    ],
    exercise:
      "毎回リセットしてから、同じゴール位置に異なる向きを指定しましょう。計画される経路は同じで、到着後のその場回転が変わることを観察しましょう。",
    insight:
      "このLessonはゴールを送ったときに経路を計画し、走行中は速度指令を更新します。ゴールの向きは到着後のその場回転に使います。実際のナビゲーションでは、障害物や自己位置の変化に応じて経路を再計画する構成もあります。",
  },
  image_processing: {
    overview:
      "カメラ画像には照明やセンサーによる細かなノイズが混ざります。そのまま輪郭を探すと、ノイズまで線として検出されます。このレッスンでは、最初にgaussian_blurで画像をなめらかにし、その後cannyで明るさが大きく変わる場所を輪郭として取り出します。「画像を整える → 輪郭を探す」という基本の順番を体験します。",
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
    exercise: "低い閾値と高い閾値を調整し、ノイズと必要な輪郭のバランスを探しましょう。",
    insight: "認識前の前処理を適切に設計すると、後段アルゴリズムを単純かつ安定にできます。",
  },
  object_detection: {
    overview:
      "カメラ画像から物体の種類と位置を検出し、検出結果をロボットが利用できる情報に変換します。画像、推論結果、可視化画像を別Topicとして扱う構成を学びます。",
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
      "物体検出器の出力は推定であり、正解を保証しません。信頼度スコアも正しく校正された確率とは限らないため、行動側では誤検出と見逃しを考慮する必要があります。",
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
      "物体を認識し、アームでつかみ、指定場所へ置くPick & Placeを完成させます。認識、TF、IK、Gripper、Actionを順番につなぐ総合的なManipulation課題です。",
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
      "同じAction名と型のポートを接続してGoalを開始し、途中のFeedbackから完了時のResultまで観察します。Serverは実行中に進み具合を返せるため、ナビゲーションなど時間のかかる処理に適しています。このLessonの操作は接続と成功完了の確認までです。",
    goals: [
      "同じAction名と型のClientとServerを接続する",
      "Goal・Feedback・Resultを区別する",
      "時間のかかる処理で途中経過が役立つ理由を説明する",
    ],
    steps: [
      "/navigate_to_poseのポートを接続し、Goalを開始する",
      "ロボットと、Feedbackのdistance_remainingの変化を見る",
      "診断ログで最後のResultとSUCCEEDEDを確認する",
    ],
    exercise:
      "/action_builder/eventsを確認し、goal_accepted・feedback・resultを見分けましょう。実行中に何度も出るのはどのイベントでしょうか。",
    insight:
      "ROS 2のActionには途中経過の通知とキャンセル要求の仕組みがあります。このLessonで体験するのはGoalの受付・Feedback・成功完了で、キャンセル操作は実装していません。",
  },
  behavior_tree: {
    overview:
      "センサーの条件と動作を組み合わせ、ロボットの判断を作ります。このLessonはBehavior Treeの考え方を簡略化したもので、上から順に条件を調べ、最初に成立したルールの動作を選びます。",
    goals: [
      "センサーの条件と移動・回転の動作を組み合わせる",
      "最初に成立したルールが優先されることを説明する",
      "選ばれたルールとロボットの動きを比べる",
    ],
    steps: [
      "各ルールの条件と動作を選ぶ",
      "優先するルールを上の行に置き、どの条件にも合わないときの動作を選ぶ",
      "実行し、強調されるルールと/cmd_velを観察する",
    ],
    exercise:
      "障害物を避けるルールとゴール方向を向くルールを、上下の行で入れ替えてみましょう。両方の条件が成立したとき、どちらの動作が優先されるか比べましょう。",
    insight:
      "このLessonは、最初に成立した条件で速度を選び、どれも成立しなければ既定の動作を行います。一般のBehavior TreeにはSuccess・Failure・Runningの伝播や再試行・回復行動もありますが、このLessonではそれらを編集・実行する機能は扱いません。",
  },
};

export function guideCopyFor(stage: StageMeta): GuideCopy {
  if (stage.id === "world_model") {
    return getLang() === "ja"
      ? {
          overview:
            "ボールを押す前に、「軽く押せば少し、強く押せば遠くへ動きそう」と考えることがあります。ロボットも、動きの記録から「こう押すと、こう動く」を学べます。ここでは箱の動きを予想してから、実際に動かして確かめましょう。同じ表と、同じ場所のボタンで進めます。学習待ちはありません。",
          goals: [
            "動かす前の予想と、動かして確かめた結果を比べる",
            "予想を作るために、動きの記録から学んだしくみを知る",
            "目標だけを変えた場合と、箱が動いている場合の違いを見つける",
          ],
          steps: [
            "止まっている箱で「予想を見る」→「2秒動かして確かめる」。表の予想と実際を比べる",
            "同じ場所のボタンで次へ。目標だけが遠くなると、どの押し方が選ばれるか見る",
            "もう一度次へ。最初から右へ動いている箱では、同じ押し方の予想も変わるか見る",
          ],
          exercise:
            "目標を遠くしただけで、箱の動き方まで変わるでしょうか。箱が最初から動いていたらどうでしょう。表の「弱く押す」の予想を比べてみましょう。実際の結果が入るのは、動かして確かめた行だけです。予想が実際に近いことと、箱が目標に近いことも別です。3つの実験で確かめれば完了でき、正解を当てる必要はありません。",
          insight:
            "世界モデルは、今の状態と押し方から次の状態を予想するために学んだしくみです。予想を実際の動きと比べ、目標を変えたときと箱が動いているときの違いを確かめましょう。",
          details: [
            "箱を押す強さや、箱がすでに動いているかによって、その後の動きは変わります。このLessonでは、動きの記録から学んだ「今の状態と押し方から、次の状態を予想するしくみ」を世界モデルと呼びます。表に出る数字は、そのしくみを使って計算した予想です。予想を作るしくみと、予想という結果は別です。さらに、3つの予想を目標と比べて押し方を選ぶ処理を計画と呼びます。最初の2実験は、目標だけを0.47 m先から1.05 m先へ変えます。同じ押し方なら、箱の動き方は変わらないため、予想は同じです。3つ目では目標は同じでも、箱が最初から右へ動いているため予想が変わります。3実験とも、同じ学習済みのしくみを使っています。",
            "詳しく見ると、この教材の世界モデルは、箱の位置・速度・力を数値で受け取る小さなニューラルネットです。シミュレーションの4,000件の記録から事前に学び、次の状態の予測を40回つなげて2秒後を求めます。目標はこのモデルの入力に含めず、別の計画器が予想位置と目標の距離で押し方を選びます。予想を計算するときは、実行結果や正解の物理シミュレーターを参照しません。選んだ1候補だけを同じ開始状態・力の予定で実行し、同じ2秒時点で比べます。",
            "実際の動きもシミュレーションです。2秒後に停止しているとは限らず、予想が外れることもあります。画像からの状態推定、実行途中の計画の更新、報酬による行動の学習は扱いません。研究には画像や潜在表現の予測を使う世界モデルもありますが、ここでは数値で表した箱の動きに範囲を絞っています。",
          ],
        }
      : {
          overview:
            "Before pushing a ball, you might expect a gentle push to move it a little and a strong push to move it farther. A robot can learn how pushes affect motion from recorded examples. Here, predict how a box will move, then try it and check. Keep watching the same table and use the button in the same place to continue. There is no training wait.",
          goals: [
            "Compare a prediction made before acting with the result after acting",
            "Understand the learned mechanism that turns motion records into predictions",
            "Compare changing only the target with starting from a box already in motion",
          ],
          steps: [
            "For a stationary box, view the predictions, then run for two seconds and compare the table's prediction and actual result",
            "Continue with the same button. Only the target moves farther away: see which push is selected",
            "Continue again. The box now starts moving right: see whether the same push has a different predicted result",
          ],
          exercise:
            "Does moving the target farther away change how the box moves? What if the box is already moving? Compare the gentle-push predictions. An actual result appears only for the push you tried. Predicting the result accurately and reaching the target are different things. Check all three experiments to finish; you do not have to guess the right answer.",
          insight:
            "A world model learns to predict the next state from the current state and an action. Compare its predictions with motion, then distinguish changing the target from changing the starting motion.",
          details: [
            "A box's motion depends on how hard it is pushed and whether it is already moving. In this lesson, a world model is a mechanism learned from motion records that predicts the next state from the current state and a push. The numbers in the table are predictions calculated using that mechanism. The mechanism and its predictions are different things. Comparing three predictions with a target to choose a push is called planning. The first two trials change only the target, from 0.47 m to 1.05 m right of the start. For the same push, how the box moves is unchanged, so its prediction stays the same. The third keeps the target but starts the box moving right, so the predictions change. All three use the same learned mechanism.",
            "In more detail, this lesson's world model is a small neural network that receives numerical position, velocity and force. It was trained beforehand on 4,000 simulated transitions and repeats its next-state prediction 40 times to predict two seconds ahead. The target is not an input to this model: a separate planner chooses the push whose predicted position is closest to it. Prediction does not consult the actual result or the ground-truth physics simulator. Only the selected candidate is executed with the same initial state and force schedule, then compared at the same two-second instant.",
            "Actual motion is simulated too. The box may still be moving at two seconds, and predictions can be wrong. This lesson does not estimate state from images, update its plan during execution or learn actions from rewards. Research also uses world models that predict images or latent representations; this lesson focuses on the box's motion represented by numbers.",
          ],
        };
  }
  if (stage.id === "vla_lab") {
    return getLang() === "ja"
      ? {
          overview:
            "「赤い箱へ」「青い箱へ」を選び、ロボットを動かしましょう。画像で周りを見て、言葉の指示に合わせて次の動作を選びます。画像・指示・動作の3つを見比べる、小さなVLAの体験です。",
          goals: [
            "画像と指示の両方が、動作を決める材料になると気づく",
            "同じ景色でも、指示を変えると行き先が変わることを確かめる",
            "同じ指示でも、箱の場所を変えると動きが変わることを確かめる",
          ],
          steps: [
            "「赤い箱へ」を選び、ロボットを動かす",
            "同じ配置で「青い箱へ」に変え、動きを比べる",
            "指示をそのままにして箱の配置を変え、もう一度動かす",
          ],
          exercise:
            "指示だけを変えたときと、配置だけを変えたときに、最初の動作はどう変わりましたか。画像・指示・動作のカードを見て、どの入力が変わったか説明してみましょう。",
          insight:
            "VLAはVision（画像）・Language（言葉）・Action（動作）をつなぐモデルの構成を表します。模倣学習や強化学習は学び方の名前なので、VLAと別の軸です。この教材は7×5の簡略RGB俯瞰画像と、選択した2種類の指示コードから、上下左右・停止の5動作を選びます。赤箱をR、ロボットをG、青箱をBに符号化した105個の画素値を入力し、指示に応じた線形softmax方策で動作を予測します。合成したお手本で事前に行動模倣（BC）を行い、実行中は固定の係数で推論するため学習待ちはありません。一般の写真や自由な文章を理解するモデルではなく、赤青の箱へ向かう限定タスクの教材です。OpenVLAそのものや実機の汎用性能を再現するものではありません。",
        }
      : {
          overview:
            "Choose the red or blue box and watch the robot move. It uses an image of the scene and your instruction to choose its next action. Compare the three cards: image, instruction and action.",
          goals: [
            "Notice that both the image and the instruction help select an action",
            "Keep the scene fixed and see how a new instruction changes the destination",
            "Keep the instruction fixed and see how moving the boxes changes the actions",
          ],
          steps: [
            "Choose the red box and run the robot",
            "Keep the layout and choose the blue box to compare the movement",
            "Keep the instruction, change the layout and run again",
          ],
          exercise:
            "How does the first action change when you change only the instruction, or only the layout? Use the image, instruction and action cards to explain which input changed.",
          insight:
            "VLA connects Vision, Language and Action: it describes a model's inputs and outputs. Imitation learning and reinforcement learning describe ways to train, so they are a different axis. This lesson encodes a 7×5 overhead image as 105 RGB values: red box in R, robot in G and blue box in B. An instruction-conditioned linear softmax policy takes these pixels and one of two instruction codes, then chooses up, right, down, left or stop. It was trained by behavior cloning on synthetic demonstrations; the lesson uses fixed coefficients for inference, with no training wait. It is a limited red/blue-box task, not general photo or free-form language understanding, OpenVLA itself, or evidence of general robot performance.",
        };
  }
  if (stage.id === "reinforcement_learning") {
    return getLang() === "ja"
      ? {
          overview:
            "ごほうびを選び、ロボットに旗のゴールを目指してもらいましょう。ロボットは自分で動きを試して、ごほうび（報酬）から学びます。操作のお手本を渡す模倣学習とは違う学び方です。",
          goals: [
            "試行とごほうびから学んだ動きを、学習前と比べる",
            "いろいろ試して学ぶ時間と、学んだ動きを見る時間を区別する",
            "ごほうびを集めることと、ゴールに着くことを分けて考える",
          ],
          steps: [
            "「ゴール重視」で、ゴール到着にごほうびを付ける",
            "「学習する（約2秒）」→「動きを見る」で、学習前後を比べる",
            "結果を見てLessonを完了する。発展として「ボーナス追加」で学び直し、報酬の違いを比べる",
          ],
          exercise:
            "まず同じごほうび設定で学習前と学習後の3地点の結果を比べましょう。ここまででLessonを完了できます。発展課題は「ボーナス追加」での再学習です。★への寄り道でごほうびを集めても、ゴールへ行かないことはありますか。結果はすぐ表示され、短い動きの抜粋で様子を確認できます。",
          insight:
            "この実装は、マップ上の位置と上下左右の行動ごとに値を保存する表形式のQ学習です。ニューラルネットや操作のお手本は使いません。学習中は確率的に行動を試す探索を行い、比較中は探索と値の更新を止めます。各学習は同じ初期値と乱数シードから600回試行します。比較は80手を上限に同じマップの固定3開始位置で評価し、動きは最大16手の抜粋を再生します。3地点は学習にも使うため、未知のマップへの汎化や成功確率を示すものではありません。報酬設定が違うモデル同士では、報酬の合計だけで優劣を決められません。",
        }
      : {
          overview:
            "Choose a reward and help the robot reach the goal flag. The robot tries moves and learns from the rewards it receives. Unlike imitation learning, it learns without being shown example actions.",
          goals: [
            "Compare behavior before and after learning from trials and rewards",
            "Distinguish trying moves to learn from watching a learned behavior",
            "Consider collecting rewards separately from reaching the goal",
          ],
          steps: [
            "Choose Goal reward to reward reaching the flag",
            "Select Learn (about 2 sec), then Watch the robots to compare before and after",
            "Inspect the results to finish the lesson. Optionally choose Bonus reward and learn again to compare reward rules",
          ],
          exercise:
            "First compare the same three starts before and after learning with one reward setting; this is enough to finish. As an optional extension, learn again with Bonus reward. Can the robot collect rewards by revisiting ★ without reaching the flag? Results appear immediately, with a short motion excerpt.",
          insight:
            "This lesson uses tabular Q-learning, storing a value for each grid position and each of four actions. It uses neither a neural network nor demonstrated actions. Training includes random exploration; evaluation disables both exploration and value updates. Each fit runs 600 trials from the same initial values and random seed. Evaluation allows up to 80 moves from three fixed starts; playback shows an excerpt of at most 16 moves. The starts also appear in training, so these results do not establish success probabilities or generalization to unseen maps. Reward totals under different rules are not directly comparable measures of performance.",
        };
  }
  if (stage.id === "imitation_learning") {
    return getLang() === "ja"
      ? {
          overview:
            "まず自分で操作を記録し、模倣学習の一種、Behavior Cloningを体験します。そのときの状況と操作のペアから、あなたの操作に近い値を予測するようニューラルネットの重みを学習します。操作の模倣誤差と、実際の走行成績を分けて確認します。",
          goals: [
            "実演の操作をまねる学習目標と、走行の成功を区別する",
            "同じ条件で学習前と学習後の走行を比べる",
            "プログラムで生成した復帰データを追加し、走行の変化を比べる",
          ],
          steps: [
            "「操作データを集める」から上下キー・タッチの説明を確認して開始する。3秒のカウントダウン後、約11秒の操作を失敗も含めて記録する",
            "選択した記録が20件以上になったら学習する。記録した操作と学習前・学習後の予測を見て、同じ3条件で走行を比較する",
            "必要なら復帰データ100件を追加して再学習する。前回と今回の使用データ・成功コース数・コース内にいた時間の割合を比較する",
          ],
          exercise:
            "自分の操作データだけで学習したモデルと、同じ操作データに復帰データを加えたモデルを比較しましょう。操作をよくまねられても走行に失敗する場合はありますか。操作データ・復帰データは各100件まで。使うカテゴリを選べ、選択を外しても記録は消えません。復帰データは操作を20件以上記録すると用意できます。",
          insight:
            "この実装は2→12→1のtanhネットで、記録した操作との二乗誤差をAdamで240エポック学習します。操作データはあなたの入力、復帰データはずれた位置から中央へ戻るプログラムの走行記録です。学習処理に制御式や試験成績は渡さず、失敗操作も学習対象になります。学習データでの一致は未知状態での成功を保証せず、閉ループでは小さな誤差から記録とは違う状態へ進むことがあります。固定試験の反復も実機への汎化を証明しません。",
        }
      : {
          overview:
            "Start by recording your own controls, then explore Behavior Cloning, one form of imitation learning. Fit a neural network to predict your recorded actions from observations, and inspect imitation error separately from driving performance.",
          goals: [
            "Distinguish imitating demonstrated actions from succeeding at driving",
            "Compare driving before and after training under identical conditions",
            "Compare driving after adding Recovery data generated by a programmed controller",
          ],
          steps: [
            "Choose Record your driving, read the Up/Down keyboard and touch instructions, and start. After a 3-second countdown, record about 11 seconds of your controls, including mistakes",
            "Train with at least 20 selected pairs. Inspect the recorded action and before/after predictions, then compare driving under the same 3 conditions",
            "Optionally add 100 Recovery pairs and retrain. Compare previous and current models by their training data, successful courses and percentage of time inside the course band",
          ],
          exercise:
            "Compare training on your controls alone with training on the same controls plus Recovery data. Can imitation error be low while driving fails? Each of the two categories holds up to 100 pairs. Choose which categories to use; turning one off does not delete its data. Recovery collection becomes available after recording at least 20 manual pairs.",
          insight:
            "This implementation fits a 2→12→1 tanh network to recorded actions using MSE and Adam for 240 epochs. Manual data records your inputs; Recovery data records a programmed controller returning toward the course center from displaced positions. Fitting has no access to the controller formula or test scores. Mistakes remain training targets. A good fit does not guarantee success in unseen states; small errors in closed-loop execution can lead away from recorded states. Repeated fixed tests do not establish transfer to hardware.",
        };
  }
  if (getLang() === "en") {
    const seed = ENGLISH_GUIDE[stage.id];
    const interfaceName = stage.ros2?.msgTypes[0]?.split("/").at(-1) ?? "ROS 2 data";
    if (seed) {
      const lowerFirst = (value: string): string => value.charAt(0).toLowerCase() + value.slice(1);
      return {
        overview: `Your task is to ${lowerFirst(seed.action)}. This stage helps you ${lowerFirst(seed.goal)}. ${seed.observe}, then connect what you see to the underlying ROS 2 data flow.`,
        goals: seed.goals ?? [
          seed.goal,
          `Connect the onscreen behavior to ${interfaceName} and the ROS 2 graph`,
          "Explain how the same design transfers from simulation to a physical robot",
        ],
        steps: seed.steps ?? [
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

export function cardPreviewFor(stage: StageMeta): CardPreview {
  if (stage.id === "world_model")
    return {
      icon: "◇",
      action:
        getLang() === "ja" ? "動かす前に、結果を予想しよう" : "Predict the outcome before moving",
    };
  if (stage.id === "vla_lab")
    return {
      icon: "◉",
      action:
        getLang() === "ja"
          ? "画像 ＋ 指示 → ロボットの動き。言葉と配置を変えて試す"
          : "Image + instruction → action. Try a new instruction or layout",
    };
  if (stage.id === "reinforcement_learning")
    return {
      icon: "↗",
      action:
        getLang() === "ja"
          ? "ごほうびを選ぶ → 学習する → ロボットの動きを見る"
          : "Choose rewards → learn → watch the robots",
    };
  if (stage.id === "imitation_learning")
    return {
      icon: "◎",
      action:
        getLang() === "ja"
          ? "自分の操作を記録し、学習前後の走行を比べる"
          : "Record your controls and compare driving before and after training",
    };
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
