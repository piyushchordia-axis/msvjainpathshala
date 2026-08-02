/**
 * Session materialisation (AT7–AT10).
 * Rolling 60-day forward window; ON CONFLICT DO NOTHING for BullMQ idempotency.
 * No historical backfill — past dates are never inserted.
 */
import {
  db,
  sessions,
  batches,
  centre_holidays,
  shikshak_batch_assignments,
} from "@workspace/db";
import { and, eq, gte, lte, sql, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { notifyUsers, parentUserIdsForBatch } from "../lib/notify";
import { enqueueJob } from "../lib/queues";
import { QUEUE_NAMES } from "@jp/shared/constants";

const WINDOW_DAYS = 60;

/** Calendar YYYY-MM-DD in Asia/Kolkata. */
export function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Add days to a YYYY-MM-DD string (UTC noon arithmetic — date-only safe). */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday 1=Mon … 7=Sun (matches batches.day_of_week). */
export function isoWeekday(ymd: string): number {
  const js = new Date(`${ymd}T12:00:00.000Z`).getUTCDay();
  return js === 0 ? 7 : js;
}

async function primaryShikshakForBatch(batchId: string): Promise<string | null> {
  const [primary] = await db
    .select({ user_id: shikshak_batch_assignments.user_id })
    .from(shikshak_batch_assignments)
    .where(
      and(
        eq(shikshak_batch_assignments.batch_id, batchId),
        eq(shikshak_batch_assignments.is_active, true),
        eq(shikshak_batch_assignments.is_primary, true),
      ),
    )
    .limit(1);
  if (primary) return primary.user_id;

  const [any] = await db
    .select({ user_id: shikshak_batch_assignments.user_id })
    .from(shikshak_batch_assignments)
    .where(
      and(
        eq(shikshak_batch_assignments.batch_id, batchId),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .limit(1);
  return any?.user_id ?? null;
}

async function holidayDatesForCentre(
  centreId: string,
  from: string,
  to: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ holiday_date: centre_holidays.holiday_date })
    .from(centre_holidays)
    .where(
      and(
        eq(centre_holidays.centre_id, centreId),
        gte(centre_holidays.holiday_date, from),
        lte(centre_holidays.holiday_date, to),
      ),
    );
  return new Set(rows.map((r) => r.holiday_date));
}

/** Expand one batch into the forward window. Returns rows attempted. */
export async function materialiseBatch(batchId: string): Promise<{ attempted: number; inserted: number }> {
  const [batch] = await db
    .select({
      id: batches.id,
      centre_id: batches.centre_id,
      day_of_week: batches.day_of_week,
      start_time: batches.start_time,
      end_time: batches.end_time,
      status: batches.status,
      deleted_at: batches.deleted_at,
    })
    .from(batches)
    .where(eq(batches.id, batchId))
    .limit(1);

  if (!batch || batch.status !== "active" || batch.deleted_at) {
    return { attempted: 0, inserted: 0 };
  }

  const from = todayIst();
  const to = addDays(from, WINDOW_DAYS - 1);
  const holidays = await holidayDatesForCentre(batch.centre_id, from, to);
  const days = new Set(batch.day_of_week ?? []);
  const shikshakId = await primaryShikshakForBatch(batch.id);

  if (!shikshakId) {
    logger.warn(
      { batch_id: batch.id },
      "materialise: batch has no shikshak; creating sessions with NULL shikshak_user_id",
    );
  }

  const values: Array<{
    batch_id: string;
    scheduled_date: string;
    scheduled_start_time: string;
    scheduled_end_time: string;
    status: "scheduled";
    shikshak_user_id: string | null;
  }> = [];

  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(from, i);
    if (!days.has(isoWeekday(date))) continue;
    if (holidays.has(date)) continue;
    values.push({
      batch_id: batch.id,
      scheduled_date: date,
      scheduled_start_time: batch.start_time,
      scheduled_end_time: batch.end_time,
      status: "scheduled",
      shikshak_user_id: shikshakId,
    });
  }

  if (values.length === 0) return { attempted: 0, inserted: 0 };

  // UNIQUE (batch_id, scheduled_date) — DO NOTHING on conflict (BullMQ retry-safe).
  const inserted = await db
    .insert(sessions)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: sessions.id });

  return { attempted: values.length, inserted: inserted.length };
}

/** Nightly job body: materialise every active batch. */
export async function materialiseAllActiveBatches(): Promise<{
  batches: number;
  attempted: number;
  inserted: number;
}> {
  const active = await db
    .select({ id: batches.id })
    .from(batches)
    .where(and(eq(batches.status, "active"), isNull(batches.deleted_at)));

  let attempted = 0;
  let inserted = 0;
  for (const b of active) {
    const r = await materialiseBatch(b.id);
    attempted += r.attempted;
    inserted += r.inserted;
  }
  logger.info({ batches: active.length, attempted, inserted }, "session.materialise complete");
  return { batches: active.length, attempted, inserted };
}

/**
 * AT9 — after timetable change: delete future empty scheduled sessions,
 * re-expand, notify parents.
 */
export async function rematerialiseBatch(batchId: string): Promise<{
  deleted: number;
  attempted: number;
  inserted: number;
}> {
  const deleted = await db.execute(sql`
    delete from sessions s
    where s.batch_id = ${batchId}::uuid
      and s.status = 'scheduled'
      and s.scheduled_date >= (${todayIst()})::date
      and not exists (select 1 from attendance a where a.session_id = s.id)
  `);
  const deletedCount =
    typeof (deleted as { rowCount?: number }).rowCount === "number"
      ? (deleted as { rowCount: number }).rowCount
      : 0;

  const { attempted, inserted } = await materialiseBatch(batchId);

  const parentIds = await parentUserIdsForBatch(batchId);
  await notifyUsers({
    userIds: parentIds,
    title_en: "Class timetable updated",
    title_hi: "कक्षा समय सारणी अपडेट",
    body_en: "Your child's batch schedule has changed. Upcoming class dates may differ.",
    body_hi: "आपके बच्चे की बैच समय सारणी बदल गई है। आगामी कक्षा की तिथियाँ भिन्न हो सकती हैं।",
  });

  // Optional parent-notify queue hop when Redis is available.
  await enqueueJob(QUEUE_NAMES.PARENT_NOTIFY, {
    batch_id: batchId,
    kind: "timetable_change",
  }).catch(() => undefined);

  return { deleted: deletedCount, attempted, inserted };
}

/**
 * AT10 — new holiday range: delete future empty scheduled sessions in range.
 * Sessions that already have attendance are left intact.
 */
export async function applyHolidayToSessions(
  centreId: string,
  start: string,
  end: string,
): Promise<{ deleted: number }> {
  const deleted = await db.execute(sql`
    delete from sessions s
    using batches b
    where s.batch_id = b.id
      and b.centre_id = ${centreId}::uuid
      and s.status = 'scheduled'
      and s.scheduled_date >= (${todayIst()})::date
      and s.scheduled_date >= ${start}::date
      and s.scheduled_date <= ${end}::date
      and not exists (select 1 from attendance a where a.session_id = s.id)
  `);
  const deletedCount =
    typeof (deleted as { rowCount?: number }).rowCount === "number"
      ? (deleted as { rowCount: number }).rowCount
      : 0;
  logger.info({ centreId, start, end, deleted: deletedCount }, "applyHolidayToSessions");
  return { deleted: deletedCount };
}
