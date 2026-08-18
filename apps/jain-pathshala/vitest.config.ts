import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Unit tests for the web app's pure logic — URL shaping, draft/published
 * comparison, upload result mapping. Node environment on purpose: these are the
 * functions that were wrong, and none of them needs a DOM.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
