// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

// Auto-collect every stage in src/stages/ via Vite's `import.meta.glob`.
// Importing this module triggers the eager glob, which runs each stage
// file's top-level code, which in turn calls `defineStage(...)` to register
// itself with the runtime registry.

const modules = import.meta.glob("../stages/**/*.ts", { eager: true });

// Touch the result to avoid tree-shaking the imports out.
export const STAGE_MODULE_COUNT = Object.keys(modules).length;
