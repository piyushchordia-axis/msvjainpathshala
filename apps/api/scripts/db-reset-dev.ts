/**
 * Dev-only: wipe public + drizzle schemas, re-apply migrations, run full seed stack.
 *
 *   pnpm --filter @jp/api db:reset:dev
 */

import { execSync } from 'node:child_process';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const sql = postgres(url, { max: 1, prepare: false });

async function main(): Promise<void> {
  console.info('[db:reset:dev] dropping schemas public + drizzle…');
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    GRANT ALL ON SCHEMA public TO public;
    DROP SCHEMA IF EXISTS drizzle CASCADE;
  `);
  await sql.end({ timeout: 5 });

  const root = pathToRepoRoot();
  console.info('[db:reset:dev] applying migrations…');
  execSync('pnpm db:migrate', { cwd: root, stdio: 'inherit' });

  console.info('[db:reset:dev] seeding (base → demo → extra)…');
  execSync('pnpm db:seed:full', { cwd: root, stdio: 'inherit' });

  console.info('[db:reset:dev] done.');
}

function pathToRepoRoot(): string {
  // apps/api/scripts → repo root
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

main().catch((err) => {
  console.error('[db:reset:dev] FAILED', err);
  process.exit(1);
});
