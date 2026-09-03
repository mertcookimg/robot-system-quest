// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getLang } from "../i18n";

export const guideText = (ja: string, en: string): string => (getLang() === "ja" ? ja : en);

const STATIC_EN: Record<string, string> = {
  ガイド概要: "Overview",
  学べること: "What You Will Learn",
  学び方: "Learning Path",
  実機で学ぶ: "Learn with a Real Robot",
  "Game / Lessonを開く": "Open Game / Lesson",
  "小林聖人 · 作品・講義・プロフィール": "Masato Kobayashi · Projects, Courses & Profile",
  "GAME / LESSONへ": "OPEN GAME / LESSON",
  "遊んで、理解して、": "Play. Understand.",
  "実機へつなげる。": "Build toward real robots.",
  "Robot System Questのゲームとレッスンを入口に、ROS 2の通信、制御、認識、 ナビゲーションを段階的に理解するためのガイドです。":
    "A structured guide to ROS 2 communication, control, perception, and navigation—starting with the games and lessons in Robot System Quest.",
  "ROS 2通信": "ROS 2 Communication",
  ロボット制御: "Robot Control",
  "センサー・認識": "Sensors & Perception",
  "自律移動・アーム": "Navigation & Manipulation",
  "ブラウザ上でROS 2のデータフローを再現する概念シミュレーションです。ROS 2やDDS自体は実行していません。":
    "This is a conceptual browser simulation of ROS 2 data flow; it does not run ROS 2 or DDS itself.",
  Gamesから見る: "Explore Games",
  Lessonsから見る: "Explore Lessons",
  ロボットシステムについて: "About a Robot System",
  "ロボットシステムは、機構・電源・通信・安全・学習など、多様な要素で成り立ちます。この教材では、その働きを理解するために、認識・判断／計画・制御という多様な視点から学びます。これらは固定された順序ではなく、互いに関わりながら実世界の変化に応答します。":
    "Robot systems consist of diverse elements, including mechanisms, power systems, communication, safety, and learning. To understand how they work, this course uses several perspectives: perception, decision-making and planning, and control. These are not fixed sequential stages; they interact as the robot responds to changes in the physical world.",
  周囲と自分を認識する: "Perceive the World and the Robot",
  "カメラやLiDARなどのセンサーから、環境とロボット自身の状態を推定します。":
    "Estimate the environment and the robot's own state from cameras, LiDAR, and other sensors.",
  "画像・距離・自己位置": "Images, distance, and localization",
  "目標に向けて計画・決断する": "Plan and Decide Toward the Goal",
  "現在の状況と目標を基に、行動、経路、作業の進め方を決めます。":
    "Use the current situation and goal to decide actions, paths, and task execution.",
  "目標・経路・タスク": "Goals, paths, and tasks",
  "狙った動きを実現する：適応的に制御する": "Produce the Intended Motion with Adaptive Control",
  "目標値と現在値を比較し、車輪や関節が安定して動くように指令を調整します。":
    "Compare target and measured states, then adjust commands so wheels and joints move reliably.",
  "速度・関節・フィードバック": "Velocity, joints, and feedback",
  "多様な機能とハードウェアが連携し、実世界の変化に応答し続ける":
    "Diverse functions and hardware work together to continuously respond to changes in the physical world",
  ロボットシステムには様々な種類があります: "There Is More Than One Way to Build a Robot System",
  "ロボットシステムは、機能ごとに分けたモジュールを組み合わせて構成されます。近年は、その一部または複数の役割にVLAなどの学習モデルを用いる構成も広がっています。":
    "Robot systems are composed by combining modules separated by function. Increasingly, learned models such as VLAs are being used for one or more of those roles.",
  代表的な構成例: "Robot Architecture",
  VLAを用いた構成例: "Example Architecture Using a VLA",
  センサー: "Sensors",
  認識: "Perception",
  "判断・計画": "Decision & Planning",
  制御: "Control",
  ロボット: "Robot",
  "画像・言語・ロボット状態": "Vision, Language & Robot State",
  VLAポリシー: "VLA Policy",
  ロボット行動: "Robot Actions",
  "二つは排他的な分類ではなく、VLAをモジュール型システムの一部として組み込む構成もあります。VLAを用いる場合も低レベル制御や安全機構は必要です。World Modelは構成によって併用されますが、VLAの必須要素ではありません。":
    "These are not mutually exclusive categories: a VLA can be integrated as part of a modular system. Systems using VLAs still require low-level control and safety mechanisms. A world model may be used in some architectures, but it is not a required component of a VLA.",
  通信をつなぐ: "Connect Communication",
  "ノード同士がデータや要求を交換する、ROS 2の基本構造を組み立てます。":
    "Build the core ROS 2 structure that lets nodes exchange data and requests.",
  できるようになること: "You will be able to",
  "Topic・Service・Actionの概要と使い分けを理解できる":
    "Understand the basics of Topics, Services, Actions, and when each is used",
  動きを制御する: "Control Motion",
  "目標値と現在値から指令を作り、ロボットを安定して動かします。":
    "Turn targets and measured states into commands that move a robot reliably and stably.",
  "Feedforward・Feedback・Parameterの概要と役割を理解できる":
    "Understand the basics and roles of feedforward, feedback, and parameters",
  周囲の世界を見る: "Perceive the World",
  "LiDARとカメラのデータを処理し、ロボットが利用できる情報に変換します。":
    "Process LiDAR and camera data into information the robot can use.",
  "LiDAR・画像処理・物体検出の概要を理解できる":
    "Understand the basics of LiDAR, image processing, and object detection",
  位置と地図を理解する: "Understand Position & Maps",
  "座標変換、地図作成、確率的な自己位置推定をひとつの流れで学びます。":
    "Follow one continuous path from coordinate transforms to mapping and probabilistic localization.",
  "TF・SLAM・AMCLの概要と役割を理解できる": "Understand the basics and roles of TF, SLAM, and AMCL",
  自分で考えて移動する: "Navigate Autonomously",
  "Goalを基に経路を作り、障害物を避けながら目的地まで走る仕組みを理解します。":
    "Understand how a robot plans from a goal and drives around obstacles to reach it.",
  "Nav2・Path・Behavior Treeの概要を理解できる":
    "Understand the basics of Nav2, paths, and behavior trees",
  アームで作業する: "Work with a Robot Arm",
  "関節角、手先位置、把持動作をつなぎ、物をつかんで運ぶ作業を完成させます。":
    "Connect joint motion, end-effector poses, and grasping to complete a manipulation task.",
  "JointState・IK・Pick & Placeの概要と流れを理解できる":
    "Understand the basics and workflow of JointState, IK, and Pick & Place",
  体験できるステージ: "Interactive stages",
  分野をつなぐ学習: "Connected learning across domains",
  つながったロボットシステム: "Connected robot system",
  "3つのステップで学ぶ": "Learn in Three Steps",
  体験から概念へ: "From experience to understanding",
  "基礎から制御・認識・ナビゲーションまで、ステップごとに理解を深めます。":
    "Build understanding step by step, from fundamentals to control, perception, and navigation.",
  動かして気づく: "Discover by Playing",
  "まずはロボットを動かし、センサーや通信がゲーム中でどう働くかを体感します。":
    "Move the robot first and experience how sensors and communication affect the game.",
  Gamesで体験: "Experience through Games",
  "Gamesを見る →": "Explore Games →",
  仕組みを組み立てる: "Build the System",
  "Topic、Service、TF、制御などを操作しながら、システムの仕組みを分解します。":
    "Manipulate Topics, Services, TF, and controllers to break the system into understandable parts.",
  Lessonsで理解: "Understand through Lessons",
  "Lessonsを見る →": "Explore Lessons →",
  実機で実践: "Apply It on a Real Robot",
  "講義資料と実機を使い、同じROS 2の概念を実際のロボットシステムで確かめます。":
    "Use the lecture material and physical hardware to verify the same ROS 2 concepts on a real robot.",
  "実機学習を見る →": "Open Real-Robot Course →",
  ロボットを操作する: "Operate the robot",
  "移動・追跡・探索・対戦": "Drive, follow, explore, and compete",
  画面の変化を観察する: "Observe what changes",
  "センサー・Topic・状態": "Sensors, Topics, and state",
  "値を操作・調整する": "Change and tune values",
  "Parameter・Goal・制御": "Parameters, goals, and control",
  動く理由を説明できる: "Explain why the robot behaves that way",
  概念からシステムへ: "From concepts to complete systems",
  次は実機で学ぶ: "Continue with a real robot",
  "ブラウザから実機へ。ロボットシステムを、動かしながら学ぶ。":
    "From browser simulation to physical hardware—learn robot systems by making them move.",
  "シミュレーションで学んだROS 2の概念を、カチャカの実機と開発環境で試してみましょう。 開発環境、ROS 2基礎、制御、センサー、ナビゲーション、画像処理までを扱います。":
    "Apply what you learned in simulation to Kachaka and a real development environment. The course covers setup, ROS 2 fundamentals, control, sensors, navigation, and image processing.",
  "実機の開発環境とROS 2基礎": "Real-robot environment and ROS 2 fundamentals",
  "フィードフォワード・フィードバック制御": "Feedforward and feedback control",
  "センサー・Nav2・画像認識": "Sensors, Nav2, and computer vision",
  "ROS 2 AI Lectureを開く": "Open the ROS 2 AI Lecture",
  GitHubでOSSを見る: "View the OSS on GitHub",
  実機で動く様子を見る: "Watch the real robot in action",
  "実機演習の手順と、各Lessonの解説を順番に確認できます。":
    "Follow the real-robot exercises and lesson explanations step by step.",
  "講義で使用するROS 2パッケージと実装コードを公開しています。":
    "Explore the ROS 2 packages and implementation used in the course.",
  "知能ロボットシステムやROS 2に関する研究・講義をまとめています。":
    "Explore research and courses on intelligent robot systems and ROS 2.",
  "シミュレーションで得た直感を、ROS 2の概念と実機での実践につなげます。":
    "Connect intuition from simulation to ROS 2 concepts and physical robots.",
  "アクセス解析にGoogle Analyticsを利用しています。":
    "This site uses Google Analytics for usage insights.",
  "ページ上部へ ↑": "Back to top ↑",
};

const ATTRIBUTE_EN: Record<string, string> = {
  ガイド内ナビゲーション: "Guide navigation",
  メニューを開く: "Open menu",
  学べる分野: "Learning domains",
  ロボットシステムを理解するための多様な視点:
    "Several perspectives for understanding a robot system",
  "センサー、認識、判断と計画、制御、ロボットという代表的な構成":
    "Representative architecture: sensors, perception, decision and planning, control, and robot",
  "画像、言語、ロボット状態をVLAポリシーが処理し、ロボット行動を生成する代表的な構成":
    "Representative architecture in which a VLA policy processes vision, language, and robot state to generate robot actions",
  "実践！知能ロボットシステム入門 — カチャカとROS 2でAIロボット":
    "Practical Intelligent Robot Systems — AI Robotics with Kachaka and ROS 2",
  kachaka_ros2_lectureをGitHubで開く: "Open kachaka_ros2_lecture on GitHub",
  "Robot System QuestのOSSリポジトリをGitHubで開く":
    "Open the Robot System Quest open-source repository on GitHub",
  "ROS 2 AI Lectureの解説サイトを開く": "Open the ROS 2 AI Lecture guide",
  小林聖人のサイトを開く: "Open Masato Kobayashi's website",
};

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Translate the static guide shell. Dynamic stage content uses guideText(). */
export function localizeStaticGuide(root: ParentNode = document): void {
  document.documentElement.lang = getLang();
  if (getLang() !== "en") return;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = normalize(node.nodeValue ?? "");
    const translated = STATIC_EN[text];
    if (translated) node.nodeValue = translated;
  }

  root.querySelectorAll<HTMLElement>("[aria-label], [placeholder], [title]").forEach((element) => {
    for (const attr of ["aria-label", "placeholder", "title"] as const) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const translated = ATTRIBUTE_EN[normalize(value)];
      if (translated) element.setAttribute(attr, translated);
    }
  });
}
