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
      name: "stage-runtime-boundaries",
      generateBundle(_options, bundle) {
        for (const [entryPath, includeDynamic] of [
          ["/guide/index.html", true],
          ["/index.html", false],
        ] as const) {
          const entry = Object.values(bundle).find(
            (item) =>
              item.type === "chunk" &&
              item.facadeModuleId?.replaceAll("\\", "/") ===
                resolve(__dirname, `.${entryPath}`).replaceAll("\\", "/"),
          );
          if (!entry || entry.type !== "chunk") this.error(`Entry is missing: ${entryPath}`);
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
                this.error(`${entryPath} must not eagerly load runtime stage code: ${normalized}`);
              }
            }
            pending.push(...chunk.imports);
            if (includeDynamic) pending.push(...chunk.dynamicImports);
          }
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
