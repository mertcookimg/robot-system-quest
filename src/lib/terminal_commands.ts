// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// The guide, footer and terminal use the same declared simulation resources.
// Command examples never create nodes, topics, services or actions themselves.
import type { Ros2Concept } from "../types";

const normalize = (command: string) => command.replace(/\\\s*\n\s*/g, " ").trim();

export function availableInspectionCommand(command: string, concept?: Ros2Concept): boolean {
  const line = normalize(command);
  // This is a command interpreter, not a shell with redirection or pipelines.
  if (/[;|<>]/.test(line)) return false;
  const [tool, resource, verb, name, key] = line.split(/\s+/);
  if (tool === "help" || tool === "clear") return resource === undefined;
  if (tool !== "ros2") return false;
  if (resource === "doctor") return verb === undefined;
  const state = concept?.state;
  if (["topic", "node", "service", "action"].includes(resource) && verb === "list") return true;
  if (resource === "topic" && ["info", "type", "echo", "hz"].includes(verb))
    return !!state?.topics.some((topic) => topic.name === name);
  if (resource === "node" && verb === "info") return !!state?.nodes.includes(name);
  if (resource === "service" && verb === "type")
    return !!state?.services?.some((service) => service.name === name);
  if (resource === "action" && verb === "info")
    return !!state?.actions?.some((action) => action.name === name);
  if (resource === "param" && ["list", "get", "dump"].includes(verb)) {
    const parameters = state?.parameters?.[name];
    return !!parameters && (verb !== "get" || Object.hasOwn(parameters, key));
  }
  if (resource === "lifecycle" && verb === "get") return !!state?.lifecycle?.[name];
  if (resource === "interface" && verb === "show")
    return declaredInterfaceTypes(concept).includes(name);
  return false;
}

function declaredInterfaceTypes(concept?: Ros2Concept): string[] {
  return [
    ...(concept?.msgTypes ?? []),
    ...(concept?.state?.topics ?? []).map((topic) => topic.type),
    ...(concept?.state?.services ?? []).map((service) => service.type),
    ...(concept?.state?.actions ?? []).map((action) => action.type),
  ];
}

export function inspectionCommands(concept?: Ros2Concept): string[] {
  const state = concept?.state;
  const commands = ["ros2 topic list", "ros2 node list", "ros2 service list", "ros2 action list"];
  for (const raw of concept?.cli ?? []) {
    const command = normalize(raw);
    if (availableInspectionCommand(command, concept)) commands.push(command);
  }
  for (const topic of state?.topics ?? []) {
    for (const verb of ["echo", "info", "type", "hz"])
      commands.push(`ros2 topic ${verb} ${topic.name}`);
  }
  for (const node of state?.nodes ?? []) commands.push(`ros2 node info ${node}`);
  for (const service of state?.services ?? []) commands.push(`ros2 service type ${service.name}`);
  for (const action of state?.actions ?? []) commands.push(`ros2 action info ${action.name}`);
  for (const [node, parameters] of Object.entries(state?.parameters ?? {})) {
    commands.push(`ros2 param list ${node}`, `ros2 param dump ${node}`);
    for (const name of Object.keys(parameters)) commands.push(`ros2 param get ${node} ${name}`);
  }
  for (const node of Object.keys(state?.lifecycle ?? {}))
    commands.push(`ros2 lifecycle get ${node}`);
  for (const type of declaredInterfaceTypes(concept)) commands.push(`ros2 interface show ${type}`);
  commands.push("ros2 doctor", "help", "clear");
  return [...new Set(commands)];
}

export function recommendedInspectionCommand(concept?: Ros2Concept): string {
  const advertised = (concept?.cli ?? [])
    .map(normalize)
    .find((command) => availableInspectionCommand(command, concept));
  if (advertised) return advertised;
  const state = concept?.state;
  if (state?.topics[0]) return `ros2 topic echo ${state.topics[0].name}`;
  if (state?.nodes[0]) return `ros2 node info ${state.nodes[0]}`;
  return "ros2 topic list";
}
