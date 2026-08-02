/**
 * Mark migrations 0000–0007 as already applied so `drizzle-kit migrate` can
 * run 0008+ against a DB that was provisioned via push/seed (empty journal).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
const journal = JSON.parse(
  fs.readFileSync(path.join(root, "migrations/meta/_journal.json"), "utf8"),
) as { entries: Array<{ idx: number; when: number; tag: string }> };

const throughIdx = Number(process.argv[2] ?? "7");
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala",
});
await c.connect();
await c.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
await c.query(`
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);

for (const entry of journal.entries) {
  if (entry.idx > throughIdx) continue;
  const sqlPath = path.join(root, "migrations", `${entry.tag}.sql`);
  const query = fs.readFileSync(sqlPath, "utf8");
  const hash = crypto.createHash("sha256").update(query).digest("hex");
  const existing = await c.query(
    `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 OR created_at = $2`,
    [hash, entry.when],
  );
  if (existing.rowCount) {
    console.log("skip", entry.tag);
    continue;
  }
  await c.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, entry.when],
  );
  console.log("baselined", entry.tag, hash.slice(0, 12));
}

const rows = await c.query(
  `SELECT id, created_at, left(hash,12) AS h FROM drizzle.__drizzle_migrations ORDER BY created_at`,
);
console.log("now", rows.rows);
await c.end();
