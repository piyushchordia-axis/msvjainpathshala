/**
 * Vitest unit config — runs ONLY pure unit tests (no DB, no Redis).
 *
 * Step 23 introduced this config so `pnpm test` (called from CI's
 * `unit-tests` job) has a valid config to load. The existing
 * `vitest.integration.config.ts` continues to drive `pnpm test:integration`.
 *
 * As of v1.0 we don't ship dedicated *.unit.spec.ts files — the integration
 * suite covers controllers + services end-to-end. This config exists so the
 * `unit-tests` job exits 0 without picking up the integration specs (which
 * require Postgres + Redis and would explode if run via `pnpm test`).
 */

import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
        keepClassNames: true,
      },
    }),
  ],
  test: {
    include: ['src/**/*.unit.spec.ts'],
    exclude: ['**/__tests__/**', '**/*.integration.spec.ts'],
    environment: 'node',
    globals: false,
    passWithNoTests: true,
  },
});
