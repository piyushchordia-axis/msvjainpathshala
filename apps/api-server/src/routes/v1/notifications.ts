/**
 * /v1/notifications — the caller's in-app notification inbox and Expo push-token
 * registration.
 *
 * Every route requires authentication and is scoped to the caller's own user
 * (req.authUser.id): a user can only register tokens against, read, or mark
 * read their OWN notifications. Birthday wishes (`runBirthdayWishes`) live here
 * as a service export; the cron is registered in `src/jobs/birthday-jobs.ts`
 * so importing this router does not schedule work on every API instance.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, notifications, device_push_tokens, students } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { notifyUsers } from "../../lib/notify";
import { clampLimit } from "../../lib/route-helpers";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/* ---- route-local schemas (inline, NOT in api-zod) ---- */
const pushTokenSchema = z.object({
  expo_token: z.string().min(1).max(500),
  platform: z.string().max(20).optional(),
});

/* POST /v1/notifications/push-token — register/refresh this device's Expo token */
router.post("/push-token", async (req: Request, res: Response) => {
  let body: z.infer<typeof pushTokenSchema>;
  try {
    body = pushTokenSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid push-token data.");
    return;
  }

  const callerId = req.authUser!.id;
  const platform = body.platform ?? null;
  const lockKey = `push-token:${body.expo_token}`;

  // Read-then-write under an advisory lock so two devices cannot race a claim.
  // Active tokens stay bound to their owner; inactive tokens may be reassigned
  // (genuine DeviceNotRegistered / reinstall / device handover).
  let claimedByOther = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const [existing] = await tx
      .select({
        id: device_push_tokens.id,
        user_id: device_push_tokens.user_id,
        is_active: device_push_tokens.is_active,
      })
      .from(device_push_tokens)
      .where(eq(device_push_tokens.expo_token, body.expo_token))
      .limit(1);

    if (!existing) {
      await tx.insert(device_push_tokens).values({
        user_id: callerId,
        expo_token: body.expo_token,
        platform,
        is_active: true,
      });
      return;
    }

    if (existing.user_id === callerId) {
      await tx
        .update(device_push_tokens)
        .set({ platform, is_active: true, updated_at: new Date() })
        .where(eq(device_push_tokens.id, existing.id));
      return;
    }

    if (!existing.is_active) {
      await tx
        .update(device_push_tokens)
        .set({
          user_id: callerId,
          platform,
          is_active: true,
          updated_at: new Date(),
        })
        .where(eq(device_push_tokens.id, existing.id));
      return;
    }

    claimedByOther = true;
  });

  if (claimedByOther) {
    fail(
      res,
      409,
      "ERR_PUSH_TOKEN_CLAIMED",
      "That device is registered to another account — sign out on that device first.",
    );
    return;
  }

  ok(res, { ok: true });
});

/* GET /v1/notifications?limit= — the caller's inbox, newest first + unread_count */
router.get("/", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const limit = clampLimit(req.query.limit, 50, 200);

  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      title_en: notifications.title_en,
      title_hi: notifications.title_hi,
      body_en: notifications.body_en,
      body_hi: notifications.body_hi,
      read_at: notifications.read_at,
      created_at: notifications.created_at,
    })
    .from(notifications)
    .where(eq(notifications.user_id, uid))
    .orderBy(desc(notifications.created_at))
    .limit(limit);

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.user_id, uid), isNull(notifications.read_at)));

  const items = rows.map((r) => ({
    ...r,
    read_at: r.read_at ? r.read_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(res, { items, unread_count: Number(unread ?? 0) }, { count: items.length });
});

/* POST /v1/notifications/:id/read — mark the caller's notification read (404 if not theirs) */
router.post("/:id/read", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const id = String(req.params.id);
  if (!UUID_RE.test(id)) {
    fail(res, 404, "ERR_NOT_FOUND", "Notification not found.");
    return;
  }

  const [row] = await db
    .select({ id: notifications.id, read_at: notifications.read_at })
    .from(notifications)
    .where(and(eq(notifications.id, id), eq(notifications.user_id, uid)))
    .limit(1);
  if (!row) {
    fail(res, 404, "ERR_NOT_FOUND", "Notification not found.");
    return;
  }

  // Idempotent: only set read_at the first time so re-calling keeps the timestamp.
  if (!row.read_at) {
    await db
      .update(notifications)
      .set({ read_at: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.user_id, uid)));
  }

  ok(res, { id: row.id, read: true });
});

/* ═══════════════════════════ BIRTHDAY CRON ═══════════════════════════ */

/** IST MM-DD for a given instant (defaults to now). */
function istMonthDay(when: Date): string {
  // en-CA gives YYYY-MM-DD; slice the MM-DD in the Asia/Kolkata zone.
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  return ymd.slice(5); // "MM-DD"
}

/**
 * Insert a birthday notification for each recipient user (idempotent per day:
 * skips a user who already has a 'birthday' notification dated today in IST),
 * then push to those users' active devices. Exported + safe to call directly.
 */
export async function runBirthdayWishes(today?: Date): Promise<{ students: number; notifications: number }> {
  const when = today ?? new Date();
  const mmdd = istMonthDay(when);
  const [mmStr, ddStr] = mmdd.split("-");
  const month = Number(mmStr);
  const day = Number(ddStr);

  // Active students whose birthday (month+day) is today.
  // EXTRACT is IMMUTABLE-compatible for expression indexes (PERF #6); to_char is not.
  const birthdayStudents = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      user_id: students.user_id,
      parent_id: students.parent_id,
    })
    .from(students)
    .where(
      and(
        eq(students.status, "active"),
        isNull(students.deleted_at),
        sql`EXTRACT(MONTH FROM ${students.dob}) = ${month}`,
        sql`EXTRACT(DAY FROM ${students.dob}) = ${day}`,
      ),
    );

  if (birthdayStudents.length === 0) {
    return { students: 0, notifications: 0 };
  }

  // One notification per (recipient user). A student maps to up to two
  // recipients: their own user (if linked) and their parent.
  const recipients: { userId: string; studentName: string }[] = [];
  const seen = new Set<string>();
  for (const s of birthdayStudents) {
    for (const userId of [s.user_id, s.parent_id]) {
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      recipients.push({ userId, studentName: s.full_name });
    }
  }

  const recipientUserIds = recipients.map((r) => r.userId);

  // The calendar date (IST) this run is for — also the advisory-lock key, so all
  // instances/firings for the same day serialize on the same lock.
  const todayIst = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);

  // Idempotency that holds ACROSS instances (autoscale runs the in-process cron
  // on every node, so two firings can hit 06:00 IST together). The read-then-
  // insert below is a check-then-act race on its own; we make it at-most-once-
  // per-(user,day) by serializing all birthday runs for a given IST date under a
  // transaction-scoped advisory lock — the same pattern used for niyam/exam
  // idempotency in this codebase. The existing per-day SELECT then acts as the
  // de-dup guard, now race-free because only one tx holds the lock at a time.
  const lockKey = `birthday-wishes:${todayIst}`;
  const toInsert = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const existing = await tx
      .select({ user_id: notifications.user_id })
      .from(notifications)
      .where(
        and(
          inArray(notifications.user_id, recipientUserIds),
          eq(notifications.kind, "birthday"),
          // Dedup on the REAL creation date (rows are stamped now()), so a second
          // run on the same calendar day is idempotent regardless of the dob date.
          sql`(${notifications.created_at} at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`,
        ),
      );
    const alreadyNotified = new Set(existing.map((e) => e.user_id));

    const pending = recipients.filter((r) => !alreadyNotified.has(r.userId));
    if (pending.length === 0) return pending;

    await tx.insert(notifications).values(
      pending.map((r) => ({
        user_id: r.userId,
        kind: "birthday" as const,
        title_en: "Happy Birthday!",
        title_hi: "जन्मदिन की शुभकामनाएँ!",
        body_en: `Wishing ${r.studentName} a joyful and blessed birthday from all of us at Jain Pathshala.`,
        body_hi: `जैन पाठशाला परिवार की ओर से ${r.studentName} को जन्मदिन की हार्दिक शुभकामनाएँ।`,
      })),
    );
    return pending;
  });

  if (toInsert.length === 0) {
    return { students: birthdayStudents.length, notifications: 0 };
  }

  // Best-effort push OUTSIDE the transaction. Inbox rows already inserted above;
  // inbox:false so push-opt-out does not suppress the durable birthday notice.
  // Per-recipient body (student name) — one notifyUsers call each.
  for (const r of toInsert) {
    await notifyUsers({
      userIds: [r.userId],
      kind: "birthday",
      title_en: "Happy Birthday!",
      title_hi: "जन्मदिन की शुभकामनाएँ!",
      body_en: `Wishing ${r.studentName} a joyful and blessed birthday.`,
      body_hi: `जैन पाठशाला परिवार की ओर से ${r.studentName} को जन्मदिन की हार्दिक शुभकामनाएँ।`,
      inbox: false,
      push: true,
      data: { kind: "birthday" },
    });
  }

  return { students: birthdayStudents.length, notifications: toInsert.length };
}

export default router;
