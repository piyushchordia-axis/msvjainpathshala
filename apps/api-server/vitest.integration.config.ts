import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["workspace"],
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.integration.test.ts"],
    fileParallelism: false,
    pool: "forks",
    testTimeout: 120_000,
    hookTimeout: 180_000,
    // Container lifecycle is owned by the suite setup file.
    setupFiles: [],
    server: {
      deps: {
        external: ["pg", "pg-native", "@testcontainers/postgresql", "testcontainers"],
      },
    },
  },
});

