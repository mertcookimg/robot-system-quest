// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import listings from "./stages.generated.json";
import { registerStageLoader, type StageListing } from "./stage_def";

// Only the selected stage is imported. Build-time catalog generation and
// standalone tests still use stage_collect.ts to evaluate every manifest.
const modules = import.meta.glob("../stages/**/*.ts");
for (const listing of listings as StageListing[]) {
  const load = modules[`../stages/${listing.mode}/${listing.id}.ts`];
  if (!load) throw new Error(`No implementation for stage ${listing.id}`);
  registerStageLoader(listing, load);
}
