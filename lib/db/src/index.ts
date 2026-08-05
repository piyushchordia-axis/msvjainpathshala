import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

type PoolOptions = ConstructorParameters<typeof Pool>[0];

function createPool(overrides: PoolOptions = {}): pg.Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 20),
    min: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    application_name: process.env.PROCESS_ROLE ?? "api",
    ...overrides,
  });
}

/**
 * Request-path pool. Sized for concurrent HTTP + inline queue work.
 * PG_POOL_MAX should be set relative to Postgres max_connections, divided
 * across API + worker instances (e.g. max_connections=100 → leave ~20 for
 * admin/superuser, split the rest: 40 API + 40 worker across replicas).
 */
export const pool = createPool();

/**
 * Long-running batch jobs (MV refresh, consecutive-absence scan, punya
 * reconcile) must not inherit the API statement_timeout — they run for
 * minutes. Keep this pool small; jobs are sequential/low-concurrency.
 * statement_timeout / query_timeout 0 = disabled in node-pg.
 */
export const workerPool = createPool({
  max: Number(process.env.PG_WORKER_POOL_MAX ?? 5),
  min: 0,
  statement_timeout: 0,
  query_timeout: 0,
  application_name: `${process.env.PROCESS_ROLE ?? "api"}-worker`,
});

function attachIdleErrorHandler(p: pg.Pool, label: string): void {
  // Idle clients can emit errors (e.g. backend termination during a failover or
  // `pg_terminate_backend`). Without a listener, `pg` rethrows on the pool's
  // EventEmitter and crashes the process. Log and let the pool evict the client.
  p.on("error", (err) => {
    console.error(`[db] idle pg client error (${label})`, err);
  });
}

attachIdleErrorHandler(pool, "api");
attachIdleErrorHandler(workerPool, "worker");

export const db = drizzle(pool, { schema });
export const dbWorker = drizzle(workerPool, { schema });

export * from "./schema";
