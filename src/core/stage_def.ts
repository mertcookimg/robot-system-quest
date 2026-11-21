// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Stage manifest helper. Each stage file calls `defineStage(...)` once to
// register itself with the runtime: i18n strings, lesson modal content, and
// the SVG diagram are declared in the manifest, while the stage's runtime
// methods come from the existing `make*()` factory passed as `build`.
//
// stage_catalog.ts registers lightweight menu handles; each selected module
// fills its handle when defineStage() runs. stage_collect.ts evaluates all
// manifests for catalog generation and standalone tests.

import type { Stage } from "../types";
import { getLang, registerLang } from "../i18n";

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
  def: Pick<StageDefinition, "mode" | "order">;
  stage: Stage;
  setImplementation?: (stage: Stage) => void;
  prepare?: () => Promise<void> | undefined;
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

  const existing = records.find((record) => record.stage.id === id);
  if (existing?.setImplementation) {
    // Keep the generated ordering stable as individual modules arrive.
    existing.setImplementation(stage);
  } else {
    records.push({ def, stage });
  }
  return def;
}

/** Lightweight menu data; executable manifests remain the source of truth. */
export interface StageListing {
  id: string;
  mode: Mode;
  order: number;
  ja: { name: string; lesson: string };
  en: { name: string; lesson: string };
}

/** Register a stable stage handle without evaluating its implementation. */
export function registerStageLoader(listing: StageListing, load: () => Promise<unknown>): void {
  let implementation: Stage | undefined;
  let pending: Promise<void> | undefined;
  const stage: Stage = {
    id: listing.id,
    get name() {
      return implementation?.name ?? listing[getLang()].name;
    },
    get lesson() {
      return implementation?.lesson ?? listing[getLang()].lesson;
    },
    get lessonCmd() {
      return implementation?.lessonCmd ?? "";
    },
    get ros2() {
      return implementation?.ros2;
    },
    init(context) {
      if (!implementation) throw new Error(`Stage ${listing.id} has not loaded`);
      implementation.init(context);
    },
    update(dt) {
      implementation?.update(dt);
    },
    draw() {
      implementation?.draw();
    },
    reset() {
      implementation?.reset();
    },
    dispose() {
      implementation?.dispose();
    },
  };
  records.push({
    def: listing,
    stage,
    setImplementation(value) {
      implementation = value;
    },
    prepare() {
      if (implementation) return;
      pending ??= load()
        .then(() => {
          if (!implementation) throw new Error(`Stage ${listing.id} did not register`);
        })
        .catch((error: unknown) => {
          pending = undefined;
          throw error;
        });
      return pending;
    },
  });
}

/** Already loaded stages and standalone test stages need no asynchronous work. */
export function prepareStage(stage: Stage): Promise<void> | undefined {
  return records.find((record) => record.stage === stage)?.prepare?.();
}

/**
 * All registered stage instances, sorted by mode (game before lesson) then
 * by `order`. Both eager registration and lazy catalog handles use this order.
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
