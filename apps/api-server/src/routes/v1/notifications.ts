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
import { db, notifications, device_push_tokens, students, users } from "@workspace/db";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ok, fail } from "../../lib/envelope";
import { requireAuth } from "../../middlewares/auth";
import { notifyUsers, prefsAllowKind } from "../../lib/notify";
import { clampLimit } from "../../lib/route-helpers";
import { logger } from "../../lib/logger";

const router: IRouter = Router();
router.use(requireAuth);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keyset cursor — same base64url `a|b` shape as niyam-submissions. */
function encodeInboxCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, "utf8").toString("base64url");
}

function decodeInboxCursor(raw: unknown): { createdAt: Date; id: string } | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const i = decoded.indexOf("|");
    if (i < 0) return null;
    const iso = decoded.slice(0, i);
    const id = decoded.slice(i + 1);
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !UUID_RE.test(id)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}


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

const pushTokenDeactivateSchema = z.object({
  expo_token: z.string().min(1).max(500),
});

/**
 * POST /v1/notifications/push-token/deactivate — X-4 (review 2026-08). Call
 * this on sign-out. Without it, a shared family handset kept delivering the
 * previous account's notifications (child names, attendance, approvals)
 * forever, since the only other thing that frees a token is Expo returning
 * DeviceNotRegistered on a healthy device, which never happens.
 *
 * Scoped to the caller's own token: deactivating someone else's token is a
 * silent no-op (404-shaped `deactivated: false`), never a 403 that would
 * leak whether a given token belongs to another account.
 */
router.post("/push-token/deactivate", async (req: Request, res: Response) => {
  let body: z.infer<typeof pushTokenDeactivateSchema>;
  try {
    body = pushTokenDeactivateSchema.parse(req.body);
  } catch {
    fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid push-token data.");
    return;
  }

  const callerId = req.authUser!.id;
  const updated = await db
    .update(device_push_tokens)
    .set({ is_active: false, updated_at: new Date() })
    .where(
      and(
        eq(device_push_tokens.expo_token, body.expo_token),
        eq(device_push_tokens.user_id, callerId),
      ),
    )
    .returning({ id: device_push_tokens.id });

  ok(res, { deactivated: updated.length > 0 });
});

/* GET /v1/notifications?limit=&cursor= — keyset inbox (created_at DESC, id DESC) */
router.get("/", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const limit = clampLimit(req.query.limit, 50, 200);

  const cursorRaw = req.query.cursor;
  let cursor: { createdAt: Date; id: string } | null = null;
  if (cursorRaw !== undefined && cursorRaw !== null && String(cursorRaw).length > 0) {
    cursor = decodeInboxCursor(cursorRaw);
    if (!cursor) {
      fail(res, 422, "ERR_VALIDATION_FAILED", "Invalid cursor — request the first page again.");
      return;
    }
  }

  const conds = [eq(notifications.user_id, uid)];
  if (cursor) {
    conds.push(
      or(
        lt(notifications.created_at, cursor.createdAt),
        and(eq(notifications.created_at, cursor.createdAt), lt(notifications.id, cursor.id)),
      )!,
    );
  }

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
    .where(and(...conds))
    .orderBy(desc(notifications.created_at), desc(notifications.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeInboxCursor(last.created_at, last.id) : null;

  // unread_count only on the first page — paging does not change the badge.
  let unread_count: number | undefined;
  if (!cursor) {
    const [{ unread }] = await db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.user_id, uid), isNull(notifications.read_at)));
    unread_count = Number(unread ?? 0);
  }

  const items = page.map((r) => ({
    ...r,
    read_at: r.read_at ? r.read_at.toISOString() : null,
    created_at: r.created_at.toISOString(),
  }));
  ok(
    res,
    cursor
      ? { items, next_cursor: nextCursor }
      : { items, unread_count: unread_count!, next_cursor: nextCursor },
    { count: items.length },
  );
});

/* POST /v1/notifications/read-all — mark every unread inbox row for the caller */
router.post("/read-all", async (req: Request, res: Response) => {
  const uid = req.authUser!.id;
  const updated = await db
    .update(notifications)
    .set({ read_at: new Date() })
    .where(and(eq(notifications.user_id, uid), isNull(notifications.read_at)))
    .returning({ id: notifications.id });
  ok(res, { updated: updated.length });
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

/** IST YYYY-MM-DD for a given instant (defaults to now). */
function istDateParts(when: Date): { year: number; month: number; day: number } {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(when);
  const [y, m, d] = ymd.split("-").map(Number);
  return { year: y!, month: m!, day: d! };
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Bilingual "A, B and C" / "A, B और C" join for merged-twin birthday copy (X-24). */
function joinNames(names: string[], andWord: "and" | "और"): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} ${andWord} ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} ${andWord} ${names[names.length - 1]}`;
}

/**
 * Insert a birthday notification for each recipient user (idempotent per day:
 * skips a user who already has a 'birthday' notification dated today in IST),
 * then push to those users' active devices. Exported + safe to call directly.
 */
export async function runBirthdayWishes(today?: Date): Promise<{ students: number; notifications: number }> {
  const when = today ?? new Date();
  const { year, month, day } = istDateParts(when);

  // X-29 — a 29-Feb birthday needs a fallback in a non-leap year, or the
  // child is never wished at all that year. Wish them on 28-Feb instead,
  // the conventional civil fallback.
  const feb29Fallback = month === 2 && day === 28 && !isLeapYear(year);

  // Active students whose birthday (month+day) is today.
  // EXTRACT is IMMUTABLE-compatible for expression indexes (PERF #6); to_char is not.
  const dobMatch = feb29Fallback
    ? or(
        and(
          sql`EXTRACT(MONTH FROM ${students.dob}) = ${month}`,
          sql`EXTRACT(DAY FROM ${students.dob}) = ${day}`,
        ),
        and(
          sql`EXTRACT(MONTH FROM ${students.dob}) = 2`,
          sql`EXTRACT(DAY FROM ${students.dob}) = 29`,
        ),
      )!
    : and(
        sql`EXTRACT(MONTH FROM ${students.dob}) = ${month}`,
        sql`EXTRACT(DAY FROM ${students.dob}) = ${day}`,
      )!;

  const birthdayStudents = await db
    .select({
      id: students.id,
      full_name: students.full_name,
      user_id: students.user_id,
      parent_id: students.parent_id,
    })
    .from(students)
    .where(and(eq(students.status, "active"), isNull(students.deleted_at), dobMatch));

  if (birthdayStudents.length === 0) {
    return { students: 0, notifications: 0 };
  }

  // One notification per (recipient user), naming EVERY birthday child of
  // theirs today — X-24: two children sharing a birthday under one parent
  // used to have the second one silently dropped rather than merged in.
  const namesByUser = new Map<string, string[]>();
  for (const s of birthdayStudents) {
    for (const userId of [s.user_id, s.parent_id]) {
      if (!userId) continue;
      const names = namesByUser.get(userId) ?? [];
      if (!names.includes(s.full_name)) names.push(s.full_name);
      namesByUser.set(userId, names);
    }
  }
  const recipients = [...namesByUser.entries()].map(([userId, names]) => ({ userId, names }));
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

    // X-11 — the raw insert used to bypass notification_preferences entirely,
    // so {birthday: false} still produced an inbox row every year; only the
    // push respected it. Apply the same kind gate the standard notifyUsers
    // path now uses (X-1), so a user who muted birthdays gets neither.
    const prefRows = await tx
      .select({ id: users.id, prefs: users.notification_preferences })
      .from(users)
      .where(and(inArray(users.id, pending.map((r) => r.userId)), eq(users.is_active, true)));
    const prefsById = new Map(prefRows.map((r) => [r.id, r.prefs] as const));
    const toNotify = pending.filter((r) =>
      prefsById.has(r.userId) && prefsAllowKind(prefsById.get(r.userId), "birthday"),
    );
    if (toNotify.length === 0) return toNotify;

    await tx.insert(notifications).values(
      toNotify.map((r) => ({
        user_id: r.userId,
        kind: "birthday" as const,
        title_en: "Happy Birthday!",
        title_hi: "जन्मदिन की शुभकामनाएँ!",
        body_en: `Wishing ${joinNames(r.names, "and")} a joyful and blessed birthday from all of us at Jain Pathshala.`,
        body_hi: `जैन पाठशाला परिवार की ओर से ${joinNames(r.names, "और")} को जन्मदिन की हार्दिक शुभकामनाएँ।`,
      })),
    );
    return toNotify;
  });

  if (toInsert.length === 0) {
    return { students: birthdayStudents.length, notifications: 0 };
  }

  // Best-effort push OUTSIDE the transaction. Inbox rows already inserted above;
  // inbox:false so a re-run/retry does not double-insert the inbox row (the
  // channel gate inside notifyUsers still applies to the push itself).
  // Per-recipient body (student name(s)) — one notifyUsers call each.
  //
  // X-10 — per-recipient try/catch: this used to be a bare loop with no
  // per-iteration guard, so one recipient's push throwing propagated out of
  // the whole cron run. Under BullMQ retry, the dedup SELECT above then finds
  // every "today" row already inserted for everyone and returns early —
  // nobody gets a birthday push that day, and the retry cannot recover it.
  for (const r of toInsert) {
    try {
      await notifyUsers({
        userIds: [r.userId],
        kind: "birthday",
        title_en: "Happy Birthday!",
        title_hi: "जन्मदिन की शुभकामनाएँ!",
        body_en: `Wishing ${joinNames(r.names, "and")} a joyful and blessed birthday.`,
        body_hi: `जैन पाठशाला परिवार की ओर से ${joinNames(r.names, "और")} को जन्मदिन की हार्दिक शुभकामनाएँ।`,
        inbox: false,
        push: true,
        data: { kind: "birthday" },
      });
    } catch (err) {
      logger.error({ err, userId: r.userId }, "runBirthdayWishes: push failed for one recipient");
    }
  }

  return { students: birthdayStudents.length, notifications: toInsert.length };
}

export default router;
