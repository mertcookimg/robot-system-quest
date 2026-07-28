// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Wires the inline ROS 2 terminal: input field + scrollback panel.

import { ui } from "./dom";
import { execCommand, resetTerminalState, type RuntimeState } from "../lib/terminal";
import * as topicMonitor from "./topic_monitor";
import type { Ros2Concept } from "../types";
import { t, onLangChange } from "../i18n";

const cmdHistory: string[] = [];
let historyIdx = -1;

function appendLines(lines: string[], cls: "out" | "info" | "err" = "out"): void {
  for (const line of lines) {
    const div = document.createElement("div");
    div.className = `tline tline-${cls}`;
    div.textContent = line;
    ui.terminalBody.appendChild(div);
  }
  ui.terminalBody.scrollTop = ui.terminalBody.scrollHeight;
}

function appendCmd(text: string): void {
  const div = document.createElement("div");
  div.className = "tline tline-cmd";
  const dollar = document.createElement("span");
  dollar.className = "tdollar";
  dollar.textContent = "$";
  const body = document.createTextNode(" " + text);
  div.appendChild(dollar);
  div.appendChild(body);
  ui.terminalBody.appendChild(div);
  ui.terminalBody.scrollTop = ui.terminalBody.scrollHeight;
}

interface Deps {
  getConcept: () => Ros2Concept | undefined;
  getStageName: () => string;
}
let deps: Deps | null = null;
let commandSelectEl: HTMLSelectElement | null = null;

/** Commands that inspect the simulation without pretending to mutate it. */
function isSelectableCommand(command: string): boolean {
  const line = command.trim();
  return /^(?:help|clear|ros2 (?:topic (?:list|info|type|echo|hz)|node (?:list|info)|service (?:list|type)|action (?:list|info)|param (?:list|get|dump)|lifecycle get|interface show|doctor)\b)/.test(
    line,
  );
}

function inferredTopicType(name: string, concept?: Ros2Concept): string {
  const types = concept?.msgTypes ?? [];
  const preferred = /(?:cmd_vel)$/.test(name)
    ? "geometry_msgs/msg/Twist"
    : /(?:joint_states)$/.test(name)
      ? "sensor_msgs/msg/JointState"
      : /(?:scan)$/.test(name)
        ? "sensor_msgs/msg/LaserScan"
        : /(?:battery_state)$/.test(name)
          ? "sensor_msgs/msg/BatteryState"
          : /(?:\/map)$/.test(name)
            ? "nav_msgs/msg/OccupancyGrid"
            : /(?:odom|odometry)$/.test(name)
              ? "nav_msgs/msg/Odometry"
              : /(?:image|image_raw)$/.test(name)
                ? "sensor_msgs/msg/Image"
                : /(?:objects|status|order|score|lap)$/.test(name)
                  ? "std_msgs/msg/String"
                  : /(?:pose|goal_pose|tip_target)$/.test(name)
                    ? "geometry_msgs/msg/PoseStamped"
                    : undefined;
  return (
    (preferred && types.includes(preferred) ? preferred : undefined) ??
    types.find((type) => type.includes("/msg/")) ??
    "unknown/msg/Type"
  );
}

function buildState(): RuntimeState {
  const c = deps?.getConcept();
  const topics = [...(c?.state?.topics ?? [])];
  const services = [...(c?.state?.services ?? [])];

  // The ROS Lab CLI is part of a stage's contract.  Some teaching stages
  // intentionally have no live publisher yet (the learner is about to build
  // it), so also expose resources advertised by those commands.
  for (const raw of c?.cli ?? []) {
    const line = raw.replace(/\\\s*\n\s*/g, " ");
    const topicMatch = line.match(
      /ros2 topic (?:info|type|echo|hz|pub(?:\s+--once|\s+-1)?)\s+(\/\S+)/,
    );
    if (topicMatch && !topics.some((tp) => tp.name === topicMatch[1])) {
      const pubType = line.match(/ros2 topic pub(?:\s+--once|\s+-1)?\s+\/\S+\s+(\S+)/)?.[1];
      topics.push({ name: topicMatch[1], type: pubType ?? inferredTopicType(topicMatch[1], c) });
    }
    const serviceMatch = line.match(/ros2 service (?:type|call)\s+(\/\S+)(?:\s+(\S+\/srv\/\S+))?/);
    if (serviceMatch && !services.some((sv) => sv.name === serviceMatch[1])) {
      services.push({
        name: serviceMatch[1],
        type: serviceMatch[2] ?? c?.msgTypes.find((x) => x.includes("/srv/")) ?? "unknown/srv/Type",
      });
    }
  }
  return {
    nodes: c?.state?.nodes ?? [],
    topics,
    services,
    recentMessages: (topic, n = 10) =>
      topicMonitor.recentMessages(topic, n).map((e) => ({ ts: e.ts, topic: e.topic, msg: e.msg })),
  };
}

function runLine(line: string): void {
  appendCmd(line);
  ui.terminalInput.value = "";
  if (line.trim()) {
    cmdHistory.push(line);
    if (cmdHistory.length > 50) cmdHistory.shift();
    historyIdx = cmdHistory.length;
  }
  const result = execCommand(line, buildState(), deps?.getConcept());
  if (result.effect === "clear") {
    ui.terminalBody.innerHTML = "";
    return;
  }
  if (result.lines.length) appendLines(result.lines, "out");
  if (result.effect === "close") ui.terminalInput.blur();
}

// ── Gamepad quick palette ─────────────────────────────────────────────
// The terminal input is keyboard-only, so pad players get a preset-command
// palette instead: L3 opens it, d-pad/stick moves the highlight, A runs the
// selected `ros2 ...` line, B or L3 closes it (see core/gamepad.ts).

let paletteEl: HTMLElement | null = null;
let paletteCmds: string[] = [];
let paletteIdx = 0;

function buildPaletteCmds(): string[] {
  const c = deps?.getConcept();
  const cmds: string[] = ["ros2 topic list", "ros2 node list", "ros2 service list"];
  for (const raw of c?.cli ?? []) {
    const cmd = raw.replace(/\\\s*\n\s*/g, " ").trim();
    if (cmd && isSelectableCommand(cmd) && !cmds.includes(cmd)) cmds.push(cmd);
  }
  const runtime = buildState();
  const topics = runtime.topics;
  for (const tp of topics.slice(0, 3)) {
    cmds.push(`ros2 topic echo ${tp.name}`);
    cmds.push(`ros2 topic hz ${tp.name}`);
  }
  for (const sv of runtime.services ?? []) {
    cmds.push(`ros2 service type ${sv.name}`);
  }
  const seenTypes = new Set<string>();
  for (const tp of topics) {
    if (seenTypes.size >= 2) break;
    if (!seenTypes.has(tp.type)) {
      seenTypes.add(tp.type);
      cmds.push(`ros2 interface show ${tp.type}`);
    }
  }
  cmds.push("help", "clear");
  return [...new Set(cmds)];
}

/** A stage-safe command for the footer; never advertises a fake mutation. */
export function recommendedCommand(): string {
  const c = deps?.getConcept();
  const advertised = (c?.cli ?? [])
    .map((raw) => raw.replace(/\\\s*\n\s*/g, " ").trim())
    .find(isSelectableCommand);
  if (advertised) return advertised;
  const state = buildState();
  if (state.topics[0]) return `ros2 topic echo ${state.topics[0].name}`;
  if (state.nodes[0]) return `ros2 node info ${state.nodes[0]}`;
  return "ros2 topic list";
}

function refreshCommandSelect(select: HTMLSelectElement): void {
  const previous = select.value;
  const commands = buildPaletteCmds();
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("terminal.select");
  select.appendChild(placeholder);
  const group = document.createElement("optgroup");
  group.label = t("terminal.inspect");
  commands.forEach((cmd) => {
    const option = document.createElement("option");
    option.value = cmd;
    option.textContent = cmd;
    group.appendChild(option);
  });
  select.appendChild(group);
  select.value = commands.includes(previous) ? previous : "";
}

function renderPalette(): void {
  if (!paletteEl) return;
  paletteEl.innerHTML = "";
  paletteCmds.forEach((cmd, i) => {
    const row = document.createElement("div");
    row.textContent = (i === paletteIdx ? "▶ " : "  ") + cmd;
    row.style.cssText = [
      "padding:2px 8px",
      "white-space:pre",
      i === paletteIdx
        ? "color:var(--accent, #7dd3fc); background:rgba(125,211,252,0.12)"
        : "color:#9aa6c8",
    ].join(";");
    row.onclick = () => {
      paletteIdx = i;
      paletteExec();
    };
    paletteEl!.appendChild(row);
    if (i === paletteIdx) row.scrollIntoView({ block: "nearest" });
  });
}

export function isPadPaletteOpen(): boolean {
  return paletteEl !== null;
}

export function openPadPalette(): void {
  if (paletteEl) return;
  paletteCmds = buildPaletteCmds();
  paletteIdx = 0;
  paletteEl = document.createElement("div");
  paletteEl.id = "terminal-pad-palette";
  paletteEl.style.cssText = [
    "max-height:140px",
    "overflow-y:auto",
    "border-top:1px solid rgba(125,211,252,0.3)",
    "background:rgba(var(--scrim-rgb), 0.96)",
    "font-family:ui-monospace,monospace",
    "font-size:11px",
    "line-height:1.6",
  ].join(";");
  ui.terminalInput.parentElement?.insertBefore(paletteEl, ui.terminalInput);
  renderPalette();
}

export function closePadPalette(): void {
  paletteEl?.remove();
  paletteEl = null;
}

export function togglePadPalette(): void {
  if (paletteEl) closePadPalette();
  else openPadPalette();
}

/** Move the palette highlight by `dir` (+1 / -1), wrapping around. */
export function paletteMove(dir: number): void {
  if (!paletteEl || paletteCmds.length === 0) return;
  paletteIdx = (paletteIdx + dir + paletteCmds.length) % paletteCmds.length;
  renderPalette();
}

/** Run the highlighted command; the palette stays open for follow-ups. */
export function paletteExec(): void {
  if (!paletteEl) return;
  runLine(paletteCmds[paletteIdx] ?? "");
}

/** Reset all terminal UI and simulated shell state for a newly loaded stage. */
export function resetForStage(): void {
  ui.terminalBody.innerHTML = "";
  ui.terminalInput.value = "";
  cmdHistory.length = 0;
  historyIdx = -1;
  resetTerminalState();
  closePadPalette();
  ui.terminalStage.textContent = t("terminal.stage", { name: deps?.getStageName() ?? "—" });
  if (commandSelectEl) {
    commandSelectEl.value = "";
    refreshCommandSelect(commandSelectEl);
  }
  appendLines([t("terminal.welcome"), t("terminal.guide"), ""], "info");
}

export function setupTerminal(d: Deps): void {
  deps = d;
  const commandSelect = document.getElementById(
    "terminal-command-select",
  ) as HTMLSelectElement | null;
  commandSelectEl = commandSelect;
  const commandRun = document.getElementById("terminal-command-run") as HTMLButtonElement | null;
  const terminalTitle = document.getElementById("terminal-title");
  const terminalHint = document.getElementById("terminal-hint");
  const commandLabel = document.getElementById("terminal-command-label");
  const renderLanguage = (): void => {
    if (terminalTitle) terminalTitle.textContent = t("terminal.title");
    if (terminalHint) terminalHint.textContent = t("terminal.hint");
    if (commandLabel) commandLabel.textContent = t("terminal.command");
    if (commandRun) commandRun.textContent = t("terminal.run");
    ui.terminalInput.placeholder = t("terminal.input");
    ui.terminalStage.textContent = t("terminal.stage", { name: deps?.getStageName() ?? "—" });
    if (commandSelect) {
      commandSelect.setAttribute("aria-label", t("terminal.select"));
      refreshCommandSelect(commandSelect);
    }
  };
  const executeSelected = (): void => {
    const cmd = commandSelect?.value;
    if (!cmd) return;
    runLine(cmd);
  };
  if (commandSelect) {
    refreshCommandSelect(commandSelect);
    commandSelect.addEventListener("focus", () => refreshCommandSelect(commandSelect));
    commandSelect.addEventListener("change", () => {
      // Keep selection and require an explicit RUN click. This avoids
      // accidental service/action execution while browsing the list.
      ui.terminalInput.value = commandSelect.value;
    });
  }
  commandRun?.addEventListener("click", executeSelected);
  onLangChange(() => {
    renderLanguage();
    resetForStage();
  });
  renderLanguage();
  resetForStage();

  ui.terminalInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runLine(ui.terminalInput.value);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      historyIdx = Math.max(0, historyIdx - 1);
      ui.terminalInput.value = cmdHistory[historyIdx] ?? "";
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      historyIdx = Math.min(cmdHistory.length, historyIdx + 1);
      ui.terminalInput.value = cmdHistory[historyIdx] ?? "";
      return;
    }
  });
}
