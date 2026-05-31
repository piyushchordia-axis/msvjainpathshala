/**
 * Vitest integration config — tests boot a real NestJS app against a real
 * Postgres + Redis.
 *
 * In CI / the user's prod-mirror environment, `JP_TEST_DB_URL` and
 * `JP_TEST_REDIS_URL` point to a Testcontainers-managed pair (a globalSetup
 * file would spin them up). When unset (local dev), the tests target the
 * same localhost services the API uses. Each test uses a unique
 * phone-number suffix so two test runs never collide.
 *
 * Single-threaded by `pool: 'forks' + singleFork` because the app boots
 * once per file and tests share the boot.
 */

import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  // unplugin-swc preserves NestJS decorator metadata that vitest's default
  // esbuild transform strips — without it, every Nest DI injection becomes
  // undefined. Same fix as the dev runner (@swc-node/register).
  // Module type 'es6' so vitest's ESM-only `vitest` import resolves.
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
    include: ['src/**/__tests__/**/*.integration.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    sequence: { concurrent: false },
    env: {
      // Defaults match the dev API's connection strings — overridable in CI.
      DATABASE_URL: process.env.JP_TEST_DB_URL ?? 'postgres://sumit@localhost:5432/jainpathshala',
      REDIS_URL: process.env.JP_TEST_REDIS_URL ?? 'redis://localhost:6379',
      REDIS_TLS: 'false',
      REDIS_KEY_PREFIX: 'jp:test:',
      NODE_ENV: 'development',
      LOG_LEVEL: 'error',
      JWT_ISSUER: 'jainpathshala.test',
      JWT_AUDIENCE: 'jp.api',
      STORAGE_DRIVER: 'noop',
    },
  },
});
