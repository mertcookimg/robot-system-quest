// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Pseudo "ROS topic monitor" — a fixed-size in-memory log of recent
// publications, rendered in the right-side panel. Stages call `publish()`,
// the terminal queries `recentMessages()`, the main loop calls `render()`.

import { getLang } from "../i18n";

export interface TopicEntry {
  ts: number;
  topic: string;
  msg: string;
}

const MAX_ENTRIES = 14;
const log: TopicEntry[] = [];

export function publish(topic: string, msg: string): void {
  log.push({ ts: performance.now() / 1000, topic, msg });
  if (log.length > MAX_ENTRIES) log.shift();
}

export function clearLog(): void {
  log.length = 0;
}

export function recentMessages(topic?: string, n = 10): TopicEntry[] {
  const filtered = topic ? log.filter((e) => e.topic === topic) : log;
  return filtered.slice(-n);
}

function topicColor(topic: string): string {
  if (topic.includes("cmd_vel")) return "var(--accent)";
  if (topic.includes("scan")) return "var(--accent-2)";
  if (topic.includes("pose")) return "var(--warn)";
  if (topic.includes("data_collected")) return "var(--ok)";
  return "var(--fg-dim)";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function render(el: HTMLElement): void {
  if (log.length === 0) {
    const wait =
      getLang() === "ja"
        ? "// 待機中... ステージで操作するとメッセージが流れます"
        : "// idle... move on a stage to see messages";
    el.innerHTML = `<span class="dim">$ ros2 topic echo &lt;topic&gt;\n${wait}</span>`;
    return;
  }
  const t0 = log[0].ts;
  const lines: string[] = [];
  const recent = log.slice().reverse();
  recent.forEach((e, i) => {
    const t = (e.ts - t0).toFixed(2).padStart(6, " ");
    const tp = e.topic.padEnd(18, " ");
    lines.push(
      `<span class="dim">[${t}]</span> <span style="color:${topicColor(e.topic)}">${tp}</span><span>${escapeHtml(e.msg)}</span>`,
    );
    if (i < recent.length - 1) lines.push(`<span class="dim">---</span>`);
  });
  el.innerHTML = lines.join("\n");
}
