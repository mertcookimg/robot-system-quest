// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Pseudo ROS 2 terminal — executes commands against the per-stage topic /
// node / service state.
import type { Ros2Concept, Ros2State } from "../types";
import { t, tx } from "../i18n";

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

// Compact interface summaries. Nested definitions are intentionally abbreviated
// and labeled as such rather than presented as a complete ROS installation.
function interfaceDefinitions(): Record<string, string[]> {
  return {
    "geometry_msgs/msg/Twist": [
      tx("# 空間内の並進速度と角速度。", "# A velocity in free space."),
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
      tx("float32 angle_min        # 開始角 [rad]", "float32 angle_min        # start angle [rad]"),
      tx("float32 angle_max        # 終了角 [rad]", "float32 angle_max        # end angle [rad]"),
      tx(
        "float32 angle_increment  # ビーム間角度 [rad]",
        "float32 angle_increment  # angle between beams [rad]",
      ),
      "float32 time_increment",
      "float32 scan_time",
      "float32 range_min",
      "float32 range_max",
      tx("float32[] ranges         # 距離配列 [m]", "float32[] ranges         # range array [m]"),
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
      tx("# リクエスト（空）", "# Request (empty)"),
      "---",
      tx("# レスポンス", "# Response"),
      "bool   success",
      "string message",
    ],
    "lifecycle_msgs/srv/ChangeState": [
      tx("# リクエスト", "# Request"),
      "Transition transition",
      "        uint8  id",
      "        string label",
      "---",
      tx("# レスポンス", "# Response"),
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
    "std_msgs/msg/Int32": ["int32 data"],
    "std_msgs/msg/Float32": ["float32 data"],
    "std_msgs/msg/Bool": ["bool data"],
    "std_srvs/srv/Empty": ["---"],
    "std_srvs/srv/SetBool": ["bool data", "---", "bool success", "string message"],
    "geometry_msgs/msg/PointStamped": ["std_msgs/Header header", "geometry_msgs/Point point"],
    "geometry_msgs/msg/PoseArray": ["std_msgs/Header header", "geometry_msgs/Pose[] poses"],
    "nav_msgs/msg/Path": ["std_msgs/Header header", "geometry_msgs/PoseStamped[] poses"],
    "geometry_msgs/msg/Pose": ["Point position", "Quaternion orientation"],
    "rcl_interfaces/msg/ParameterEvent": [
      "builtin_interfaces/Time stamp",
      "string node",
      "Parameter[] new_parameters",
      "Parameter[] changed_parameters",
      "Parameter[] deleted_parameters",
    ],
    "rcl_interfaces/srv/SetParameters": [
      "Parameter[] parameters",
      "---",
      "SetParametersResult[] results",
    ],
    "rcl_interfaces/srv/GetParameters": ["string[] names", "---", "ParameterValue[] values"],
    "nav2_msgs/action/NavigateToPose": [
      tx("# Goal（目標）", "# Goal"),
      "geometry_msgs/PoseStamped pose",
      "string behavior_tree",
      "---",
      tx("# Result（結果。エラー定数は省略）", "# Result (error constants omitted)"),
      "uint16 error_code",
      "string error_msg",
      "---",
      tx("# Feedback（進捗。一部のフィールドのみ）", "# Feedback (selected fields)"),
      "geometry_msgs/PoseStamped current_pose",
      "builtin_interfaces/Duration navigation_time",
      "builtin_interfaces/Duration estimated_time_remaining",
      "int16 number_of_recoveries",
      "float32 distance_remaining",
    ],
  };
}

function helpLines(): string[] {
  return [
    t("terminal.help.title"),
    "",
    "  ros2 topic list [-t]",
    "  ros2 topic info  <topic>",
    "  ros2 topic type  <topic>",
    "  ros2 topic echo  <topic>",
    "  ros2 topic hz    <topic>",
    "  ros2 node list",
    "  ros2 node info   <node>",
    "  ros2 service list [-t]",
    "  ros2 service type <service>",
    "  ros2 action list [-t]",
    "  ros2 action info <action>",
    "  ros2 param list|get|dump <node> ...",
    "  ros2 lifecycle get <node>",
    "  ros2 interface show <type>",
    "  ros2 doctor",
    `  clear      # ${t("terminal.help.clear")}`,
    `  q | exit   # ${t("terminal.help.exit")}`,
    "",
    t("terminal.help.history"),
    t("terminal.help.inspectOnly"),
  ];
}

function usage(command: string): string {
  return t("terminal.usage", { command });
}

function unknownVerb(command: string): string {
  return t("terminal.unknownVerb", { command });
}

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
      return { lines: [t("terminal.bye")], effect: "close" };
    case "help":
    case "?":
      return { lines: helpLines() };
    case "ros2":
      break;
    default:
      return {
        lines: [t("terminal.commandNotFound", { command: tokens[0] }), t("terminal.tryHelp")],
      };
  }

  if (tokens.length < 2) return { lines: [usage("ros2 <verb> ..."), t("terminal.tryHelp")] };

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
      return { lines: execAction(noun, rest, state) };
    case "param":
      return { lines: execParam(noun, rest, state) };
    case "lifecycle":
      return { lines: execLifecycle(noun, rest, state) };
    case "interface":
      return { lines: execInterface(noun, rest, state, concept) };
    case "run":
    case "launch":
      return { lines: [unsupportedMutation(`ros2 ${verb}`)] };
    case "doctor":
      return {
        lines: [t("terminal.doctor", { nodes: state.nodes.length, topics: state.topics.length })],
      };
    default:
      return {
        lines: [t("terminal.notImplemented", { command: `ros2 ${verb}` }), t("terminal.tryHelp")],
      };
  }
}

function execTopic(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [usage("ros2 topic <list|info|type|echo|hz> ...")];
  switch (verb) {
    case "list":
      return s.topics.length
        ? s.topics.map((t) => (rest.includes("-t") ? `${t.name} [${t.type}]` : t.name))
        : [t("terminal.noTopics")];
    case "info": {
      const topic = s.topics.find((x) => x.name === rest[0]);
      if (!topic) return [t("terminal.topicNotFound", { name: rest[0] ?? t("terminal.missing") })];
      const out: string[] = [
        `Type: ${topic.type}`,
        ``,
        `Publisher count: ${topic.pub?.length ?? 0}`,
      ];
      (topic.pub ?? []).forEach((n) => out.push(`  ${n} : ${topic.type}`));
      out.push(``, `Subscription count: ${topic.sub?.length ?? 0}`);
      (topic.sub ?? []).forEach((n) => out.push(`  ${n} : ${topic.type}`));
      return out;
    }
    case "type": {
      const topic = s.topics.find((x) => x.name === rest[0]);
      return topic
        ? [topic.type]
        : [t("terminal.topicNotFound", { name: rest[0] ?? t("terminal.missing") })];
    }
    case "echo": {
      if (!rest[0]) return [usage("ros2 topic echo <topic>")];
      const valid = s.topics.find((x) => x.name === rest[0]);
      if (!valid) return [t("terminal.topicNotFound", { name: rest[0] })];
      const recent = s.recentMessages(rest[0], 5);
      if (recent.length === 0)
        return [t("terminal.noMessages", { topic: rest[0] }), t("terminal.snapshot", { count: 0 })];
      const lines: string[] = [t("terminal.snapshot", { count: recent.length })];
      recent.forEach((m, i) => {
        lines.push(m.msg);
        if (i < recent.length - 1) lines.push("---");
      });
      return lines;
    }
    case "hz": {
      if (!rest[0]) return [usage("ros2 topic hz <topic>")];
      if (!s.topics.some((x) => x.name === rest[0]))
        return [t("terminal.topicNotFound", { name: rest[0] })];
      const recent = s.recentMessages(rest[0], 30);
      if (recent.length < 2) return [t("terminal.notEnoughMessages", { topic: rest[0] })];
      const dt = recent[recent.length - 1].ts - recent[0].ts;
      const hz = (recent.length - 1) / Math.max(dt, 0.001);
      return [
        `average rate: ${hz.toFixed(2)} Hz`,
        `\twindow: ${recent.length} samples`,
        t("terminal.rateSnapshot"),
      ];
    }
    case "pub": {
      return [unsupportedMutation("ros2 topic pub")];
    }
    default:
      return [unknownVerb(`ros2 topic ${verb}`)];
  }
}

function execNode(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [usage("ros2 node <list|info> ...")];
  switch (verb) {
    case "list":
      return s.nodes.length ? s.nodes : [t("terminal.noNodes")];
    case "info": {
      const name = rest[0];
      if (!name) return [usage("ros2 node info <node>")];
      if (!s.nodes.includes(name)) return [t("terminal.nodeNotFound", { name })];
      const subs = s.topics.filter((t) => t.sub?.includes(name));
      const pubs = s.topics.filter((t) => t.pub?.includes(name));
      const services = (s.services ?? []).filter((sv) => sv.node === name);
      const clients = (s.actions ?? []).filter((action) => action.clients?.includes(name));
      const servers = (s.actions ?? []).filter((action) => action.servers?.includes(name));
      const out: string[] = [name, ""];
      out.push("  Subscribers:");
      if (subs.length === 0) out.push(tx("    （なし）", "    (none)"));
      else subs.forEach((t) => out.push(`    ${t.name}: ${t.type}`));
      out.push("", "  Publishers:");
      if (pubs.length === 0) out.push(tx("    （なし）", "    (none)"));
      else pubs.forEach((t) => out.push(`    ${t.name}: ${t.type}`));
      out.push("", "  Service Servers:");
      if (services.length === 0) out.push(tx("    （なし）", "    (none)"));
      else services.forEach((sv) => out.push(`    ${sv.name}: ${sv.type}`));
      out.push("", "  Action Clients:");
      if (clients.length === 0) out.push(tx("    （なし）", "    (none)"));
      else clients.forEach((action) => out.push(`    ${action.name}: ${action.type}`));
      out.push("", "  Action Servers:");
      if (servers.length === 0) out.push(tx("    （なし）", "    (none)"));
      else servers.forEach((action) => out.push(`    ${action.name}: ${action.type}`));
      return out;
    }
    default:
      return [unknownVerb(`ros2 node ${verb}`)];
  }
}

function execService(verb: string, rest: string[], s: RuntimeState): string[] {
  if (!verb) return [usage("ros2 service <list|type> ...")];
  switch (verb) {
    case "list":
      return (s.services ?? []).length
        ? (s.services ?? []).map((sv) =>
            rest.includes("-t") ? `${sv.name} [${sv.type}]` : sv.name,
          )
        : [t("terminal.noServices")];
    case "type": {
      const sv = (s.services ?? []).find((x) => x.name === rest[0]);
      return sv
        ? [sv.type]
        : [t("terminal.serviceNotFound", { name: rest[0] ?? t("terminal.missing") })];
    }
    case "call": {
      return [unsupportedMutation("ros2 service call")];
    }
    default:
      return [unknownVerb(`ros2 service ${verb}`)];
  }
}

function execAction(verb: string, rest: string[], state: RuntimeState): string[] {
  const actions = state.actions ?? [];
  if (!verb) return [usage("ros2 action <list|info> ...")];
  if (verb === "send_goal") return [unsupportedMutation("ros2 action send_goal")];
  if (verb === "list")
    return actions.length
      ? actions.map((a) => (rest.includes("-t") ? `${a.name} [${a.type}]` : a.name))
      : [t("terminal.noActions")];
  if (verb !== "info") return [unknownVerb(`ros2 action ${verb}`)];
  const name = rest[0];
  const action = actions.find((a) => a.name === name);
  if (!name) return [usage("ros2 action info <action>")];
  if (!action) return [t("terminal.actionNotFound", { name })];
  return [
    `Action: ${name}`,
    `Action clients: ${action.clients?.length ?? 0}`,
    ...(action.clients ?? []).map((node) => `  ${node}`),
    `Action servers: ${action.servers?.length ?? 0}`,
    ...(action.servers ?? []).map((node) => `  ${node}`),
    `Type: ${action.type}`,
  ];
}

function execParam(verb: string, rest: string[], state: RuntimeState): string[] {
  if (!verb) return [usage("ros2 param <list|get|dump> <node> ...")];
  if (verb === "set") return [unsupportedMutation("ros2 param set")];
  if (!["list", "get", "dump"].includes(verb)) return [unknownVerb(`ros2 param ${verb}`)];
  const node = rest[0];
  if (!node) return [usage(`ros2 param ${verb} <node>${verb === "get" ? " <parameter>" : ""}`)];
  if (!state.nodes.includes(node)) return [t("terminal.nodeNotFound", { name: node })];
  const params = new Map(Object.entries(state.parameters?.[node] ?? {}));
  if (params.size === 0) return [t("terminal.noParameters", { node })];
  if (verb === "list") return [...params.keys()].map((k) => `  ${k}`);
  const key = rest[1];
  if (verb === "get")
    return key && params.has(key)
      ? [`${key}: ${params.get(key)}`]
      : [t("terminal.parameterNotFound", { name: key ?? t("terminal.missing") })];
  if (verb === "dump")
    return [
      `${node.replace(/^\//, "")}:`,
      "  ros__parameters:",
      ...[...params].map(([k, v]) => `    ${k}: ${v}`),
    ];
  return [unknownVerb(`ros2 param ${verb}`)];
}

function execLifecycle(verb: string, rest: string[], s: RuntimeState): string[] {
  if (verb === "set") return [unsupportedMutation("ros2 lifecycle set")];
  if (verb && verb !== "get") return [unknownVerb(`ros2 lifecycle ${verb}`)];
  if (!verb || !rest[0]) return [usage("ros2 lifecycle get <node>")];
  const node = rest[0];
  if (!s.nodes.includes(node)) return [t("terminal.nodeNotFound", { name: node })];
  const lifecycle = s.lifecycle?.[node];
  return lifecycle
    ? [`${lifecycle.label} [${lifecycle.id}]`]
    : [t("terminal.noLifecycle", { node })];
}

function unsupportedMutation(command: string): string {
  return t("terminal.unsupported", { command });
}

function execInterface(
  verb: string,
  rest: string[],
  state: RuntimeState,
  concept?: Ros2Concept,
): string[] {
  if (verb !== "show") return [usage("ros2 interface show <type>")];
  const typeName = rest[0];
  if (!typeName) return [usage("ros2 interface show <type>")];
  const interfaces = interfaceDefinitions();
  const lines = interfaces[typeName];
  const declared = [
    ...(concept?.msgTypes ?? []),
    ...state.topics.map((topic) => topic.type),
    ...(state.services ?? []).map((service) => service.type),
    ...(state.actions ?? []).map((action) => action.type),
  ];
  if (!lines && declared.includes(typeName))
    return [`# ${typeName}`, t("terminal.interfaceDeclared"), t("terminal.interfaceOmitted")];
  if (!lines)
    return [
      t("terminal.interfaceNotFound", { name: typeName }),
      t("terminal.available"),
      ...Object.keys(interfaces).map((k) => `  ${k}`),
    ];
  const complete = new Set([
    "std_msgs/msg/String",
    "std_msgs/msg/Int32",
    "std_msgs/msg/Float32",
    "std_msgs/msg/Bool",
    "std_srvs/srv/Empty",
    "std_srvs/srv/SetBool",
    "std_srvs/srv/Trigger",
  ]);
  return complete.has(typeName) ? lines : [t("terminal.interfaceSummary"), ...lines];
}
