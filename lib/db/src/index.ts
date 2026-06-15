import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Idle clients can emit errors (e.g. backend termination during a failover or
// `pg_terminate_backend`). Without a listener, `pg` rethrows on the pool's
// EventEmitter and crashes the process. Log and let the pool evict the client.
pool.on("error", (err) => {
  console.error("[db] idle pg client error", err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
