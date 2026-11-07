// Copyright 2026 Masato Kobayashi
// SPDX-License-Identifier: Apache-2.0

import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  // GitHub Actions sets this from the repository name. Local and other
  // deployments default to the domain root and can override it explicitly.
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [
    {
      name: "guide-runtime-boundary",
      generateBundle(_options, bundle) {
        const entry = Object.values(bundle).find(
          (item) =>
            item.type === "chunk" &&
            item.facadeModuleId?.replaceAll("\\", "/").endsWith("/guide/index.html"),
        );
        if (!entry || entry.type !== "chunk") this.error("Guide entry is missing");
        const pending = [entry.fileName];
        const seen = new Set<string>();
        while (pending.length) {
          const file = pending.pop()!;
          if (seen.has(file)) continue;
          seen.add(file);
          const chunk = bundle[file];
          if (!chunk || chunk.type !== "chunk") continue;
          for (const id of Object.keys(chunk.modules)) {
            const normalized = id.replaceAll("\\", "/");
            if (
              /\/src\/stages\//.test(normalized) ||
              /\/src\/lib\/(vla|world_model)_weights\.ts/.test(normalized)
            ) {
              this.error(`Guide must not load runtime stage code: ${normalized}`);
            }
          }
          pending.push(...chunk.imports, ...chunk.dynamicImports);
        }
      },
    },
  ],
  build: {
    rolldownOptions: {
      input: {
        game: resolve(__dirname, "index.html"),
        guide: resolve(__dirname, "guide/index.html"),
      },
      output: {
        codeSplitting: {
          // Shared drawing helpers must not drag their entire stage group into
          // Guide. Keep chunks separate for entries with different dependencies.
          groups: [
            { name: "game-stages", test: /[\\/]src[\\/]stages[\\/]game[\\/]/, entriesAware: true },
            {
              name: "lesson-stages",
              test: /[\\/]src[\\/]stages[\\/]lesson[\\/]/,
              entriesAware: true,
            },
          ],
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
