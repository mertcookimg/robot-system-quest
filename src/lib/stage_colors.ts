// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { getTheme } from "../core/theme";

// Scene interface colors are resolved when drawing, including values retained
// in port tables, robot records and trails. Image pixels and sprite artwork
// bypass this helper so a theme switch cannot change sensor measurements.
const pairs: ReadonlyArray<readonly [string, string]> = [
  ["#075f93", "#7dd3fc"],
  ["#075985", "#38bdf8"],
  ["#6d42b5", "#c4b5fd"],
  ["#be2949", "#fda4af"],
  ["#087764", "#5eead4"],
  ["#586a82", "#a4b5cd"],
  ["#425570", "#c2cfe3"],
  ["#172b4d", "#edf3ff"],
  ["#925b00", "#fbbf24"],
  ["#7487a0", "#7188a6"],
  ["#d8e2ef", "#3b506d"],
  ["#edf3fb", "#223149"],
  ["#f1f5fb", "#131f35"],
  ["#e8eff7", "#213149"],
  ["#93a7c1", "#3a4870"],
  ["#e7eff8", "#172940"],
  ["#cad6e5", "#34445e"],
  ["#637892", "#dbeafe"],
  ["#dcecf9", "#172944"],
  ["#dfeef9", "#173452"],
  ["#f1f7fb", "#31536a"],
  ["#c5d3e4", "#24354f"],
  ["#dce5f2", "#1b2c48"],
  ["#b22c7a", "#f472b6"],
  ["#b8dbd5", "#123d42"],
  ["#28664c", "#a7f3d0"],
  ["#a5d5b5", "#247346"],
  ["#87bd9c", "#0b3b27"],
  ["#dfedf8", "#18324f"],
  ["#dce6f2", "#17243d"],
  ["#d0ddea", "#1b2a44"],
  ["#c3d3e3", "#253653"],
  ["#c2e1d9", "#0d4845"],
  ["#a8d3c5", "#0f5b50"],
  ["#b0ddbf", "#237346"],
  ["#8bc59f", "#0d422b"],
  ["#d5ad8a", "#9f704b"],
  ["#e1c4a6", "#b98557"],
  ["#a4b4ca", "#43536e"],
  ["#dce8f5", "#193655"],
  ["#f1f6fb", "#15283a"],
  ["#cfebdb", "#12533c"],
  ["#def1e5", "#176447"],
  ["#edf6f4", "#102a35"],
  ["#cce7df", "#176b61"],
  ["#d9e3f0", "#2b3c59"],
  ["#e7eef7", "#111e32"],
  ["#8298b4", "#4a6080"],
  ["#e4edf8", "#293c5d"],
  ["#167346", "#86efac"],
  ["#edf7f6", "#122c37"],
  ["#c9d7e8", "#334c6b"],
  ["#cbe9df", "#135a46"],
  ["#f6e5be", "#70511b"],
  ["#b4233e", "#fca5a5"],
  ["#aabcd4", "#657b98"],
  ["#2f6b52", "#dcefe5"],
  ["#27644e", "#def2e9"],
  ["#387562", "#246b5a"],
  ["#d1dceb", "#263953"],
];

const palette = new Map<string, readonly [string, string]>();
for (const pair of pairs) {
  palette.set(pair[0], pair);
  palette.set(pair[1], pair);
}
// Old accent spellings can survive in stored decorative particles.
palette.set("#b8c8dc", ["#7487a0", "#7188a6"]);
palette.set("#627895", ["#7487a0", "#7188a6"]);
palette.set("#fb7185", ["#be2949", "#fda4af"]);
palette.set("#eef2ff", ["#172b4d", "#edf3ff"]);
palette.set("#9aa6c8", ["#425570", "#c2cfe3"]);
palette.set("#6e7a9c", ["#586a82", "#a4b5cd"]);

function colorPair(value: string): readonly [string, string] | undefined {
  const hex = value.toLowerCase();
  const direct = palette.get(hex);
  if (direct) return direct;
  const alphaHex = /^(#[a-f0-9]{6})([a-f0-9]{2})$/i.exec(value);
  if (alphaHex) {
    const pair = palette.get(alphaHex[1].toLowerCase());
    if (pair) return [pair[0] + alphaHex[2], pair[1] + alphaHex[2]];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([.\d]+))?\s*\)$/i.exec(value);
  if (!rgb) return;
  const key =
    "#" +
    rgb
      .slice(1, 4)
      .map((part) => Number(part).toString(16).padStart(2, "0"))
      .join("");
  const pair = palette.get(key);
  if (!pair) return;
  if (rgb[4] === undefined) return pair;
  const rgba = (hex: string) =>
    "rgba(" +
    [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16)).join(", ") +
    ", " +
    rgb[4] +
    ")";
  return [rgba(pair[0]), rgba(pair[1])];
}

/** Resolve interface colors immediately before a canvas drawing operation. */
export function stageColor<T extends string | CanvasGradient | CanvasPattern>(value: T): T {
  if (typeof value !== "string") return value;
  const pair = colorPair(value);
  return (pair ? pair[getTheme() === "dark" ? 1 : 0] : value) as T;
}

/** Native CSS colors remain reactive after an inline control has been built. */
export function cssStageColor(value: string): string {
  const pair = colorPair(value);
  return pair ? `light-dark(${pair[0]}, ${pair[1]})` : value;
}
