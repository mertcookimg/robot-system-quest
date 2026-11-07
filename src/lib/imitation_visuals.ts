// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { theme, withA } from "../core/theme";
import { tx } from "../i18n";
import { clearBackground, drawGrid, drawRobotBody } from "./draw";
import type { ImitationCounts } from "./imitation_data";
import { laneCenter, type Demonstration } from "./imitation_model";

interface LearningVisualState {
  phase: "data" | "training" | "learned";
  /** The same actual first saved example, never selected for a favorable prediction. */
  example: Demonstration;
  /** Selected counts, or counts frozen when the current fit began. */
  counts: ImitationCounts;
  /** Actual predictions for example.observation, before and during/after fitting. */
  before?: number;
  prediction?: number;
  epochs?: number;
  totalEpochs?: number;
}

export type ImitationExplainerState =
  { phase: "ready"; counts?: ImitationCounts } | LearningVisualState;

export interface ImitationTextOptions {
  /** Font size at the native 800px canvas width. */
  size?: number;
  /** Minimum rendered CSS-pixel size on narrower canvases. */
  minCss?: number;
  /** Text wraps within this logical width; glyphs are never horizontally compressed. */
  maxWidth?: number;
  maxLines?: number;
  color?: string;
  align?: CanvasTextAlign;
  weight?: number;
  mono?: boolean;
}

const FG = "#eef2ff";
const MUTED = "#9aa6c8";
const ACCENT = "#7dd3fc";
const OK = "#5eead4";
const LINE = withA(MUTED, 0.24);

/** For text drawn in the shared canvas's unscaled 800×500 coordinate space. */
export function getImitationFontSize(
  c: CanvasRenderingContext2D,
  desktopSize = 18,
  minCssSize = 13,
): number {
  const displayedWidth = c.canvas.clientWidth || c.canvas.width || 800;
  return Math.max(desktopSize, (minCssSize * 800) / displayedWidth);
}

function wrapText(c: CanvasRenderingContext2D, value: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/\s+/u)) {
      const candidate = current ? `${current} ${word}` : word;
      if (c.measureText(candidate).width <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      current = "";
      // Long words and Japanese phrases wrap at character boundaries.
      for (const character of word) {
        if (current && c.measureText(current + character).width > width) {
          lines.push(current);
          current = "";
        }
        current += character;
      }
    }
    if (current || !paragraph) lines.push(current);
  }
  return lines;
}

/** x/y use an alphabetic baseline, like fillText. Returns the occupied line height. */
export function drawImitationText(
  c: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: ImitationTextOptions = {},
): number {
  const size = getImitationFontSize(c, options.size ?? 18, options.minCss ?? 13);
  const width = options.maxWidth ?? 736;
  if (width <= 0) return 0;
  c.save();
  c.font = `${options.weight ?? 500} ${size}px ${options.mono ? 'ui-monospace, "Cascadia Mono", monospace' : "system-ui, sans-serif"}`;
  c.textAlign = options.align ?? "left";
  c.textBaseline = "alphabetic";
  c.fillStyle = options.color ?? FG;
  const lines = wrapText(c, value, width);
  if (options.maxLines !== undefined && lines.length > options.maxLines) {
    lines.length = Math.max(1, options.maxLines);
    let last = lines.at(-1)!;
    while (last && c.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last}…`;
  }
  const lineHeight = size * 1.3;
  lines.forEach((line, i) => c.fillText(line, x, y + i * lineHeight));
  c.restore();
  return lines.length * lineHeight;
}

function line(
  c: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = LINE,
  width = 1,
): void {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(x1, y1);
  c.lineTo(x2, y2);
  c.stroke();
}

function arrow(c: CanvasRenderingContext2D, x1: number, y: number, x2: number): void {
  line(c, x1, y, x2, y, ACCENT, 2);
  c.strokeStyle = ACCENT;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(x2 - 10, y - 8);
  c.lineTo(x2, y);
  c.lineTo(x2 - 10, y + 8);
  c.stroke();
}

function observationLabels(example: Demonstration): [string, string] {
  const [offset, velocity] = example.observation;
  return [
    Math.abs(offset) < 0.005
      ? tx("中央付近", "Near center")
      : offset > 0
        ? tx("中央より上", "Above center")
        : tx("中央より下", "Below center"),
    Math.abs(velocity) < 0.005
      ? tx("中央に対してほぼ静止", "Relative: near zero")
      : velocity > 0
        ? tx("中央に対して↓", "Relative: ↓")
        : tx("中央に対して↑", "Relative: ↑"),
  ];
}

/** A schematic of direction; exact action magnitudes remain unchanged in the bars. */
function observationDiagram(
  c: CanvasRenderingContext2D,
  example: Demonstration,
  left: number,
  right: number,
  centerY: number,
  robotScale = 1.8,
): void {
  const [offset, velocity] = example.observation;
  const robotX = left + (right - left) * 0.35;
  const robotY = centerY + (Math.abs(offset) < 0.005 ? 0 : offset > 0 ? -30 : 30);
  c.setLineDash([5, 7]);
  line(c, left, centerY, right, centerY, withA(MUTED, 0.5));
  c.setLineDash([]);
  drawImitationText(c, tx("中央", "Center"), right, centerY - 15, {
    size: 16,
    minCss: 12,
    maxWidth: 150,
    align: "right",
    color: MUTED,
  });
  c.save();
  c.translate(robotX, robotY);
  c.scale(robotScale, robotScale);
  drawRobotBody(c);
  c.restore();
  if (Math.abs(velocity) >= 0.005) {
    const x = left + (right - left) * 0.56;
    const direction = velocity > 0 ? 1 : -1;
    const tip = robotY + direction * 28;
    line(c, x, robotY, x, tip, ACCENT, 3);
    c.strokeStyle = ACCENT;
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(x - 8, tip - direction * 8);
    c.lineTo(x, tip);
    c.lineTo(x + 8, tip - direction * 8);
    c.stroke();
  }
}

/** Every bar shares a fixed -1..+1 scale, without normalization or value adjustments. */
function actionBar(
  c: CanvasRenderingContext2D,
  value: number | undefined,
  center: number,
  halfWidth: number,
  y: number,
  color: string,
): void {
  c.lineCap = "round";
  line(c, center - halfWidth, y, center + halfWidth, y, LINE, 4);
  line(c, center, y - 11, center, y + 11, withA(MUTED, 0.65));
  if (value !== undefined && Number.isFinite(value)) {
    const end = center + value * halfWidth;
    line(c, center, y, end, y, color, 8);
    c.fillStyle = color;
    c.beginPath();
    c.arc(end, y, 5, 0, Math.PI * 2);
    c.fill();
  } else {
    drawImitationText(c, tx("未計算", "Not run"), center, y + 9, {
      color: MUTED,
      align: "center",
      maxWidth: halfWidth * 2,
    });
  }
  c.lineCap = "butt";
}

function drawReady(c: CanvasRenderingContext2D): void {
  drawGrid(c, 800, 500, withA(MUTED, 0.09));
  c.beginPath();
  for (let x = 60; x <= 740; x += 4) {
    if (x === 60) c.moveTo(x, laneCenter(x, 0));
    else c.lineTo(x, laneCenter(x, 0));
  }
  c.lineCap = "round";
  c.strokeStyle = withA(theme.floor, 0.75);
  c.lineWidth = 88;
  c.stroke();
  c.strokeStyle = withA(ACCENT, 0.7);
  c.lineWidth = 2;
  c.setLineDash([9, 10]);
  c.stroke();
  c.setLineDash([]);
  c.lineCap = "butt";
  c.save();
  c.translate(60, laneCenter(60, 0));
  c.scale(2.2, 2.2);
  drawRobotBody(c);
  c.restore();
  for (const radius of [25, 35]) {
    c.strokeStyle = withA(OK, radius === 25 ? 0.8 : 0.35);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(740, laneCenter(740, 0), radius, 0, Math.PI * 2);
    c.stroke();
  }
  drawImitationText(c, "START", 32, laneCenter(60, 0) - 65, {
    mono: true,
    size: 18,
    minCss: 12,
    maxWidth: 160,
    color: ACCENT,
  });
  drawImitationText(c, "GOAL", 768, laneCenter(740, 0) - 65, {
    mono: true,
    size: 18,
    minCss: 12,
    maxWidth: 160,
    color: OK,
    align: "right",
  });
  drawImitationText(c, tx("中央を走ってゴールへ", "Follow the center to the goal"), 32, 468, {
    color: MUTED,
    maxWidth: 736,
  });
}

function drawData(c: CanvasRenderingContext2D, state: LearningVisualState): void {
  const n = state.counts.manual + state.counts.recovery;
  drawImitationText(c, tx(`学習データ：${n}件`, `Training data: ${n}`), 32, 48, {
    size: 20,
    minCss: 14,
    maxWidth: 550,
  });
  drawImitationText(c, tx("未学習", "Not trained"), 768, 48, {
    size: 16,
    minCss: 12,
    maxWidth: 210,
    color: MUTED,
    align: "right",
  });
  const categories = [
    [tx("操作", "Yours"), state.counts.manual],
    [tx("復帰", "Recovery"), state.counts.recovery],
  ] as const;
  categories.forEach(([label, count], i) => {
    drawImitationText(c, `${label} ${count}`, 32 + i * 368, 99, {
      size: 17,
      minCss: 12,
      maxWidth: 352,
      color: count ? ACCENT : MUTED,
    });
  });
  line(c, 32, 126, 768, 126);
  drawImitationText(c, tx("記録の1例", "One example"), 32, 177, {
    size: 18,
    maxWidth: 340,
    maxLines: 1,
  });
  drawImitationText(c, tx("記録した操作", "Recorded action"), 480, 177, {
    size: 18,
    maxWidth: 288,
  });
  observationDiagram(c, state.example, 32, 364, 260, 2.2);
  arrow(c, 398, 260, 442);
  actionBar(c, state.example.action, 620, 140, 260, FG);
  drawImitationText(c, "↑", 480, 231, { color: MUTED, maxWidth: 60 });
  drawImitationText(c, "0", 620, 231, { color: MUTED, maxWidth: 60, align: "center" });
  drawImitationText(c, "↓", 760, 231, { color: MUTED, maxWidth: 60, align: "right" });
  const [position, motion] = observationLabels(state.example);
  drawImitationText(c, position, 32, 354, { maxWidth: 340 });
  drawImitationText(c, motion, 32, 400, { maxWidth: 340, color: MUTED });
  const actionLabel =
    Math.abs(state.example.action) < 0.005
      ? tx("ほぼ入力なし", "Almost no input")
      : state.example.action < 0
        ? tx("↑ 上へ操作", "↑ Steer up")
        : tx("↓ 下へ操作", "↓ Steer down");
  drawImitationText(c, actionLabel, 620, 354, { maxWidth: 288, align: "center" });
  drawImitationText(
    c,
    tx("中央に対する位置・動き → 操作", "Relative position + motion → action"),
    32,
    473,
    {
      maxWidth: 736,
      color: MUTED,
    },
  );
}

function drawLearning(c: CanvasRenderingContext2D, state: LearningVisualState): void {
  const training = state.phase === "training";
  drawImitationText(
    c,
    training ? tx("操作を学習", "Learning actions") : tx("学習後の操作", "Learned actions"),
    32,
    45,
    {
      size: 20,
      minCss: 14,
      maxWidth: 520,
    },
  );
  if (state.epochs !== undefined && state.totalEpochs !== undefined && state.totalEpochs > 0) {
    const ratio = state.epochs / state.totalEpochs;
    drawImitationText(
      c,
      ratio >= 1 ? tx("学習完了", "Complete") : `${Math.floor(ratio * 100)}%`,
      768,
      45,
      {
        mono: true,
        size: 16,
        minCss: 12,
        maxWidth: 210,
        color: MUTED,
        align: "right",
      },
    );
    line(c, 32, 68, 768, 68, LINE, 3);
    line(c, 32, 68, 32 + 736 * ratio, 68, withA(ACCENT, 0.6), 3);
  }
  drawImitationText(c, tx("記録の1例で比較", "One example"), 32, 112, {
    size: 16,
    minCss: 12,
    maxWidth: 360,
    maxLines: 1,
    color: MUTED,
  });
  const [position, motion] = observationLabels(state.example);
  drawImitationText(c, position, 32, 154, { maxWidth: 360 });
  drawImitationText(c, motion, 32, 196, { maxWidth: 360, color: MUTED });
  observationDiagram(c, state.example, 430, 768, 154, 1.8);

  drawImitationText(c, "↑", 352, 247, { maxWidth: 60, color: MUTED });
  drawImitationText(c, "0", 560, 247, { maxWidth: 60, color: MUTED, align: "center" });
  drawImitationText(c, "↓", 768, 247, { maxWidth: 60, color: MUTED, align: "right" });
  const rows = [
    [tx("記録した操作", "Recorded"), state.example.action, FG],
    [tx("学習前", "Before"), state.before, MUTED],
    [training ? tx("学習中", "Learning") : tx("学習後", "After"), state.prediction, ACCENT],
  ] as const;
  rows.forEach(([label, value, color], i) => {
    const y = 287 + i * 65;
    drawImitationText(c, label, 32, y + 9, { maxWidth: 280, color });
    actionBar(c, value, 560, 208, y, color);
  });
  drawImitationText(c, tx("走行は次のテストで確認", "Test driving next"), 32, 479, {
    color: MUTED,
    maxWidth: 736,
  });
}

/** Render only: no sample collection, weight updates, or test evaluation happens here. */
export function drawImitationExplainer(
  c: CanvasRenderingContext2D,
  state: ImitationExplainerState,
): void {
  c.save();
  c.beginPath();
  c.rect(0, 0, 800, 500);
  c.clip();
  clearBackground(c);
  if (state.phase === "ready") drawReady(c);
  else if (state.phase === "data") drawData(c, state);
  else drawLearning(c, state);
  c.restore();
}
