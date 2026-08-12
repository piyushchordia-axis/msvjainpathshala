/**
 * Thin SQLite wrapper for library FTS — kept swappable for unit tests.
 */
import * as SQLite from "expo-sqlite";
import type { FtsRow } from "@/lib/library/search-collect";

export type { FtsRow } from "@/lib/library/search-collect";

const DB_NAME = "library-search.db";

const CREATE_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS library_fts USING fts5(
  item_id UNINDEXED,
  section_id UNINDEXED,
  subsection_id UNINDEXED,
  result_kind UNINDEXED,
  title,
  title_en, title_hi, title_gu,
  section_en, section_hi, section_gu,
  subsection_en, subsection_hi, subsection_gu,
  item_code,
  body,
  roman_title,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export type FtsMatchRow = {
  item_id: string;
  section_id: string;
  subsection_id: string;
  result_kind: string;
  title: string;
  section_title: string;
  title_snip: string;
  body_snip: string;
  body: string;
};

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
          await db.runAsync(
            `INSERT INTO library_fts(
              item_id, section_id, subsection_id, result_kind,
              title, title_en, title_hi, title_gu,
              section_en, section_hi, section_gu,
              subsection_en, subsection_hi, subsection_gu,
              item_code, body, roman_title
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              r.item_id,
              r.section_id,
              r.subsection_id,
              r.result_kind,
              r.title,
              r.title_en,
              r.title_hi,
              r.title_gu,
              r.section_en,
              r.section_hi,
              r.section_gu,
              r.subsection_en,
              r.subsection_hi,
              r.subsection_gu,
              r.item_code,
              r.body,
              r.roman_title,
            ],
          );
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
      // column indices: title=4, body=15 (see CREATE_SQL)
      const rows = await db.getAllAsync<FtsMatchRow>(
        `SELECT
          item_id,
          section_id,
          subsection_id,
          result_kind,
          title,
          CASE WHEN ? THEN
            CASE WHEN length(section_hi) > 0 THEN section_hi ELSE section_en END
          ELSE
            CASE WHEN length(section_en) > 0 THEN section_en ELSE section_hi END
          END AS section_title,
          snippet(library_fts, 4, '«', '»', '…', 12) AS title_snip,
          snippet(library_fts, 15, '«', '»', '…', 12) AS body_snip,
          body
        FROM library_fts
        WHERE library_fts MATCH ?
        ORDER BY bm25(library_fts)
        LIMIT ?`,
        [localeHi ? 1 : 0, ftsQuery, limit],
      );
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
