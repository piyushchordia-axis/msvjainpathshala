/**
 * Drizzle wrapper with explicit write / read pool separation (SPEC §17.1).
 *
 *   DrizzleService.db       — write pool (DATABASE_URL)
 *   DrizzleService.dbRead   — read pool  (DATABASE_URL_READ, falls back to write)
 *
 * Service code that knows it is reading consults `.dbRead` to keep load off the
 * primary. Anything writing (or reading with strong-consistency requirements)
 * goes through `.db`. The fallback means dev / single-node setups still work.
 *
 * Step 4 will populate `src/db/schema/*` and pass `{ schema }` here so query
 * builders are typed end-to-end; for Step 3 we expose the raw client.
 */

import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { type AppConfigService } from '../config/app-config.service';

export const DRIZZLE_WRITE_TOKEN = Symbol('DRIZZLE_WRITE');
export const DRIZZLE_READ_TOKEN = Symbol('DRIZZLE_READ');
export const PG_WRITE_TOKEN = Symbol('PG_WRITE');
export const PG_READ_TOKEN = Symbol('PG_READ');

@Injectable()
export class DrizzleService implements OnModuleDestroy {
  private readonly logger = new Logger(DrizzleService.name);

  constructor(
    @Inject(DRIZZLE_WRITE_TOKEN) public readonly db: PostgresJsDatabase,
    @Inject(DRIZZLE_READ_TOKEN) public readonly dbRead: PostgresJsDatabase,
    @Inject(PG_WRITE_TOKEN) private readonly pgWrite: Sql,
    @Inject(PG_READ_TOKEN) private readonly pgRead: Sql,
  ) {}

  /** Ping both pools — used by the readiness indicator. */
  async ping(): Promise<{ write: boolean; read: boolean }> {
    const [write, read] = await Promise.allSettled([this.pgWrite`SELECT 1`, this.pgRead`SELECT 1`]);
    return {
      write: write.status === 'fulfilled',
      read: read.status === 'fulfilled',
    };
  }

  /**
   * Pass-through to drizzle's write-pool transaction API. Service code uses
   * `await drizzle.transaction(async (tx) => { ... })` — the wrapper exists
   * so we never reach into `.db` directly from feature modules.
   */
  get transaction(): PostgresJsDatabase['transaction'] {
    return this.db.transaction.bind(this.db);
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Closing Postgres pools…');
    await Promise.allSettled([this.pgWrite.end({ timeout: 5 }), this.pgRead.end({ timeout: 5 })]);
  }
}

/**
 * Factory used by DatabaseModule — single place where the Postgres clients
 * are constructed so we can centralise SSL, pool sizing, and the read/write
 * fallback rule.
 */
export function createPgClient(opts: {
  url: string;
  ssl: boolean;
  poolMax: number;
  serviceName: string;
}): Sql {
  return postgres(opts.url, {
    max: opts.poolMax,
    ssl: opts.ssl ? { rejectUnauthorized: true } : false,
    prepare: false, // PgBouncer transaction-mode compat (SPEC §17.1)
    connection: { application_name: opts.serviceName },
  });
}

export function buildPools(config: AppConfigService): {
  pgWrite: Sql;
  pgRead: Sql;
  dbWrite: PostgresJsDatabase;
  dbRead: PostgresJsDatabase;
} {
  const db = config.database;

  const pgWrite = createPgClient({
    url: db.url,
    ssl: db.ssl,
    poolMax: db.poolMax,
    serviceName: `${config.serviceName}-write`,
  });

  // §17.1 fallback: if DATABASE_URL_READ is unset, read pool is the same as write.
  const sharePool = !db.urlRead || db.urlRead === db.url;
  const pgRead = sharePool
    ? pgWrite
    : createPgClient({
        url: db.urlRead,
        ssl: db.ssl,
        poolMax: db.poolMax,
        serviceName: `${config.serviceName}-read`,
      });

  return {
    pgWrite,
    pgRead,
    dbWrite: drizzle(pgWrite),
    dbRead: drizzle(pgRead),
  };
}
