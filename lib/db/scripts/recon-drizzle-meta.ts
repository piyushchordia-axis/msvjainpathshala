import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL ?? "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala",
});
await c.connect();
const schemas = await c.query(
  `SELECT schema_name FROM information_schema.schemata ORDER BY 1`,
);
console.log("schemas", schemas.rows.map((r) => r.schema_name));
for (const schema of ["drizzle", "public"]) {
  try {
    const t = await c.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema=$1`,
      [schema],
    );
    console.log(schema, "tables", t.rows.map((r) => r.table_name));
  } catch (e) {
    console.log(schema, (e as Error).message);
  }
}
try {
  const r = await c.query(`SELECT * FROM drizzle.__drizzle_migrations ORDER BY id`);
  console.log("drizzle.__drizzle_migrations", r.rows);
} catch (e) {
  console.log("drizzle meta err", (e as Error).message);
}
try {
  const r = await c.query(`SELECT * FROM public.__drizzle_migrations ORDER BY id`);
  console.log("public.__drizzle_migrations", r.rows);
} catch (e) {
  console.log("public meta err", (e as Error).message);
}
await c.end();
