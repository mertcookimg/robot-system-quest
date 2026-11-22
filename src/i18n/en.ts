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
  "terminal.hint": "↑/↓ history · help for commands",
  "terminal.command": "COMMAND",
  "terminal.select": "Select a command…",
  "terminal.inspect": "INSPECT",
  "terminal.run": "▶ RUN",
  "terminal.input": "Enter a ROS 2 command (try help)",
  "terminal.welcome": "ROS 2 concepts (simulated) · Robot System Quest Terminal",
  "terminal.guide":
    "This terminal is for inspection. Change settings through the stage controls. Automatic execution, timers and messages continue while manual input goes to the terminal. Press Esc / gamepad B, or press the game canvas or touchpad, to return to manual controls.",
  "terminal.noMessages":
    "No recorded messages on {topic} yet. Operate the stage, then run this command again.",
  "terminal.snapshot":
    "# Saved-log snapshot: latest {count} messages at command time. Run again to refresh.",
  "terminal.rateSnapshot":
    "# Calculated from saved-log intervals. Action-triggered events do not have a fixed publishing period.",
  "terminal.noParameters": "{node} does not expose simulated parameters in this stage.",
  "terminal.noLifecycle": "{node} does not expose a managed lifecycle state in this stage.",
  "terminal.doctor":
    "Simulated graph: {nodes} nodes, {topics} topics. No real ROS 2 installation or hardware diagnostics are run.",
  "terminal.unsupported":
    "{command}: not available in this inspection-only terminal. Change settings and issue commands through the stage controls.",
  "terminal.help.title": "Inspection commands (Esc / q / exit releases terminal input):",
  "terminal.help.clear": "clear screen",
  "terminal.help.exit": "leave terminal input",
  "terminal.help.history": "history navigation: ↑ / ↓",
  "terminal.help.inspectOnly":
    "Change values and issue execution commands through the stage controls.",
  "terminal.bye": "Terminal input released.",
  "terminal.tryHelp": "try: help",
  "terminal.usage": "Usage: {command}",
  "terminal.commandNotFound": "bash: {command}: command not found",
  "terminal.notImplemented": "Command not implemented: {command}",
  "terminal.unknownVerb": "Unknown command: {command}. Try help for available commands.",
  "terminal.missing": "(missing)",
  "terminal.topicNotFound": "Topic '{name}' not found.",
  "terminal.nodeNotFound": "Node '{name}' not found.",
  "terminal.serviceNotFound": "Service '{name}' not found.",
  "terminal.actionNotFound": "Action '{name}' not found in this stage.",
  "terminal.parameterNotFound": "Parameter '{name}' not found.",
  "terminal.noTopics": "(no topics in this stage)",
  "terminal.noNodes": "(no nodes)",
  "terminal.noServices": "(no services in this stage)",
  "terminal.noActions": "(no actions in this stage)",
  "terminal.notEnoughMessages":
    "(not enough messages on {topic} yet; operate the stage and run again)",
  "terminal.interfaceDeclared": "# Interface type declared by this simulation.",
  "terminal.interfaceOmitted":
    "# Its complete field definition is omitted by the lightweight simulator.",
  "terminal.interfaceNotFound": "Interface '{name}' not in this game's database.",
  "terminal.available": "Available:",
  "terminal.interfaceSummary": "# Simplified interface summary; nested fields may be omitted.",

  // ── pubsub / service / action ──
  "puzzle.status.connect":
    "Drag with mouse or use ↑↓←→ + Enter (A) to wire / Backspace (B) to cancel/delete",

  // ── block editor common ──
  "block.program.empty_short": "Empty program",
  "block.program.empty_help": "Add a block from BLOCKS, then press ▶ RUN.",
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
  "ff_controller.move_start_on":
    "✋ Move START ON — WASD / arrows / pad to drag. Press again to confirm",
  "ff_controller.move_start_off": "START position fixed. RUN replays from this spot",

  // ── feedforward_mission ──
  "ff_mission.tip": "Arrange blocks and press ▶ RUN",
  "ff_mission.hint": "Edit blocks → ▶ RUN / R to reset position",
  "ff_mission.palette_hint": "Publish geometry_msgs/msg/Twist for `duration` seconds",

  // ── feedback_controller ──
  "fb_controller.move_start_on":
    "✋ Move START ON — WASD / arrows / pad to drag. Press again to confirm",
  "fb_controller.move_start_off": "START position fixed. RUN replays from this spot",

  // ── feedback_mission ──
  "fb_mission.tip": "Solve the same problem as feedforward_mission with feedback control",
  "fb_mission.hint": "Use go_straight / turn_left / turn_right to dodge walls → GOAL",
  "fb_mission.palette_hint":
    "Use /robot/odometry/odometry to end each move at its target distance or angle",
};
