/**
 * Guard: every .sql in lib/db/migrations must be registered in
 * meta/_journal.json, and every journal entry must have a file.
 *
 * Why this exists: `0043_per_batch_rate_functions.sql` sat on disk for months
 * without a journal entry (two migrations were both numbered 0043), so
 * `drizzle-kit migrate` silently skipped it. The AT5 per-batch rate functions
 * it defines — which lib/attendance-rate.ts and lib/homework-completion-rate.ts
 * call at runtime — therefore did not exist on any freshly migrated database.
 *
 * An unregistered file is invisible: nothing errors, the DDL just never runs.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "migrations");
const journalPath = path.join(migrationsDir, "meta", "_journal.json");

const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
const tags = journal.entries.map((e) => e.tag);
const tagSet = new Set(tags);

const files = fs
  .readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.slice(0, -".sql".length));
const fileSet = new Set(files);

const orphanFiles = files.filter((f) => !tagSet.has(f)).sort();
const missingFiles = tags.filter((t) => !fileSet.has(t)).sort();
const duplicateTags = tags.filter((t, i) => tags.indexOf(t) !== i);

let failed = false;

if (orphanFiles.length > 0) {
  failed = true;
  console.error(
    `::error::${orphanFiles.length} migration file(s) are NOT in meta/_journal.json ` +
      `and will never be applied:\n  ${orphanFiles.join("\n  ")}`,
  );
}
if (missingFiles.length > 0) {
  failed = true;
  console.error(
    `::error::${missingFiles.length} journal entr(ies) have no .sql file:\n  ${missingFiles.join("\n  ")}`,
  );
}
if (duplicateTags.length > 0) {
  failed = true;
  console.error(`::error::duplicate journal tags: ${[...new Set(duplicateTags)].join(", ")}`);
}

if (failed) process.exit(1);
console.log(`OK: ${files.length} migration files, all registered in the journal.`);
