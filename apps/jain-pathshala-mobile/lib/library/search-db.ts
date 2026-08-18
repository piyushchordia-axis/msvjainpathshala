/**
 * Thin SQLite wrapper for library FTS — kept swappable for unit tests.
 */
import * as SQLite from "expo-sqlite";
import type { FtsRow } from "@/lib/library/search-collect";
import type { FtsMatchRow } from "@/lib/library/search-row";
import {
  CREATE_SQL,
  FTS_SCHEMA_VERSION,
  INSERT_SQL,
  MATCH_SQL,
  insertValues,
} from "@/lib/library/search-schema";

export type { FtsRow } from "@/lib/library/search-collect";

const DB_NAME = "library-search.db";

export type { FtsMatchRow } from "@/lib/library/search-row";

export type SearchDb = {
  ensureSchema: () => Promise<void>;
  clearAll: () => Promise<void>;
  insertRows: (rows: FtsRow[]) => Promise<void>;
  countRows: () => Promise<number>;
  match: (ftsQuery: string, localeHi: boolean, limit?: number) => Promise<FtsMatchRow[]>;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

export function createExpoSearchDb(): SearchDb {
  return {
    async ensureSchema() {
      const db = await getDb();
      const row = await db.getFirstAsync<{ user_version: number }>(
        "PRAGMA user_version;",
      );
      if ((row?.user_version ?? 0) < FTS_SCHEMA_VERSION) {
        await db.execAsync("DROP TABLE IF EXISTS library_fts;");
        await db.execAsync(CREATE_SQL);
        await db.execAsync(`PRAGMA user_version = ${FTS_SCHEMA_VERSION};`);
        return;
      }
      await db.execAsync(CREATE_SQL);
    },

    async clearAll() {
      const db = await getDb();
      await db.execAsync("DELETE FROM library_fts;");
    },

    async insertRows(rows) {
      if (rows.length === 0) return;
      const db = await getDb();
      await db.withTransactionAsync(async () => {
        for (const r of rows) {
          await db.runAsync(INSERT_SQL, insertValues(r));
        }
      });
    },

    async countRows() {
      const db = await getDb();
      const row = await db.getFirstAsync<{ c: number }>(
        "SELECT COUNT(*) AS c FROM library_fts;",
      );
      return row?.c ?? 0;
    },

    async match(ftsQuery, localeHi, limit = 50) {
      const db = await getDb();
      const rows = await db.getAllAsync<FtsMatchRow>(MATCH_SQL, [
        localeHi ? 1 : 0,
        ftsQuery,
        limit,
      ]);
      return rows;
    },
  };
}

let defaultDb: SearchDb | null = null;

export function getSearchDb(): SearchDb {
  if (!defaultDb) defaultDb = createExpoSearchDb();
  return defaultDb;
}

/** Test hook — inject a mock SearchDb. */
export function setSearchDbForTests(db: SearchDb | null): void {
  defaultDb = db;
}
