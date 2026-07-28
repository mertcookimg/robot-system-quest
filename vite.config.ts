// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // GitHub Actions sets this from the repository name. Local and other
  // deployments default to the domain root and can override it explicitly.
  base: process.env.VITE_BASE_PATH || "/",
  build: {
    rollupOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        guide: resolve(__dirname, "guide/index.html"),
      },
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (normalized.includes("/src/stages/game/")) return "game-stages";
          if (normalized.includes("/src/stages/lesson/")) return "lesson-stages";
        },
      },
    },
  },
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    // Prefer .ts when both .ts and .js files share the same name.
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
});
