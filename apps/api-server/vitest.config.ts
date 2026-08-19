import fs from "node:fs";
import { configDefaults, defineConfig, type Plugin } from "vitest/config";

/** Match esbuild `loader: { ".ttf": "binary" }` so the same import works under vitest. */
function ttfBinaryPlugin(): Plugin {
  return {
    name: "ttf-binary",
    enforce: "pre",
    load(id) {
      const clean = id.split("?")[0] ?? id;
      if (!clean.endsWith(".ttf")) return null;
      const b64 = fs.readFileSync(clean).toString("base64");
      return `export default new Uint8Array(Buffer.from(${JSON.stringify(b64)}, "base64"));`;
    },
  };
}

export default defineConfig({
  plugins: [ttfBinaryPlugin()],
  resolve: {
    // Match tsconfig.base customConditions so @workspace/* resolves to ./src/*.ts
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    /**
     * The integration suite has its OWN config (vitest.integration.config.ts):
     * 120s/180s timeouts, no setup file, and pg/testcontainers externalised
     * because it starts real Docker containers. But those files are named
     * `*.integration.test.ts`, so the include glob above swallowed them and
     * `pnpm run test` ran them under these settings instead — a 20s testTimeout
     * against container startup, with testcontainers bundled rather than
     * external. Run them with `pnpm run test:integration`.
     */
    exclude: [...configDefaults.exclude, "test/integration/**"],
    // Single global pg pool — run files serially to avoid data races.
    fileParallelism: false,
    pool: "forks",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
