// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// EN dictionary — translation key → English string
export const EN: Record<string, string> = {
  // ── UI common ──
  "ui.audio.on": "ON",
  "ui.audio.off": "OFF",
  "ui.help.title": "How to Play",
  "ui.help.close": "Close",
  "ui.intro.start": "START",
  "ui.clear.retry": "Retry",
  "ui.clear.next": "Next →",
  "ui.allclear.again": "Play Again",
  "ui.toast.perfect": "PERFECT",
  "ui.toast.starsupd": "STARS UPDATED",
  "ui.toast.newrecord": "NEW RECORD",
  "terminal.title": "ROS 2 CONCEPT TERMINAL · simulated",
  "terminal.stage": "stage: {name}",
  "terminal.hint": "click to type · ↑/↓ history · help for commands",
  "terminal.command": "COMMAND",
  "terminal.select": "Select a command…",
  "terminal.inspect": "INSPECT",
  "terminal.run": "▶ RUN",
  "terminal.input": "Enter a ROS 2 command (try help)",
  "terminal.welcome": "ROS 2 concepts (simulated) · Robot System Quest Terminal",
  "terminal.guide": "Select a command below or type one. Use help to list commands.",
  "terminal.unsupported": "{command}: not available in this game. Choose an inspect command.",

  // ── pubsub / service / action ──
  "puzzle.status.connect":
    "Drag with mouse or use ↑↓←→ + Enter (A) to wire / Backspace (B) to cancel/delete",

  // ── block editor common ──
  "block.program.empty_short": "Empty program",
  "block.program.count": "{n} blocks",
  "block.btn.up": "Move up",
  "block.btn.down": "Move down",
  "block.btn.remove": "Remove",
  "block.empty": "Program is empty",
  "block.stop_aborted": "Execution stopped",
  "block.stop_run": "Stopped — press RUN to re-evaluate",
  "block.done": "Program finished — edit and RUN again",
  "block.error": "Execution error",
  "block.running": "Running ({n} blocks)",
  "block.running_program": "Program running ({n} blocks)",
  "block.running_feedback": "Feedback control running ({n} blocks)",
  "block.running_lidar": "LiDAR avoidance running ({n} blocks)",

  // ── feedforward_controller ──
  "ff_controller.tip": "Sandbox — arrange blocks and RUN",
  "ff_controller.hint": "No obstacles or goal — try different cmd_vel values",
  "ff_controller.palette_hint": "No goal or obstacles. Experiment freely with cmd_vel",
  "ff_controller.practice_on": "🔄 Practice mode — RUN as many times as you want, no clear screen",
  "ff_controller.practice_off": "🎯 Mission mode — clear by using forward / turn-left / turn-right",
  "ff_controller.practice_done": "Program done — edit blocks freely and RUN again",
  "ff_controller.need_all":
    "Use {n}/3 patterns — forward(linear>0) / turn-left(angular>0) / turn-right(angular<0) for clear",
  "ff_controller.move_start_on":
    "✋ Move START ON — WASD / arrows / pad to drag. Press again to confirm",
  "ff_controller.move_start_off": "START position fixed. RUN replays from this spot",

  // ── feedforward_mission ──
  "ff_mission.tip": "Arrange blocks and press ▶ RUN",
  "ff_mission.hint": "Edit blocks → ▶ RUN / R to reset position",
  "ff_mission.palette_hint": "Publish geometry_msgs/msg/Twist for `duration` seconds",

  // ── feedback_controller ──
  "fb_controller.tip": "Recreates robot_feedback_control. Watch odom feedback in action",
  "fb_controller.hint": "Combine go_straight / turn_left / turn_right to drive via odom feedback",
  "fb_controller.palette_hint": "Subscribe /odom and stop once target distance / angle is met",
  "fb_controller.practice_on": "🔄 Practice mode — RUN as many times as you want, no clear screen",
  "fb_controller.practice_off": "🎯 Mission mode — clear by using all 3 block kinds",
  "fb_controller.practice_done": "Program done — edit blocks freely and RUN again",
  "fb_controller.need_all":
    "Use {n}/3 kinds — go_straight / turn_left / turn_right needed for clear",
  "fb_controller.move_start_on":
    "✋ Move START ON — WASD / arrows / pad to drag. Press again to confirm",
  "fb_controller.move_start_off": "START position fixed. RUN replays from this spot",

  // ── feedback_mission ──
  "fb_mission.tip": "Solve the same problem as feedforward_mission with feedback control",
  "fb_mission.hint": "Use go_straight / turn_left / turn_right to dodge walls → GOAL",
  "fb_mission.palette_hint": "Use /odom feedback to dodge walls and reach GOAL",
};
