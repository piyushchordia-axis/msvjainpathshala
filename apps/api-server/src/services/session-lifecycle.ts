/**
 * Session check-in / check-out / cancel / auto-checkout / no-show (AT8, AT12–AT16, AT25).
 * Scope guards live HERE (service layer), not only in route middleware.
 */
import {
  db,
  sessions,
  attendance,
  batches,
  centres,
  students,
  shikshak_batch_assignments,
  type User,
} from "@workspace/db";
import { and, eq, sql, isNull, inArray } from "drizzle-orm";
import { haversineMeters } from "../lib/haversine";
import { logger } from "../lib/logger";
import { writeAudit } from "../lib/audit";
import {
  notifyUsers,
  sanchalakUserIdsForCentre,
  cityAdminUserIdsForCentre,
  parentUserIdsForBatch,
} from "../lib/notify";
import { reverseStreakBonusForSession } from "../lib/punya-streak";
import { reverseAttendanceAward } from "./attendance-mark";
import { todayIst } from "./session-materialise";
import { resolveAdminScope, inBatchWriteScope } from "../lib/scope";

const ACCURACY_UNVERIFIED_M = 100;

export class SessionLifecycleError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "SessionLifecycleError";
  }
}

type SessionRow = typeof sessions.$inferSelect;

async function loadBatchCentre(batchId: string) {
  const [row] = await db
    .select({
      batch_id: batches.id,
      centre_id: batches.centre_id,
      start_time: batches.start_time,
      end_time: batches.end_time,
      lat: centres.lat,
      lng: centres.lng,
      gps_radius_meters: centres.gps_radius_meters,
      centre_name: centres.name,
    })
    .from(batches)
    .innerJoin(centres, eq(centres.id, batches.centre_id))
    .where(and(eq(batches.id, batchId), isNull(batches.deleted_at)))
    .limit(1);
  return row ?? null;
}

/** Service-layer scope: shikshak own batches · sanchalak own centres · city_admin own city. */
export async function assertSessionActorScope(
  actor: User,
  batchId: string,
  centreId: string,
): Promise<void> {
  const scope = await resolveAdminScope(actor);
  if (!inBatchWriteScope(scope, batchId, centreId)) {
    throw new SessionLifecycleError(403, "ERR_FORBIDDEN", "Session is outside your scope.");
  }
}

function centreDistanceM(
  lat: number,
  lng: number,
  centreLat: string | null,
  centreLng: string | null,
): number | null {
  if (centreLat == null || centreLng == null) return null;
  return Math.round(haversineMeters(lat, lng, Number(centreLat), Number(centreLng)));
}

async function notifyGpsFlag(
  centreId: string,
  title_en: string,
  body_en: string,
  title_hi: string,
  body_hi: string,
): Promise<void> {
  const ids = await sanchalakUserIdsForCentre(centreId);
  await notifyUsers({ userIds: ids, title_en, title_hi, body_en, body_hi });
}

export type CheckInInput = {
  sessionId: string;
  actor: User;
  submissionOpId: string;
  lat: number;
  lng: number;
  accuracy_m: number;
  /** Required when soft-creating (AT8) because no session row matched. */
  batchId?: string;
  /** Offline sync may soft-create for a specific calendar date (defaults to today IST). */
  scheduledDate?: string;
};

export async function checkInSession(input: CheckInInput): Promise<SessionRow> {
  const { actor, submissionOpId, lat, lng, accuracy_m } = input;

  // AT16 — idempotency FIRST (before status assertion).
  const [byOp] = await db
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.submission_op_id, submissionOpId),
        eq(sessions.shikshak_user_id, actor.id),
      ),
    )
    .limit(1);
  if (byOp) return byOp;

  const [byId] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1);

  let session: SessionRow | null = byId ?? null;

  if (session?.check_in_at) {
    if (session.shikshak_user_id && session.shikshak_user_id !== actor.id) {
      const bc = await loadBatchCentre(session.batch_id);
      if (bc) {
        await notifyGpsFlag(
          bc.centre_id,
          "Duplicate check-in attempt",
          `Another Guruji tried to check in to an already started session at ${bc.centre_name}.`,
          "डुप्लिकेट चेक-इन प्रयास",
          `${bc.centre_name} पर पहले से शुरू सत्र में किसी अन्य गुरुजी ने चेक-इन करने का प्रयास किया।`,
        );
      }
      throw new SessionLifecycleError(
        409,
        "ERR_ALREADY_CHECKED_IN_BY_OTHER",
        "This session was already checked in by another Guruji.",
      );
    }
    if (session.shikshak_user_id === actor.id) return session;
  }

  // AT8 — no matching scheduled session → soft-create (or resolve today's row).
  if (!session || session.status !== "scheduled") {
    if (session) {
      throw new SessionLifecycleError(
        409,
        "ERR_SESSION_NOT_SCHEDULED",
        "Session is not in scheduled state.",
      );
    }

    const batchId = input.batchId;
    if (!batchId) {
      throw new SessionLifecycleError(
        404,
        "ERR_NOT_FOUND",
        "No scheduled session found. Provide batch_id to start an unscheduled session.",
      );
    }

    const bcSoft = await loadBatchCentre(batchId);
    if (!bcSoft) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Batch not found.");
    await assertSessionActorScope(actor, bcSoft.batch_id, bcSoft.centre_id);

    const date = input.scheduledDate ?? todayIst();
    const [todayRow] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.batch_id, batchId), eq(sessions.scheduled_date, date)))
      .limit(1);

    if (todayRow?.check_in_at) {
      if (todayRow.shikshak_user_id && todayRow.shikshak_user_id !== actor.id) {
        throw new SessionLifecycleError(
          409,
          "ERR_ALREADY_CHECKED_IN_BY_OTHER",
          "This session was already checked in by another Guruji.",
        );
      }
      return todayRow;
    }

    if (todayRow?.status === "scheduled") {
      session = todayRow;
    } else if (!todayRow) {
      const distance = centreDistanceM(lat, lng, bcSoft.lat, bcSoft.lng);
      const radius = bcSoft.gps_radius_meters ?? 250;
      const outOfRadius = distance != null && distance > radius;
      const gpsUnverified = accuracy_m > ACCURACY_UNVERIFIED_M;
      const gpsFlagged = outOfRadius || gpsUnverified;

      const [created] = await db
        .insert(sessions)
        .values({
          batch_id: batchId,
          scheduled_date: date,
          scheduled_start_time: bcSoft.start_time,
          scheduled_end_time: bcSoft.end_time,
          status: "in_progress",
          unscheduled: true,
          shikshak_user_id: actor.id,
          conducted_by: actor.id,
          submission_op_id: submissionOpId,
          check_in_at: new Date(),
          check_in_lat: String(lat),
          check_in_lng: String(lng),
          check_in_distance_m: distance,
          check_in_accuracy_m: Math.round(accuracy_m),
          gps_flagged: gpsFlagged,
          gps_unverified: gpsUnverified,
        })
        .onConflictDoNothing()
        .returning();

      if (created) {
        await writeAudit({
          actorId: actor.id,
          actorRole: actor.role as never,
          action: "create",
          entityKind: "session",
          entityId: created.id,
          summary: "Unscheduled session check-in (AT8 soft-create)",
          metadata: {
            unscheduled: true,
            batch_id: batchId,
            scheduled_date: date,
            gps_flagged: gpsFlagged,
            check_in_distance_m: distance,
          },
        });
        const sanchalakIds = await sanchalakUserIdsForCentre(bcSoft.centre_id);
        await notifyUsers({
          userIds: sanchalakIds,
          title_en: "Unscheduled session started",
          title_hi: "अनिर्धारित सत्र शुरू",
          body_en: `A Guruji started an unscheduled session at ${bcSoft.centre_name}.`,
          body_hi: `${bcSoft.centre_name} पर गुरुजी ने एक अनिर्धारित सत्र शुरू किया।`,
        });
        if (gpsFlagged) {
          await notifyGpsFlag(
            bcSoft.centre_id,
            "GPS-flagged check-in",
            `Unscheduled check-in at ${bcSoft.centre_name} was flagged (distance/accuracy).`,
            "GPS चिह्नित चेक-इन",
            `${bcSoft.centre_name} पर अनिर्धारित चेक-इन चिह्नित किया गया।`,
          );
        }
        return created;
      }

      const [raced] = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.batch_id, batchId), eq(sessions.scheduled_date, date)))
        .limit(1);
      if (!raced) {
        throw new SessionLifecycleError(500, "ERR_INTERNAL", "Failed to create session.");
      }
      session = raced;
    } else {
      throw new SessionLifecycleError(
        409,
        "ERR_SESSION_NOT_SCHEDULED",
        "Session is not available for check-in.",
      );
    }
  }

  const bc = await loadBatchCentre(session.batch_id);
  if (!bc) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Batch not found.");
  await assertSessionActorScope(actor, bc.batch_id, bc.centre_id);

  if (session.status === "cancelled") {
    throw new SessionLifecycleError(409, "ERR_SESSION_CANCELLED", "Session is cancelled.");
  }

  const distance = centreDistanceM(lat, lng, bc.lat, bc.lng);
  const radius = bc.gps_radius_meters ?? 250;
  const outOfRadius = distance != null && distance > radius;
  const gpsUnverified = accuracy_m > ACCURACY_UNVERIFIED_M;
  const gpsFlagged = outOfRadius || gpsUnverified;

  const [updated] = await db
    .update(sessions)
    .set({
      status: "in_progress",
      shikshak_user_id: actor.id,
      conducted_by: actor.id,
      submission_op_id: submissionOpId,
      check_in_at: new Date(),
      check_in_lat: String(lat),
      check_in_lng: String(lng),
      check_in_distance_m: distance,
      check_in_accuracy_m: Math.round(accuracy_m),
      gps_flagged: gpsFlagged || session.gps_flagged,
      gps_unverified: gpsUnverified || session.gps_unverified,
    })
    .where(eq(sessions.id, session.id))
    .returning();

  if (gpsFlagged) {
    await notifyGpsFlag(
      bc.centre_id,
      "GPS-flagged check-in",
      `Check-in at ${bc.centre_name} was flagged (distance/accuracy). Class was not blocked.`,
      "GPS चिह्नित चेक-इन",
      `${bc.centre_name} पर चेक-इन चिह्नित किया गया। कक्षा अवरुद्ध नहीं हुई।`,
    );
  }

  return updated!;
}

export type CheckOutInput = {
  sessionId: string;
  actor: User;
  lat: number;
  lng: number;
  accuracy_m?: number;
};

export async function checkOutSession(input: CheckOutInput): Promise<SessionRow> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1);
  if (!session) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Session not found.");

  const bc = await loadBatchCentre(session.batch_id);
  if (!bc) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Batch not found.");
  await assertSessionActorScope(input.actor, bc.batch_id, bc.centre_id);

  if (session.status !== "in_progress") {
    throw new SessionLifecycleError(
      409,
      "ERR_SESSION_NOT_SCHEDULED",
      "Session is not in progress.",
    );
  }

  const distance = centreDistanceM(input.lat, input.lng, bc.lat, bc.lng);
  const radius = bc.gps_radius_meters ?? 250;
  const outOfRadius = distance != null && distance > radius;
  const accuracy = input.accuracy_m ?? null;
  const gpsUnverified = accuracy != null && accuracy > ACCURACY_UNVERIFIED_M;

  let gpsHaversine: number | null = null;
  if (session.check_in_lat != null && session.check_in_lng != null) {
    gpsHaversine = Math.round(
      haversineMeters(
        Number(session.check_in_lat),
        Number(session.check_in_lng),
        input.lat,
        input.lng,
      ),
    );
  }

  const checkOutAt = new Date();
  const checkInAt = session.check_in_at ? new Date(session.check_in_at) : checkOutAt;
  const durationMinutes = Math.max(
    0,
    Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60_000),
  );

  const [updated] = await db
    .update(sessions)
    .set({
      status: "completed",
      check_out_at: checkOutAt,
      check_out_lat: String(input.lat),
      check_out_lng: String(input.lng),
      check_out_distance_m: distance,
      check_out_accuracy_m: accuracy != null ? Math.round(accuracy) : null,
      gps_haversine_m: gpsHaversine,
      duration_minutes: durationMinutes,
      gps_flagged: outOfRadius || gpsUnverified || session.gps_flagged,
      gps_unverified: gpsUnverified || session.gps_unverified,
    })
    .where(eq(sessions.id, session.id))
    .returning();

  if (outOfRadius || gpsUnverified) {
    await notifyGpsFlag(
      bc.centre_id,
      "GPS-flagged check-out",
      `Check-out at ${bc.centre_name} was flagged (distance/accuracy).`,
      "GPS चिह्नित चेक-आउट",
      `${bc.centre_name} पर चेक-आउट चिह्नित किया गया।`,
    );
  }

  return updated!;
}

export type CancelInput = {
  sessionId: string;
  actor: User;
  reason: string;
  forceCancel?: boolean;
};

export async function cancelSession(input: CancelInput): Promise<SessionRow> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) {
    throw new SessionLifecycleError(
      422,
      "ERR_VALIDATION_FAILED",
      "Cancellation reason is required (min 10 characters).",
    );
  }

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, input.sessionId))
    .limit(1);
  if (!session) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Session not found.");

  const bc = await loadBatchCentre(session.batch_id);
  if (!bc) throw new SessionLifecycleError(404, "ERR_NOT_FOUND", "Batch not found.");
  await assertSessionActorScope(input.actor, bc.batch_id, bc.centre_id);

  if (session.status === "cancelled") {
    return session;
  }

  const marks = await db
    .select({
      id: attendance.id,
      student_id: attendance.student_id,
      revision: attendance.revision,
    })
    .from(attendance)
    .where(eq(attendance.session_id, session.id));

  if (marks.length > 0 && !input.forceCancel) {
    throw new SessionLifecycleError(
      409,
      "ERR_SESSION_HAS_ATTENDANCE",
      "Session has attendance marks. Pass force_cancel=true to reverse Punya and cancel.",
    );
  }

  const parentsWithMarks = new Set<string>();
  if (marks.length > 0) {
    const studentIds = marks.map((m) => m.student_id);
    const parentRows = await db
      .select({ id: students.id, parent_id: students.parent_id })
      .from(students)
      .where(inArray(students.id, studentIds));
    for (const p of parentRows) {
      if (p.parent_id) parentsWithMarks.add(p.parent_id);
    }

    await db.transaction(async (tx) => {
      for (const mark of marks) {
        const newRevision = mark.revision + 1;
        // AT25 / AT18 — reverse at the NEW revision (never current).
        await reverseAttendanceAward(tx, {
          sessionId: session.id,
          studentId: mark.student_id,
          newRevision,
          awardedBy: input.actor.id,
        });
        // AT22 — session cancel removes the mark from streak eligibility; reverse bonus.
        await reverseStreakBonusForSession(tx, {
          studentId: mark.student_id,
          sessionId: session.id,
          newRevision,
        });
        await tx
          .update(attendance)
          .set({ revision: newRevision })
          .where(eq(attendance.id, mark.id));
      }

      await tx
        .update(sessions)
        .set({
          status: "cancelled",
          cancelled_at: new Date(),
          cancellation_reason: reason,
          cancellation_by: input.actor.id,
        })
        .where(eq(sessions.id, session.id));
    });

    await writeAudit({
      actorId: input.actor.id,
      actorRole: input.actor.role as never,
      action: "update",
      entityKind: "session",
      entityId: session.id,
      summary: "force_cancel session with attendance reversals",
      metadata: {
        force_cancel: true,
        reason,
        marks: marks.length,
      },
    });
  } else {
    await db
      .update(sessions)
      .set({
        status: "cancelled",
        cancelled_at: new Date(),
        cancellation_reason: reason,
        cancellation_by: input.actor.id,
      })
      .where(eq(sessions.id, session.id));

    await writeAudit({
      actorId: input.actor.id,
      actorRole: input.actor.role as never,
      action: "update",
      entityKind: "session",
      entityId: session.id,
      summary: "Session cancelled",
      metadata: { force_cancel: false, reason },
    });
  }

  const allParents = await parentUserIdsForBatch(session.batch_id);
  const notifyParents = allParents.filter((id) => !parentsWithMarks.has(id));
  await notifyUsers({
    userIds: notifyParents,
    title_en: "Class cancelled",
    title_hi: "कक्षा रद्द",
    body_en: `Today's class at ${bc.centre_name} has been cancelled. Reason: ${reason}`,
    body_hi: `${bc.centre_name} की आज की कक्षा रद्द कर दी गई है। कारण: ${reason}`,
  });

  const [updated] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, session.id))
    .limit(1);
  return updated!;
}

/** AT12 — close stale in_progress sessions past scheduled_end + 2h. */
export async function autoCheckoutStaleSessions(): Promise<number> {
  const result = await db.execute(sql`
    update sessions
    set
      status = 'completed',
      auto_checked_out = true,
      check_out_at = now(),
      duration_minutes = greatest(
        0,
        cast(
          extract(
            epoch from (
              (scheduled_end_time - scheduled_start_time)
            )
          ) / 60 as integer
        )
      ),
      updated_at = now()
    where status = 'in_progress'
      and scheduled_end_time is not null
      and scheduled_start_time is not null
      and (
        (scheduled_date + scheduled_end_time) at time zone 'Asia/Kolkata'
        + interval '2 hours'
      ) <= now()
    returning id
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ?? [];
  if (rows.length > 0) {
    logger.info({ count: rows.length }, "attendance.auto_checkout closed sessions");
  }
  return rows.length;
}

/** No-show flag with both mandatory guards. */
export async function flagNoShowSessions(): Promise<number> {
  const result = await db.execute(sql`
    update sessions s
    set no_show_flagged_at = now(), updated_at = now()
    from batches b
    where s.batch_id = b.id
      and s.status = 'scheduled'
      and s.check_in_at is null
      and s.no_show_flagged_at is null
      and s.scheduled_date >= (current_date - interval '2 days')
      and s.scheduled_start_time is not null
      and (
        (s.scheduled_date + s.scheduled_start_time) at time zone 'Asia/Kolkata'
        + interval '30 minutes'
      ) <= now()
    returning s.id, b.centre_id, s.scheduled_date
  `);
  const rows =
    (result as unknown as {
      rows?: Array<{ id: string; centre_id: string; scheduled_date: string }>;
    }).rows ?? [];

  for (const row of rows) {
    const [sanchalakIds, cityAdminIds] = await Promise.all([
      sanchalakUserIdsForCentre(row.centre_id),
      cityAdminUserIdsForCentre(row.centre_id),
    ]);
    await notifyUsers({
      userIds: [...sanchalakIds, ...cityAdminIds],
      title_en: "Session no-show",
      title_hi: "सत्र अनुपस्थिति",
      body_en: `No check-in 30+ minutes after start for session on ${row.scheduled_date}.`,
      body_hi: `${row.scheduled_date} के सत्र में शुरू होने के 30+ मिनट बाद भी चेक-इन नहीं हुआ।`,
    });
  }

  if (rows.length > 0) {
    logger.info({ count: rows.length }, "attendance.no_show_check flagged sessions");
  }
  return rows.length;
}

/** Whether actor is assigned to the batch (used by soft-create helpers). */
export async function isShikshakOnBatch(userId: string, batchId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: shikshak_batch_assignments.id })
    .from(shikshak_batch_assignments)
    .where(
      and(
        eq(shikshak_batch_assignments.user_id, userId),
        eq(shikshak_batch_assignments.batch_id, batchId),
        eq(shikshak_batch_assignments.is_active, true),
      ),
    )
    .limit(1);
  return !!row;
}
