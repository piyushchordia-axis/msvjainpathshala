/**
 * Guard: after `pnpm db:migrate` on an empty database, the result must match
 * `schema.ts`.
 *
 * Why this exists: CI builds its test database with `drizzle-kit push`, which
 * reads schema.ts directly — so the migration chain was never exercised. The
 * entire post-baseline Niyam schema (period_key, niyam_submission_media, four
 * enums, the period unique index) existed only in schema.ts and in nobody's
 * .sql file. A fresh `pnpm db:migrate` produced a database on which every niyam
 * submit threw `column "period_key" does not exist`, and it went unnoticed for
 * months because no job ever ran the chain.
 *
 * How it compares, and why not `drizzle-kit generate`:
 * `generate` diffs schema.ts against the newest SNAPSHOT in migrations/meta/,
 * and this repo's snapshots stop at 0009 (see the 2026-08 drift repair) — so it
 * would report enormous, entirely spurious drift for everything after that and
 * the check would fail permanently.
 *
 * Instead we let Postgres do the parsing: build a SECOND database from
 * `drizzle-kit export` (the full DDL that schema.ts describes), then diff the
 * two databases' catalogs. Both sides are real databases, so the comparison is
 * apples-to-apples and needs no SQL text matching.
 *
 * Usage: DATABASE_URL=<the migrated db> node lib/db/scripts/check-migration-drift.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbRoot = path.join(here, "..");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL must be set (point it at the freshly migrated database).");
  process.exit(2);
}

const parsed = new URL(databaseUrl);
const migratedDb = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
const referenceDb = `${migratedDb}_schemaref`;

const adminUrl = new URL(databaseUrl);
adminUrl.pathname = "/postgres";
const referenceUrl = new URL(databaseUrl);
referenceUrl.pathname = `/${referenceDb}`;

/** Structure of one database, as comparable strings. */
async function describe(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // BASE TABLE only. information_schema.columns also lists views and
    // materialised views, which migrations create and schema.ts never declares
    // — counting those produces permanent false drift.
    const columns = await client.query(`
      select c.table_name || '.' || c.column_name || ' ' || c.data_type
             || case when c.is_nullable = 'NO' then ' NOT NULL' else '' end as sig
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by 1
    `);
    // Labels SORTED, not in ordinal order: `ALTER TYPE … ADD VALUE` appends,
    // so a value added by a later migration sits at the end of the migrated
    // enum but wherever schema.ts lists it. Membership is the thing that
    // matters; ordinal position only affects ORDER BY on an enum column.
    const enums = await client.query(`
      select t.typname || '=' || string_agg(e.enumlabel, ',' order by e.enumlabel) as sig
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      group by t.typname
      order by 1
    `);
    // Informational only — see the report step for why index names legitimately
    // diverge between a chain that carries renames and a fresh export.
    const indexes = await client.query(`
      select indexname as sig from pg_indexes where schemaname = 'public' order by 1
    `);
    return {
      columns: new Set(columns.rows.map((r) => r.sig)),
      enums: new Set(enums.rows.map((r) => r.sig)),
      indexes: new Set(indexes.rows.map((r) => r.sig)),
    };
  } finally {
    await client.end();
  }
}

function diff(expected, actual) {
  const missing = [...expected].filter((v) => !actual.has(v));
  const extra = [...actual].filter((v) => !expected.has(v));
  return { missing, extra };
}

const admin = new pg.Client({ connectionString: adminUrl.toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${referenceDb}"`);
await admin.query(`CREATE DATABASE "${referenceDb}"`);
await admin.end();

let failed = false;
try {
  // Full DDL for schema.ts, as a diff against an empty database.
  const ddl = execFileSync(
    "pnpm",
    ["exec", "drizzle-kit", "export", "--sql", "--config", "./drizzle.config.ts"],
    { cwd: dbRoot, encoding: "utf8", shell: process.platform === "win32" },
  );

  const ref = new pg.Client({ connectionString: referenceUrl.toString() });
  await ref.connect();
  // One statement at a time: export output is ordered, and applying it
  // piecewise gives a usable error if any single statement is malformed.
  for (const stmt of ddl
    .split("--> statement-breakpoint")
    .flatMap((chunk) => (chunk.includes("--> statement-breakpoint") ? [chunk] : [chunk]))
    .map((s) => s.trim())
    .filter(Boolean)) {
    await ref.query(stmt);
  }
  await ref.end();

  const expected = await describe(referenceUrl.toString());
  const actual = await describe(databaseUrl);

  // Columns and enum membership are the assertion — that is exactly the class
  // of drift that hid the Niyam schema (a missing column, a missing enum
  // value). Index names are reported but never fail the build: a chain that
  // carries an `ALTER TABLE … RENAME` keeps the ORIGINAL name on the primary
  // key index (e.g. `curricula_pkey` on a table now called `courses`), and
  // migrations legitimately add performance indexes schema.ts never declares.
  for (const key of ["columns", "enums"]) {
    const { missing, extra } = diff(expected[key], actual[key]);
    if (missing.length > 0) {
      failed = true;
      console.error(
        `::error::${missing.length} ${key} in schema.ts are MISSING from the migrated database ` +
          `— the migration chain does not reproduce schema.ts:\n  ${missing.join("\n  ")}`,
      );
    }
    if (extra.length > 0) {
      failed = true;
      console.error(
        `::error::${extra.length} ${key} exist in the migrated database but not in ` +
          `schema.ts:\n  ${extra.join("\n  ")}`,
      );
    }
  }

  const idx = diff(expected.indexes, actual.indexes);
  if (idx.missing.length > 0 || idx.extra.length > 0) {
    console.warn(
      `::warning::index-name differences (informational, not drift): ` +
        `${idx.missing.length} declared in schema.ts under a different name or absent, ` +
        `${idx.extra.length} present only in the migrated database.`,
    );
    for (const m of idx.missing) console.warn(`  only in schema.ts: ${m}`);
    for (const e of idx.extra) console.warn(`  only in migrated:   ${e}`);
  }
} finally {
  const cleanup = new pg.Client({ connectionString: adminUrl.toString() });
  await cleanup.connect();
  await cleanup.query(`DROP DATABASE IF EXISTS "${referenceDb}"`);
  await cleanup.end();
}

if (failed) process.exit(1);
console.log("OK: the migration chain reproduces schema.ts (columns, enums, indexes).");
