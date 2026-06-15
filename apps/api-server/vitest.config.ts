import { defineConfig } from "vitest/config";

export default defineConfig({
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
