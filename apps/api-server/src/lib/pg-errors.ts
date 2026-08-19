/**
 * Postgres error-code predicates.
 *
 * The 23505 check was inlined at several call sites with slightly different
 * shapes; one place to look means a new caller cannot get the narrowing subtly
 * wrong and swallow an unrelated error.
 */

/**
 * Read the SQLSTATE, unwrapping driver wrappers.
 *
 * drizzle-orm raises a DrizzleQueryError whose `cause` is the pg error, so a
 * top-level `err.code` check silently never matches and a unique violation
 * surfaced as a 500 instead of a 409.
 */
function pgCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** unique_violation — a guarded insert hit a unique index. */
export function isUniqueViolation(err: unknown): boolean {
  return pgCode(err) === "23505";
}

/** foreign_key_violation — referenced row is missing or still referenced. */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgCode(err) === "23503";
}
