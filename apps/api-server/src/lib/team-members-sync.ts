/**
 * Keep team_members in sync with staff/admin user lifecycle.
 *
 * Rows for linked users are created by role assignment — not admin data entry.
 * Manual/trustee cards (user_id IS NULL) are never touched here.
 *
 * Always look up the existing row by user_id first and UPDATE — never insert a
 * second row and catch the unique violation.
 */
import {
  db,
  users,
  centres,
  cities,
  team_categories,
  team_members,
  sanchalak_centre_assignments,
  shikshak_centre_assignments,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { logger } from "./logger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

const TEAM_ROLES = ["sanchalak", "shikshak", "city_admin", "state_admin"] as const;
type TeamRole = (typeof TEAM_ROLES)[number];

/** Role → category.key (lifecycle mapping — not UI rendering). */
function categoryKeyForRole(role: TeamRole): "core_team" | "sanchalak" | "shikshak" {
  if (role === "city_admin" || role === "state_admin") return "core_team";
  if (role === "sanchalak") return "sanchalak";
  return "shikshak";
}

function isTeamRole(role: string): role is TeamRole {
  return (TEAM_ROLES as readonly string[]).includes(role);
}

async function categoryIdByKey(ex: Executor, key: string): Promise<string | null> {
  const [row] = await ex
    .select({ id: team_categories.id })
    .from(team_categories)
    .where(eq(team_categories.key, key))
    .limit(1);
  return row?.id ?? null;
}

async function findActiveMemberByUser(ex: Executor, userId: string) {
  const [row] = await ex
    .select({
      id: team_members.id,
      unpublished_by: team_members.unpublished_by,
      is_published: team_members.is_published,
      published_at: team_members.published_at,
      content_version: team_members.content_version,
    })
    .from(team_members)
    .where(and(eq(team_members.user_id, userId), isNull(team_members.deleted_at)))
    .limit(1);
  return row ?? null;
}

type ScopeGeo = {
  scope_level: "state" | "city" | "centre";
  state_id: string;
  city_id: string | null;
  centre_id: string | null;
};

async function resolveCentreGeo(ex: Executor, centreId: string): Promise<ScopeGeo | null> {
  const [row] = await ex
    .select({
      id: centres.id,
      state_id: centres.state_id,
      city_id: centres.city_id,
    })
    .from(centres)
    .where(and(eq(centres.id, centreId), isNull(centres.deleted_at)))
    .limit(1);
  if (!row) return null;
  return {
    scope_level: "centre",
    state_id: row.state_id,
    city_id: row.city_id,
    centre_id: row.id,
  };
}

/** Prefer default centre if still actively assigned; else newest active assignment. */
async function pickActiveCentreId(
  ex: Executor,
  role: "sanchalak" | "shikshak",
  userId: string,
  centreIdDefault: string | null,
): Promise<string | null> {
  const table = role === "sanchalak" ? sanchalak_centre_assignments : shikshak_centre_assignments;

  if (centreIdDefault) {
    const [activeDefault] = await ex
      .select({ centre_id: table.centre_id })
      .from(table)
      .where(
        and(
          eq(table.user_id, userId),
          eq(table.centre_id, centreIdDefault),
          eq(table.is_active, true),
        ),
      )
      .limit(1);
    if (activeDefault) return activeDefault.centre_id;
  }

  const [newest] = await ex
    .select({ centre_id: table.centre_id })
    .from(table)
    .where(and(eq(table.user_id, userId), eq(table.is_active, true)))
    .orderBy(desc(table.updated_at), desc(table.created_at))
    .limit(1);
  if (newest) return newest.centre_id;

  // Fresh create may set centre_id_default before the assignment row lands.
  return centreIdDefault;
}

async function resolveScopeGeo(
  ex: Executor,
  user: {
    role: string;
    state_id: string | null;
    city_id: string | null;
    centre_id_default: string | null;
    is_active: boolean;
  },
  userId: string,
): Promise<ScopeGeo | null> {
  if (!isTeamRole(user.role) || !user.is_active) return null;

  if (user.role === "state_admin") {
    if (!user.state_id) return null;
    return { scope_level: "state", state_id: user.state_id, city_id: null, centre_id: null };
  }

  if (user.role === "city_admin") {
    if (!user.city_id) return null;
    let stateId = user.state_id;
    if (!stateId) {
      const [city] = await ex
        .select({ state_id: cities.state_id })
        .from(cities)
        .where(eq(cities.id, user.city_id))
        .limit(1);
      stateId = city?.state_id ?? null;
    }
    if (!stateId) return null;
    return {
      scope_level: "city",
      state_id: stateId,
      city_id: user.city_id,
      centre_id: null,
    };
  }

  const centreId = await pickActiveCentreId(
    ex,
    user.role,
    userId,
    user.centre_id_default,
  );
  if (!centreId) return null;
  return resolveCentreGeo(ex, centreId);
}

/**
 * Upsert the single team_members card for a linked user from current role + geography.
 * No-op for non-team roles / incomplete geography / inactive users (those go through unpublish).
 */
export async function syncTeamMemberForUser(
  userId: string,
  executor: Executor = db,
): Promise<void> {
  const [user] = await executor
    .select({
      id: users.id,
      role: users.role,
      full_name: users.full_name,
      state_id: users.state_id,
      city_id: users.city_id,
      centre_id_default: users.centre_id_default,
      is_active: users.is_active,
      deleted_at: users.deleted_at,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.deleted_at) {
    await unpublishTeamMemberForUser(userId, { executor });
    return;
  }

  if (!isTeamRole(user.role) || !user.is_active) {
    await unpublishTeamMemberForUser(userId, { executor });
    return;
  }

  const geo = await resolveScopeGeo(executor, user, userId);
  if (!geo) {
    // Centre-scoped roles with no Pathshala yet — unpublish if a row exists.
    const existing = await findActiveMemberByUser(executor, userId);
    if (existing) await unpublishTeamMemberForUser(userId, { executor });
    return;
  }

  const categoryId = await categoryIdByKey(executor, categoryKeyForRole(user.role));
  if (!categoryId) {
    logger.warn({ role: user.role }, "team_categories row missing for role — skip sync");
    return;
  }

  const existing = await findActiveMemberByUser(executor, userId);
  const now = new Date();
  // Admin-explicit unpublish survives assignment updates and reactivation.
  const publish = existing?.unpublished_by == null;

  if (existing) {
    await executor
      .update(team_members)
      .set({
        category_id: categoryId,
        scope_level: geo.scope_level,
        state_id: geo.state_id,
        city_id: geo.city_id,
        centre_id: geo.centre_id,
        is_published: publish,
        published_at: publish ? existing.is_published ? existing.published_at ?? now : now : null,
        content_version: (existing.content_version ?? 1) + 1,
        updated_at: now,
      })
      .where(eq(team_members.id, existing.id));
    return;
  }

  await executor.insert(team_members).values({
    category_id: categoryId,
    user_id: userId,
    scope_level: geo.scope_level,
    state_id: geo.state_id,
    city_id: geo.city_id,
    centre_id: geo.centre_id,
    display_name_en: user.full_name,
    is_published: true,
    published_at: now,
    content_version: 1,
  });
}

/** System unpublish — does not set unpublished_by (admin decision must survive reactivation). */
export async function unpublishTeamMemberForUser(
  userId: string,
  opts: { executor?: Executor; byAdminId?: string | null } = {},
): Promise<void> {
  const ex = opts.executor ?? db;
  const existing = await findActiveMemberByUser(ex, userId);
  if (!existing || !existing.is_published) {
    if (existing && opts.byAdminId && !existing.unpublished_by) {
      await ex
        .update(team_members)
        .set({
          unpublished_by: opts.byAdminId,
          updated_at: new Date(),
        })
        .where(eq(team_members.id, existing.id));
    }
    return;
  }

  await ex
    .update(team_members)
    .set({
      is_published: false,
      unpublished_by: opts.byAdminId ?? existing.unpublished_by,
      updated_at: new Date(),
      content_version: (existing.content_version ?? 1) + 1,
    })
    .where(eq(team_members.id, existing.id));
}

/**
 * After user reactivation: publish again only when an admin did not explicitly unpublish.
 */
export async function republishTeamMemberAfterReactivation(
  userId: string,
  executor: Executor = db,
): Promise<void> {
  const existing = await findActiveMemberByUser(executor, userId);
  if (!existing) {
    await syncTeamMemberForUser(userId, executor);
    return;
  }
  if (existing.unpublished_by != null) return;
  if (existing.is_published) {
    await syncTeamMemberForUser(userId, executor);
    return;
  }
  await executor
    .update(team_members)
    .set({
      is_published: true,
      published_at: new Date(),
      updated_at: new Date(),
      content_version: (existing.content_version ?? 1) + 1,
    })
    .where(eq(team_members.id, existing.id));
  await syncTeamMemberForUser(userId, executor);
}

/** Centre deactivated — hide every card that points at that Pathshala. */
export async function unpublishTeamMembersForCentre(
  centreId: string,
  executor: Executor = db,
): Promise<number> {
  const result = await executor
    .update(team_members)
    .set({
      is_published: false,
      updated_at: new Date(),
      content_version: sql`${team_members.content_version} + 1`,
    })
    .where(
      and(
        eq(team_members.centre_id, centreId),
        isNull(team_members.deleted_at),
        eq(team_members.is_published, true),
      ),
    )
    .returning({ id: team_members.id });
  return result.length;
}

/** One-time backfill: upsert cards for all active team-role users. */
export async function backfillTeamMembersFromUsers(): Promise<{ synced: number; skipped: number }> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        eq(users.is_active, true),
        sql`${users.role} IN ('sanchalak', 'shikshak', 'city_admin', 'state_admin')`,
      ),
    );

  let synced = 0;
  let skipped = 0;
  for (const row of rows) {
    const before = await findActiveMemberByUser(db, row.id);
    await syncTeamMemberForUser(row.id);
    const after = await findActiveMemberByUser(db, row.id);
    if (after) synced += 1;
    else skipped += 1;
    void before;
  }
  logger.info({ synced, skipped, total: rows.length }, "team_members backfill complete");
  return { synced, skipped };
}
