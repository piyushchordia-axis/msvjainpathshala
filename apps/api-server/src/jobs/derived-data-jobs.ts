/**
 * Frozen cron table registrations beyond session lifecycle (CLAUDE.md).
 */
import { QUEUE_NAMES, CRON_EXPRESSIONS } from "@jp/shared/constants";
import {
  registerQueueHandler,
  enqueueJob,
  dailyCronJobId,
  slotCronJobId,
} from "../lib/queues";
import { registerCron } from "../lib/scheduler";
import { runConsecutiveAbsenceCheck } from "../services/consecutive-absence";
import {
  runAttendancePostProcess,
  sendParentAttendancePush,
} from "../services/attendance-post-process";
import { notifyParentsOfGalleryWallFeature } from "../lib/gallery-wall-notify";
import { snapshotMonthlyLeaderboard } from "../services/monthly-leaderboard-snapshot";
import { todayIst } from "../services/session-materialise";
import { sweepPushReceipts } from "../lib/push";
import { db, dbWorker } from "@workspace/db";
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
  // dbWorker: MV refresh routinely exceeds the API statement_timeout (PERF #3).
  for (const name of CANONICAL_MVS) {
    try {
      await dbWorker.execute(sql.raw(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${name}`));
    } catch (err) {
      // Empty / first refresh may lack a unique index snapshot — fall back.
      try {
        await dbWorker.execute(sql.raw(`REFRESH MATERIALIZED VIEW ${name}`));
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
    if (kind === "shivir_scanned") {
      // SPEC 8.6 step 6. The `shivir` notification kind has existed in the enum
      // since the baseline migration and no code had ever sent it, so a parent
      // whose child arrived at a camp heard nothing.
      const studentId = String((data as { student_id?: string }).student_id ?? "");
      const sessionId = String((data as { session_id?: string }).session_id ?? "");
      const scanKind = String((data as { scan_kind?: string }).scan_kind ?? "present");
      if (!studentId || !sessionId) {
        throw new Error("notifications.parent shivir_scanned missing ids");
      }
      const { sendParentShivirPush } = await import("../lib/shivir-notify");
      await sendParentShivirPush(
        studentId,
        sessionId,
        scanKind === "check_in" || scanKind === "check_out" ? scanKind : "present",
      );
      return;
    }
    if (kind === "shivir_published") {
      // Unbounded fan-out (every parent in the city), so it belongs on the
      // worker rather than inside the API request that published the shivir.
      const shivirId = String((data as { shivir_id?: string }).shivir_id ?? "");
      if (!shivirId) throw new Error("notifications.parent shivir_published missing shivir_id");
      const { announceShivirPublished } = await import("../lib/shivir-notify");
      await announceShivirPublished(shivirId);
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
    if (kind === "homework_bulk_graded") {
      const raw = (data as { student_ids?: unknown }).student_ids;
      const studentIds = Array.isArray(raw)
        ? raw.map((id) => String(id)).filter(Boolean)
        : [];
      const status = String((data as { status?: string }).status ?? "approved");
      const assignmentId = String((data as { assignment_id?: string }).assignment_id ?? "");
      if (studentIds.length === 0 || !assignmentId) return;
      const { notifyParentsHomeworkBulkGraded } = await import("../lib/homework-notify");
      await notifyParentsHomeworkBulkGraded({
        studentIds,
        status: status === "starred" ? "starred" : "approved",
        assignmentId,
      });
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
    // dbWorker: full-ledger aggregate can exceed the API statement_timeout.
    await dbWorker.execute(sql`
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
      await enqueueJob(
        QUEUE_NAMES.ATTENDANCE_CONSECUTIVE_CHECK,
        {},
        { jobId: dailyCronJobId("consecutive", todayIst()) },
      );
    },
  );

  registerQueueHandler(QUEUE_NAMES.NOTIFICATIONS_PUSH_RECEIPTS, async () => {
    const result = await sweepPushReceipts();
    if (result.checked > 0 || result.deactivated > 0) {
      logger.info(result, "notifications.push_receipts sweep");
    }
  });

  registerCron(
    QUEUE_NAMES.NOTIFICATIONS_PUSH_RECEIPTS,
    CRON_EXPRESSIONS.NOTIFICATIONS_PUSH_RECEIPTS,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.NOTIFICATIONS_PUSH_RECEIPTS,
        {},
        { jobId: slotCronJobId("push_receipts", 30) },
      );
    },
  );

  registerCron(
    QUEUE_NAMES.NOTIFICATIONS_MONTHLY_REPORTS,
    CRON_EXPRESSIONS.NOTIFICATIONS_MONTHLY_REPORTS,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.NOTIFICATIONS_MONTHLY_REPORTS,
        {},
        { jobId: dailyCronJobId("monthly_reports", todayIst()) },
      );
    },
  );

  registerCron(
    QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH,
    CRON_EXPRESSIONS.PUNYA_LEADERBOARD_REFRESH,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.PUNYA_LEADERBOARD_REFRESH,
        {},
        { jobId: slotCronJobId("leaderboard", 5) },
      );
    },
  );

  registerCron(QUEUE_NAMES.PUNYA_RECONCILE, CRON_EXPRESSIONS.PUNYA_RECONCILE, async () => {
    await enqueueJob(
      QUEUE_NAMES.PUNYA_RECONCILE,
      {},
      { jobId: dailyCronJobId("punya_reconcile", todayIst()) },
    );
  });

  registerCron(
    QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS,
    CRON_EXPRESSIONS.ANALYTICS_REFRESH_VIEWS,
    async () => {
      await enqueueJob(
        QUEUE_NAMES.ANALYTICS_REFRESH_VIEWS,
        {},
        { jobId: dailyCronJobId("analytics_mv", todayIst()) },
      );
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
    const { runRetentionPrune } = await import("../lib/retention");
    const pruned = await runRetentionPrune();
    if (pruned.sync_operations_deleted > 0 || pruned.notifications_deleted > 0) {
      logger.info(
        {
          sync_operations_deleted: pruned.sync_operations_deleted,
          notifications_deleted: pruned.notifications_deleted,
        },
        "retention prune",
      );
    }
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
