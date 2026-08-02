/**
 * Apply 0017 to an existing local DB that may already have 0000–0011 applied
 * outside drizzle.__drizzle_migrations tracking.
 *
 *   pnpm --filter @workspace/api-server exec node scripts/apply-0017-local.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const m = /^\s*([^#=]+)=(.*)$/.exec(line);
  if (m) process.env[m[1].trim()] ??= m[2].trim();
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
console.log("Connected:", process.env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@"));

// 0012 prereq columns the function/MV bodies reference
await client.query(`ALTER TABLE students ADD COLUMN IF NOT EXISTS deactivated_at timestamptz`);

const sql = fs.readFileSync(
  path.join(root, "lib/db/migrations/0017_derived_attendance_fix.sql"),
  "utf8",
);
const parts = sql
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter(Boolean);

await client.query("BEGIN");
try {
  for (const [i, stmt] of parts.entries()) {
    await client.query(stmt);
    console.log(`ok ${i + 1}/${parts.length}`);
  }
  await client.query("COMMIT");
  const check = await client.query(`
    select to_regclass('public.monthly_leaderboard_snapshots') as snapshots,
           to_regclass('public.mv_monthly_leaderboard_city') as old_mv,
           to_regclass('public.mv_centre_engagement') as centre_mv
  `);
  console.log(check.rows[0]);
  console.log("0017 applied to local");
} catch (err) {
  await client.query("ROLLBACK");
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
