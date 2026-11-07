// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0
import type { Demonstration } from "./imitation_model";

export const IMITATION_SOURCES = ["manual", "recovery"] as const;
export type ImitationSource = (typeof IMITATION_SOURCES)[number];
export type ImitationCounts = Record<ImitationSource, number>;
export type ImitationSelection = Record<ImitationSource, boolean>;
export type CategorizedDemonstration = Demonstration & { source: ImitationSource };
export const MAX_SAMPLES_PER_CATEGORY = 100;
export const emptyImitationCounts = (): ImitationCounts => ({ manual: 0, recovery: 0 });
export const defaultImitationSelection = (): ImitationSelection => ({
  manual: true,
  recovery: false,
});

export function countImitationData(samples: readonly CategorizedDemonstration[]): ImitationCounts {
  const counts = emptyImitationCounts();
  samples.forEach((s) => counts[s.source]++);
  return counts;
}

/** Summarize only the retained manual records, including moments with no steering input. */
export function countManualActions(samples: readonly CategorizedDemonstration[]): {
  up: number;
  neutral: number;
  down: number;
} {
  const counts = { up: 0, neutral: 0, down: 0 };
  for (const sample of samples) {
    if (sample.source !== "manual") continue;
    if (sample.action < 0) counts.up++;
    else if (sample.action === 0) counts.neutral++;
    else if (sample.action > 0) counts.down++;
  }
  return counts;
}

export function appendCategoryData(
  samples: readonly CategorizedDemonstration[],
  incoming: readonly Demonstration[],
  source: ImitationSource,
): CategorizedDemonstration[] {
  if (!incoming.length) return [...samples];
  // A generated batch covers the whole demonstration, including early recoveries.
  // Streaming manual samples retain the newest 100 without displacing other categories.
  const batch =
    source !== "manual" && incoming.length > MAX_SAMPLES_PER_CATEGORY
      ? Array.from(
          { length: MAX_SAMPLES_PER_CATEGORY },
          (_, i) =>
            incoming[Math.floor((i * (incoming.length - 1)) / (MAX_SAMPLES_PER_CATEGORY - 1))],
        )
      : incoming;
  const category = [
    ...samples.filter((s) => s.source === source),
    ...batch.map((s) => ({
      observation: [...s.observation] as Demonstration["observation"],
      action: s.action,
      source,
    })),
  ].slice(-MAX_SAMPLES_PER_CATEGORY);
  return [...samples.filter((s) => s.source !== source), ...category];
}

export function selectImitationData(
  samples: readonly CategorizedDemonstration[],
  selection: ImitationSelection,
): CategorizedDemonstration[] {
  return samples.filter((s) => selection[s.source]);
}

export function imitationTrainingKey(
  counts: ImitationCounts,
  versions: ImitationCounts,
  selection: ImitationSelection,
): string {
  return IMITATION_SOURCES.filter((source) => selection[source] && counts[source] > 0)
    .map((source) => `${source}:${versions[source]}`)
    .join("|");
}

/** Compare the selected category snapshots used by two completed fits. */
export function changedImitationSources(
  beforeCounts: ImitationCounts,
  beforeVersions: ImitationCounts,
  afterCounts: ImitationCounts,
  afterVersions: ImitationCounts,
): ImitationSource[] {
  return IMITATION_SOURCES.filter(
    (source) =>
      beforeCounts[source] !== afterCounts[source] ||
      (beforeCounts[source] > 0 &&
        afterCounts[source] > 0 &&
        beforeVersions[source] !== afterVersions[source]),
  );
}
