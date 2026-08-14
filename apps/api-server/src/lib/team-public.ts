/**
 * Public Team directory — shared queries + privacy-safe serialiser.
 *
 * Schema adaptations vs SPEC wording:
 * - users.full_name (no name_en/_hi) → both language fields fall back to it
 * - users.photo_url (no profile_photo_asset_id) → photo_url when no override asset
 * - users.is_active + deleted_at (no status column)
 */
import {
  db,
  users,
  centres,
  cities,
  states,
  batches,
  team_categories,
  team_members,
  sanchalak_centre_assignments,
  shikshak_batch_assignments,
} from "@workspace/db";
import { and, asc, eq, gt, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { t } from "@workspace/i18n";
import { signUploadUrl } from "./file-tokens";

export const SHIKSHAK_CENTRES_PAGE_SIZE = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TeamMemberCard = {
  id: string;
  honorific: string | null;
  name_en: string;
  name_hi: string;
  designation_en: string | null;
  designation_hi: string | null;
  bio_en: string | null;
  bio_hi: string | null;
  /** SPEC media_assets id when set on the card. */
  photo_asset_id: string | null;
  /** Running-schema profile URL when there is no override asset. */
  photo_url: string | null;
  associated_since: number | null;
  is_in_memoriam: boolean;
  scope_level: string;
  order: number;
  /** Multi-centre sanchalak — all active Pathshala names. */
  centre_names?: string[];
};

export type TeamCategoryPublic = {
  id: string;
  key: string;
  name_en: string;
  name_hi: string;
  display_style: string;
  group_by: string;
  is_lazy_loaded: boolean;
  order: number;
  member_count: number;
};

type MemberRow = {
  id: string;
  honorific: string | null;
  display_name_en: string | null;
  display_name_hi: string | null;
  designation_en: string | null;
  designation_hi: string | null;
  bio_en: string | null;
  bio_hi: string | null;
  photo_override_asset_id: string | null;
  associated_since: number | null;
  is_in_memoriam: boolean;
  scope_level: string;
  order: number;
  category_id: string;
  category_key: string;
  user_id: string | null;
  user_full_name: string | null;
  user_role: string | null;
  user_gender: "male" | "female" | "other" | null;
  user_photo_url: string | null;
  state_id: string | null;
  city_id: string | null;
  centre_id: string | null;
};

/** Active linked user OR trustee/manual card (user_id null). */
export function teamMemberVisibilitySql(): SQL {
  return sql`(
    ${team_members.user_id} IS NULL
    OR (
      ${users.is_active} = true
      AND ${users.deleted_at} IS NULL
    )
  )`;
}

export function publishedMemberBase() {
  return and(
    eq(team_members.is_published, true),
    isNull(team_members.deleted_at),
    teamMemberVisibilitySql(),
  );
}

const ADMIN_TEAM_ROLES = new Set(["super_admin", "state_admin", "city_admin"]);

/** Scenic Picsum leftovers from an earlier dummy — treat as missing. */
export function isScenicPlaceholderUrl(url: string | null | undefined): boolean {
  return !url || /picsum\.photos/i.test(url);
}

/** Distinct illustrated Jain-person portrait per card when there is no stored photo. */
export function dummyTeamPhotoUrl(
  memberId: string,
  gender?: "male" | "female" | "other" | null,
): string {
  const g = gender === "female" ? "f" : gender === "male" ? "m" : "";
  return g ? `/v1/team/portraits/${memberId}?g=${g}` : `/v1/team/portraits/${memberId}`;
}

export function designationFromRole(
  role: string | null,
  gender: "male" | "female" | "other" | null,
): { en: string | null; hi: string | null } {
  if (!role) return { en: null, hi: null };
  // Public Core Team: admins are photo + name only — never a role subtitle.
  if (ADMIN_TEAM_ROLES.has(role)) return { en: null, hi: null };

  if (role === "shikshak") {
    if (gender === "male") {
      return {
        en: t("team.designation.shikshak_male", "en"),
        hi: t("team.designation.shikshak_male", "hi"),
      };
    }
    if (gender === "female") {
      return {
        en: t("team.designation.shikshak_female", "en"),
        hi: t("team.designation.shikshak_female", "hi"),
      };
    }
    // Gender unknown — neutral bilingual label (never the raw word "Shikshak" alone).
    return {
      en: t("team.designation.shikshak", "en"),
      hi: t("team.designation.shikshak", "hi"),
    };
  }

  const key = `team.designation.${role}`;
  const en = t(key, "en");
  const hi = t(key, "hi");
  // Empty string from catalog (super_admin) → null
  return {
    en: en && en !== key ? en : null,
    hi: hi && hi !== key ? hi : null,
  };
}

/** Privacy-safe card — never emits phone/email/dob/gender. */
export function serializeTeamMember(
  row: MemberRow,
  opts?: { centre_names?: string[]; overridePhotoUrl?: string | null },
): TeamMemberCard {
  const nameFallback = row.user_full_name?.trim() || row.display_name_en?.trim() || "—";
  const name_en = row.display_name_en?.trim() || nameFallback;
  const name_hi = row.display_name_hi?.trim() || nameFallback;

  const isAdmin = row.user_role != null && ADMIN_TEAM_ROLES.has(row.user_role);
  const roleDefaults = designationFromRole(row.user_role, row.user_gender);
  const designation_en = isAdmin ? null : row.designation_en?.trim() || roleDefaults.en;
  const designation_hi = isAdmin ? null : row.designation_hi?.trim() || roleDefaults.hi;

  const photo_asset_id = row.photo_override_asset_id;
  const storedPhoto = opts?.overridePhotoUrl ?? row.user_photo_url ?? null;
  const photo_url = isScenicPlaceholderUrl(storedPhoto)
    ? dummyTeamPhotoUrl(row.id, row.user_gender)
    : signUploadUrl(storedPhoto);
  // #region agent log
  fetch("http://127.0.0.1:7744/ingest/33975112-0421-4ef6-a79e-c48c452c7ec5", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "0083e4" },
    body: JSON.stringify({
      sessionId: "0083e4",
      runId: "post-fix",
      hypothesisId: "B",
      location: "team-public.ts:serializeTeamMember",
      message: "team photo emit",
      data: {
        id: row.id,
        hasUserPhoto: Boolean(row.user_photo_url),
        hasOverride: Boolean(photo_asset_id),
        kind: photo_url.includes("/uploads/")
          ? "upload"
          : photo_url.includes("/portraits/")
            ? "dummy"
            : "other",
        hasSig: /[?&]sig=/.test(photo_url),
      },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion

  const card: TeamMemberCard = {
    id: row.id,
    honorific: row.honorific,
    name_en,
    name_hi,
    designation_en,
    designation_hi,
    bio_en: isAdmin ? null : row.bio_en,
    bio_hi: isAdmin ? null : row.bio_hi,
    photo_asset_id,
    photo_url,
    associated_since: row.associated_since,
    is_in_memoriam: row.is_in_memoriam,
    scope_level: row.scope_level,
    order: row.order,
  };
  if (!isAdmin && opts?.centre_names && opts.centre_names.length > 0) {
    card.centre_names = opts.centre_names;
  }
  return card;
}

const memberSelect = {
  id: team_members.id,
  honorific: team_members.honorific,
  display_name_en: team_members.display_name_en,
  display_name_hi: team_members.display_name_hi,
  designation_en: team_members.designation_en,
  designation_hi: team_members.designation_hi,
  bio_en: team_members.bio_en,
  bio_hi: team_members.bio_hi,
  photo_override_asset_id: team_members.photo_override_asset_id,
  associated_since: team_members.associated_since,
  is_in_memoriam: team_members.is_in_memoriam,
  scope_level: team_members.scope_level,
  order: team_members.order,
  category_id: team_members.category_id,
  category_key: team_categories.key,
  user_id: team_members.user_id,
  // Explicit user columns only — never select *.
  user_full_name: users.full_name,
  user_role: users.role,
  user_gender: users.gender,
  user_photo_url: users.photo_url,
  state_id: team_members.state_id,
  city_id: team_members.city_id,
  centre_id: team_members.centre_id,
};

async function loadPublishedCategories(): Promise<TeamCategoryPublic[]> {
  const rows = await db
    .select({
      id: team_categories.id,
      key: team_categories.key,
      name_en: team_categories.name_en,
      name_hi: team_categories.name_hi,
      display_style: team_categories.display_style,
      group_by: team_categories.group_by,
      is_lazy_loaded: team_categories.is_lazy_loaded,
      order: team_categories.order,
    })
    .from(team_categories)
    .where(eq(team_categories.is_published, true))
    .orderBy(asc(team_categories.order), asc(team_categories.key));
  return rows.map((r) => ({ ...r, member_count: 0 }));
}

async function fetchMembers(where: SQL | undefined): Promise<MemberRow[]> {
  const rows = await db
    .select(memberSelect)
    .from(team_members)
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(publishedMemberBase(), where))
    .orderBy(asc(team_members.order), asc(team_members.id));
  return rows as MemberRow[];
}

async function sanchalakCentreNames(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      user_id: sanchalak_centre_assignments.user_id,
      centre_name: centres.name,
    })
    .from(sanchalak_centre_assignments)
    .innerJoin(centres, eq(centres.id, sanchalak_centre_assignments.centre_id))
    .where(
      and(
        inArray(sanchalak_centre_assignments.user_id, userIds),
        eq(sanchalak_centre_assignments.is_active, true),
        eq(centres.status, "active"),
        isNull(centres.deleted_at),
      ),
    )
    .orderBy(asc(centres.order), asc(centres.name));
  for (const r of rows) {
    const list = map.get(r.user_id) ?? [];
    if (!list.includes(r.centre_name)) list.push(r.centre_name);
    map.set(r.user_id, list);
  }
  return map;
}

function serializeWithCentres(rows: MemberRow[], centreNames: Map<string, string[]>): TeamMemberCard[] {
  return rows.map((r) =>
    serializeTeamMember(r, {
      centre_names: r.user_id ? centreNames.get(r.user_id) : undefined,
    }),
  );
}

/* ─── National / state landing ─── */

export async function buildNationalTeamPayload() {
  const categories = await loadPublishedCategories();
  const members = await fetchMembers(
    inArray(team_members.scope_level, ["national", "state"]),
  );

  const sanchalakIds = members
    .filter((m) => m.category_key === "sanchalak" && m.user_id)
    .map((m) => m.user_id!);
  const centreNames = await sanchalakCentreNames(sanchalakIds);

  const stateIds = [...new Set(members.map((m) => m.state_id).filter(Boolean))] as string[];
  const stateNameById = new Map<string, string>();
  if (stateIds.length > 0) {
    const st = await db
      .select({ id: states.id, name: states.name })
      .from(states)
      .where(inArray(states.id, stateIds));
    for (const s of st) stateNameById.set(s.id, s.name);
  }

  const categoryBlocks = categories.map((cat) => {
    const catMembers = members.filter((m) => m.category_id === cat.id);
    const national = serializeWithCentres(
      catMembers.filter((m) => m.scope_level === "national"),
      centreNames,
    );
    const byState = new Map<string, MemberRow[]>();
    for (const m of catMembers.filter((m) => m.scope_level === "state")) {
      if (!m.state_id) continue;
      const list = byState.get(m.state_id) ?? [];
      list.push(m);
      byState.set(m.state_id, list);
    }
    const statesBlock = [...byState.entries()]
      .map(([stateId, rows]) => ({
        state_id: stateId,
        state_name: stateNameById.get(stateId) ?? "—",
        members: serializeWithCentres(rows, centreNames),
      }))
      .sort((a, b) => a.state_name.localeCompare(b.state_name));

    return {
      ...cat,
      member_count: catMembers.length,
      members: national,
      states: statesBlock,
    };
  });

  // City index — only cities with ≥1 published member (any scope that carries city_id).
  const cityRows = await db
    .select({
      id: cities.id,
      slug: cities.slug,
      name: cities.name,
      state_name: states.name,
      member_count: sql<number>`count(distinct ${team_members.id})::int`,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.state_id))
    .innerJoin(team_members, eq(team_members.city_id, cities.id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(publishedMemberBase())
    .groupBy(cities.id, cities.slug, cities.name, states.name)
    .having(sql`count(distinct ${team_members.id}) > 0`)
    .orderBy(asc(states.name), asc(cities.name));

  return {
    categories: categoryBlocks,
    cities: cityRows,
  };
}

/* ─── Shikshak centres (shared city + centre detail path) ─── */

export type CentreCursor = { order: number; id: string };

export function encodeCentreCursor(order: number, id: string): string {
  return Buffer.from(`${order}|${id}`, "utf8").toString("base64url");
}

export function decodeCentreCursor(raw: unknown): CentreCursor | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("|");
    if (i < 0) return null;
    const order = Number(decoded.slice(0, i));
    const id = decoded.slice(i + 1);
    if (!Number.isFinite(order) || !UUID_RE.test(id)) return null;
    return { order, id };
  } catch {
    return null;
  }
}

/**
 * Centres in a city (or a single centre) that have ≥1 published shikshak
 * teaching there via shikshak_batch_assignments — keyset on (order, id),
 * or offset page for crawlable `?page=N` URLs.
 *
 * Always returns full per-centre rosters (never a partial person page).
 */
export async function loadShikshakCentrePage(opts: {
  cityId?: string;
  centreId?: string;
  cursor?: CentreCursor | null;
  /** 0-based centre offset; ignored when cursor is set. */
  offset?: number;
  limit?: number;
}): Promise<{
  centres: Array<{ id: string; name: string; order: number; members: TeamMemberCard[] }>;
  next_cursor: string | null;
  member_count: number;
  total_centres: number;
}> {
  const limit = opts.limit ?? SHIKSHAK_CENTRES_PAGE_SIZE;
  const offset = Math.max(0, opts.offset ?? 0);

  // Distinct centres that host at least one visible published shikshak via batches.
  const centreConditions: SQL[] = [
    eq(centres.status, "active"),
    isNull(centres.deleted_at),
    eq(team_categories.group_by, "centre"),
    eq(team_categories.is_lazy_loaded, true),
    publishedMemberBase()!,
    eq(shikshak_batch_assignments.is_active, true),
    eq(batches.status, "active"),
    isNull(batches.deleted_at),
  ];
  if (opts.cityId) centreConditions.push(eq(centres.city_id, opts.cityId));
  if (opts.centreId) centreConditions.push(eq(centres.id, opts.centreId));
  if (opts.cursor) {
    centreConditions.push(
      or(
        gt(centres.order, opts.cursor.order),
        and(eq(centres.order, opts.cursor.order), gt(centres.id, opts.cursor.id)),
      )!,
    );
  }

  let centreQuery = db
    .selectDistinct({
      id: centres.id,
      name: centres.name,
      order: centres.order,
    })
    .from(centres)
    .innerJoin(batches, eq(batches.centre_id, centres.id))
    .innerJoin(
      shikshak_batch_assignments,
      eq(shikshak_batch_assignments.batch_id, batches.id),
    )
    .innerJoin(team_members, eq(team_members.user_id, shikshak_batch_assignments.user_id))
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(...centreConditions))
    .orderBy(asc(centres.order), asc(centres.id))
    .$dynamic();

  // Cursor path is keyset (no offset). Offset/page path is for crawlable ?page=N.
  if (!opts.cursor && offset > 0) {
    centreQuery = centreQuery.offset(offset);
  }
  const centrePage = await centreQuery.limit(limit + 1);

  const hasMore = centrePage.length > limit;
  const page = hasMore ? centrePage.slice(0, limit) : centrePage;
  const next_cursor =
    hasMore && page.length > 0
      ? encodeCentreCursor(page[page.length - 1]!.order, page[page.length - 1]!.id)
      : null;

  if (page.length === 0) {
    const total_centres = await countShikshakCentres(opts);
    return { centres: [], next_cursor: null, member_count: 0, total_centres };
  }

  const centreIds = page.map((c) => c.id);

  // Full roster per centre — render-time expansion of one team_members row per person.
  const rosterRows = await db
    .select({
      roster_centre_id: centres.id,
      id: team_members.id,
      honorific: team_members.honorific,
      display_name_en: team_members.display_name_en,
      display_name_hi: team_members.display_name_hi,
      designation_en: team_members.designation_en,
      designation_hi: team_members.designation_hi,
      bio_en: team_members.bio_en,
      bio_hi: team_members.bio_hi,
      photo_override_asset_id: team_members.photo_override_asset_id,
      associated_since: team_members.associated_since,
      is_in_memoriam: team_members.is_in_memoriam,
      scope_level: team_members.scope_level,
      order: team_members.order,
      category_id: team_members.category_id,
      category_key: team_categories.key,
      user_id: team_members.user_id,
      user_full_name: users.full_name,
      user_role: users.role,
      user_gender: users.gender,
      user_photo_url: users.photo_url,
      state_id: team_members.state_id,
      city_id: team_members.city_id,
      centre_id: team_members.centre_id,
    })
    .from(centres)
    .innerJoin(batches, eq(batches.centre_id, centres.id))
    .innerJoin(
      shikshak_batch_assignments,
      and(
        eq(shikshak_batch_assignments.batch_id, batches.id),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .innerJoin(team_members, eq(team_members.user_id, shikshak_batch_assignments.user_id))
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(
      and(
        inArray(centres.id, centreIds),
        eq(team_categories.group_by, "centre"),
        eq(team_categories.is_lazy_loaded, true),
        publishedMemberBase(),
        eq(batches.status, "active"),
        isNull(batches.deleted_at),
      ),
    )
    .orderBy(asc(centres.id), asc(team_members.order), asc(team_members.id));

  const byCentre = new Map<string, TeamMemberCard[]>();
  const seen = new Set<string>();
  for (const r of rosterRows) {
    const dedupeKey = `${r.roster_centre_id}:${r.id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const card = serializeTeamMember(r as MemberRow);
    const list = byCentre.get(r.roster_centre_id) ?? [];
    list.push(card);
    byCentre.set(r.roster_centre_id, list);
  }

  // Total distinct shikshak members in scope (for section header) — not just this page.
  const countConditions: SQL[] = [
    eq(team_categories.group_by, "centre"),
    eq(team_categories.is_lazy_loaded, true),
    publishedMemberBase()!,
    eq(shikshak_batch_assignments.is_active, true),
    eq(batches.status, "active"),
    isNull(batches.deleted_at),
    eq(centres.status, "active"),
    isNull(centres.deleted_at),
  ];
  if (opts.cityId) countConditions.push(eq(centres.city_id, opts.cityId));
  if (opts.centreId) countConditions.push(eq(centres.id, opts.centreId));

  const [countRow] = await db
    .select({
      n: sql<number>`count(distinct ${team_members.id})::int`,
    })
    .from(team_members)
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .innerJoin(
      shikshak_batch_assignments,
      eq(shikshak_batch_assignments.user_id, team_members.user_id),
    )
    .innerJoin(batches, eq(batches.id, shikshak_batch_assignments.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(...countConditions));

  const total_centres = await countShikshakCentres(opts);

  return {
    centres: page.map((c) => ({
      id: c.id,
      name: c.name,
      order: c.order,
      members: byCentre.get(c.id) ?? [],
    })),
    next_cursor,
    member_count: Number(countRow?.n ?? 0),
    total_centres,
  };
}

/** Distinct centres with ≥1 published shikshak — drives total_pages for ?page=N. */
async function countShikshakCentres(opts: {
  cityId?: string;
  centreId?: string;
}): Promise<number> {
  const countConditions: SQL[] = [
    eq(centres.status, "active"),
    isNull(centres.deleted_at),
    eq(team_categories.group_by, "centre"),
    eq(team_categories.is_lazy_loaded, true),
    publishedMemberBase()!,
    eq(shikshak_batch_assignments.is_active, true),
    eq(batches.status, "active"),
    isNull(batches.deleted_at),
  ];
  if (opts.cityId) countConditions.push(eq(centres.city_id, opts.cityId));
  if (opts.centreId) countConditions.push(eq(centres.id, opts.centreId));

  const [row] = await db
    .select({
      n: sql<number>`count(distinct ${centres.id})::int`,
    })
    .from(centres)
    .innerJoin(batches, eq(batches.centre_id, centres.id))
    .innerJoin(
      shikshak_batch_assignments,
      eq(shikshak_batch_assignments.batch_id, batches.id),
    )
    .innerJoin(team_members, eq(team_members.user_id, shikshak_batch_assignments.user_id))
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(...countConditions));

  return Number(row?.n ?? 0);
}

/* ─── City + single-centre payloads (same query path) ─── */

export async function resolveCityBySlug(slug: string) {
  const [row] = await db
    .select({
      id: cities.id,
      slug: cities.slug,
      name: cities.name,
      state_id: cities.state_id,
      state_name: states.name,
    })
    .from(cities)
    .innerJoin(states, eq(states.id, cities.state_id))
    .where(eq(cities.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function cityHasPublishedMembers(cityId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: team_members.id })
    .from(team_members)
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(publishedMemberBase(), eq(team_members.city_id, cityId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Slugs for cities with ≥1 published Team member.
 * Use for generateStaticParams / prerender when the Next public site ships.
 */
export async function listPublishedTeamCitySlugs(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ slug: cities.slug })
    .from(cities)
    .innerJoin(team_members, eq(team_members.city_id, cities.id))
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(publishedMemberBase())
    .orderBy(asc(cities.slug));
  return rows.map((r) => r.slug);
}

export async function buildCityTeamPayload(
  cityId: string,
  opts?: {
    /** 1-based crawlable page — centres for pages 1..page (cumulative). */
    page?: number;
    shikshakCursor?: CentreCursor | null;
    shikshakLimit?: number;
  },
) {
  const categories = await loadPublishedCategories();
  const requestedPage = Math.max(1, Math.floor(opts?.page ?? 1));

  // Non–centre-grouped members for this city (lazy shikshak page loads separately).
  const flatMembers = await fetchMembers(
    and(
      eq(team_members.city_id, cityId),
      sql`${team_categories.group_by} <> 'centre'`,
    ),
  );

  const sanchalakIds = flatMembers
    .filter((m) => m.category_key === "sanchalak" && m.user_id)
    .map((m) => m.user_id!);
  const centreNames = await sanchalakCentreNames(sanchalakIds);

  // Cumulative 1..requestedPage so ?page=N is crawlable without JS.
  const shikshakPage = await loadShikshakCentrePage({
    cityId,
    cursor: opts?.shikshakCursor ?? null,
    limit: opts?.shikshakLimit ?? requestedPage * SHIKSHAK_CENTRES_PAGE_SIZE,
  });

  const total_centres = shikshakPage.total_centres;
  const total_pages = Math.max(1, Math.ceil(total_centres / SHIKSHAK_CENTRES_PAGE_SIZE) || 1);
  const page = Math.min(requestedPage, total_pages);
  const centreCap = page * SHIKSHAK_CENTRES_PAGE_SIZE;
  const centres = shikshakPage.centres.slice(0, centreCap);
  const last = centres[centres.length - 1];
  const next_cursor =
    centres.length < total_centres && last
      ? encodeCentreCursor(last.order, last.id)
      : null;

  const blocks = categories.map((cat) => {
    if (cat.group_by === "centre" || cat.is_lazy_loaded) {
      return {
        ...cat,
        member_count: shikshakPage.member_count,
        members: [] as TeamMemberCard[],
        centres,
        next_cursor,
      };
    }
    const rows = flatMembers.filter((m) => m.category_id === cat.id);
    return {
      ...cat,
      member_count: rows.length,
      members: serializeWithCentres(rows, centreNames),
      centres: [] as Array<{ id: string; name: string; order: number; members: TeamMemberCard[] }>,
      next_cursor: null as string | null,
    };
  });

  return {
    categories: blocks,
    shikshak_next_cursor: next_cursor,
    page,
    page_size: SHIKSHAK_CENTRES_PAGE_SIZE,
    total_pages,
    total_centres,
  };
}

/**
 * Centre Locator detail — sanchalak + shikshak for one Pathshala.
 * Same loaders as the city page, narrower filter (no second data path).
 */
export async function buildCentreTeamPayload(centreId: string) {
  const [centre] = await db
    .select({
      id: centres.id,
      name: centres.name,
      city_id: centres.city_id,
      status: centres.status,
    })
    .from(centres)
    .where(and(eq(centres.id, centreId), isNull(centres.deleted_at)))
    .limit(1);
  if (!centre || centre.status !== "active") return null;

  const categories = await loadPublishedCategories();
  const wanted = categories.filter((c) => c.key === "sanchalak" || c.group_by === "centre");

  // Sanchalaks assigned to this centre (via assignment table), with published cards.
  const sanchalakRows = await db
    .select(memberSelect)
    .from(team_members)
    .innerJoin(team_categories, eq(team_categories.id, team_members.category_id))
    .innerJoin(
      sanchalak_centre_assignments,
      and(
        eq(sanchalak_centre_assignments.user_id, team_members.user_id),
        eq(sanchalak_centre_assignments.centre_id, centreId),
        eq(sanchalak_centre_assignments.is_active, true),
      ),
    )
    .leftJoin(users, eq(users.id, team_members.user_id))
    .where(and(publishedMemberBase(), eq(team_categories.group_by, "none"), sql`${team_categories.key} = 'sanchalak'`))
    .orderBy(asc(team_members.order), asc(team_members.id));

  const sanchalakIds = sanchalakRows.map((r) => r.user_id).filter(Boolean) as string[];
  const centreNames = await sanchalakCentreNames(sanchalakIds);

  const shikshakPage = await loadShikshakCentrePage({
    centreId,
    limit: 1000, // single centre — full roster, no lazy page
  });

  const blocks = wanted.map((cat) => {
    if (cat.group_by === "centre" || cat.is_lazy_loaded) {
      const members = shikshakPage.centres[0]?.members ?? [];
      return {
        ...cat,
        member_count: shikshakPage.member_count,
        members,
        centres: shikshakPage.centres,
      };
    }
    const members = serializeWithCentres(sanchalakRows as MemberRow[], centreNames);
    return {
      ...cat,
      member_count: members.length,
      members,
      centres: [] as typeof shikshakPage.centres,
    };
  });

  return {
    centre: { id: centre.id, name: centre.name, city_id: centre.city_id },
    categories: blocks,
  };
}
