/**
 * Session check-in / check-out lifecycle (AT8, AT12–AT16, AT32).
 * Uses the local DATABASE_URL fixture graph (same pattern as attendance-at20).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pool,
  db,
  sessions,
  centres,
  users,
  attendance,
  students,
  type User,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { ulid } from "../src/lib/ulid";
import * as notify from "../src/lib/notify";
import {
  checkInSession,
  checkOutSession,
  SessionLifecycleError,
} from "../src/services/session-lifecycle";
import { markAttendance } from "../src/services/attendance-mark";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

type Fixture = {
  actor: User;
  otherActor: User;
  sessionId: string;
  batchId: string;
  centreId: string;
  scheduledDate: string;
  studentId: string;
  centreLat: number;
  centreLng: number;
};

let fx: Fixture;

async function resetSession(extra?: Partial<typeof sessions.$inferInsert>): Promise<void> {
  await db.delete(attendance).where(eq(attendance.session_id, fx.sessionId));
  await db
    .update(sessions)
    .set({
      status: "scheduled",
      unscheduled: false,
      shikshak_user_id: null,
      conducted_by: null,
      submission_op_id: null,
      check_in_at: null,
      check_in_lat: null,
      check_in_lng: null,
      check_in_distance_m: null,
      check_in_accuracy_m: null,
      check_out_at: null,
      check_out_lat: null,
      check_out_lng: null,
      check_out_distance_m: null,
      check_out_accuracy_m: null,
      gps_haversine_m: null,
      duration_minutes: null,
      gps_flagged: false,
      gps_unverified: false,
      auto_checked_out: false,
      cancelled_at: null,
      cancellation_reason: null,
      cancellation_by: null,
      ...extra,
    })
    .where(eq(sessions.id, fx.sessionId));
}

beforeAll(async () => {
  const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
    `select s.batch_id, b.centre_id
     from students s
     join batches b on b.id = s.batch_id
     where s.status = 'active' and s.batch_id is not null and s.deleted_at is null
     group by s.batch_id, b.centre_id
     having count(*) >= 1
     order by count(*) desc
     limit 1`,
  );
  expect(batchPick.rows.length).toBe(1);
  const batchId = batchPick.rows[0]!.batch_id;
  const centreId = batchPick.rows[0]!.centre_id;

  const centreLat = 19.076;
  const centreLng = 72.8777;
  await db
    .update(centres)
    .set({
      lat: String(centreLat),
      lng: String(centreLng),
      gps_radius_meters: 250,
    })
    .where(eq(centres.id, centreId));

  const [guruji] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "super_admin"))
    .limit(1);
  expect(guruji).toBeTruthy();

  let otherId: string;
  const [existingOther] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "shikshak"), eq(users.is_active, true)))
    .limit(1);
  if (existingOther && existingOther.id !== guruji!.id) {
    otherId = existingOther.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        phone: "+919900009999",
        role: "shikshak",
        full_name: "Other Guruji",
        preferred_language: "en",
        is_active: true,
      })
      .returning({ id: users.id });
    otherId = created!.id;
  }

  const [student] = await db
    .select({ id: students.id })
    .from(students)
    .where(and(eq(students.batch_id, batchId), eq(students.status, "active"), isNull(students.deleted_at)))
    .limit(1);
  expect(student).toBeTruthy();

  const scheduledDate = "2024-07-20";
  const [session] = await db
    .insert(sessions)
    .values({
      batch_id: batchId,
      scheduled_date: scheduledDate,
      scheduled_start_time: "10:00:00",
      scheduled_end_time: "11:00:00",
      status: "scheduled",
      topic: "session-lifecycle-fixture",
    })
    .onConflictDoUpdate({
      target: [sessions.batch_id, sessions.scheduled_date],
      set: {
        status: "scheduled",
        topic: "session-lifecycle-fixture",
        scheduled_start_time: "10:00:00",
        scheduled_end_time: "11:00:00",
      },
    })
    .returning({ id: sessions.id });

  fx = {
    actor: {
      id: guruji!.id,
      role: "super_admin",
      phone: "+919900000001",
      full_name: "Test Guruji",
      preferred_language: "en",
      is_active: true,
    } as User,
    otherActor: {
      id: otherId,
      role: "shikshak",
      phone: "+919900009999",
      full_name: "Other Guruji",
      preferred_language: "en",
      is_active: true,
    } as User,
    sessionId: session!.id,
    batchId,
    centreId,
    scheduledDate,
    studentId: student!.id,
    centreLat,
    centreLng,
  };
  await resetSession();
}, 60_000);

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

describe("session-lifecycle check-in / check-out", () => {
  it("check-in inside the radius sets status=in_progress and check_in_distance_m", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    const row = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 12,
      batchId: fx.batchId,
    });
    expect(row.status).toBe("in_progress");
    expect(row.check_in_at).not.toBeNull();
    expect(row.check_in_distance_m).not.toBeNull();
    expect(row.check_in_distance_m!).toBeLessThanOrEqual(250);
    expect(row.gps_flagged).toBe(false);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("check-in outside gps_radius_meters still succeeds but sets gps_flagged and notifies", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue(["sanchalak-1"]);

    const row = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: 28.6139, // Delhi — far from Mumbai fixture centre
      lng: 77.209,
      accuracy_m: 15,
      batchId: fx.batchId,
    });
    expect(row.status).toBe("in_progress");
    expect(row.gps_flagged).toBe(true);
    expect(row.check_in_distance_m!).toBeGreaterThan(250);
    expect(notifySpy).toHaveBeenCalled();
    const gpsCall = notifySpy.mock.calls.find(
      (c) => (c[0] as { title_en?: string }).title_en === "GPS-flagged check-in",
    );
    expect(gpsCall).toBeTruthy();
  });

  it("accuracy_m > 100 sets gps_unverified and does NOT reject (AT15)", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue([]);

    const row = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 250,
      batchId: fx.batchId,
    });
    expect(row.status).toBe("in_progress");
    expect(row.gps_unverified).toBe(true);
    expect(row.gps_flagged).toBe(true);
  });

  it("null GPS writes null coords, gps_unverified, gps_flagged=false, no GPS notify (AT32)", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue(["sanchalak-1"]);

    const row = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: null,
      lng: null,
      accuracy_m: null,
      batchId: fx.batchId,
    });
    expect(row.status).toBe("in_progress");
    expect(row.check_in_lat).toBeNull();
    expect(row.check_in_lng).toBeNull();
    expect(row.check_in_distance_m).toBeNull();
    expect(row.gps_unverified).toBe(true);
    expect(row.gps_flagged).toBe(false);
    const gpsCall = notifySpy.mock.calls.find(
      (c) => (c[0] as { title_en?: string }).title_en === "GPS-flagged check-in",
    );
    expect(gpsCall).toBeUndefined();
  });

  it("replaying the same submission_op_id returns the existing session even when in_progress (AT16)", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    const opId = ulid();
    const first = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: opId,
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 10,
      batchId: fx.batchId,
    });
    expect(first.status).toBe("in_progress");

    const replay = await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: opId,
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 10,
      batchId: fx.batchId,
    });
    expect(replay.id).toBe(first.id);
    expect(replay.submission_op_id).toBe(opId);
  });

  it("a different shikshak on a checked-in session returns 409 ERR_ALREADY_CHECKED_IN_BY_OTHER", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue(["sanchalak-1"]);

    await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 10,
      batchId: fx.batchId,
    });

    await expect(
      checkInSession({
        sessionId: fx.sessionId,
        actor: fx.otherActor,
        submissionOpId: ulid(),
        lat: fx.centreLat,
        lng: fx.centreLng,
        accuracy_m: 10,
        batchId: fx.batchId,
      }),
    ).rejects.toMatchObject({
      httpStatus: 409,
      code: "ERR_ALREADY_CHECKED_IN_BY_OTHER",
    } satisfies Partial<SessionLifecycleError>);

    const dupCall = notifySpy.mock.calls.find(
      (c) => (c[0] as { title_en?: string }).title_en === "Duplicate check-in attempt",
    );
    expect(dupCall).toBeTruthy();
  });

  it("check-in with no matching session + batch_id soft-creates unscheduled=true (AT8)", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    vi.spyOn(notify, "sanchalakUserIdsForCentre").mockResolvedValue(["sanchalak-1"]);

    const softDate = "2024-07-21";
    // Ensure no row for this date.
    await db
      .delete(sessions)
      .where(and(eq(sessions.batch_id, fx.batchId), eq(sessions.scheduled_date, softDate)));

    const created = await checkInSession({
      sessionId: "00000000-0000-4000-8000-000000000000",
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 10,
      batchId: fx.batchId,
      scheduledDate: softDate,
    });
    expect(created.unscheduled).toBe(true);
    expect(created.status).toBe("in_progress");
    expect(created.batch_id).toBe(fx.batchId);
    expect(String(created.scheduled_date)).toBe(softDate);

    await db.delete(sessions).where(eq(sessions.id, created.id));
  });

  it("check-out sets status=completed, duration_minutes and gps_haversine_m", async () => {
    vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);
    await checkInSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      submissionOpId: ulid(),
      lat: fx.centreLat,
      lng: fx.centreLng,
      accuracy_m: 10,
      batchId: fx.batchId,
    });

    const out = await checkOutSession({
      sessionId: fx.sessionId,
      actor: fx.actor,
      lat: fx.centreLat + 0.0001,
      lng: fx.centreLng + 0.0001,
      accuracy_m: 12,
    });
    expect(out.status).toBe("completed");
    expect(out.check_out_at).not.toBeNull();
    expect(out.duration_minutes).not.toBeNull();
    expect(out.gps_haversine_m).not.toBeNull();
  });
});

describe("AT32.1 soft transition via mark (no prior check-in)", () => {
  it("roster marked with no check-in succeeds, leaves check_in_at NULL, status=in_progress, no gps_flagged", async () => {
    const notifySpy = vi.spyOn(notify, "notifyUsers").mockResolvedValue(undefined);

    const result = await markAttendance({
      sessionId: fx.sessionId,
      userId: fx.actor.id,
      actor: fx.actor,
      markedAt: new Date(`${fx.scheduledDate}T10:15:00.000+05:30`),
      submissionOpId: ulid(),
      marks: [
        {
          student_id: fx.studentId,
          status: "present",
          client_op_id: ulid(),
        },
      ],
    });
    expect(result.applied).toBeGreaterThanOrEqual(1);

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, fx.sessionId))
      .limit(1);
    expect(row!.status).toBe("in_progress");
    expect(row!.check_in_at).toBeNull();
    expect(row!.conducted_by).toBe(fx.actor.id);
    expect(row!.gps_flagged).toBe(false);

    const gpsCall = notifySpy.mock.calls.find(
      (c) => (c[0] as { title_en?: string }).title_en?.includes("GPS"),
    );
    expect(gpsCall).toBeUndefined();
  });
});
