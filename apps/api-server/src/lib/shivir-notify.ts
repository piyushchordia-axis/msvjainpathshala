/**
 * Parent notifications for shivir scans and shivir publication.
 *
 * SPEC 8.6 step 6 mandates an immediate parent push on scan. The `shivir`
 * notification kind has existed in notification_kind_enum since the baseline
 * migration and had never been sent by any code — a parent who put their child
 * on a bus to a camp learned nothing when they arrived.
 *
 * Mirrors services/attendance-post-process.ts: a sliding debounce on
 * QUEUE_NAMES.PARENT_NOTIFY, delivery through notifyUsers so the recipient's
 * notification_preferences still decide whether it lands.
 */
import {
  centres,
  db,
  msv_enrolments,
  shivir_events,
  shivir_sessions,
  students,
} from "@workspace/db";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { notifyUsers } from "./notify";
import { enqueueDebouncedJob, enqueueJob } from "./queues";
import { QUEUE_NAMES } from "@jp/shared/constants";
import { logger } from "./logger";

/**
 * Shorter than attendance's five minutes. A parent waiting to hear their child
 * reached the venue is the single most time-sensitive push in the product; five
 * minutes of silence is exactly the window in which they phone the Sanchalak.
 */
export const SHIVIR_PUSH_DEBOUNCE_MS = 60 * 1000;

type ScanKind = "present" | "check_in" | "check_out";

const SCAN_COPY: Record<ScanKind, { en: string; hi: string }> = {
  present: { en: "marked present at", hi: "में उपस्थित दर्ज" },
  check_in: { en: "checked in at", hi: "में प्रवेश दर्ज" },
  check_out: { en: "checked out of", hi: "से निकास दर्ज" },
};

/** Deliver the debounced parent push (queue handler entry point). */
export async function sendParentShivirPush(
  studentId: string,
  sessionId: string,
  scanKind: ScanKind,
): Promise<void> {
  const [row] = await db
    .select({
      parent_id: students.parent_id,
      full_name: students.full_name,
      session_title: shivir_sessions.title,
      shivir_id: shivir_events.id,
      shivir_name_en: shivir_events.name_en,
      shivir_name_hi: shivir_events.name_hi,
    })
    .from(students)
    .innerJoin(shivir_sessions, eq(shivir_sessions.id, sessionId))
    .innerJoin(shivir_events, eq(shivir_events.id, shivir_sessions.shivir_id))
    .where(eq(students.id, studentId))
    .limit(1);

  if (!row?.parent_id) return;

  const copy = SCAN_COPY[scanKind];
  const nameHi = row.shivir_name_hi ?? row.shivir_name_en;

  await notifyUsers({
    userIds: [row.parent_id],
    kind: "shivir",
    title_en: "Shivir attendance",
    title_hi: "शिविर उपस्थिति",
    body_en: `${row.full_name} ${copy.en} ${row.shivir_name_en} — ${row.session_title}`,
    body_hi: `${row.full_name} ${nameHi} ${copy.hi} — ${row.session_title}`,
    push: true,
    data: {
      kind: "shivir",
      shivir_id: row.shivir_id,
      session_id: sessionId,
      student_id: studentId,
      scan_kind: scanKind,
    },
  });
}

/** Sliding debounce keyed per (student, session) — a check-out replaces a check-in. */
export async function enqueueParentShivirNotify(
  studentId: string,
  sessionId: string,
  scanKind: ScanKind,
): Promise<void> {
  try {
    await enqueueDebouncedJob(
      QUEUE_NAMES.PARENT_NOTIFY,
      {
        kind: "shivir_scanned",
        student_id: studentId,
        session_id: sessionId,
        scan_kind: scanKind,
      },
      {
        jobId: `shivir-parent:${studentId}:${sessionId}`,
        delayMs: SHIVIR_PUSH_DEBOUNCE_MS,
      },
    );
  } catch (err) {
    // Never let a notification failure surface as a failed scan — the scan is
    // already committed and, per AT28, is the only record the child was there.
    logger.warn({ err, studentId, sessionId }, "shivir parent notify enqueue failed");
  }
}

/**
 * Hand the publish announcement to the worker.
 *
 * The fan-out is unbounded — every parent of an active student in the city — so
 * it must not run inside the API request that created the shivir. A city with a
 * few thousand families would otherwise hold a request thread through thousands
 * of inbox inserts and push calls.
 */
export async function enqueueShivirPublishedAnnouncement(shivirId: string): Promise<void> {
  try {
    await enqueueJob(QUEUE_NAMES.PARENT_NOTIFY, {
      kind: "shivir_published",
      shivir_id: shivirId,
    });
  } catch (err) {
    logger.warn({ err, shivirId }, "shivir publish announcement enqueue failed");
  }
}

/**
 * Announce a newly published shivir to the parents whose children could attend.
 * Queue handler entry point — see enqueueShivirPublishedAnnouncement.
 *
 * Audience is deliberately narrow: parents of active students at a centre in the
 * shivir's city, and for an msv_only shivir only those with a live MSV
 * enrolment. Announcing a Mumbai camp to Ahmedabad teaches families to mute the
 * app.
 */
export async function announceShivirPublished(shivirId: string): Promise<void> {
  const [shivir] = await db
    .select({
      id: shivir_events.id,
      name_en: shivir_events.name_en,
      name_hi: shivir_events.name_hi,
      city_id: shivir_events.city_id,
      start_date: shivir_events.start_date,
      msv_only: shivir_events.msv_only,
    })
    .from(shivir_events)
    .where(and(eq(shivir_events.id, shivirId), isNull(shivir_events.deleted_at)))
    .limit(1);
  if (!shivir) return;

  // students.centre_id is the live posting; enrolments is the request ledger and
  // would double-count a child who moved between centres.
  const rows = await db
    .selectDistinct({ parent_id: students.parent_id, student_id: students.id })
    .from(students)
    .innerJoin(centres, eq(centres.id, students.centre_id))
    .where(
      and(
        eq(centres.city_id, shivir.city_id),
        eq(students.status, "active"),
        isNull(students.deleted_at),
      ),
    );

  let eligible = rows.filter((r) => !!r.parent_id);

  if (shivir.msv_only && eligible.length > 0) {
    const msvRows = await db
      .select({ student_id: msv_enrolments.student_id })
      .from(msv_enrolments)
      .where(
        and(
          inArray(
            msv_enrolments.student_id,
            eligible.map((r) => r.student_id),
          ),
          eq(msv_enrolments.status, "approved"),
        ),
      );
    const msvIds = new Set(msvRows.map((r) => r.student_id));
    eligible = eligible.filter((r) => msvIds.has(r.student_id));
  }

  const userIds = Array.from(new Set(eligible.map((r) => r.parent_id as string)));
  if (userIds.length === 0) return;

  await notifyUsers({
    userIds,
    kind: "shivir",
    title_en: "New shivir announced",
    title_hi: "नया शिविर घोषित",
    body_en: `${shivir.name_en} begins ${shivir.start_date}. Open the app to register.`,
    body_hi: `${shivir.name_hi ?? shivir.name_en} ${shivir.start_date} से। पंजीकरण के लिए ऐप खोलें।`,
    push: true,
    data: { kind: "shivir", shivir_id: shivir.id },
  });
}
