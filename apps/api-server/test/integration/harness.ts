/**
 * Testcontainers Postgres harness for attendance mark integration tests.
 * Applies all drizzle SQL migrations, then seeds a minimal graph.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ulid } from "../../src/lib/ulid";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../../../lib/db/migrations");

export interface Harness {
  container: StartedPostgreSqlContainer;
  pool: pg.Pool;
  databaseUrl: string;
  /** Seeded fixtures */
  fixtures: Fixtures;
}

export interface Fixtures {
  userId: string;
  centreId: string;
  cityId: string;
  batchId: string;
  sessionId: string;
  scheduledDate: string;
  studentIds: string[];
  attendancePoints: number;
}

let harness: Harness | null = null;

async function applyMigrations(client: pg.Client): Promise<void> {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
  ) as { entries: Array<{ tag: string }> };

  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsDir, `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, "utf8");
    const parts = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await client.query("BEGIN");
    try {
      for (const stmt of parts) {
        await client.query(stmt);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${entry.tag} failed: ${(e as Error).message}`);
    }
  }
}

async function seedFixtures(pool: pg.Pool): Promise<Fixtures> {
  const client = await pool.connect();
  try {
    const attendancePoints = 10;
    const scheduledDate = "2026-03-15";

    const state = await client.query(
      `insert into states (name, code) values ('Test State', 'TS') returning id`,
    );
    const stateId = state.rows[0].id as string;
    const city = await client.query(
      `insert into cities (state_id, name, code) values ($1, 'Test City', 'TC') returning id`,
      [stateId],
    );
    const cityId = city.rows[0].id as string;

    const user = await client.query(
      `insert into users (phone, role, full_name, preferred_language, is_active, state_id, city_id)
       values ('+919900000001', 'shikshak', 'Test Guruji', 'en', true, $1, $2) returning id`,
      [stateId, cityId],
    );
    const userId = user.rows[0].id as string;

    const centre = await client.query(
      `insert into centres (state_id, city_id, name, status, gps_radius_meters)
       values ($1, $2, 'Test Centre', 'active', 250) returning id`,
      [stateId, cityId],
    );
    const centreId = centre.rows[0].id as string;

    // Baseline schema still has singular age_group (array migration lives in TS only).
    const batch = await client.query(
      `insert into batches (centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
       values ($1, 'Test Batch', 'bal', '{0}', '10:00', '11:00', 40, 'active') returning id`,
      [centreId],
    );
    const batchId = batch.rows[0].id as string;

    await client.query(
      `insert into punya_features (key, label, min_points, max_points, is_active)
       values ('attendance', 'Attendance', $1, $1, true)`,
      [attendancePoints],
    );
    await client.query(
      `insert into punya_configs (feature_key, points, city_id, is_active)
       values ('attendance', $1, null, true)`,
      [attendancePoints],
    );

    const studentIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      const code = `T${String(i + 1).padStart(4, "0")}`;
      const r = await client.query(
        `insert into students (student_code, full_name, age_group, centre_id, batch_id, status)
         values ($1, $2, 'bal', $3, $4, 'active') returning id`,
        [code, `Student ${i + 1}`, centreId, batchId],
      );
      studentIds.push(r.rows[0].id as string);
      await client.query(
        `insert into punya_balances (student_id, total_points, tier) values ($1, 0, 'jigyasu')`,
        [r.rows[0].id],
      );
    }

    const session = await client.query(
      `insert into sessions (batch_id, scheduled_date, status, topic)
       values ($1, $2::date, 'scheduled', 'Integration') returning id`,
      [batchId, scheduledDate],
    );

    return {
      userId,
      centreId,
      cityId,
      batchId,
      sessionId: session.rows[0].id as string,
      scheduledDate,
      studentIds,
      attendancePoints,
    };
  } finally {
    client.release();
  }
}

export async function startHarness(): Promise<Harness> {
  if (harness) return harness;

  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("jainpathshala_test")
    .withUsername("jp")
    .withPassword("jp_test")
    .start();

  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = "test";
  process.env.JP_AUTH_SECRET ??= "jp-dev-secret-do-not-use-in-production";
  process.env.LOG_LEVEL = "silent";

  const boot = new pg.Client({ connectionString: databaseUrl });
  await boot.connect();
  await applyMigrations(boot);
  await boot.end();

  const pool = new pg.Pool({ connectionString: databaseUrl });
  const fixtures = await seedFixtures(pool);

  harness = { container, pool, databaseUrl, fixtures };
  return harness;
}

export async function stopHarness(): Promise<void> {
  if (!harness) return;
  try {
    const { pool: dbPool } = await import("@workspace/db");
    await dbPool.end();
  } catch {
    /* already closed */
  }
  await harness.pool.end();
  await harness.container.stop();
  harness = null;
}

export function markedAtOnSessionDay(scheduledDate: string, hour = 10): string {
  // scheduledDate is a Kolkata calendar day; emit an ISO instant on that day IST.
  return `${scheduledDate}T${String(hour).padStart(2, "0")}:30:00.000+05:30`;
}

export function newSubmission(marks: Array<{ student_id: string; status: string; notes?: string }>) {
  return {
    submission_op_id: ulid(),
    marks: marks.map((m) => ({
      student_id: m.student_id,
      status: m.status,
      notes: m.notes ?? null,
      client_op_id: ulid(),
    })),
  };
}

export { ulid };
