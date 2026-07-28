// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Stage manifest helper. Each stage file calls `defineStage(...)` once to
// register itself with the runtime: i18n strings, lesson modal content, and
// the SVG diagram are declared in the manifest, while the stage's runtime
// methods come from the existing `make*()` factory passed as `build`.
//
// The runtime auto-collects every defineStage() call (see stage_collect.ts)
// so adding a new stage means creating one file — no edits to main.ts /
// modes.ts / ja.ts / en.ts.

import type { Stage } from "../types";
import { registerLang } from "../i18n";

export type Mode = "game" | "lesson";

export interface Bilingual {
  ja: string;
  en: string;
}

export interface LessonModalContent {
  title: Bilingual;
  learn: Bilingual;
  goal: Bilingual;
  first: Bilingual;
}

export interface StageDefinition {
  /** Mode tab the stage belongs to. */
  mode: Mode;
  /** Sort key within the mode. Smaller values appear first. */
  order: number;

  /** Optional SVG diagram for the per-stage lesson modal. */
  diagram?: string;

  /**
   * Optional lesson modal content. When provided, the modal auto-opens on
   * the first visit to a LESSON stage. Strings are registered as
   * `${stage.id}.lesson.title`, `${stage.id}.lesson.learn`, etc.
   */
  lessonModal?: LessonModalContent;

  /**
   * Additional bilingual strings used by the stage. Keys are registered with
   * the prefix `${stage.id}.`, so `strings.ja["status.go"]` becomes the JA
   * value of `t(\`${stage.id}.status.go\`)` at runtime.
   */
  strings?: { ja: Record<string, string>; en: Record<string, string> };

  /**
   * Build the full Stage (including id, name, lesson, lessonCmd, ros2 and
   * the runtime methods init/update/draw/reset/dispose). Called once at
   * registration time.
   */
  build(): Stage;
}

interface StageRecord {
  def: StageDefinition;
  stage: Stage;
}

const records: StageRecord[] = [];
const diagrams = new Map<string, string>();

/**
 * Declare a stage. Side effects: builds the stage instance once, registers
 * its i18n entries (prefixed by `${stage.id}.`) and its diagram into runtime
 * registries. Returns the definition so the file can `export default defineStage(...)`.
 */
export function defineStage(def: StageDefinition): StageDefinition {
  const stage = def.build();
  const id = stage.id;

  const ja: Record<string, string> = {};
  const en: Record<string, string> = {};
  if (def.lessonModal) {
    for (const k of ["title", "learn", "goal", "first"] as const) {
      ja[`${id}.lesson.${k}`] = def.lessonModal[k].ja;
      en[`${id}.lesson.${k}`] = def.lessonModal[k].en;
    }
  }
  if (def.strings) {
    for (const [k, v] of Object.entries(def.strings.ja)) ja[`${id}.${k}`] = v;
    for (const [k, v] of Object.entries(def.strings.en)) en[`${id}.${k}`] = v;
  }
  if (Object.keys(ja).length || Object.keys(en).length) {
    registerLang({ ja, en });
  }

  if (def.diagram) diagrams.set(id, def.diagram);

  records.push({ def, stage });
  return def;
}

/**
 * All registered stage instances, sorted by mode (game before lesson) then
 * by `order`. Called from main.ts once after stage_collect runs.
 */
export function getStages(): Stage[] {
  const modeRank = (m: Mode): number => (m === "game" ? 0 : 1);
  return [...records]
    .sort((a, b) => modeRank(a.def.mode) - modeRank(b.def.mode) || a.def.order - b.def.order)
    .map((r) => r.stage);
}

/**
 * Lesson numbering derived from `order` — the single source of truth.
 * Stage files declare only the concept text in `stage.lesson`; the display
 * label `L{n}` is computed here so numbers can never duplicate or drift.
 */
export function getLessonNumbers(): Map<string, number> {
  const lessons = records
    .filter((r) => r.def.mode === "lesson")
    .sort((a, b) => a.def.order - b.def.order);
  const map = new Map<string, number>();
  lessons.forEach((r, i) => map.set(r.stage.id, i + 1));
  return map;
}

/** Lookup table: stage id → mode. Used by core/modes.ts. */
export function getStageModes(): Map<string, Mode> {
  const map = new Map<string, Mode>();
  for (const r of records) map.set(r.stage.id, r.def.mode);
  return map;
}

/** Lesson modal looks up the registered diagram by stage id. */
export function getDiagram(stageId: string): string {
  return diagrams.get(stageId) ?? "";
}
