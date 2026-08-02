/**
 * Frozen cron table registrations beyond session lifecycle (CLAUDE.md).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import { registerQueueHandler, enqueueJob } from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { runConsecutiveAbsenceCheck } from "../services/consecutive-absence";
import {
  runAttendancePostProcess,
  sendParentAttendancePush,
} from "../services/attendance-post-process";
import { notifyParentsOfGalleryWallFeature } from "../lib/gallery-wall-notify";
import { snapshotMonthlyLeaderboard } from "../services/monthly-leaderboard-snapshot";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let registered = false;

/** Canonical materialised views only — leaderboard is a TABLE now. */
const CANONICAL_MVS = [
  "mv_centre_engagement",
  "mv_city_attendance_monthly",
  "mv_donation_summary",
  "mv_msv_funnel",
  "mv_punya_distribution",
  "mv_niyam_completion",
] as const;

export async function refreshAnalyticsViews(): Promise<void> {
  for (const name of CANONICAL_MVS) {
    try {
      await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name}`));
    } catch (err) {
      // Empty / first refresh may lack a unique index snapshot — fall back.
      try {
        await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${name}`));
      } catch (err2) {
        logger.warn({ err: err2, name }, "MV refresh failed");
      }
      void err;
    }
  }
}

export function registerDerivedDataJobs(): void {
  if (registered) return;
  registered = true;

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_POST_PROCESS, async (data) => {
    const sessionId = String((data as { session_id?: string }).session_id ?? "");
    if (!sessionId) {
      throw new Error("attendance.post_process missing session_id");
    }
    await runAttendancePostProcess(sessionId);
  });

  registerQueueHandler(QUEUE_NAMES.PARENT_NOTIFY, async (data) => {
    const kind = String((data as { kind?: string }).kind ?? "");
    if (kind === "attendance_marked") {
      const studentId = String((data as { student_id?: string }).student_id ?? "");
      const sessionId = String((data as { session_id?: string }).session_id ?? "");
      if (!studentId || !sessionId) {
        throw new Error("notifications.parent attendance_marked missing ids");
      }
      await sendParentAttendancePush(studentId, sessionId);
      return;
    }
    if (kind === "gallery_wall_featured") {
      const raw = (data as { gallery_item_ids?: unknown }).gallery_item_ids;
      const ids = Array.isArray(raw)
        ? raw.map((id) => String(id)).filter(Boolean)
        : [];
      await notifyParentsOfGalleryWallFeature(ids);
      return;
    }
    // timetable_change etc. — push already sent inline by the producer.
    logger.debug({ data }, "parent notify job acknowledged");
  });

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK, async () => {
    await runConsecutiveAbsenceCheck();
  });

  registerQueueHandler(QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH, async () => {
    // Snapshots the month just ended (idempotent). Not a materialised-view refresh.
    const result = await snapshotMonthlyLeaderboard();
    logger.info(result, "monthly_leaderboard_snapshots upsert");
  });

  registerQueueHandler(QUEUE_NAMES.PUNYA_RECONCILE, async () => {
    // Recompute balances from ledger (idempotent safety net).
    await db.execute(sql`
      insert into punya_balances (student_id, total_points, tier)
      select student_id, coalesce(sum(points), 0)::int, 'jigyasu'
      from punya_transactions
      group by student_id
      on conflict (student_id) do update
        set total_points = excluded.total_points,
            updated_at = now()
    `);
  });

  registerQueueHandler(QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS, async () => {
    await refreshAnalyticsViews();
  });

  registerCron(
    QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK,
    CRON_EXPRESSIONS.ATTENDANCE_CONSECUTIVE_CHECK,
    async () => {
      await enqueueJob(QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK, {});
    },
  );

  registerCron(
    QUEUE_NAMES.NOTIFICATIONS_MONTHLY_REPORTS,
    CRON_EXPRESSIONS.NOTIFICATIONS_MONTHLY_REPORTS,
    async () => {
      logger.info("notifications.monthly_reports tick (report worker hooks later)");
    },
  );

  registerCron(
    QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH,
    CRON_EXPRESSIONS.PUNYA_LEADERBOARD_REFRESH,
    async () => {
      await enqueueJob(QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH, {});
    },
  );

  registerCron(QUEUE_NAMES.PUNYA_RECONCILE, CRON_EXPRESSIONS.PUNYA_RECONCILE, async () => {
    await enqueueJob(QUEUE_NAMES.PUNYA_RECONCILE, {});
  });

  registerCron(
    QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS,
    CRON_EXPRESSIONS.ANALYTICS_REFRESH_VIEWS,
    async () => {
      await enqueueJob(QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS, {});
    },
  );

  registerCron(QUEUE_NAMES.DIGEST_WEEKLY_EMAIL, CRON_EXPRESSIONS.DIGEST_WEEKLY_EMAIL, async () => {
    logger.info("digest.weekly.email tick");
  });

  registerCron(QUEUE_NAMES.AUTH_SESSION_CLEANUP, CRON_EXPRESSIONS.AUTH_SESSION_CLEANUP, async () => {
    await db.execute(sql`
      delete from device_sessions
      where expires_at < now()
         or (revoked_at is not null and revoked_at < now() - interval '30 days')
    `);
  });

  registerCron(
    QUEUE_NAMES.MEDIA_CLEANUP_UNFINALIZED,
    CRON_EXPRESSIONS.MEDIA_CLEANUP_UNFINALIZED,
    async () => {
      logger.info("media.cleanup_unfinalized tick");
    },
  );

  registerCron(
    QUEUE_NAMES.DONATION_EIGHTYG_YEAR_END,
    CRON_EXPRESSIONS.DONATION_EIGHTYG_YEAR_END,
    async () => {
      logger.info("donation.eightyg.year_end_summary tick");
    },
  );
}
