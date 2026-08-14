/**
 * Shared test helpers. Module test files import these to authenticate as a
 * seeded persona and hit the API via supertest against the imported app.
 */
import request from "supertest";
import { pool, workerPool } from "@workspace/db";
import app from "../src/app";

/** Seeded login phones (OTP via DEFAULT_OTP / OTP_ENABLED=false in tests). */
export const SEED_PHONES = {
  super_admin: "+919800000001",
  state_admin: "+919800000002",
  city_admin: "+919800000003",
  sanchalak: "+919800000004",
  shikshak: "+919800000005",
  parent: "+919800000006",
  student: "+919800000007",
} as const;

export type SeedRole = keyof typeof SEED_PHONES;

export interface Session {
  token: string;
  user: { id: string; role: string; full_name?: string; phone?: string };
}

/** Complete the OTP send+verify flow for a seeded phone; return token + user. */
export async function loginAs(role: SeedRole): Promise<Session> {
  const phone = SEED_PHONES[role];
  const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  if (send.status !== 200) {
    throw new Error(`login send failed for ${role}: ${send.status} ${JSON.stringify(send.body)}`);
  }
  const otpToken: string = send.body.data.otp_token;
  const code: string = send.body.data.dev_code ?? "123456";
  const verify = await request(app)
    .post("/api/auth/login")
    .send({ phase: "verify", otp_token: otpToken, code, device_id: `test-${role}` });
  if (verify.status !== 200) {
    throw new Error(`login verify failed for ${role}: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { token: verify.body.data.tokens.access_token, user: verify.body.data.user };
}

/** Authorization header for a session token. */
export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/* ------------------------------------------------------------------ */
/* Query-count spy — measurement instrument for PERF #7/#10/#11/#13/#14 */
/* ------------------------------------------------------------------ */

export type QueryCountResult<T> = {
  result: T;
  /** Statements observed on the instrumented pools while `fn` ran. */
  count: number;
};

type PoolLike = typeof pool;

/** True original Client.query — survives nested / repeated withQueryCount. */
const clientQueryOrig = new WeakMap<object, (...args: unknown[]) => unknown>();

/**
 * Instrument one pg Pool so every statement bumps `onQuery`.
 *
 * drizzle-orm/node-postgres uses Pool.query for simple statements and
 * Client.query (via Pool.connect) inside transactions. Pool.query itself
 * acquires a client through connect — so we only wrap Client.query. Wrapping
 * both Pool.query and Client.query double-counts every statement.
 *
 * Returns a restore function; always call it in `finally` so patches never
 * leak across tests.
 */
function instrumentPool(p: PoolLike, onQuery: () => void): () => void {
  const origConnect = p.connect.bind(p);
  const wrappedClients = new Set<object>();

  const wrapClient = <C extends { query: typeof p.query }>(client: C): C => {
    if (!client) return client;
    if (!clientQueryOrig.has(client)) {
      clientQueryOrig.set(
        client,
        client.query.bind(client) as (...args: unknown[]) => unknown,
      );
    }
    const oq = clientQueryOrig.get(client)!;
    client.query = ((...args: unknown[]) => {
      onQuery();
      return oq(...args);
    }) as typeof client.query;
    wrappedClients.add(client);
    return client;
  };

  p.connect = ((arg?: unknown) => {
    if (typeof arg === "function") {
      return origConnect((err: Error | undefined, client: unknown, release: unknown) => {
        if (client) wrapClient(client as { query: typeof p.query });
        return (arg as (e: unknown, c: unknown, r: unknown) => void)(err, client, release);
      });
    }
    return (origConnect as () => Promise<{ query: typeof p.query }>)().then(wrapClient);
  }) as typeof p.connect;

  return () => {
    p.connect = origConnect;
    for (const client of wrappedClients) {
      const oq = clientQueryOrig.get(client);
      if (oq) {
        (client as { query: typeof p.query }).query = oq as typeof p.query;
      }
    }
  };
}

/**
 * Count Drizzle/pg statements issued while `fn` runs.
 *
 * Wraps both the request-path `pool` and `workerPool` (dbWorker jobs such as
 * consecutive-absence). Restores both in `finally` — each call starts from a
 * fresh zero; no shared mutable counter to reset between tests.
 *
 * @example
 *   const { result, count } = await withQueryCount(() => markAttendance(...));
 *   expect(count).toBeLessThan(80);
 */
export async function withQueryCount<T>(fn: () => Promise<T>): Promise<QueryCountResult<T>> {
  let count = 0;
  const onQuery = () => {
    count += 1;
  };
  const restorePool = instrumentPool(pool, onQuery);
  const restoreWorker = instrumentPool(workerPool, onQuery);
  try {
    const result = await fn();
    return { result, count };
  } finally {
    restorePool();
    restoreWorker();
  }
}
