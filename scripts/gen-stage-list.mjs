// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Generates the GAME / LESSON stage tables in README.md from the actual
// defineStage() manifests. Each stage file is parsed with regex (we can't
// `import` TS at runtime without a build step, so static parsing is fine
// for the small set of fields we need).
//
// Usage:
//   node scripts/gen-stage-list.mjs           # rewrites README.md
//   node scripts/gen-stage-list.mjs --check   # exits 1 if README is stale
//
// README markers (do not edit between them by hand):
//   <!-- STAGES:GAME -->   ... <!-- STAGES:GAME:END -->
//   <!-- STAGES:LESSON --> ... <!-- STAGES:LESSON:END -->

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..");

function readStage(filePath) {
  const src = fs.readFileSync(filePath, "utf8");
  const file = path.relative(repo, filePath);
  const fileId = path.basename(filePath, ".ts");
  const identities = [...src.matchAll(/\bid:\s*"([^"]+)"\s*,\s*\n\s*name:\s*"([^"]+)"/g)];
  const identity = identities.at(-1);
  if (!identity) throw new Error(`${file}: could not parse Stage.id and Stage.name`);
  const [, id, name] = identity;
  if (id !== fileId) {
    throw new Error(`${file}: filename "${fileId}" does not match Stage.id "${id}"`);
  }

  // defineStage manifest: mode, order
  const mode = /defineStage\(\s*\{[\s\S]*?mode:\s*"(game|lesson)"/.exec(src)?.[1];
  if (!mode) throw new Error(`${file}: could not parse defineStage.mode`);
  const expectedMode = path.basename(path.dirname(filePath));
  if (mode !== expectedMode) {
    throw new Error(`${file}: directory "${expectedMode}" does not match mode "${mode}"`);
  }

  const orderText = /defineStage\(\s*\{[\s\S]*?order:\s*(\d+(?:\.\d+)?)/.exec(src)?.[1];
  const order = Number(orderText);
  if (!orderText || !Number.isFinite(order) || order <= 0) {
    throw new Error(`${file}: defineStage.order must be a positive number`);
  }

  // ros2.title concept (bilingual via tx() — extract the English arg). Anchor on
  // `title:` so we don't pick up a tx() call inside `summary` etc.
  const title = /\btitle:\s*tx\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/.exec(src);
  const concept = title ? title[2] : "";
  return { id, name, mode, order, concept, file };
}

function loadAll() {
  const dirs = ["src/stages/game", "src/stages/lesson"];
  const stages = [];
  for (const d of dirs) {
    const abs = path.join(repo, d);
    for (const fn of fs.readdirSync(abs).sort()) {
      if (!fn.endsWith(".ts")) continue;
      stages.push(readStage(path.join(abs, fn)));
    }
  }

  const ids = new Map();
  const orders = new Map();
  for (const stage of stages) {
    const previousId = ids.get(stage.id);
    if (previousId) {
      throw new Error(`${stage.file}: duplicate Stage.id "${stage.id}" (also in ${previousId})`);
    }
    ids.set(stage.id, stage.file);

    const orderKey = `${stage.mode}:${stage.order}`;
    const previousOrder = orders.get(orderKey);
    if (previousOrder) {
      throw new Error(
        `${stage.file}: duplicate ${stage.mode} order ${stage.order} (also in ${previousOrder})`,
      );
    }
    orders.set(orderKey, stage.file);
  }

  return stages.sort((a, b) =>
    a.mode === b.mode ? a.order - b.order : a.mode === "game" ? -1 : 1,
  );
}

function table(stages, prefix) {
  const lines = [
    "| # | ID | Concept |",
    "|----|----|----|",
    ...stages.map((s, i) => {
      const id = `\`${s.id}\``;
      const concept = s.concept || s.name;
      return `| ${prefix}${i + 1} | ${id} | ${concept} |`;
    }),
  ];
  return lines.join("\n");
}

function rebuild(readme, marker, body) {
  const start = `<!-- STAGES:${marker} -->`;
  const end = `<!-- STAGES:${marker}:END -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  const block = `${start}\n${body}\n${end}`;
  if (re.test(readme)) return readme.replace(re, block);
  // No markers yet: leave file alone, caller logs.
  return null;
}

const stages = loadAll();
const play = stages.filter((s) => s.mode === "game");
const learn = stages.filter((s) => s.mode === "lesson");

const readmePath = path.join(repo, "README.md");
let readme = fs.readFileSync(readmePath, "utf8");
let updated = readme;
const playBlock = rebuild(updated, "GAME", table(play, "G"));
if (playBlock !== null) updated = playBlock;
else throw new Error('README.md: missing "<!-- STAGES:GAME -->" markers');
const learnBlock = rebuild(updated, "LESSON", table(learn, "L"));
if (learnBlock !== null) updated = learnBlock;
else throw new Error('README.md: missing "<!-- STAGES:LESSON -->" markers');

const check = process.argv.includes("--check");
if (check) {
  if (updated !== readme) {
    console.error("README.md is out of date. Run: npm run gen:stages");
    process.exit(1);
  }
  console.log("README.md stage tables are up to date.");
  process.exit(0);
}
if (updated !== readme) {
  fs.writeFileSync(readmePath, updated);
  console.log(`Updated README.md (${play.length} GAME + ${learn.length} LESSON stages)`);
} else {
  console.log("README.md already up to date");
}
