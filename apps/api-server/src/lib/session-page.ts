/**
 * Page sessions first, then LATERAL aggregate counts for that page only.
 * Avoids GROUP BY … ORDER BY … LIMIT over the full sessions × attendance product.
 */
import { db, sessions, batches, centres, users } from "@workspace/db";
import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_WINDOW_DAYS = 180;

export type SessionListCursor = { date: string; id: string };

export function encodeSessionCursor(date: string, id: string): string {
  return Buffer.from(`${date}|${id}`, "utf8").toString("base64url");
}

export function decodeSessionCursor(raw: unknown): SessionListCursor | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("|");
    if (i < 0) return null;
    const date = decoded.slice(0, i);
    const id = decoded.slice(i + 1);
    if (!DATE_RE.test(date) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
    return { date, id };
  } catch {
    return null;
  }
}

/** Asia/Kolkata calendar date minus N days → YYYY-MM-DD. */
export function kolkataDateMinusDays(days: number, when = new Date()): string {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export type PagedSessionRow = {
  id: string;
  session_date: string;
  status: string;
  topic: string | null;
  batch_id: string;
  batch_name: string;
  centre_name: string;
  centre_id: string;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  gps_required?: boolean;
  unscheduled?: boolean;
  gps_flagged?: boolean;
  gps_unverified?: boolean;
  check_in_at?: Date | null;
  check_out_at?: Date | null;
  check_in_distance_m?: number | null;
  check_out_distance_m?: number | null;
  duration_minutes?: number | null;
  auto_checked_out?: boolean;
  has_gps?: boolean;
  conducted_by?: string | null;
  conducted_by_name?: string | null;
  present_count: number;
  total_count: number;
};

/**
 * Page the sessions table, then LATERAL-count attendance for those rows only.
 * `extraSelect` is unused — callers pass filters; optional date window defaults to 180 days.
 */
export async function pageSessionsWithAttendanceCounts(opts: {
  filters: SQL[];
  limit: number;
  cursor?: SessionListCursor | null;
  /** When null, no default window. When number, scheduled_date >= today-N unless caller already filtered. */
  windowDays?: number | null;
  /** Extra columns from the page query (today route). */
  forToday?: boolean;
}): Promise<{
  items: PagedSessionRow[];
  hasMore: boolean;
  nextCursor: string | null;
  windowFrom: string | null;
  windowDays: number | null;
}> {
  const limit = opts.limit;
  const filters = [...opts.filters];

  let windowFrom: string | null = null;
  const windowDays =
    opts.windowDays === undefined ? DEFAULT_WINDOW_DAYS : opts.windowDays;
  if (windowDays !== null) {
    windowFrom = kolkataDateMinusDays(windowDays);
    filters.push(gte(sessions.scheduled_date, windowFrom));
  }

  if (opts.cursor) {
    filters.push(
      or(
        lt(sessions.scheduled_date, opts.cursor.date),
        and(eq(sessions.scheduled_date, opts.cursor.date), lt(sessions.id, opts.cursor.id)),
      )!,
    );
  }

  const baseSelect = {
    id: sessions.id,
    session_date: sessions.scheduled_date,
    status: sessions.status,
    topic: sessions.topic,
    batch_id: sessions.batch_id,
    batch_name: batches.name,
    centre_name: centres.name,
    centre_id: batches.centre_id,
  };

  const conductor = alias(users, "session_conductor");

  const todaySelect = opts.forToday
    ? {
        ...baseSelect,
        scheduled_start_time: sessions.scheduled_start_time,
        scheduled_end_time: sessions.scheduled_end_time,
        gps_required: sessions.gps_required,
        unscheduled: sessions.unscheduled,
        gps_flagged: sessions.gps_flagged,
        gps_unverified: sessions.gps_unverified,
        check_in_at: sessions.check_in_at,
        check_out_at: sessions.check_out_at,
        check_in_distance_m: sessions.check_in_distance_m,
        check_out_distance_m: sessions.check_out_distance_m,
        duration_minutes: sessions.duration_minutes,
        auto_checked_out: sessions.auto_checked_out,
        conducted_by: sessions.conducted_by,
        conducted_by_name: conductor.full_name,
        has_gps: sql<boolean>`(${centres.lat} is not null and ${centres.lng} is not null)`,
      }
    : {
        ...baseSelect,
        gps_required: sessions.gps_required,
        conducted_by: sessions.conducted_by,
        conducted_by_name: conductor.full_name,
      };

  const pageRows = await db
    .select(todaySelect)
    .from(sessions)
    .innerJoin(batches, eq(batches.id, sessions.batch_id))
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .leftJoin(conductor, eq(conductor.id, sessions.conducted_by))
    .where(and(...filters))
    .orderBy(
      desc(sessions.scheduled_date),
      desc(opts.forToday ? sessions.scheduled_start_time : sessions.id),
      desc(sessions.id),
    )
    .limit(limit + 1);

  const hasMore = pageRows.length > limit;
  const page = hasMore ? pageRows.slice(0, limit) : pageRows;

  const countById = new Map<string, { present_count: number; total_count: number }>();
  if (page.length > 0) {
    const idArray = sql`array[${sql.join(
      page.map((r) => sql`${r.id}::uuid`),
      sql`, `,
    )}]::uuid[]`;
    // AT5-style FILTER — never COUNT(boolean).
    const countResult = await db.execute(sql`
      select
        s.id,
        coalesce(cnt.present_count, 0)::int as present_count,
        coalesce(cnt.total_count, 0)::int as total_count
      from unnest(${idArray}) as s(id)
      left join lateral (
        select
          count(*) filter (where a.status in ('present', 'late'))::int as present_count,
          count(*)::int as total_count
        from attendance a
        where a.session_id = s.id
      ) cnt on true
    `);
    const countRows =
      (countResult as unknown as {
        rows?: Array<{ id: string; present_count: number; total_count: number }>;
      }).rows ?? [];
    for (const r of countRows) {
      countById.set(String(r.id), {
        present_count: Number(r.present_count),
        total_count: Number(r.total_count),
      });
    }
  }

  const items: PagedSessionRow[] = page.map((r) => {
    const c = countById.get(r.id) ?? { present_count: 0, total_count: 0 };
    const row = r as typeof r & {
      check_in_at?: Date | null;
      check_out_at?: Date | null;
      conducted_by?: string | null;
      conducted_by_name?: string | null;
    };
    return {
      ...row,
      session_date: String(row.session_date),
      check_in_at: row.check_in_at ?? null,
      check_out_at: row.check_out_at ?? null,
      conducted_by: row.conducted_by ?? null,
      conducted_by_name: row.conducted_by_name ?? null,
      present_count: c.present_count,
      total_count: c.total_count,
    };
  });

  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last ? encodeSessionCursor(last.session_date, last.id) : null;

  return {
    items,
    hasMore,
    nextCursor,
    windowFrom,
    windowDays,
  };
}
