/**
 * Team admin service — publish authority + validation live here (not in route guards).
 *
 * Authority:
 * - super_admin / state_admin: any scope
 * - city_admin: members whose city_id matches theirs only
 * - sanchalak / shikshak / others: ERR_TEAM_PUBLISH_FORBIDDEN
 */
import {
  db,
  users,
  cities,
  centres,
  team_categories,
  team_members,
  upload_objects,
  type User,
} from "@workspace/db";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { ErrorCode } from "@workspace/api-zod";
import { designationFromRole } from "./team-public";
import { storage } from "./storage";

export class TeamAdminError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TeamAdminError";
  }
}

export type TeamScopeLevel = "national" | "state" | "city" | "centre";

export type TeamMemberScope = {
  scope_level: TeamScopeLevel;
  state_id: string | null;
  city_id: string | null;
  centre_id: string | null;
};

/** Matches team_members_scope_consistency CHECK. */
export function assertTeamScopeConsistency(scope: TeamMemberScope): void {
  const { scope_level, state_id, city_id, centre_id } = scope;
  const ok =
    (scope_level === "national" && !state_id && !city_id && !centre_id) ||
    (scope_level === "state" && !!state_id && !city_id && !centre_id) ||
    (scope_level === "city" && !!state_id && !!city_id && !centre_id) ||
    (scope_level === "centre" && !!state_id && !!city_id && !!centre_id);
  if (!ok) {
    throw new TeamAdminError(
      400,
      "ERR_TEAM_SCOPE_INVALID",
      "That Team scope does not match state/city/centre — fix the geography fields and try again.",
    );
  }
}

/**
 * Publish / manage authority. Call from the service on every mutating path —
 * not from Express role middleware alone.
 */
export function assertTeamPublishAuthority(actor: User, member: TeamMemberScope): void {
  const role = actor.role;
  if (role === "super_admin" || role === "state_admin") return;

  if (role === "city_admin") {
    if (!actor.city_id) {
      throw new TeamAdminError(
        403,
        "ERR_TEAM_PUBLISH_FORBIDDEN",
        "You cannot manage Team members outside your scope — ask a city or state admin.",
      );
    }
    if (member.city_id !== actor.city_id) {
      throw new TeamAdminError(
        403,
        "ERR_TEAM_PUBLISH_FORBIDDEN",
        "You cannot manage Team members outside your scope — ask a city or state admin.",
      );
    }
    return;
  }

  throw new TeamAdminError(
    403,
    "ERR_TEAM_PUBLISH_FORBIDDEN",
    "You cannot manage Team members outside your scope — ask a city or state admin.",
  );
}

/** True when the actor may list/read this member (same rules as publish authority). */
export function canReadTeamMember(actor: User, member: TeamMemberScope): boolean {
  try {
    assertTeamPublishAuthority(actor, member);
    return true;
  } catch (err) {
    if (err instanceof TeamAdminError && err.code === "ERR_TEAM_PUBLISH_FORBIDDEN") return false;
    throw err;
  }
}

export async function resolveDesignationForPublish(opts: {
  designation_en: string | null;
  designation_hi: string | null;
  user_id: string | null;
}): Promise<{ en: string; hi: string | null }> {
  const explicitEn = opts.designation_en?.trim() || null;
  const explicitHi = opts.designation_hi?.trim() || null;
  if (explicitEn) return { en: explicitEn, hi: explicitHi };

  if (opts.user_id) {
    const [u] = await db
      .select({ role: users.role, gender: users.gender })
      .from(users)
      .where(eq(users.id, opts.user_id))
      .limit(1);
    if (u) {
      const derived = designationFromRole(u.role, u.gender);
      if (derived.en) return { en: derived.en, hi: derived.hi };
    }
  }

  throw new TeamAdminError(
    400,
    "ERR_TEAM_DESIGNATION_REQUIRED",
    "This Team card has no designation — set designation_en (and designation_hi) before publishing.",
  );
}

/** Fill state_id / city_id from centre or city when the client omits denormalised fields. */
export async function hydrateTeamScope(input: {
  scope_level: TeamScopeLevel;
  state_id?: string | null;
  city_id?: string | null;
  centre_id?: string | null;
}): Promise<TeamMemberScope> {
  let state_id = input.state_id ?? null;
  let city_id = input.city_id ?? null;
  let centre_id = input.centre_id ?? null;

  if (input.scope_level === "centre" && centre_id) {
    const [c] = await db
      .select({ state_id: centres.state_id, city_id: centres.city_id })
      .from(centres)
      .where(and(eq(centres.id, centre_id), isNull(centres.deleted_at)))
      .limit(1);
    if (!c) {
      throw new TeamAdminError(404, "ERR_NOT_FOUND", "That centre could not be found.");
    }
    state_id = c.state_id;
    city_id = c.city_id;
  } else if ((input.scope_level === "city" || input.scope_level === "centre") && city_id && !state_id) {
    const [city] = await db
      .select({ state_id: cities.state_id })
      .from(cities)
      .where(eq(cities.id, city_id))
      .limit(1);
    if (!city) {
      throw new TeamAdminError(404, "ERR_NOT_FOUND", "That city could not be found.");
    }
    state_id = city.state_id;
  }

  if (input.scope_level === "national") {
    state_id = null;
    city_id = null;
    centre_id = null;
  } else if (input.scope_level === "state") {
    city_id = null;
    centre_id = null;
  } else if (input.scope_level === "city") {
    centre_id = null;
  }

  const scope: TeamMemberScope = {
    scope_level: input.scope_level,
    state_id,
    city_id,
    centre_id,
  };
  assertTeamScopeConsistency(scope);
  return scope;
}

export async function assertNoDuplicateTeamUser(userId: string, excludeId?: string): Promise<void> {
  const [existing] = await db
    .select({ id: team_members.id })
    .from(team_members)
    .where(
      and(
        eq(team_members.user_id, userId),
        isNull(team_members.deleted_at),
        excludeId ? sql`${team_members.id} <> ${excludeId}` : sql`true`,
      ),
    )
    .limit(1);
  if (existing) {
    throw new TeamAdminError(
      409,
      "ERR_TEAM_MEMBER_DUPLICATE",
      "That user already has a Team card — edit the existing row instead of creating another.",
    );
  }
}

export async function getActiveTeamMember(id: string) {
  const [row] = await db
    .select()
    .from(team_members)
    .where(and(eq(team_members.id, id), isNull(team_members.deleted_at)))
    .limit(1);
  return row ?? null;
}

export async function getTeamCategory(id: string) {
  const [row] = await db.select().from(team_categories).where(eq(team_categories.id, id)).limit(1);
  return row ?? null;
}

export async function listTeamCategories() {
  return db.select().from(team_categories).orderBy(asc(team_categories.order), asc(team_categories.key));
}

export async function publishTeamMember(id: string, actor: User) {
  const row = await getActiveTeamMember(id);
  if (!row) throw new TeamAdminError(404, "ERR_NOT_FOUND", "That Team member could not be found.");

  assertTeamPublishAuthority(actor, {
    scope_level: row.scope_level as TeamScopeLevel,
    state_id: row.state_id,
    city_id: row.city_id,
    centre_id: row.centre_id,
  });

  const designation = await resolveDesignationForPublish({
    designation_en: row.designation_en,
    designation_hi: row.designation_hi,
    user_id: row.user_id,
  });

  const now = new Date();
  const [updated] = await db
    .update(team_members)
    .set({
      designation_en: row.designation_en?.trim() || designation.en,
      designation_hi: row.designation_hi?.trim() || designation.hi,
      is_published: true,
      published_at: row.published_at ?? now,
      unpublished_by: null,
      content_version: row.content_version + 1,
      updated_at: now,
    })
    .where(eq(team_members.id, id))
    .returning();
  return updated!;
}

/**
 * Admin unpublish — sets unpublished_by so lifecycle sync will not silently
 * republish on user reactivation.
 */
export async function unpublishTeamMember(id: string, actor: User) {
  const row = await getActiveTeamMember(id);
  if (!row) throw new TeamAdminError(404, "ERR_NOT_FOUND", "That Team member could not be found.");

  assertTeamPublishAuthority(actor, {
    scope_level: row.scope_level as TeamScopeLevel,
    state_id: row.state_id,
    city_id: row.city_id,
    centre_id: row.centre_id,
  });

  const now = new Date();
  const [updated] = await db
    .update(team_members)
    .set({
      is_published: false,
      unpublished_by: actor.id,
      content_version: row.content_version + 1,
      updated_at: now,
    })
    .where(eq(team_members.id, id))
    .returning();
  return updated!;
}

export async function reorderTeamMembers(ids: string[], actor: User): Promise<number> {
  const rows = await db
    .select()
    .from(team_members)
    .where(and(inArray(team_members.id, ids), isNull(team_members.deleted_at)));

  if (rows.length !== ids.length) {
    throw new TeamAdminError(404, "ERR_NOT_FOUND", "One or more Team members could not be found.");
  }

  for (const row of rows) {
    assertTeamPublishAuthority(actor, {
      scope_level: row.scope_level as TeamScopeLevel,
      state_id: row.state_id,
      city_id: row.city_id,
      centre_id: row.centre_id,
    });
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(team_members)
        .set({ order: 100_000 + i, updated_at: now })
        .where(eq(team_members.id, ids[i]!));
    }
    for (let i = 0; i < ids.length; i++) {
      await tx
        .update(team_members)
        .set({ order: i, updated_at: now })
        .where(eq(team_members.id, ids[i]!));
    }
  });
  return ids.length;
}

/** Resolve team_photo upload URL from photo_override_asset_id (UUID embedded in storage key). */
export async function resolveTeamPhotoUrls(
  assetIds: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [...new Set(assetIds.filter((x): x is string => Boolean(x)))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const rows = await db
    .select({ key: upload_objects.key })
    .from(upload_objects)
    .where(
      sql`${upload_objects.key} LIKE 'team-photos/%' AND (${sql.join(
        ids.map((id) => sql`${upload_objects.key} LIKE ${"%" + id + "%"}`),
        sql` OR `,
      )})`,
    );

  for (const row of rows) {
    for (const id of ids) {
      if (row.key.includes(id) && !out.has(id)) {
        out.set(id, storage.url(row.key));
      }
    }
  }
  return out;
}

export function assetIdFromTeamPhotoKey(key: string): string | null {
  // team-photos/<uuid>.ext — UUID is the asset id stored on the member.
  const m = /^team-photos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\./i.exec(key);
  return m?.[1] ?? null;
}
