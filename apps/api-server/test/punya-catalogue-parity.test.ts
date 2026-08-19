/**
 * C2 regression guard.
 *
 * The `attendance` Punya feature was registered by seed.ts but by no migration.
 * On a migration-built database resolveAttendanceAwardPointsForCity returned 0,
 * awardValueForStatus returned 0, and attendance-mark.ts short-circuited on
 * `amount <= 0` without writing a ledger row — so marking a full roster present
 * awarded nothing, silently, and Step 16's exit criterion did not hold.
 *
 * Nothing caught it because the catalogue had two sources of truth and every
 * test ran against a seeded database, where the key was present.
 *
 * These assertions are deliberately STATIC — they read the migration SQL from
 * disk rather than querying a database — so they hold no matter how the test
 * database was built. A DB-backed test could only ever confirm the seed.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PUNYA_FEATURE_CATALOGUE,
  PUNYA_CONFIG_DEFAULTS,
  PUNYA_KEYS_REQUIRING_NONZERO_DEFAULT,
} from "@workspace/db/punya-catalogue";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../../lib/db/migrations");

/** Every migration statement, split on the statement terminator. */
function migrationStatements(): string[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  expect(files.length).toBeGreaterThan(80);
  return files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Statements that INSERT into `table` (quoted or not, as both styles appear). */
function insertsInto(statements: string[], table: string): string[] {
  return statements.filter(
    (s) =>
      s.toUpperCase().includes("INSERT INTO") &&
      (s.includes(`"${table}"`) || s.includes(` ${table} `) || s.includes(`\n${table} `)),
  );
}

/** The literal a guarded catalogue insert selects first, e.g. SELECT 'attendance', */
function selectedKey(stmt: string): string | null {
  const marker = "SELECT '";
  const at = stmt.indexOf(marker);
  if (at < 0) return null;
  const rest = stmt.slice(at + marker.length);
  const end = rest.indexOf("'");
  return end < 0 ? null : rest.slice(0, end);
}

const STATEMENTS = migrationStatements();
const FEATURE_INSERTS = insertsInto(STATEMENTS, "punya_features");
const CONFIG_INSERTS = insertsInto(STATEMENTS, "punya_configs");

describe("punya catalogue parity (C2)", () => {
  it.each(PUNYA_FEATURE_CATALOGUE.map((f) => f.key))(
    "a migration registers the '%s' feature",
    (key) => {
      const found = FEATURE_INSERTS.some((s) => selectedKey(s) === key);
      expect(
        found,
        `No migration INSERTs punya_features key '${key}'. A migration-built ` +
          `database resolves 0 points for it and awards nothing, silently. ` +
          `Add a guarded INSERT — see 0088_punya_catalogue_parity.sql.`,
      ).toBe(true);
    },
  );

  it.each(PUNYA_CONFIG_DEFAULTS.map((c) => c.feature_key))(
    "a migration registers a global config for '%s'",
    (key) => {
      const found = CONFIG_INSERTS.some(
        (s) => selectedKey(s) === key && s.toUpperCase().includes("NULL"),
      );
      expect(
        found,
        `No migration INSERTs a global (city_id NULL) punya_configs row for '${key}'.`,
      ).toBe(true);
    },
  );

  it("the seed cannot delete a key the migrations depend on", () => {
    // seed.ts TRUNCATEs punya_features, so any key a migration inserts but the
    // canonical catalogue omits is destroyed on every seed. That is exactly how
    // `attendance_streak` vanished from seeded databases (H8) while migration
    // 0012 kept inserting it and the admin UI kept offering to edit it.
    const migrationKeys = [...new Set(FEATURE_INSERTS.map(selectedKey).filter(Boolean))].sort();
    const catalogueKeys = new Set(PUNYA_FEATURE_CATALOGUE.map((f) => f.key));
    const orphaned = migrationKeys.filter((k) => !catalogueKeys.has(k!));
    expect(
      orphaned,
      "Inserted by a migration but absent from PUNYA_FEATURE_CATALOGUE, so " +
        "`pnpm seed` deletes them:",
    ).toEqual([]);
  });

  it("every key that must pay out resolves to a non-zero value", () => {
    for (const key of PUNYA_KEYS_REQUIRING_NONZERO_DEFAULT) {
      const cfg = PUNYA_CONFIG_DEFAULTS.find((c) => c.feature_key === key);
      const feat = PUNYA_FEATURE_CATALOGUE.find((f) => f.key === key);
      const resolvable =
        (cfg != null && cfg.points > 0) ||
        (feat != null && (feat.max_points > 0 || feat.min_points > 0));
      expect(resolvable, `'${key}' resolves to 0 — it would award nothing`).toBe(true);
    }
  });

  it("attendance specifically is registered — the C2 case", () => {
    expect(FEATURE_INSERTS.some((s) => selectedKey(s) === "attendance")).toBe(true);
    expect(CONFIG_INSERTS.some((s) => selectedKey(s) === "attendance")).toBe(true);
  });
});
