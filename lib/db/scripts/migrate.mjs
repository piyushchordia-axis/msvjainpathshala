/**
 * Canonical migration runner.
 *
 * Replaces plain `drizzle-kit migrate` as `pnpm db:migrate`, because
 * drizzle-kit wraps EVERY migration in a transaction and three files
 * (0036 / 0037 / 0038) use CREATE/DROP INDEX CONCURRENTLY, which Postgres
 * forbids inside one. The result was that `pnpm db:migrate` — the command
 * CLAUDE.md documents as the deploy path — could never build a fresh database:
 * it failed at 0036 and rolled the entire chain back, leaving zero tables.
 * drizzle-kit also swallows the error output on Windows, so it failed silently.
 *
 * Behaviour:
 *  - applies journal entries in order, skipping any already recorded;
 *  - records the SHA256 of the file in drizzle.__drizzle_migrations, the same
 *    convention drizzle-kit and apply-concurrent-migration.mjs use, so this
 *    runner and drizzle-kit stay interchangeable on an existing database;
 *  - runs a normal migration inside BEGIN/COMMIT (all-or-nothing);
 *  - runs a CONCURRENTLY migration statement-by-statement in autocommit, which
 *    is the only way Postgres will accept it.
 *
 * Usage: DATABASE_URL=... node lib/db/scripts/migrate.mjs
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL must be set.");
  process.exit(2);
}

/**
 * Split a CONCURRENTLY migration into single statements.
 *
 * Prefers drizzle's explicit breakpoint marker. Falls back to splitting on
 * semicolons — safe only because these files are index DDL; a dollar-quoted
 * body would be shredded by that, so refuse rather than corrupt the database.
 */
function splitConcurrent(raw, tag) {
  if (raw.includes("--> statement-breakpoint")) {
    return raw
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (raw.includes("$$")) {
    throw new Error(
      `${tag} mixes CONCURRENTLY with a dollar-quoted body and has no ` +
        `statement-breakpoint markers — add them before this can be applied.`,
    );
  }
  return raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
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

const appliedRows = await client.query(`select hash, created_at from drizzle.__drizzle_migrations`);
const appliedHashes = new Set(appliedRows.rows.map((r) => r.hash));
const appliedWhen = new Set(appliedRows.rows.map((r) => String(r.created_at)));

let applied = 0;
let skipped = 0;

try {
  for (const entry of journal.entries) {
    const tag = entry.tag;
    const sqlPath = path.join(migrationsDir, `${tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`journal names ${tag} but ${tag}.sql does not exist`);
    }
    const raw = fs.readFileSync(sqlPath, "utf8");
    const hash = crypto.createHash("sha256").update(raw).digest("hex");

    // `created_at` is checked too: apply-concurrent-migration.mjs records by
    // (hash OR when), and some rows predate the hash convention.
    if (appliedHashes.has(hash) || appliedWhen.has(String(entry.when))) {
      skipped += 1;
      continue;
    }

    const concurrent = /\bCONCURRENTLY\b/i.test(raw);
    const statements = concurrent
      ? splitConcurrent(raw, tag)
      : raw
          .split("--> statement-breakpoint")
          .map((s) => s.trim())
          .filter(Boolean);

    process.stdout.write(
      `apply ${tag} (${statements.length} stmt${statements.length === 1 ? "" : "s"}` +
        `${concurrent ? ", autocommit" : ""}) … `,
    );

    if (concurrent) {
      // No transaction: CONCURRENTLY forbids one. A failure here can leave the
      // file half-applied, which is why every statement is IF NOT EXISTS.
      for (const stmt of statements) await client.query(stmt);
      await client.query(
        `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
        [hash, entry.when ?? Date.now()],
      );
    } else {
      await client.query("BEGIN");
      try {
        for (const stmt of statements) await client.query(stmt);
        await client.query(
          `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
          [hash, entry.when ?? Date.now()],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    console.log("ok");
    applied += 1;
  }
} catch (err) {
  console.error("\nMIGRATION FAILED:", err.message);
  await client.end();
  process.exit(1);
}

await client.end();
console.log(`\ndone — ${applied} applied, ${skipped} already present.`);
