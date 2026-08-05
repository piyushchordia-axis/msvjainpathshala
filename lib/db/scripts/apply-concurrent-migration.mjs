/**
 * Apply a migration that uses CREATE/DROP INDEX CONCURRENTLY.
 * Drizzle wraps migrations in a transaction; CONCURRENTLY forbids that.
 *
 * Usage:
 *   DATABASE_URL=... node lib/db/scripts/apply-concurrent-migration.mjs 0036_perf_hot_indexes
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: node apply-concurrent-migration.mjs <tag>");
  process.exit(2);
}

const root = path.resolve(import.meta.dirname, "..");
const sqlPath = path.join(root, "migrations", `${tag}.sql`);
const journalPath = path.join(root, "migrations/meta/_journal.json");
const raw = fs.readFileSync(sqlPath, "utf8");

// Strip line comments; split on semicolons into executable statements.
const statements = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Ensure we are NOT inside an explicit transaction (default autocommit).
for (const stmt of statements) {
  console.log("\n--- applying ---\n" + stmt.slice(0, 120) + (stmt.length > 120 ? "…" : ""));
  await client.query(stmt);
  console.log("ok");
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const entry = journal.entries.find((e) => e.tag === tag);
if (!entry) {
  console.error(`Tag ${tag} missing from _journal.json — add it before recording.`);
  await client.end();
  process.exit(1);
}

const hash = crypto.createHash("sha256").update(raw).digest("hex");
await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
await client.query(`
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )
`);
const existing = await client.query(
  `SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = $1 OR created_at = $2`,
  [hash, entry.when],
);
if (!existing.rowCount) {
  await client.query(
    `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
    [hash, entry.when],
  );
  console.log("\nrecorded in drizzle.__drizzle_migrations", hash.slice(0, 12));
} else {
  console.log("\nalready recorded in drizzle.__drizzle_migrations");
}

await client.end();
console.log("\ndone", tag);
