/**
 * Apply journal migrations not yet in drizzle.__drizzle_migrations.
 *   pnpm --filter @workspace/api-server exec node scripts/apply-pending-migrations.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const envPath = path.join(root, ".env");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = /^\s*([^#=]+)=(.*)$/.exec(line);
  if (m) process.env[m[1].trim()] ??= m[2].trim();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required");

const migrationsDir = path.join(root, "lib/db/migrations");
const journal = JSON.parse(
  fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
console.log("Connected:", databaseUrl.replace(/:[^:@/]+@/, ":***@"));

await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
await client.query(`
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

const applied = await client.query(`select hash from drizzle.__drizzle_migrations`);
const appliedSet = new Set(applied.rows.map((r) => r.hash));

for (const entry of journal.entries) {
  const tag = entry.tag;
  if (appliedSet.has(tag)) {
    console.log(`skip ${tag}`);
    continue;
  }
  const sqlPath = path.join(migrationsDir, `${tag}.sql`);
  const sql = fs.readFileSync(sqlPath, "utf8");
  const parts = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  console.log(`apply ${tag} (${parts.length} statements)`);
  await client.query("BEGIN");
  try {
    for (const stmt of parts) {
      await client.query(stmt);
    }
    await client.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [tag, entry.when ?? Date.now()],
    );
    await client.query("COMMIT");
    console.log(`  ok ${tag}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`  FAIL ${tag}:`, err.message);
    process.exitCode = 1;
    break;
  }
}

await client.end();
