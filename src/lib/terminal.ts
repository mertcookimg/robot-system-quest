// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Pseudo ROS 2 terminal — executes commands against the per-stage topic /
// node / service state.
import type { Ros2Concept, Ros2State } from "../types";
import { t } from "../i18n";

export interface RecentMsg {
  ts: number;
  topic: string;
  msg: string;
}

export interface RuntimeState extends Ros2State {
  /** Most-recent messages observed on the topic monitor. */
  recentMessages: (topic?: string, n?: number) => RecentMsg[];
}

export interface ExecResult {
  /** Lines to print to the terminal. */
  lines: string[];
  /** Special instructions: clear screen, or close the terminal panel. */
  effect?: "clear" | "close";
}

// ROS 2 standard message definitions (formatted to match real
// `ros2 interface show` output).
const INTERFACES: Record<string, string[]> = {
  "geometry_msgs/msg/Twist": [
    "# A velocity in free space.",
    "Vector3  linear",
    "        float64 x",
    "        float64 y",
    "        float64 z",
    "Vector3  angular",
    "        float64 x",
    "        float64 y",
    "        float64 z",
  ],
  "geometry_msgs/msg/PoseStamped": [
    "std_msgs/Header header",
    "        builtin_interfaces/Time stamp",
    "        string frame_id",
    "geometry_msgs/Pose pose",
    "        Point position",
    "                float64 x",
    "                float64 y",
    "                float64 z",
    "        Quaternion orientation",
    "                float64 x",
    "                float64 y",
    "                float64 z",
    "                float64 w",
  ],
  "sensor_msgs/msg/LaserScan": [
    "std_msgs/Header header",
    "float32 angle_min        # 開始角 [rad]",
    "float32 angle_max        # 終了角 [rad]",
    "float32 angle_increment  # ビーム間角度 [rad]",
    "float32 time_increment",
    "float32 scan_time",
    "float32 range_min",
    "float32 range_max",
    "float32[] ranges         # 距離配列 [m]",
    "float32[] intensities",
  ],
  "nav_msgs/msg/Odometry": [
    "std_msgs/Header header",
    "string child_frame_id",
    "geometry_msgs/PoseWithCovariance pose",
    "geometry_msgs/TwistWithCovariance twist",
  ],
  "tf2_msgs/msg/TFMessage": [
    "geometry_msgs/TransformStamped[] transforms",
    "        std_msgs/Header header",
    "        string child_frame_id",
    "        Transform transform",
  ],
  "std_srvs/srv/Trigger": [
    "# Request (empty)",
    "---",
    "# Response",
    "bool   success",
    "string message",
  ],
  "lifecycle_msgs/srv/ChangeState": [
    "# Request",
    "Transition transition",
    "        uint8  id",
    "        string label",
    "---",
    "# Response",
    "bool success",
  ],
  "sensor_msgs/msg/BatteryState": [
    "std_msgs/Header header",
    "float32 voltage",
    "float32 current",
    "float32 percentage",
    "uint8 power_supply_status",
  ],
  "sensor_msgs/msg/JointState": [
    "std_msgs/Header header",
    "string[] name",
    "float64[] position",
    "float64[] velocity",
    "float64[] effort",
  ],
  "sensor_msgs/msg/Image": [
    "std_msgs/Header header",
    "uint32 height",
    "uint32 width",
    "string encoding",
    "uint8[] data",
  ],
  "nav_msgs/msg/OccupancyGrid": [
    "std_msgs/Header header",
    "nav_msgs/MapMetaData info",
    "int8[] data",
  ],
  "std_msgs/msg/String": ["string data"],
  "geometry_msgs/msg/Pose": ["Point position", "Quaternion orientation"],
  "rcl_interfaces/msg/ParameterEvent": [
    "builtin_interfaces/Time stamp",
    "string node",
    "Parameter[] new_parameters",
    "Parameter[] changed_parameters",
    "Parameter[] deleted_parameters",
  ],
};

const HELP = [
  "Available commands  (T or Esc to close):",
  "",
  "  ros2 topic list [-t]",
  "  ros2 topic info  <topic>",
  "  ros2 topic type  <topic>",
  "  ros2 topic echo  <topic>",
  "  ros2 topic hz    <topic>",
  "  ros2 node list",
  "  ros2 node info   <node>",
  "  ros2 service list",
  "  ros2 service type <service>",
  "  ros2 action list [-t]",
  "  ros2 action info <action>",
  "  ros2 param list|get|dump <node> ...",
  "  ros2 lifecycle get <node>",
  "  ros2 interface show <type>",
  "  ros2 doctor",
  "  clear      # clear screen",
  "  q | exit   # close terminal",
  "",
  "history navigation: ↑ / ↓",
];

export function execCommand(raw: string, state: RuntimeState, concept?: Ros2Concept): ExecResult {
  const line = raw.trim();
  if (!line) return { lines: [] };
  const tokens = line.split(/\s+/);

  switch (tokens[0]) {
    case "clear":
    case "cls":
      return { lines: [], effect: "clear" };
    case "exit":
    case "q":
    case ":q":
      return { lines: ["bye."], effect: "close" };
    case "help":
    case "?":
      return { lines: HELP };
    case "ros2":
      break;
    default:
      return { lines: [`bash: ${tokens[0]}: command not found`, `try: help`] };
  }

  if (tokens.length < 2) return { lines: [`Usage: ros2 <verb> ...   (try: help)`] };

  const verb = tokens[1];
  const noun = tokens[2];
  const rest = tokens.slice(3);

  switch (verb) {
    case "topic":
      return { lines: execTopic(noun, rest, state) };
    case "node":
      return { lines: execNode(noun, rest, state) };
    case "service":
      return { lines: execService(noun, rest, state) };
    case "action":
      return { lines: execAction(noun, rest, concept) };
    case "param":
      return { lines: execParam(noun, rest, concept) };
    case "lifecycle":
      return { lines: execLifecycle(noun, rest, state) };
    case "interface":
      return { lines: execInterface(noun, rest, concept) };
    case "run":
    case "launch":
      return { lines: [unsupportedMutation(`ros2 ${verb}`)] };
    case "doctor":
      return { lines: ["All 1 checks passed"] };
    default:
      return { lines: [`Command not implemented: ros2 ${verb}`, `try: help`] };
  }
}

function execTopic(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [`Usage: ros2 topic <list|info|type|echo|hz|pub> ...`];
  switch (verb) {
    case "list":
      return s.topics.length
        ? s.topics.map((t) => (rest.includes("-t") ? `${t.name} [${t.type}]` : t.name))
        : ["(no topics in this stage)"];
    case "info": {
      const t = s.topics.find((x) => x.name === rest[0]);
      if (!t) return [`Topic '${rest[0] ?? "(missing)"}' not found.`];
      const out: string[] = [`Type: ${t.type}`, ``, `Publisher count: ${t.pub?.length ?? 0}`];
      (t.pub ?? []).forEach((n) => out.push(`  ${n} : ${t.type}`));
      out.push(``, `Subscription count: ${t.sub?.length ?? 0}`);
      (t.sub ?? []).forEach((n) => out.push(`  ${n} : ${t.type}`));
      return out;
    }
    case "type": {
      const t = s.topics.find((x) => x.name === rest[0]);
      return t ? [t.type] : [`Topic '${rest[0] ?? "(missing)"}' not found.`];
    }
    case "echo": {
      if (!rest[0]) return [`Usage: ros2 topic echo <topic>`];
      const valid = s.topics.find((x) => x.name === rest[0]);
      if (!valid) return [`Topic '${rest[0]}' not found.`];
      const recent = s.recentMessages(rest[0], 5);
      if (recent.length === 0)
        return [
          `(waiting for messages on ${rest[0]} ...)`,
          `// このトピックは存在しますが、まだメッセージが流れていません。`,
          `// ステージで操作するとここに流れます。`,
        ];
      const lines: string[] = [];
      recent.forEach((m, i) => {
        lines.push(m.msg);
        if (i < recent.length - 1) lines.push("---");
      });
      return lines;
    }
    case "hz": {
      if (!rest[0]) return [`Usage: ros2 topic hz <topic>`];
      if (!s.topics.some((x) => x.name === rest[0])) return [`Topic '${rest[0]}' not found.`];
      const recent = s.recentMessages(rest[0], 30);
      if (recent.length < 2) return [`(not enough messages on ${rest[0]} yet)`];
      const dt = recent[recent.length - 1].ts - recent[0].ts;
      const hz = (recent.length - 1) / Math.max(dt, 0.001);
      return [`average rate: ${hz.toFixed(2)} Hz`, `\twindow: ${recent.length} samples`];
    }
    case "pub": {
      return [unsupportedMutation("ros2 topic pub")];
    }
    default:
      return [`Unknown topic verb: ${verb}`];
  }
}

function execNode(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [`Usage: ros2 node <list|info> ...`];
  switch (verb) {
    case "list":
      return s.nodes.length ? s.nodes : ["(no nodes)"];
    case "info": {
      const name = rest[0];
      if (!name) return [`Usage: ros2 node info <node>`];
      if (!s.nodes.includes(name)) return [`Node '${name}' not found.`];
      const subs = s.topics.filter((t) => t.sub?.includes(name));
      const pubs = s.topics.filter((t) => t.pub?.includes(name));
      const services = (s.services ?? []).filter((sv) => sv.node === name);
      const out: string[] = [name, ""];
      out.push("  Subscribers:");
      if (subs.length === 0) out.push("    (none)");
      else subs.forEach((t) => out.push(`    ${t.name}: ${t.type}`));
      out.push("", "  Publishers:");
      if (pubs.length === 0) out.push("    (none)");
      else pubs.forEach((t) => out.push(`    ${t.name}: ${t.type}`));
      out.push("", "  Service Servers:");
      if (services.length === 0) out.push("    (none)");
      else services.forEach((sv) => out.push(`    ${sv.name}: ${sv.type}`));
      return out;
    }
    default:
      return [`Unknown node verb: ${verb}`];
  }
}

function execService(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [`Usage: ros2 service <list|type|call> ...`];
  switch (verb) {
    case "list":
      return (s.services ?? []).length
        ? (s.services ?? []).map((sv) => sv.name)
        : ["(no services in this stage)"];
    case "type": {
      const sv = (s.services ?? []).find((x) => x.name === rest[0]);
      return sv ? [sv.type] : [`Service '${rest[0] ?? "(missing)"}' not found.`];
    }
    case "call": {
      return [unsupportedMutation("ros2 service call")];
    }
    default:
      return [`Unknown service verb: ${verb}`];
  }
}

interface ActionSpec {
  name: string;
  type: string;
}

function actionSpecs(concept?: Ros2Concept): ActionSpec[] {
  const found = new Map<string, string>();
  for (const line of concept?.cli ?? []) {
    const m = line
      .replace(/\\\s*\n\s*/g, " ")
      .match(/ros2 action (?:info|send_goal)\s+(\/\S+)(?:\s+([^\s'\"]+\/action\/[^\s'\"]+))?/);
    if (m)
      found.set(
        m[1],
        m[2] ?? concept?.msgTypes.find((x) => x.includes("/action/")) ?? "(unknown action type)",
      );
  }
  if (found.size === 0) {
    const type = concept?.msgTypes.find((x) => x.includes("/action/"));
    if (type?.endsWith("/GripperCommand")) found.set("/gripper_controller/gripper_cmd", type);
    else if (type?.endsWith("/NavigateToPose")) found.set("/navigate_to_pose", type);
    else if (type?.endsWith("/FollowPath")) found.set("/follow_path", type);
  }
  return [...found].map(([name, type]) => ({ name, type }));
}

function execAction(verb: string, rest: string[], concept?: Ros2Concept): string[] {
  const actions = actionSpecs(concept);
  if (!verb) return ["Usage: ros2 action <list|info|send_goal> ..."];
  if (verb === "list")
    return actions.length
      ? actions.map((a) => (rest.includes("-t") ? `${a.name} [${a.type}]` : a.name))
      : ["(no actions in this stage)"];
  const name = rest[0];
  const action = actions.find((a) => a.name === name);
  if (!name) return [`Usage: ros2 action ${verb} <action> ...`];
  if (!action) return [`Action '${name}' not found in this stage.`];
  if (verb === "info")
    return [`Action: ${name}`, `Action clients: 1`, `Action servers: 1`, `Type: ${action.type}`];
  if (verb === "send_goal") {
    return [unsupportedMutation("ros2 action send_goal")];
  }
  return [`Unknown action verb: ${verb}`];
}

const paramValues = new Map<string, Map<string, string>>();

/** Clear mutable state owned by the simulated shell between stages. */
export function resetTerminalState(): void {
  paramValues.clear();
}

function paramsFor(node: string): Map<string, string> {
  let params = paramValues.get(node);
  if (!params) {
    params = new Map([
      ["max_speed", "0.4"],
      ["turn_gain", "1.0"],
      ["accel", "0.8"],
      ["use_sim_time", "false"],
    ]);
    paramValues.set(node, params);
  }
  return params;
}

function execParam(verb: string, rest: string[], concept?: Ros2Concept): string[] {
  if (!verb) return ["Usage: ros2 param <list|get|set|dump> <node> ..."];
  const node = rest[0];
  if (!node) return [`Usage: ros2 param ${verb} <node> ...`];
  if (!(concept?.state?.nodes ?? []).includes(node))
    return [`Node '${node}' not found in this stage.`];
  const params = paramsFor(node);
  if (verb === "list") return [...params.keys()].map((k) => `  ${k}`);
  const key = rest[1];
  if (verb === "get")
    return key && params.has(key)
      ? [`${key}: ${params.get(key)}`]
      : [`Parameter '${key ?? "(missing)"}' not found.`];
  if (verb === "set") {
    return [unsupportedMutation("ros2 param set")];
  }
  if (verb === "dump")
    return [
      `${node.replace(/^\//, "")}:`,
      "  ros__parameters:",
      ...[...params].map(([k, v]) => `    ${k}: ${v}`),
    ];
  return [`Unknown param verb: ${verb}`];
}

function execLifecycle(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb || !rest[0]) return ["Usage: ros2 lifecycle <get|set> <node> [transition]"];
  const node = rest[0];
  if (!s.nodes.includes(node)) return [`Node '${node}' not found.`];
  if (verb === "get") return ["active [3]"];
  if (verb === "set") {
    return [unsupportedMutation("ros2 lifecycle set")];
  }
  return [`Unknown lifecycle verb: ${verb}`];
}

function unsupportedMutation(command: string): string {
  return t("terminal.unsupported", { command });
}

function execInterface(verb: string, rest: string[], concept?: Ros2Concept): string[] {
  if (verb !== "show") return [`Usage: ros2 interface show <type>`];
  const t = rest[0];
  if (!t) return [`Usage: ros2 interface show <type>`];
  const lines = INTERFACES[t];
  if (!lines && concept?.msgTypes.includes(t))
    return [
      `# ${t}`,
      "# This interface is active in the current stage.",
      "# Its complete field definition is omitted by the lightweight simulator.",
    ];
  if (!lines)
    return [
      `Interface '${t}' not in this game's database.`,
      `Available:`,
      ...Object.keys(INTERFACES).map((k) => `  ${k}`),
    ];
  return lines;
}
