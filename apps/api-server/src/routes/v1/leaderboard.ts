/**
 * GET /v1/leaderboard — BRD §7.6 / SPEC §6.9 (H2).
 *
 * There was no leaderboard endpoint at any scope. `monthly_leaderboard_snapshots`
 * was written and read by nothing, so the only artefact of the whole feature was
 * a table growing one row per active student per month with no consumer.
 *
 * Scope authorisation is the interesting part. A leaderboard names other
 * people's children, so who may see which board matters more than for any other
 * read in the module:
 *
 *  - A parent or student may see the boards their own child is IN (their batch,
 *    their centre, their city) — never an arbitrary batch elsewhere.
 *  - Staff see boards inside their admin scope, batch-bound for a shikshak
 *    exactly as Q12 binds their niyam decisions.
 *
 * 404 rather than 403 throughout, matching the rest of the module: whether a
 * particular batch exists is not something an out-of-scope caller should learn.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, students, batches, centres } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ok, fail } from "../../lib/envelope";
import { resolveAdminScope, inBatchWriteScope } from "../../lib/scope";
import { requireAuth } from "../../middlewares/auth";
import {
  getLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "../../services/punya-leaderboard";

const router: IRouter = Router();

// A leaderboard names other people's children — never public.
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES: LeaderboardScope[] = ["batch", "centre", "city", "msv"];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** The children this caller may legitimately be represented by on a board. */
async function ownStudents(
  req: Request,
): Promise<Array<{ id: string; batch_id: string | null; centre_id: string | null }>> {
  const user = req.authUser!;
  if (user.role === "parent") {
    return db
      .select({ id: students.id, batch_id: students.batch_id, centre_id: students.centre_id })
      .from(students)
      .where(and(eq(students.parent_id, user.id), isNull(students.deleted_at)));
  }
  if (user.role === "student") {
    return db
      .select({ id: students.id, batch_id: students.batch_id, centre_id: students.centre_id })
      .from(students)
      .where(and(eq(students.user_id, user.id), isNull(students.deleted_at)));
  }
  return [];
}

/**
 * May this caller read this board, and which of their children is on it?
 * Returns the student to highlight, or an error.
 */
async function authorize(
  req: Request,
  scope: LeaderboardScope,
  scopeId: string | null,
): Promise<{ selfStudentId: string | null } | { error: true }> {
  const role = req.authUser!.role;
  const isFamily = role === "parent" || role === "student";

  if (isFamily) {
    const mine = await ownStudents(req);
    if (mine.length === 0) return { error: true };

    if (scope === "batch") {
      const match = mine.find((s) => s.batch_id === scopeId);
      return match ? { selfStudentId: match.id } : { error: true };
    }
    if (scope === "centre") {
      const match = mine.find((s) => s.centre_id === scopeId);
      return match ? { selfStudentId: match.id } : { error: true };
    }
    if (scope === "city") {
      const centreIds = mine.map((s) => s.centre_id).filter((v): v is string => Boolean(v));
      if (centreIds.length === 0) return { error: true };
      const rows = await db
        .select({ centre_id: centres.id, city_id: centres.city_id })
        .from(centres);
      const myCities = new Set(
        rows.filter((r) => centreIds.includes(r.centre_id)).map((r) => r.city_id),
      );
      if (!scopeId || !myCities.has(scopeId)) return { error: true };
      const match = mine.find((s) => {
        const c = rows.find((r) => r.centre_id === s.centre_id);
        return c?.city_id === scopeId;
      });
      return { selfStudentId: match?.id ?? mine[0]!.id };
    }
    // msv — national by default, or narrowed to a city the family belongs to.
    return { selfStudentId: mine[0]!.id };
  }

  // Staff: inside their admin scope.
  const adminScope = await resolveAdminScope(req.authUser!);
  if (scope === "batch") {
    if (!scopeId) return { error: true };
    const [batch] = await db
      .select({ id: batches.id, centre_id: batches.centre_id })
      .from(batches)
      .where(eq(batches.id, scopeId))
      .limit(1);
    // Q12 — a shikshak is bound to the batches they actually teach.
    if (!batch || !inBatchWriteScope(adminScope, batch.id, batch.centre_id)) return { error: true };
    return { selfStudentId: null };
  }
  if (scope === "centre") {
    if (!scopeId) return { error: true };
    if (adminScope.centreIds != null && !adminScope.centreIds.includes(scopeId)) {
      return { error: true };
    }
    return { selfStudentId: null };
  }
  // city / msv — city_admin and above; a shikshak or sanchalak has no business
  // reading a whole city's ranking of children they do not teach.
  if (role === "shikshak" || role === "sanchalak") return { error: true };
  return { selfStudentId: null };
}

router.get("/", async (req: Request, res: Response) => {
  const scopeRaw = typeof req.query.scope === "string" ? req.query.scope : "";
  if (!SCOPES.includes(scopeRaw as LeaderboardScope)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", `scope must be one of ${SCOPES.join(", ")}.`);
    return;
  }
  const scope = scopeRaw as LeaderboardScope;

  const idRaw = typeof req.query.id === "string" ? req.query.id.trim() : "";
  if (idRaw && !UUID_RE.test(idRaw)) {
    fail(res, 422, "ERR_VALIDATION_FAILED", "id must be a valid id.");
    return;
  }
  // Only the MSV board is meaningful without an id (it is national).
  if (!idRaw && scope !== "msv") {
    fail(res, 422, "ERR_VALIDATION_FAILED", `id is required for the ${scope} leaderboard.`);
    return;
  }
  const scopeId = idRaw || null;

  const periodRaw = typeof req.query.period === "string" ? req.query.period : "month";
  if (periodRaw !== "month" && periodRaw !== "all_time") {
    fail(res, 422, "ERR_VALIDATION_FAILED", "period must be month or all_time.");
    return;
  }
  const period = periodRaw as LeaderboardPeriod;

  const limitRaw = Number(req.query.limit ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limitRaw)))
    : DEFAULT_LIMIT;

  const authorized = await authorize(req, scope, scopeId);
  if ("error" in authorized) {
    fail(res, 404, "ERR_NOT_FOUND", "Leaderboard not found.");
    return;
  }

  // SPEC 6.9 — a batch may be set to show tiers instead of ordinals.
  let displayMode: "rank" | "tier" = "rank";
  if (scope === "batch" && scopeId) {
    const [b] = await db
      .select({ mode: batches.leaderboard_mode })
      .from(batches)
      .where(eq(batches.id, scopeId))
      .limit(1);
    displayMode = b?.mode === "tier" ? "tier" : "rank";
  }

  const result = await getLeaderboard({
    scope,
    scopeId,
    period,
    limit,
    selfStudentId: authorized.selfStudentId,
    displayMode,
  });
  ok(res, result, { count: result.items.length });
});

export default router;
