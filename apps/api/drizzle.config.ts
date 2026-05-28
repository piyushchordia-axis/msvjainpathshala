/**
 * Drizzle Kit config (used by `pnpm db:generate` and `pnpm db:studio`).
 *
 * Step 3 lands an empty `src/db/schema/` and `src/db/migrations/`. Step 4
 * populates them with the full Section 5 schema. The migration runner
 * (`src/db/migrate.ts`) reads from the same `out` folder under an
 * advisory lock (SPEC §18.7).
 */

import type { Config } from 'drizzle-kit';

// Run via `pnpm db:generate` / `pnpm db:migrate` which set DATABASE_URL from
// .env.development through tsx's --env-file flag. CI / prod set it via real env.
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    '[drizzle.config] DATABASE_URL is required — set it in apps/api/.env.development or your shell',
  );
}

export default {
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
} satisfies Config;
