// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Wires the inline ROS 2 terminal: input field + scrollback panel.

import { ui } from "./dom";
import { execCommand, type RuntimeState } from "../lib/terminal";
import { inspectionCommands, recommendedInspectionCommand } from "../lib/terminal_commands";
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

function buildState(): RuntimeState {
  const state = deps?.getConcept()?.state;
  return {
    nodes: state?.nodes ?? [],
    topics: state?.topics ?? [],
    services: state?.services ?? [],
    actions: state?.actions ?? [],
    parameters: state?.parameters,
    lifecycle: state?.lifecycle,
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
  if (result.effect === "close") resumeStageControls();
}

// ── Gamepad quick palette ─────────────────────────────────────────────
// The terminal input is keyboard-only, so pad players get a preset-command
// palette instead: L3 opens it, d-pad/stick moves the highlight, A runs the
// selected `ros2 ...` line, B or L3 closes it (see core/gamepad.ts).

let paletteEl: HTMLElement | null = null;
let paletteCmds: string[] = [];
let paletteIdx = 0;

function buildPaletteCmds(): string[] {
  return inspectionCommands(deps?.getConcept());
}

function refreshPaletteCommands(): boolean {
  const selected = paletteCmds[paletteIdx];
  paletteCmds = buildPaletteCmds();
  const nextIndex = paletteCmds.indexOf(selected);
  paletteIdx = nextIndex >= 0 ? nextIndex : Math.min(paletteIdx, paletteCmds.length - 1);
  return nextIndex >= 0;
}

/** A stage-safe command for the footer; never advertises a fake mutation. */
export function recommendedCommand(): string {
  return recommendedInspectionCommand(deps?.getConcept());
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

/** Explicitly hand input back to the stage, without changing its state. */
export function resumeStageControls(): void {
  closePadPalette();
  if (!ui.canvas.hasAttribute("tabindex")) ui.canvas.tabIndex = -1;
  ui.canvas.focus({ preventScroll: true });
}

export function togglePadPalette(): void {
  if (paletteEl) resumeStageControls();
  else openPadPalette();
}

/** Move the palette highlight by `dir` (+1 / -1), wrapping around. */
export function paletteMove(dir: number): void {
  if (!paletteEl || paletteCmds.length === 0) return;
  refreshPaletteCommands();
  paletteIdx = (paletteIdx + dir + paletteCmds.length) % paletteCmds.length;
  renderPalette();
}

/** Run the highlighted command; the palette stays open for follow-ups. */
export function paletteExec(): void {
  if (!paletteEl) return;
  const stillAvailable = refreshPaletteCommands();
  renderPalette();
  if (!stillAvailable) return;
  runLine(paletteCmds[paletteIdx] ?? "");
}

/** Reset all terminal UI and simulated shell state for a newly loaded stage. */
export function resetForStage(): void {
  ui.terminalBody.innerHTML = "";
  ui.terminalInput.value = "";
  cmdHistory.length = 0;
  historyIdx = -1;
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
  // Selects and Run also own Enter/Space; they must not activate a stage dialog.
  document.getElementById("ros-terminal")?.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      resumeStageControls();
    }
  });
  const commandSelect = document.getElementById(
    "terminal-command-select",
  ) as HTMLSelectElement | null;
  commandSelectEl = commandSelect;
  const commandRun = document.getElementById("terminal-command-run") as HTMLButtonElement | null;
  const resumeButton = document.createElement("button");
  resumeButton.id = "terminal-resume";
  resumeButton.className = "terminal-command-run terminal-resume";
  resumeButton.type = "button";
  resumeButton.addEventListener("click", resumeStageControls);
  commandRun?.after(resumeButton);
  const terminalTitle = document.getElementById("terminal-title");
  const terminalHint = document.getElementById("terminal-hint");
  const commandLabel = document.getElementById("terminal-command-label");
  const renderLanguage = (): void => {
    if (terminalTitle) terminalTitle.textContent = t("terminal.title");
    if (terminalHint) terminalHint.textContent = t("terminal.hint");
    if (commandLabel) commandLabel.textContent = t("terminal.command");
    if (commandRun) commandRun.textContent = t("terminal.run");
    resumeButton.textContent = t("terminal.resume");
    ui.terminalInput.placeholder = t("terminal.input");
    ui.terminalStage.textContent = t("terminal.stage", { name: deps?.getStageName() ?? "—" });
    if (commandSelect) {
      commandSelect.setAttribute("aria-label", t("terminal.select"));
      refreshCommandSelect(commandSelect);
    }
  };
  const executeSelected = (): void => {
    if (commandSelect) refreshCommandSelect(commandSelect);
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
    // Input belongs to the shell, including when a lesson overlay is also open.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      resumeStageControls();
      return;
    }
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
