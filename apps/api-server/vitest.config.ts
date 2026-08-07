import fs from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

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
    // Single global pg pool — run files serially to avoid data races.
    fileParallelism: false,
    pool: "forks",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
