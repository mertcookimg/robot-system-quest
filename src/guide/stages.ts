// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import catalog from "./stages.generated.json";
import { getLang } from "../i18n";
import type { StageMeta } from "../types";

// Generated from the executable manifests by npm run gen:guide. This module
// intentionally has no imports of stage factories, controllers or model weights.
interface GuideEntry {
  id: string;
  mode: "game" | "lesson";
  lessonNumber?: number;
  diagram: string;
  ja: StageMeta;
  en: StageMeta;
}
const entries = catalog as GuideEntry[];
const stages: StageMeta[] = entries.map((entry) => ({
  id: entry.id,
  get name() {
    return entry[getLang()].name;
  },
  get lesson() {
    return entry[getLang()].lesson;
  },
  get lessonCmd() {
    return entry[getLang()].lessonCmd;
  },
  get ros2() {
    return entry[getLang()].ros2;
  },
}));

export const getStages = (): StageMeta[] => stages;
export const getStageModes = (): Map<string, "game" | "lesson"> =>
  new Map(entries.map((entry) => [entry.id, entry.mode]));
export const getLessonNumbers = (): Map<string, number> =>
  new Map(
    entries
      .filter((entry) => entry.lessonNumber !== undefined)
      .map((entry) => [entry.id, entry.lessonNumber!]),
  );
export const getDiagram = (id: string): string =>
  entries.find((entry) => entry.id === id)?.diagram ?? "";
