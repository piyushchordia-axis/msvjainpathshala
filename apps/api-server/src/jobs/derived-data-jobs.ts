/**
 * Frozen cron table registrations beyond session lifecycle (CLAUDE.md).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import { registerQueueHandler, enqueueJob } from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { runConsecutiveAbsenceCheck } from "../services/consecutive-absence";
import { bindAttendancePostProcessListeners, runAttendancePostProcess } from "../services/attendance-post-process";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger";

let registered = false;

const CANONICAL_MVS = [
  "mv_centre_engagement",
  "mv_city_attendance_monthly",
  "mv_donation_summary",
  "mv_msv_funnel",
  "mv_punya_distribution",
  "mv_niyam_completion",
  "mv_monthly_leaderboard_city",
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

  bindAttendancePostProcessListeners();

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_POST_PROCESS, async (data) => {
    const sessionId = String((data as { session_id?: string }).session_id ?? "");
    if (sessionId) await runAttendancePostProcess(sessionId);
  });

  registerQueueHandler(QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK, async () => {
    await runConsecutiveAbsenceCheck();
  });

  registerQueueHandler(QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH, async () => {
    try {
      await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY mv_monthly_leaderboard_city`));
    } catch {
      await db.execute(sql.raw(`REFRESH MATERIALIZED VIEW mv_monthly_leaderboard_city`));
    }
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
