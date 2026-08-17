/**
 * Apply 0067_homework_bilingual.sql against DATABASE_URL from the repo-root .env.
 * The generic apply-pending-migrations script keys on tag strings, but this
 * database's drizzle.__drizzle_migrations.hash column stores file hashes from
 * drizzle-kit, so it would try to replay 0000_baseline.
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

const sqlPath = path.join(root, "lib/db/migrations/0067_homework_bilingual.sql");
const sql = fs.readFileSync(sqlPath, "utf8");
const tag = "0067_homework_bilingual";
const when = 1791542400000;

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
console.log("Connected:", databaseUrl.replace(/:[^:@/]+@/, ":***@"));

const cols = await client.query(`
  select column_name
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'homework_assignments'
    and column_name in ('title', 'title_hi', 'description', 'description_hi')
  order by column_name
`);
console.log("homework_assignments columns before:", cols.rows.map((r) => r.column_name));

await client.query("BEGIN");
try {
  await client.query(sql);
  const already = await client.query(
    `select 1 from drizzle.__drizzle_migrations where hash = $1`,
    [tag],
  );
  if (already.rowCount === 0) {
    await client.query(
      `insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)`,
      [tag, when],
    );
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  console.error("FAIL:", err.message);
  process.exitCode = 1;
  await client.end();
  process.exit(process.exitCode);
}

const after = await client.query(`
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'homework_assignments'
    and column_name in ('title', 'title_hi', 'description', 'description_hi')
  order by column_name
`);
console.log("homework_assignments columns after:");
for (const r of after.rows) {
  console.log(`  ${r.column_name} ${r.data_type} nullable=${r.is_nullable}`);
}

await client.end();
console.log("ok", tag);
