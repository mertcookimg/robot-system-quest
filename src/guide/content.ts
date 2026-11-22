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
  battery_rush: { icon: "▰", action: "配達とドックでの充電を両立する" },
  robo_kitchen: { icon: "☷", action: "アームで食材を正しく積み上げる" },
  swarm_rescue: { icon: "⋈", action: "3台で役割分担して仲間を救う" },
  robo_baseball: { icon: "⚾", action: "投球を追跡し、照準とタイミングを合わせて打つ" },
  robo_tennis: { icon: "🎾", action: "ボールの高さと着地点を読み、ラリーを続ける" },
  pubsub_builder: { icon: "⇄", action: "PublisherとSubscriberを接続する" },
  service_builder: { icon: "↔", action: "接続してCALLを繰り返し、GOALまで進める" },
  tf_puzzle: { icon: "⌗", action: "センサーの位置と向きを調整し、壁に点群を合わせる" },
  feedforward_controller: { icon: "△", action: "速度と時間を計算して正三角形を描く" },
  feedforward_mission: { icon: "┄", action: "速度と時間を組み合わせ、壁を避けてGOALへ進む" },
  feedback_controller: { icon: "△", action: "距離と角度を測って同じ正三角形を描く" },
  feedback_mission: { icon: "⌖", action: "Odometryで距離と角度を測って目標へ進む" },
  lidar_avoidance: { icon: "⌁", action: "前方・右・左の距離から前進・旋回・停止を選ぶ" },
  param_tuner: { icon: "☷", action: "Parameterを変えて動きを調整する" },
  mapping_mission: { icon: "▦", action: "走行しながら部屋の地図を完成させる" },
  localization_mission: { icon: "⁙", action: "粒子を収束させて現在位置を見つける" },
  navigation: { icon: "⚑", action: "Goalを指定して経路を計画・走行する" },
  image_processing: { icon: "▧", action: "ノイズを減らして、必要な輪郭を見つける" },
  edge_detection: { icon: "◫", action: "走行しながら輪郭を調整し、5色の対象を捕捉する" },
  object_detection: { icon: "▣", action: "模擬検出器の信頼度を調整し、対象を捕捉する" },
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
      "Compare holding the forward control with using short presses near walls. Observe how stopping between moves changes completion time and collision risk.",
    insight:
      "A Topic decouples the controller from the robot, so keyboard, gamepad, and autonomous control can share the same interface.",
  },
  follower: {
    action: "Drive behind the moving leader at a distance of 55–130 px for a total of 8 seconds",
    goal: "Relate the target pose, following distance, and manual velocity commands",
    observe: "Watch the distance and progress meter while your controls set the velocity command",
    exercise:
      "Follow near the inner edge, then the outer edge of the marked band. Compare how you steer through turns. Time outside the band pauses progress without erasing it.",
    insight:
      "You steer manually in this game. An autonomous follower could instead use the target pose and its own pose to calculate distance and heading errors, then generate velocity commands.",
  },
  lidar_explorer: {
    action: "Explore while avoiding obstacles with LiDAR",
    goal: "Read angles and ranges from a LaserScan",
    observe: "Compare the nearest ranges in front, left, and right",
    exercise:
      "Drive the route again while leaving more space around walls. Compare exploration time and collisions.",
    insight:
      "Reactive obstacle avoidance can reduce collision risk without requiring a map, but it does not guarantee safety.",
  },
  patrol: {
    action: "Avoid the patrol robots, activate all three terminals, and reach the exit",
    goal: "Choose between Topic, Service, and lifecycle state transitions",
    observe: "Track continuous state updates and one-shot shutdown requests",
    exercise:
      "Choose a different order for visiting the three terminals. Compare travel time and exposure to the patrols; each terminal slows the enemies, and the third stops them.",
    insight:
      "Real robots are collections of nodes. Managing components independently makes failures easier to isolate and recover from.",
  },
  racing: {
    action: "Pass CP1→CP2→CP3 on every lap and finish three laps; in 1P, rank determines the stars",
    goal: "Connect path tracking, odometry, and velocity control",
    observe:
      "Compare your manual steering and boost use with the opponents' automatic waypoint following",
    exercise:
      "Compare a run without boost with one that uses boost on straight sections. Pass all three checkpoints in order on every lap, and watch for time lost off the road.",
    insight:
      "The largest command is not always the fastest solution; sensing error and control rate determine the speed that remains stable.",
  },
  robo_soccer: {
    action: "Coordinate the team and score a goal",
    goal: "Share world state across multiple robot nodes",
    observe: "Watch the automatic teammates and opponents follow their attack and defense roles",
    exercise: "Change the opponent difficulty and observe chasing, defending, and shooting.",
    insight:
      "In multi-robot systems, shared information and role design often matter more than each robot's locally optimal action.",
  },
  treasure_map: {
    action: "Build a map while collecting the treasure",
    goal: "Understand how scans and a known robot pose reveal a grid map",
    observe: "Watch unknown cells become free space or obstacles",
    exercise:
      "Compare revisiting a mapped corridor with exploring a new one. Watch the known-cell percentage: revisiting known cells does not increase their confidence in this simplified map.",
    insight:
      "This game stores cells as unknown, wall, or free and assumes the robot pose is known. Probabilistic mapping and simultaneous pose estimation are extensions used in full SLAM systems.",
  },
  tag_chase: {
    action: "Evade the chasing robots for 30 seconds",
    goal: "Use live Pose updates from multiple robots",
    observe: "Watch how prediction changes the chosen escape direction",
    exercise:
      "Change direction around obstacles to make the chasers detour and preserve your distance. Compare watching their current position with also anticipating their movement.",
    insight:
      "For moving targets, predicting the near future is often more useful than responding only to the latest measurement.",
  },
  sumo_battle: {
    action: "Push the opponent out without crossing the boundary",
    goal: "Relate distance from the ring center to the risk of being pushed out",
    observe: "Watch the AI approach, wind up, charge, and recover while you steer manually",
    exercise:
      "At the same difficulty, compare staying near the center with attacking near the boundary. Record wins and losses over several rounds.",
    insight:
      "Even simple behavior becomes easier to test and tune when states and priorities are explicit.",
  },
  battery_rush: {
    action:
      "Deliver parcels and manually drive back to the charging dock before the battery runs out",
    goal: "Use BatteryState as a planning constraint",
    observe: "Compare estimated travel cost with remaining energy",
    exercise:
      "Choose to return to the dock earlier in one run and later in another. Compare deliveries and remaining battery.",
    insight:
      "Power, temperature, and communication quality are part of planning on a physical robot—not afterthoughts.",
  },
  robo_kitchen: {
    action: "Use the arm to stack ingredients in the correct order",
    goal: "Connect the hand target, inverse kinematics, and grasp execution",
    observe: "Watch the arm joints follow the hand target as ingredients move along the belt",
    exercise:
      "Try grasping an ingredient earlier and later along the belt. Adjust the hand target to meet it, then release it over the plate.",
    insight:
      "This game provides the ingredient position and computes joint angles from your hand target. A physical system would also need perception and frame transforms to obtain that target.",
  },
  swarm_rescue: {
    action: "Coordinate three robots to complete the rescue",
    goal: "Understand the fixed Scout, Carrier, and Relay roles and their shared state",
    observe: "Track how Scout, Relay, and Carrier exchange information",
    exercise:
      "Switch between Scout, Carrier, and Relay and observe how the other two keep working automatically. As a thought experiment, discuss what would change if one robot had to perform all three roles.",
    insight:
      "Distributed design must specify what happens when information is delayed or unavailable, not only how work is divided.",
  },
  robo_baseball: {
    action: "Track the pitch and match both aim and swing timing",
    goal: "Use a predicted PointStamped crossing position for fast interception",
    observe: "Compare the live ball path, predicted target, and bat contact timing",
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
      "Watch automatic motion begin after connecting and inspect the /cmd_vel log",
    ],
    insight:
      "Pub/Sub is loosely coupled, so logging, visualization, and control nodes can be added without changing the Publisher.",
  },
  service_builder: {
    action: "Connect a Service Client and Server, then repeat CALL to reach GOAL",
    goal: "Distinguish Service Client and Server responsibilities",
    observe: "Follow one request from the Client through processing to its response",
    exercise:
      "Choose whether motor stop, temperature readings, and camera frames belong on a Service or Topic, and explain each choice.",
    steps: [
      "Connect the Client and Server ports with a matching service name and srv type",
      "Press CALL to send one request, receive its response, and advance one step",
      "Repeat CALL until the robot reaches GOAL; eight calls complete this lesson",
    ],
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
    action: "Plan timed forward moves and turns to avoid walls and reach GOAL",
    goal: "Use speed and duration to plan straight segments and turns",
    observe: "Watch each timed command advance the robot along the planned route",
    exercise:
      "Change the speed of one straight segment and recalculate its duration to keep the same distance. Compare the route and whether the robot still avoids the walls.",
    steps: [
      "Plan straight segments and turns around the walls",
      "Set linear, angular, and duration in each cmd_vel block, then RUN",
      "Adjust the sequence until the robot enters the GOAL area without a collision",
    ],
    insight:
      "This lesson uses ideal motion without added disturbances. A physical robot may deviate because of model error or disturbances; a timed open-loop sequence does not correct those errors from measured pose.",
  },
  feedback_controller: {
    action: "Draw the same triangle from measured distance and angle",
    goal: "Stop each 1.4 m side and 120° turn using /robot/odometry/odometry",
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
    action: "Use front, right, and left LiDAR ranges to choose forward, turn, or stop",
    goal: "Turn LaserScan sectors from /robot/lidar/scan into a reactive obstacle-avoidance decision",
    observe: "Watch the command follow the front → right → left checks, or stop",
    exercise: "Find a distance threshold that can pass narrow gaps while reducing collision risk.",
    steps: [
      "Drive forward when front > threshold",
      "Otherwise turn left if right < threshold, or turn right if left < threshold; the left turn has priority when both sides are close",
      "Stop if none of these conditions applies; front exactly at the threshold proceeds to the side checks",
    ],
    insight:
      "A distance threshold changes both collision risk and reachable space. Increasing it with speed can reduce risk, but does not by itself guarantee safety.",
  },
  param_tuner: {
    action: "Tune robot behavior by editing the drive_params block",
    goal: "Explain how Parameters differ from Topics",
    observe: "Watch block edits change the running controller and appear on /parameter_events",
    exercise: "Change one value at a time and record each result before choosing the best setting.",
    steps: [
      "RUN the drive_params block with its default values",
      "Edit one value in the block while the robot is driving",
      "Observe the motion and /parameter_events; the conceptual terminal is read-only",
    ],
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
      "Set position with the mouse, arrows, or left stick/D-pad; drag, hold Enter/Space + arrows, or hold A + stick/D-pad to choose heading, then release to send /goal_pose (Esc/B cancels the cursor drag)",
      "Inspect the A* path on /plan and the driving commands on /cmd_vel",
      "Reach five goals requiring movement or rotation; an already-satisfied goal does not count again",
    ],
    insight:
      "This lesson plans with A* and follows a lookahead point using heading-error control. The goal heading controls the final in-place rotation. Full navigation systems can also replan as obstacles or pose estimates change.",
  },
  image_processing: {
    action: "Reduce camera noise, then find useful edges",
    goal: "Explain why Gaussian blur is applied before Canny",
    observe: "Compare the detected edges with the target while tuning each value",
    exercise:
      "Raise Edge Match to at least 55% (F1 ≥ 0.55). Treat the percentage as similarity first; F1 is the metric used underneath.",
    insight:
      "Cleaning the image first makes the features needed by later perception stages easier to detect.",
  },
  edge_detection: {
    action: "Tune blur and Canny while driving, capture all five targets and reach GOAL",
    goal: "Relate camera viewpoint and processing parameters to successful edge capture",
    observe: "Watch sigma and the low/high thresholds change the live edge image",
    goals: [
      "Understand an edge as a sharp change between neighboring pixels",
      "Compare Gaussian blur and Canny settings while changing viewpoint",
      "Capture all five coloured targets before reaching GOAL",
    ],
    steps: [
      "Drive with WASD / arrows and frame a target in the camera",
      "Edit blur sigma and canny low / high in the block fields; gamepad Y switches DRIVE / TUNE",
      "Check each target's capture indicator, then drive to GOAL after collecting all five",
    ],
    exercise:
      "Hold the viewpoint steady and adjust sigma, then low / high. Find settings that preserve the target's contour without filling its interior with noise. Then change distance and angle and compare capture results.",
    insight:
      "This lesson edits processing blocks rather than wiring ROS nodes. On a real robot, camera and preprocessing nodes can exchange images through Topics. Useful preprocessing preserves features needed by later perception stages.",
  },
  object_detection: {
    action: "Tune a simulated detector, capture every target and reach GOAL",
    goal: "Interpret bounding boxes, classes and confidence scores as detector outputs",
    observe:
      "Watch synthetic detections change with model size, viewpoint and confidence filtering; this lesson does not run image inference",
    goals: [
      "Read the class, bounding box and confidence of a simulated detection",
      "Compare confidence filtering, missed targets and false positives",
      "Capture all targets and inspect /obj_detection/objects",
    ],
    steps: [
      "Set the detect model and confidence_filter threshold, then press RUN",
      "Drive to frame each target and inspect the generated detections",
      "Capture every target and drive to GOAL; removing every false positive is not required to clear",
    ],
    exercise:
      "Keep the viewpoint fixed and change the confidence threshold. Compare retained detections and missed targets. The class, box, confidence, false positives and latency are simulated from known object positions and model settings, rather than inferred from image pixels.",
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
      "Switch between elbow-up and elbow-down at the same target. Move the cursor beyond the workspace and near full extension, then compare the tip position, joint limits and manip indicator. If you have a Joint Teleop record, compare completion times in the results.",
    insight:
      "This lesson models workspace and joint limits; it has no obstacles or collision task. The manip indicator is |sin(q2)| and approaches zero near a straight arm. A real robot also needs collision checking when selecting an IK solution.",
  },
  pick_place: {
    action: "Grasp six conveyor parcels and release each at its matching dock",
    goal: "Coordinate tip position, grasp timing and release in this 2D sorting task",
    observe:
      "Watch the parcel letter and colour, gripper state and two-second penalties for escaped parcels or wrong drops",
    goals: [
      "Break sorting into approaching, grasping, carrying and releasing",
      "Match each parcel's letter and colour to dock A, B or C",
      "Adjust timing to avoid escaped parcels and wrong drops",
    ],
    steps: [
      "Move the tip onto a parcel with the mouse or arrows",
      "Click, press Enter or use gamepad A to grasp; move to the matching dock",
      "Press again to release inside the dock and repeat until six parcels are sorted",
    ],
    exercise:
      "Compare grabbing early on the conveyor with grabbing later. Inspect where the tip is when you release and how escaped parcels or wrong drops affect the final time (+2 seconds each).",
    insight:
      "This lesson uses known parcel locations and distance-based grasp/release in 2D. Real robots additionally need perception, TF transforms, approach/lift/retreat poses and collision-aware planning; those are extensions, not controls or success tests in this task.",
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
      "/robot/manual_control/cmd_velへTwistメッセージをpublishする",
      "ロボットが指令を受け取り、姿勢を更新する",
    ],
    exercise:
      "前進キーを押し続ける操作と、壁の近くで短く押して止まる操作を比べましょう。移動の間に停止すると、所要時間と衝突しやすさはどう変わりますか。",
    insight:
      "ROS 2では操作方法とロボット本体をTopicで分離できます。同じロボットでキーボード、ゲームパッド、自律走行を切り替えて使えるのはこのためです。",
  },
  follower: {
    overview:
      "自分でロボットを操縦し、動くリーダーを追いかけます。距離が55〜130pxの範囲にいた時間が合計8秒になるとクリアです。範囲を外れている間は進捗が止まりますが、それまでの時間は失われません。",
    goals: [
      "PoseとTwistの違いを説明する",
      "リーダーとの距離を見て進行方向を決める",
      "操作による速度指令と追従の進捗を対応させる",
    ],
    steps: [
      "リーダーの位置と追従範囲を確認する",
      "前進・後退・旋回で範囲内に入る",
      "距離と進捗を見ながら追いかけ、合計8秒を達成する",
    ],
    exercise: "範囲の内側寄りと外側寄りを追走し、リーダーが曲がるときに必要な操作を比べましょう。",
    insight:
      "このゲームの操縦は手動です。自律追従では、リーダーと自分のPoseから距離・向きの誤差を求め、それを速度指令へ変換する制御を追加できます。",
  },
  lidar_explorer: {
    overview:
      "LiDARの距離データを読み、見えない障害物を避けながら探索します。LaserScanは多数の距離値を角度順に並べたメッセージで、前方・左右の最短距離を比較するだけでも反応型の自律走行を作れます。",
    goals: [
      "LaserScanの角度と距離配列を読み取る",
      "現在のスキャンで見える壁と見えない領域を区別する",
      "距離の観測を手動の進路選択に使う",
    ],
    steps: [
      "/scanから周囲の距離を受信する",
      "壁との距離を見て進む方向を選ぶ",
      "自分で前進・旋回し、3つのデータを集めてGOALへ向かう",
    ],
    exercise: "同じ経路で壁から大きく距離を取って走り、探索時間と衝突回数を比べましょう。",
    insight:
      "高度な地図がなくても現在のセンサー値に応じて動くことで衝突リスクを減らせますが、安全を保証するものではありません。",
  },
  patrol: {
    overview:
      "監視ロボットを避けながら3つの端末を作動させ、出口へ向かうミッションです。端末を1つ作動させるごとに敵が減速し、3つ目で停止します。Topicによる観測、Serviceの要求・応答、Lifecycleの状態管理を対応させます。",
    goals: [
      "TopicとServiceの使い分けを理解する",
      "Lifecycleノードの状態遷移を説明する",
      "複数ノードからなるシステムを俯瞰する",
    ],
    steps: [
      "監視状態と位置情報をTopicで観測する",
      "端末に近づき、Serviceの要求・応答ログと敵の減速を確認する",
      "3つ目の端末で敵が停止したら出口へ向かう",
    ],
    exercise:
      "3つの端末を巡る順番を変え、移動時間や監視にさらされる時間を比べましょう。各端末の効果は共通で、巡回経路の選び方が変わります。",
    insight:
      "実際のロボットは一枚岩ではありません。センサー、判断、アクチュエーターを個別ノードとして管理すると故障時の切り分けが容易になります。",
  },
  racing: {
    overview:
      "自分で操縦とブーストを使い、各周でCP1→CP2→CP3を順に通過して3周します。1Pは完走でクリアし、1位で★3、2位で★2、3位で★1です。自動制御の対戦相手は経由点を追従します。手動の走行とAIの経路追従を見比べましょう。",
    goals: [
      "PathとOdometryの関係を理解する",
      "速度と旋回安定性のトレードオフを知る",
      "手動操作とAIの経路追従を区別する",
    ],
    steps: [
      "前進と旋回でコースを走る",
      "各周で3つのチェックポイントを順番に通過する",
      "直線でブーストを使い、3周のタイムと順位を比較する",
    ],
    exercise:
      "ブーストを使わない走行と、直線でブーストを使う走行のタイムを比べましょう。コース外での減速やチェックポイントの通過も確認します。",
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
    exercise: "相手の難易度を変え、追跡・守備・シュートの動きを観察しましょう。",
    insight: "協調では個々の最適行動より、チーム全体の情報共有と役割設計が重要になります。",
  },
  treasure_map: {
    overview:
      "未知の迷路を走りながら地図を作り、宝物を回収します。このゲームはロボットの姿勢が既知であると仮定し、LiDARで観測したセルを未知・壁・通路の地図へ反映します。",
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
    exercise:
      "地図に載った通路を再訪する場合と、新しい通路を探索する場合で既知セルの割合を比べましょう。この簡略地図では、既知セルを再観測しても信頼度を更新しません。",
    insight:
      "このゲームはセルを未知・壁・通路として保存します。確率的な地図の更新や、地図と自己位置を同時に推定する処理は、実際のSLAMへ発展させるときの要素です。",
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
    exercise:
      "障害物の周りで進行方向を変え、追跡者を迂回させて距離を確保しましょう。現在位置だけを見る方法と、相手の動きも予測する方法で生存時間を比較しましょう。",
    insight: "動く対象への対応では、現在の観測だけでなく少し先の状態を予測することが有効です。",
  },
  sumo_battle: {
    overview:
      "相手を土俵の外へ押し出しつつ、自分は境界を越えないように制御します。接触、境界検出、攻撃方向を同時に扱う反応型ロボットの課題です。",
    goals: [
      "土俵の中心からの距離と場外の危険を対応させる",
      "手動操作で攻撃と境界回避を両立する",
      "AIの接近・予備動作・突進・回復を区別する",
    ],
    steps: [
      "相手と土俵境界を検出する",
      "相手の予備動作と突進を観察する",
      "前進・旋回・ブーストで相手を押し出す",
    ],
    exercise:
      "同じ難易度で、中央を保つ操作と境界近くまで攻める操作を比べましょう。数回ずつ対戦し、勝敗を記録します。",
    insight: "単純な行動でも、状態と優先順位を明示すると予測可能で調整しやすいロボットになります。",
  },
  battery_rush: {
    overview:
      "荷物の配達と、1か所のドックでの充電を両立するミッションです。/robot/battery_stateとHUDで残量を確認し、いつ配達を続け、いつドックへ戻るかを自分で判断・操縦します。25%未満で警告が出ますが、自動帰還はしません。",
    goals: [
      "BatteryStateを行動判断へ利用する",
      "距離と消費量から余裕を見積もる",
      "安全制約を含む計画を考える",
    ],
    steps: [
      "現在のバッテリー残量を観測する",
      "配達先と充電ドックまでの距離を見積もる",
      "残量が尽きる前にドックへ戻る",
    ],
    exercise: "早めにドックへ戻る走行と、配達を続けてから戻る走行で、配達数と残量を比べましょう。",
    insight: "実機では電力、温度、通信品質などの制約も行動計画の一部です。",
  },
  robo_kitchen: {
    overview:
      "注文の次に必要な食材がベルトに流れてきます。手先の目標位置を操作し、食材をつかんで皿へ運びます。逆運動学で手先の目標から関節角を求めるアーム操作を体験します。",
    goals: [
      "手先目標・逆運動学・把持の流れを理解する",
      "JointStateと手先Poseを対応させる",
      "作業手順を失敗から回復できる形で設計する",
    ],
    steps: [
      "注文とベルト上の食材位置を確認する",
      "手先の目標Poseと関節角を計算する",
      "把持・移動・配置を順番に実行する",
    ],
    exercise:
      "ベルトの手前側と奥側で食材をつかみ、動く食材に合わせて手先目標を調整してみましょう。運んだ食材は皿の上で放します。",
    insight:
      "このゲームでは食材の位置が与えられ、操作した手先目標から関節角を求めます。実機では、この目標を得るための認識や座標変換も必要になります。",
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
    exercise:
      "Scout・Carrier・Relayを切り替え、操作していない2台が自動で働く様子を見ましょう。発展として、1台がすべての役割を担うとどう変わるか、思考実験で長所と弱点を整理します。",
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
      "接続後の自動走行と/cmd_velのログを確認する",
    ],
    exercise:
      "Publisherの出力をSubscriberの入力へ接続し、/cmd_velのログを見ましょう。接続する前にロボットが動かなかった理由を説明してみましょう。",
    insight: "Pub/Subの疎結合性により、記録・可視化・制御ノードを後から追加できます。",
  },
  service_builder: {
    overview:
      "Requestを送りResponseを受け取るService通信を組み立てます。接続しただけでは実行されず、CALLを押すたびに一組のRequest/Responseが発生してロボットが1段階進みます。CALLを繰り返してGOALに到達するとクリアです。",
    goals: [
      "Service ClientとServerの役割を区別する",
      "Request/Response型を理解する",
      "TopicとServiceの選択基準を説明する",
    ],
    steps: [
      "Service名とsrv型が一致するClientとServerのポートを接続する",
      "CALLでRequestを送り、Responseと1段階の前進を確認する",
      "GOALまでCALLを繰り返す（このLessonでは8回で到達）",
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
      "速度と時間を決めた直進・旋回のブロックを並べ、壁を避けてGOAL領域を目指します。各ブロックは指定時間で終了し、測定した位置に応じて指令を修正することはありません。",
    goals: [
      "速度と時間から直進距離・旋回角度を計算する",
      "壁を避ける動作の順序を組み立てる",
      "時間で動作を終える開ループ制御を理解する",
    ],
    steps: [
      "壁を避ける直進区間と旋回を考える",
      "cmd_velブロックのlinear・angular・durationを設定してRUNする",
      "衝突せずGOAL領域へ入るように順序と数値を調整する",
    ],
    exercise:
      "一つの直進区間の速度を変え、同じ距離を進むようにdurationを計算し直しましょう。経路と壁を避けられるかどうかを比較します。",
    insight:
      "このLessonは外乱のない理想的な動きを使います。実機ではモデルの誤差や外乱でずれることがあり、時間だけで動く開ループ制御は測定結果からそのずれを修正しません。",
  },
  feedback_controller: {
    overview:
      "Feedforward Controllerと同じ正三角形を、今度はOdometry（/robot/odometry/odometry）から推定した移動距離と回転角を使って描きます。時間ではなく、各目標へ到達したと推定されたかどうかで停止する閉ループ制御です。",
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
      "/robot/lidar/scanのLaserScanを購読し、前方の障害物を検知して進行方向を変えます。センサー入力から判断、速度出力までを短い周期で繰り返すリアクティブ制御です。",
    goals: [
      "LaserScanから必要な角度範囲を抽出する",
      "閾値を使った障害物回避判定を設計する",
      "Callbackと制御周期の関係を理解する",
    ],
    steps: [
      "前方の最小距離がthresholdより大きければ前進する",
      "それ以外は、右がthreshold未満なら左旋回、次に左がthreshold未満なら右旋回する（左右とも近ければ左旋回を優先）",
      "どれにも当てはまらなければ停止する。前方が閾値と同じ場合も左右の条件へ進む",
    ],
    exercise: "狭い通路を通れる距離閾値と、衝突リスクを抑える距離閾値の違いを探しましょう。",
    insight:
      "距離閾値は衝突リスクと行動可能範囲を同時に変えます。実機では速度に応じて閾値を変える設計も有効ですが、それだけで安全を保証するものではありません。",
  },
  param_tuner: {
    overview:
      "drive_paramsブロックの値を編集し、走行中の速度・旋回ゲイン・加速度を調整します。実機のros2 param setによる実行時変更を模した操作で、変更内容は/parameter_eventsに記録されます。概念端末は観察用で、値の変更はブロックから行います。",
    goals: [
      "ParameterとTopicの違いを説明する",
      "実行時変更が制御へ反映される流れを知る",
      "複数の値を比較して調整する",
    ],
    steps: [
      "drive_paramsブロックの初期値でRUNする",
      "走行中にブロックの値を一つ変更する",
      "動きと/parameter_eventsの変化を確認する",
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
      "地図上で指定したGoal Poseまで、自動で経路を計画して走行します。A*による経路計画と、先読み点への向きの誤差を使う簡易経路追従で、Nav2のGlobal Planner・Local Controller・速度指令の役割を体験します。",
    goals: [
      "Goal PoseとPathの違いを理解する",
      "Global PlanとLocal Controlを区別する",
      "Actionが長時間処理に適する理由を知る",
    ],
    steps: [
      "マウスでドラッグ、矢印で位置を決めてEnter／Spaceを押しながら矢印、または左スティック／十字で位置を決めてAを押しながら向きを指定し、離して/goal_poseへ送る（カーソルでの向き指定中はEsc／Bで取消）",
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
      "遠隔操作で走行しながら、疑似カメラ画像にgaussian_blurとcannyを適用します。ブロックの数値を調整して5色のターゲットの輪郭を捕捉し、すべて集めてGOALへ向かいます。このLessonで編集するのは処理ブロックと数値で、Topicの配線ではありません。",
    goals: [
      "エッジが画素の変化量であることを理解する",
      "ぼかし・Cannyの閾値・カメラの視点と検出結果を対応させる",
      "5色のターゲットを捕捉してGOALへ到達する",
    ],
    steps: [
      "WASD / 矢印キーで走行し、カメラにターゲットを収める",
      "ブロックの数値欄でblurのsigmaとcannyのlow / highを調整する（ゲームパッドはYでDRIVE / TUNE切り替え）",
      "捕捉の表示を確認し、5色すべてを集めてGOALへ進む",
    ],
    exercise:
      "視点を固定してsigma、次にlow / highを変え、対象の輪郭を残しながら内部のノイズを減らしましょう。その後、距離や角度を変えて捕捉のしやすさを比べてください。",
    insight:
      "このLessonでは処理ブロックを編集します。実機ではカメラや前処理を別ノードに分け、画像をTopicで受け渡す構成にもできます。後段が必要とする特徴を残す前処理が大切です。",
  },
  object_detection: {
    overview:
      "検出器の出力を模したシミュレーションで、Bounding Box・クラス・信頼度の読み方を学びます。実際の画像推論は行わず、既知の物体位置から検出結果と誤検出を生成し、処理時間も模擬します。modelとthresholdを調整して全ターゲットを捕捉し、GOALへ到達しましょう。",
    goals: [
      "模擬検出結果のクラス・Bounding Box・信頼度を読む",
      "信頼度による選別と、見逃し・誤検出の関係を比べる",
      "全ターゲットを捕捉し、/obj_detection/objectsを観察する",
    ],
    steps: [
      "detectのmodelとconfidence_filterのthresholdを設定し、RUNを押す",
      "走行して各ターゲットを画面に収め、生成された検出結果を見る",
      "全ターゲットを捕捉してGOALへ進む（誤検出の除去自体はクリア条件ではない）",
    ],
    exercise:
      "視点を固定して信頼度閾値を変え、残る検出と見逃しを比べましょう。クラス・矩形・信頼度・誤検出・処理時間は、画像画素からの推論ではなく、物体位置やmodel設定から模擬生成しています。",
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
    exercise:
      "同じ目標で肘の向きを切り替えましょう。カーソルを作業領域の外や腕が伸び切る付近へ動かし、手先の位置・関節制限・manipの値を比べてください。Joint Teleopの記録があれば結果画面で所要時間も比較できます。",
    insight:
      "このLessonは作業領域と関節制限を扱い、障害物との衝突課題はありません。manipは|sin(q2)|で、腕が伸び切ると0へ近づきます。実機でIKの解を選ぶ際には、周囲との衝突も確認する必要があります。",
  },
  pick_place: {
    overview:
      "2Dのアームでコンベア上の荷物をつかみ、同じ文字と色のドックへ運んで放します。手先の位置と把持・解放のタイミングを合わせ、6個の荷物を仕分けましょう。取り逃しや誤った場所での解放には、1回につき2秒のペナルティーが付きます。",
    goals: [
      "接近・把持・搬送・解放の順序を理解する",
      "荷物の文字と色をA・B・Cのドックに対応させる",
      "取り逃しや誤配を減らすタイミングを探す",
    ],
    steps: [
      "マウス / 矢印キーで手先を荷物に合わせる",
      "クリック・Enter・ゲームパッドAでつかみ、同じ文字と色のドックへ運ぶ",
      "ドック内でもう一度押して放し、6個の仕分けを完了する",
    ],
    exercise:
      "コンベアの早い位置でつかむ場合と、遅い位置でつかむ場合を比べましょう。解放時の手先の位置を確認し、取り逃しや誤配による+2秒が結果にどう影響するか観察してください。",
    insight:
      "このLessonは既知の荷物位置と手先との距離で把持・解放を判定します。実機では認識、TFによる座標変換、接近・持ち上げ・退避の姿勢、衝突を避ける経路計画も必要ですが、それらはこの課題の操作や成功判定には含まれない発展内容です。",
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
