/**
 * /v1/notifications — the caller's in-app notification inbox, Expo push-token
 * registration, and the daily birthday-wishes cron.
 *
 * Every route requires authentication and is scoped to the caller's own user
 * (req.authUser.id): a user can only register tokens against, read, or mark
 * read their OWN notifications. The birthday cron (runBirthdayWishes) is
 * exported and idempotent per day so re-running it never double-inserts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { db, notifications, device_push_tokens, students } from "@workspace/db";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { sendPush } from "../../lib/push";
import { registerCron } from "../../lib/scheduler";
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

  // Upsert on the unique expo_token: a device re-registering under a new user
  // (or after reinstall) re-points the token to the current caller + reactivates.
  await db
    .insert(device_push_tokens)
    .values({
      user_id: req.authUser!.id,
      expo_token: body.expo_token,
      platform: body.platform ?? null,
      is_active: true,
    })
    .onConflictDoUpdate({
      target: device_push_tokens.expo_token,
      set: {
        user_id: req.authUser!.id,
        platform: body.platform ?? null,
        is_active: true,
      },
    });

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

  // Active students whose birthday (month+day) is today.
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
        sql`to_char(${students.dob}, 'MM-DD') = ${mmdd}`,
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

  // Best-effort push to the newly-notified users' active devices. Done OUTSIDE
  // the transaction (and only for the users THIS run actually inserted) so the
  // external Expo call never holds the advisory lock and never double-sends:
  // the at-most-once insert above gates the at-most-once push.
  const newlyNotifiedIds = toInsert.map((r) => r.userId);
  const tokens = await db
    .select({ user_id: device_push_tokens.user_id, expo_token: device_push_tokens.expo_token })
    .from(device_push_tokens)
    .where(
      and(
        inArray(device_push_tokens.user_id, newlyNotifiedIds),
        eq(device_push_tokens.is_active, true),
      ),
    );

  if (tokens.length > 0) {
    const nameByUser = new Map(toInsert.map((r) => [r.userId, r.studentName]));
    await sendPush(
      tokens.map((t) => ({
        to: t.expo_token,
        title: "Happy Birthday!",
        body: `Wishing ${nameByUser.get(t.user_id) ?? "your child"} a joyful and blessed birthday.`,
        data: { kind: "birthday" },
      })),
    );
  }

  return { students: birthdayStudents.length, notifications: toInsert.length };
}

// Register the daily job at module load (06:00 IST). Never starts a timer in tests.
registerCron("birthday-wishes", "0 6 * * *", async () => {
  await runBirthdayWishes();
});

export default router;
