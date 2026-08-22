import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  db,
  pool,
  notifications,
  users,
  students,
  sessions,
  attendance,
  device_push_tokens,
  upload_objects,
  NOTIFICATION_KINDS,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { runBirthdayWishes } from "../src/routes/v1/notifications";
import { sendParentAttendancePush } from "../src/services/attendance-post-process";
import { notifyBadgesPush } from "../src/lib/niyam-badges";
import { notifyUsers } from "../src/lib/notify";
import * as pushModule from "../src/lib/push";
import { sendPush, sweepPushReceipts } from "../src/lib/push";
import { Expo } from "expo-server-sdk";

function todayIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

function daysAgoIst(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

describe("notifications — auth", () => {
  it("rejects the inbox without auth", async () => {
    const res = await request(app).get("/v1/notifications");
    expect(res.status).toBe(401);
  });

  it("rejects push-token registration without auth", async () => {
    const res = await request(app).post("/v1/notifications/push-token").send({ expo_token: "x" });
    expect(res.status).toBe(401);
  });
});

describe("notifications — push token", () => {
  it("registers (upserts) a push token for the caller", async () => {
    const { token } = await loginAs("parent");
    // Use a real Expo-format token so it would also pass the push-send filter.
    const expoToken = "ExponentPushToken[jp-test-parent-0001]";

    const res1 = await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(token))
      .send({ expo_token: expoToken, platform: "ios" });
    expect(res1.status).toBe(200);
    expect(res1.body.data.ok).toBe(true);

    // Re-registering the same token must succeed (idempotent upsert, no error).
    const res2 = await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(token))
      .send({ expo_token: expoToken, platform: "android" });
    expect(res2.status).toBe(200);
    expect(res2.body.data.ok).toBe(true);
  });

  it("rejects an empty expo_token", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(token))
      .send({ expo_token: "" });
    expect(res.status).toBe(422);
  });

  it("user B cannot claim user A's active push token", async () => {
    const userA = await loginAs("parent");
    const userB = await loginAs("shikshak");
    const expoToken = `ExponentPushToken[fix4-claim-${Date.now()}]`;

    const regA = await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(userA.token))
      .send({ expo_token: expoToken, platform: "ios" });
    expect(regA.status).toBe(200);

    try {
      const claimB = await request(app)
        .post("/v1/notifications/push-token")
        .set(auth(userB.token))
        .send({ expo_token: expoToken, platform: "android" });
      expect(claimB.status).toBe(409);
      expect(claimB.body.error.code).toBe("ERR_PUSH_TOKEN_CLAIMED");

      const [row] = await db
        .select({ user_id: device_push_tokens.user_id, is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, expoToken))
        .limit(1);
      expect(row?.user_id).toBe(userA.user.id);
      expect(row?.is_active).toBe(true);
    } finally {
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });

  it("re-registering your own token is idempotent and reactivates it", async () => {
    const userA = await loginAs("parent");
    const expoToken = `ExponentPushToken[fix4-reactivate-${Date.now()}]`;

    const reg1 = await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(userA.token))
      .send({ expo_token: expoToken, platform: "ios" });
    expect(reg1.status).toBe(200);

    const [before] = await db
      .select({ id: device_push_tokens.id })
      .from(device_push_tokens)
      .where(eq(device_push_tokens.expo_token, expoToken))
      .limit(1);

    await db
      .update(device_push_tokens)
      .set({ is_active: false })
      .where(eq(device_push_tokens.expo_token, expoToken));

    try {
      const reg2 = await request(app)
        .post("/v1/notifications/push-token")
        .set(auth(userA.token))
        .send({ expo_token: expoToken, platform: "android" });
      expect(reg2.status).toBe(200);

      const [after] = await db
        .select({
          id: device_push_tokens.id,
          is_active: device_push_tokens.is_active,
          platform: device_push_tokens.platform,
          user_id: device_push_tokens.user_id,
        })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, expoToken))
        .limit(1);
      expect(after?.id).toBe(before?.id);
      expect(after?.is_active).toBe(true);
      expect(after?.platform).toBe("android");
      expect(after?.user_id).toBe(userA.user.id);
    } finally {
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });

  it("a token deactivated by DeviceNotRegistered can be claimed by a new user", async () => {
    const userA = await loginAs("parent");
    const userB = await loginAs("shikshak");
    const expoToken = `ExponentPushToken[fix4-handover-${Date.now()}]`;

    await request(app)
      .post("/v1/notifications/push-token")
      .set(auth(userA.token))
      .send({ expo_token: expoToken, platform: "ios" });

    await db
      .update(device_push_tokens)
      .set({ is_active: false })
      .where(eq(device_push_tokens.expo_token, expoToken));

    try {
      const claimB = await request(app)
        .post("/v1/notifications/push-token")
        .set(auth(userB.token))
        .send({ expo_token: expoToken, platform: "android" });
      expect(claimB.status).toBe(200);

      const [row] = await db
        .select({ user_id: device_push_tokens.user_id, is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, expoToken))
        .limit(1);
      expect(row?.user_id).toBe(userB.user.id);
      expect(row?.is_active).toBe(true);
    } finally {
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });
});

describe("notifications — inbox + read flow", () => {
  it("lists the caller's notifications with an unread_count and marks one read", async () => {
    const session = await loginAs("parent");
    const uid = session.user.id;

    // T-8 (review 2026-08) — a loose >=1 assertion is satisfied by a query
    // that dropped the user_id filter and counted every user's unread rows.
    // Capture the baseline so the assertion below pins the actual delta.
    const before = await request(app).get("/v1/notifications?limit=50").set(auth(session.token));
    const baselineUnread = before.body.data.unread_count as number;

    // Self-create a notification directly so the test is rerun-safe.
    const [created] = await db
      .insert(notifications)
      .values({
        user_id: uid,
        kind: "general",
        title_en: "Test notice",
        title_hi: "परीक्षण सूचना",
        body_en: "Hello from the notifications test.",
        body_hi: "सूचना परीक्षण से नमस्ते।",
      })
      .returning({ id: notifications.id });

    const listRes = await request(app).get("/v1/notifications?limit=50").set(auth(session.token));
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.data.items)).toBe(true);
    expect(typeof listRes.body.data.unread_count).toBe("number");
    expect(listRes.body.data.unread_count).toBe(baselineUnread + 1);
    const found = listRes.body.data.items.find((n: { id: string }) => n.id === created.id);
    expect(found).toBeTruthy();
    expect(found.read_at).toBeNull();

    const readRes = await request(app)
      .post(`/v1/notifications/${created.id}/read`)
      .set(auth(session.token))
      .send({});
    expect(readRes.status).toBe(200);
    expect(readRes.body.data).toEqual({ id: created.id, read: true });

    // The row is now marked read in the DB.
    const [after] = await db
      .select({ read_at: notifications.read_at })
      .from(notifications)
      .where(eq(notifications.id, created.id))
      .limit(1);
    expect(after.read_at).not.toBeNull();

    // T-3 (review 2026-08) — the previous assertion here was only
    // `status === 200`; the actual contract (notifications.ts's own
    // comment: "re-calling keeps the timestamp") is that read_at does NOT
    // move on a repeat call. Assert the timestamp is stable, not just the
    // status code.
    const readAgain = await request(app)
      .post(`/v1/notifications/${created.id}/read`)
      .set(auth(session.token))
      .send({});
    expect(readAgain.status).toBe(200);
    const [afterAgain] = await db
      .select({ read_at: notifications.read_at })
      .from(notifications)
      .where(eq(notifications.id, created.id))
      .limit(1);
    expect(afterAgain.read_at?.getTime()).toBe(after.read_at?.getTime());
  });

  it("returns 404 marking a notification that is not the caller's", async () => {
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");

    const [created] = await db
      .insert(notifications)
      .values({
        user_id: parent.user.id,
        kind: "general",
        title_en: "Parent only",
        title_hi: "केवल अभिभावक",
        body_en: "Private to the parent.",
        body_hi: "अभिभावक के लिए निजी।",
      })
      .returning({ id: notifications.id });

    // Shikshak must not be able to mark the parent's notification read.
    const res = await request(app)
      .post(`/v1/notifications/${created.id}/read`)
      .set(auth(shikshak.token))
      .send({});
    expect(res.status).toBe(404);

    // And it stays unread.
    const [row] = await db
      .select({ read_at: notifications.read_at })
      .from(notifications)
      .where(eq(notifications.id, created.id))
      .limit(1);
    expect(row.read_at).toBeNull();
  });

  it("returns 404 for a non-existent notification id", async () => {
    const session = await loginAs("parent");
    const res = await request(app)
      .post(`/v1/notifications/00000000-0000-0000-0000-000000000000/read`)
      .set(auth(session.token))
      .send({});
    expect(res.status).toBe(404);
  });
});

describe("notifications — birthday cron", () => {
  it("creates a birthday notification for Aarav's parent and is idempotent per day", async () => {
    // Aarav Shah's seeded dob is 2016-04-12 (lib/db/src/seed.ts). The parent
    // persona (+919800000006) owns Aarav, so passing an April-12 'today'
    // (any year, IST) must create a 'birthday' notification for that parent.
    const parent = await loginAs("parent");
    const parentId = parent.user.id;

    // Clear any prior birthday notifications for this parent so this rerun-safe
    // test starts clean (the cron's per-day idempotency would otherwise skip).
    await db
      .delete(notifications)
      .where(and(eq(notifications.user_id, parentId), eq(notifications.kind, "birthday")));

    const today = new Date("2020-04-12T06:00:00+05:30");
    const result1 = await runBirthdayWishes(today);
    expect(result1.students).toBeGreaterThanOrEqual(1);
    expect(result1.notifications).toBeGreaterThanOrEqual(1);

    // A birthday notification now exists for Aarav's parent.
    const [birthdayNote] = await db
      .select({
        id: notifications.id,
        kind: notifications.kind,
        title_en: notifications.title_en,
        title_hi: notifications.title_hi,
      })
      .from(notifications)
      .where(and(eq(notifications.user_id, parentId), eq(notifications.kind, "birthday")))
      .orderBy(desc(notifications.created_at))
      .limit(1);
    expect(birthdayNote).toBeTruthy();
    expect(birthdayNote.title_en).toContain("Birthday");
    expect(birthdayNote.title_hi).toBeTruthy();

    // Count birthday notifications for the parent after the first run.
    const countAfterFirst = (
      await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.user_id, parentId), eq(notifications.kind, "birthday")))
    ).length;

    // Running again the same day must NOT add another birthday notification.
    const result2 = await runBirthdayWishes(today);
    expect(result2.notifications).toBe(0);

    const countAfterSecond = (
      await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.user_id, parentId), eq(notifications.kind, "birthday")))
    ).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("creates nothing on a day with no birthdays", async () => {
    // Dec 25 is not a seeded dob month-day; expect zero students/notifications.
    const result = await runBirthdayWishes(new Date("2020-12-25T06:00:00+05:30"));
    expect(result.students).toBe(0);
    expect(result.notifications).toBe(0);
  });
});

describe("notifications — dead token reaping (FIX #3)", () => {
  it("a DeviceNotRegistered ticket deactivates that token and no others", async () => {
    const parentA = await loginAs("parent");
    const parentB = await loginAs("shikshak");
    const tokenA = `ExponentPushToken[fix3-dead-${Date.now()}-a]`;
    const tokenB = `ExponentPushToken[fix3-dead-${Date.now()}-b]`;

    await db.insert(device_push_tokens).values([
      { user_id: parentA.user.id, expo_token: tokenA, platform: "ios", is_active: true },
      { user_id: parentB.user.id, expo_token: tokenB, platform: "android", is_active: true },
    ]);

    const sendSpy = vi
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockResolvedValue([
        {
          status: "error",
          message: "Not registered",
          details: { error: "DeviceNotRegistered" },
        },
        { status: "ok", id: `receipt-ok-${Date.now()}` },
      ] as never);

    try {
      await sendPush([
        { to: tokenA, title: "A", body: "a" },
        { to: tokenB, title: "B", body: "b" },
      ]);

      const [rowA] = await db
        .select({ is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, tokenA))
        .limit(1);
      const [rowB] = await db
        .select({ is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, tokenB))
        .limit(1);
      expect(rowA?.is_active).toBe(false);
      expect(rowB?.is_active).toBe(true);
    } finally {
      sendSpy.mockRestore();
      await db
        .delete(device_push_tokens)
        .where(inArray(device_push_tokens.expo_token, [tokenA, tokenB]));
    }
  });

  it("a MessageRateExceeded ticket does NOT deactivate the token", async () => {
    const parent = await loginAs("parent");
    const token = `ExponentPushToken[fix3-rate-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: token,
      platform: "ios",
      is_active: true,
    });

    const sendSpy = vi.spyOn(Expo.prototype, "sendPushNotificationsAsync").mockResolvedValue([
      {
        status: "error",
        message: "Rate exceeded",
        details: { error: "MessageRateExceeded" },
      },
    ] as never);

    try {
      await sendPush([{ to: token, title: "T", body: "b" }]);
      const [row] = await db
        .select({ is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, token))
        .limit(1);
      expect(row?.is_active).toBe(true);
    } finally {
      sendSpy.mockRestore();
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, token));
    }
  });

  it("a DeviceNotRegistered receipt deactivates the token", async () => {
    const parent = await loginAs("parent");
    const token = `ExponentPushToken[fix3-receipt-${Date.now()}]`;
    const ticketId = `ticket-fix3-${Date.now()}`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: token,
      platform: "ios",
      is_active: true,
    });

    const { push_receipts } = await import("@workspace/db");
    await db.insert(push_receipts).values({
      ticket_id: ticketId,
      expo_token: token,
    });

    const receiptSpy = vi
      .spyOn(Expo.prototype, "getPushNotificationReceiptsAsync")
      .mockResolvedValue({
        [ticketId]: {
          status: "error",
          message: "Not registered",
          details: { error: "DeviceNotRegistered" },
        },
      } as never);

    try {
      await sweepPushReceipts();
      const [row] = await db
        .select({ is_active: device_push_tokens.is_active })
        .from(device_push_tokens)
        .where(eq(device_push_tokens.expo_token, token))
        .limit(1);
      expect(row?.is_active).toBe(false);
    } finally {
      receiptSpy.mockRestore();
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, token));
      try {
        await db.delete(push_receipts).where(eq(push_receipts.ticket_id, ticketId));
      } catch {
        /* table may not exist before migration */
      }
    }
  });

  it("sendPush still resolves when the Expo call throws", async () => {
    const sendSpy = vi
      .spyOn(Expo.prototype, "sendPushNotificationsAsync")
      .mockRejectedValue(new Error("Expo down"));
    try {
      await expect(
        sendPush([
          {
            to: `ExponentPushToken[fix3-throw-${Date.now()}]`,
            title: "T",
            body: "b",
          },
        ]),
      ).resolves.toEqual([]);
    } finally {
      sendSpy.mockRestore();
    }
  });
});

describe("notifications — mark-all-read (FIX #11)", () => {
  it("mark-all-read clears only the caller's unread notifications", async () => {
    const userA = await loginAs("parent");
    const userB = await loginAs("shikshak");
    const suffix = `${Date.now()}`;
    const planted: string[] = [];

    try {
      for (const uid of [userA.user.id, userB.user.id]) {
        const [row] = await db
          .insert(notifications)
          .values({
            user_id: uid,
            kind: "general",
            title_en: `Fix11 unread ${suffix}`,
            title_hi: "अनरीड",
            body_en: "Unread row",
            body_hi: "अपठित",
          })
          .returning({ id: notifications.id });
        planted.push(row!.id);
      }

      const res = await request(app)
        .post("/v1/notifications/read-all")
        .set(auth(userA.token))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.updated).toBeGreaterThanOrEqual(1);

      const listA = await request(app)
        .get("/v1/notifications?limit=50")
        .set(auth(userA.token));
      expect(listA.status).toBe(200);
      expect(listA.body.data.unread_count).toBe(0);

      const listB = await request(app)
        .get("/v1/notifications?limit=50")
        .set(auth(userB.token));
      expect(listB.status).toBe(200);
      expect(listB.body.data.unread_count).toBeGreaterThanOrEqual(1);
      const bRow = (listB.body.data.items as Array<{ id: string; read_at: string | null }>).find(
        (n) => n.id === planted[1],
      );
      expect(bRow?.read_at).toBeNull();
    } finally {
      if (planted.length) {
        await db.delete(notifications).where(inArray(notifications.id, planted));
      }
    }
  });

  it("mark-all-read preserves already-read timestamps", async () => {
    const session = await loginAs("parent");
    const uid = session.user.id;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [readRow] = await db
      .insert(notifications)
      .values({
        user_id: uid,
        kind: "general",
        title_en: `Fix11 already-read ${Date.now()}`,
        title_hi: "पहले से पढ़ा",
        body_en: "Keep timestamp",
        body_hi: "समय रखें",
        read_at: yesterday,
      })
      .returning({ id: notifications.id, read_at: notifications.read_at });

    const [unreadRow] = await db
      .insert(notifications)
      .values({
        user_id: uid,
        kind: "general",
        title_en: `Fix11 to-read ${Date.now()}`,
        title_hi: "पढ़ना है",
        body_en: "Mark me",
        body_hi: "चिह्नित करें",
      })
      .returning({ id: notifications.id });

    try {
      const before = readRow!.read_at!.toISOString();
      const res = await request(app)
        .post("/v1/notifications/read-all")
        .set(auth(session.token))
        .send({});
      expect(res.status).toBe(200);

      const [after] = await db
        .select({ read_at: notifications.read_at })
        .from(notifications)
        .where(eq(notifications.id, readRow!.id))
        .limit(1);
      expect(after!.read_at!.toISOString()).toBe(before);

      const [marked] = await db
        .select({ read_at: notifications.read_at })
        .from(notifications)
        .where(eq(notifications.id, unreadRow!.id))
        .limit(1);
      expect(marked!.read_at).not.toBeNull();
    } finally {
      await db
        .delete(notifications)
        .where(inArray(notifications.id, [readRow!.id, unreadRow!.id]));
    }
  });

  it("mark-all-read on an empty inbox returns 200 with updated: 0", async () => {
    const session = await loginAs("parent");
    await db.delete(notifications).where(eq(notifications.user_id, session.user.id));

    const res = await request(app)
      .post("/v1/notifications/read-all")
      .set(auth(session.token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 0 });
  });
});

describe("notifications — inbox keyset pagination (FIX #10)", () => {
  it("the inbox pages through more notifications than the limit", async () => {
    const session = await loginAs("parent");
    const uid = session.user.id;
    const suffix = `${Date.now()}`;
    const planted: string[] = [];

    // Isolate from leftover inbox rows left by earlier tests.
    await db.delete(notifications).where(eq(notifications.user_id, uid));

    try {
      // T-1 (review 2026-08) — `i` used to land in the SECONDS field, so all
      // five rows got distinct created_at values and the (created_at, id)
      // tie-break (the entire reason `id` is in the cursor, and the reason
      // migration 0046 exists) was never exercised — deleting that clause
      // would leave this test green. Every row shares the exact same
      // created_at here, forcing the ordering (and the cursor) to rely on
      // `id DESC` alone.
      const sharedCreatedAt = new Date(Date.UTC(2024, 5, 1, 12, 0, 0));
      for (let i = 0; i < 5; i++) {
        const createdAt = sharedCreatedAt;
        const [row] = await db
          .insert(notifications)
          .values({
            user_id: uid,
            kind: "general",
            title_en: `Fix10 page ${i} ${suffix}`,
            title_hi: `फिक्स10 ${i}`,
            body_en: `Body ${i}`,
            body_hi: `शरीर ${i}`,
            created_at: createdAt,
            updated_at: createdAt,
          })
          .returning({ id: notifications.id });
        planted.push(row!.id);
      }

      const seen = new Set<string>();
      let cursor: string | null = null;
      for (let page = 0; page < 3; page++) {
        const qs = cursor
          ? `limit=2&cursor=${encodeURIComponent(cursor)}`
          : "limit=2";
        const res = await request(app)
          .get(`/v1/notifications?${qs}`)
          .set(auth(session.token));
        expect(res.status).toBe(200);
        const items = res.body.data.items as Array<{ id: string; title_en: string }>;
        expect(items.length).toBe(page < 2 ? 2 : 1);
        if (page === 0) {
          expect(typeof res.body.data.unread_count).toBe("number");
        } else {
          expect(res.body.data.unread_count).toBeUndefined();
        }
        for (const item of items) {
          expect(seen.has(item.id)).toBe(false);
          seen.add(item.id);
          expect(item.title_en).toContain(suffix);
        }
        cursor = res.body.data.next_cursor as string | null;
        if (page < 2) expect(cursor).toBeTruthy();
        else expect(cursor).toBeNull();
      }
      expect(seen.size).toBe(5);
      for (const id of planted) expect(seen.has(id)).toBe(true);
    } finally {
      await db.delete(notifications).where(eq(notifications.user_id, uid));
    }
  });

  it("a cursor from another user's inbox returns that user nothing", async () => {
    const userA = await loginAs("parent");
    const userB = await loginAs("shikshak");
    const suffix = `${Date.now()}`;

    await db.delete(notifications).where(eq(notifications.user_id, userB.user.id));

    // T-2 (review 2026-08) — the previous version of this test planted only
    // ONE row for userA, so `[]` came back from userB's query whether or
    // not `eq(notifications.user_id, uid)` was actually in it (there was
    // nothing else for the query to wrongly return). A second, OLDER row
    // for userA — positioned exactly where it would surface next if the
    // user_id filter were silently dropped — makes the assertion real.
    const newer = new Date(Date.UTC(2024, 5, 2, 12, 0, 0));
    const older = new Date(Date.UTC(2024, 5, 1, 12, 0, 0));
    const [aRow] = await db
      .insert(notifications)
      .values({
        user_id: userA.user.id,
        kind: "general",
        title_en: `Fix10 A newer ${suffix}`,
        title_hi: "ए",
        body_en: "A only",
        body_hi: "केवल ए",
        created_at: newer,
        updated_at: newer,
      })
      .returning({ id: notifications.id, created_at: notifications.created_at });
    const [aRowOlder] = await db
      .insert(notifications)
      .values({
        user_id: userA.user.id,
        kind: "general",
        title_en: `Fix10 A older ${suffix}`,
        title_hi: "ए पुराना",
        body_en: "A only, older",
        body_hi: "केवल ए, पुराना",
        created_at: older,
        updated_at: older,
      })
      .returning({ id: notifications.id });

    try {
      // Cursor is a position only — user_id filter still applies independently.
      const cursor = Buffer.from(
        `${aRow!.created_at.toISOString()}|${aRow!.id}`,
        "utf8",
      ).toString("base64url");

      const listB = await request(app)
        .get(`/v1/notifications?limit=50&cursor=${encodeURIComponent(cursor)}`)
        .set(auth(userB.token));
      expect(listB.status).toBe(200);
      const items = listB.body.data.items as Array<{ id: string; title_en: string }>;
      expect(items).toEqual([]);
      expect(items.every((n) => n.id !== aRow!.id && n.id !== aRowOlder!.id)).toBe(true);
    } finally {
      await db.delete(notifications).where(inArray(notifications.id, [aRow!.id, aRowOlder!.id]));
    }
  });

  it("an invalid cursor returns 422, not a 500", async () => {
    const session = await loginAs("parent");
    const res = await request(app)
      .get("/v1/notifications?cursor=not-a-valid-cursor")
      .set(auth(session.token));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });
});

describe("notifications — attendance kind (FIX #9)", () => {
  it("attendance notifications are stored with kind 'attendance'", async () => {
    const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
      `select b.id as batch_id, b.centre_id
         from batches b
        where b.deleted_at is null and b.status = 'active'
        limit 1`,
    );
    expect(batchPick.rows.length).toBe(1);
    const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;
    const suffix = `${Date.now()}`;

    const [parent] = await db
      .insert(users)
      .values({
        phone: `+91982${suffix.slice(-7)}`.slice(0, 15),
        role: "parent",
        full_name: `Fix9 Parent ${suffix}`,
      })
      .returning({ id: users.id });
    const [stu] = await db
      .insert(students)
      .values({
        centre_id: centreId,
        batch_id: batchId,
        parent_id: parent!.id,
        full_name: `Fix9 Child ${suffix}`,
        student_code: `F9${suffix}`,
        status: "active",
        dob: "2015-01-01",
        gender: "male",
        age_group: "bal",
      })
      .returning({ id: students.id });

    try {
      const [session] = await db
        .insert(sessions)
        .values({
          batch_id: batchId,
          scheduled_date: "2024-08-01",
          scheduled_start_time: "10:00:00",
          scheduled_end_time: "11:00:00",
          status: "completed",
          topic: `fix9-kind-${suffix}`,
        })
        .onConflictDoUpdate({
          target: [sessions.batch_id, sessions.scheduled_date],
          set: { topic: `fix9-kind-${suffix}`, status: "completed" },
        })
        .returning({ id: sessions.id });

      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
      await db.insert(attendance).values({
        session_id: session!.id,
        student_id: stu!.id,
        status: "present",
        session_date: "2024-08-01",
        marked_method: "manual",
        revision: 1,
      });

      await db.delete(notifications).where(eq(notifications.user_id, parent!.id));
      await sendParentAttendancePush(stu!.id, session!.id);

      const rows = await db
        .select({ kind: notifications.kind, title_en: notifications.title_en })
        .from(notifications)
        .where(eq(notifications.user_id, parent!.id));
      expect(rows.length).toBe(1);
      expect(rows[0]!.kind).toBe("attendance");
      expect(rows[0]!.title_en).toBe("Attendance marked");
    } finally {
      await db.delete(notifications).where(eq(notifications.user_id, parent!.id));
      await db.delete(attendance).where(eq(attendance.student_id, stu!.id));
      await db.delete(students).where(eq(students.id, stu!.id));
      await db.delete(users).where(eq(users.id, parent!.id));
    }
  });

  it("disabling 'attendance' does not suppress 'general' notifications, and vice versa", async () => {
    const parent = await loginAs("parent");
    const [prefsBefore] = await db
      .select({ prefs: users.notification_preferences })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ notification_preferences: { attendance: false } })
        .where(eq(users.id, parent.user.id));

      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.user_id, parent.user.id),
            inArray(notifications.kind, ["attendance", "general"]),
          ),
        );

      await notifyUsers({
        userIds: [parent.user.id],
        kind: "attendance",
        title_en: "Attendance gated",
        title_hi: "उपस्थिति बंद",
        body_en: "Should be skipped",
        body_hi: "छोड़ा जाना चाहिए",
        push: false,
      });
      await notifyUsers({
        userIds: [parent.user.id],
        kind: "general",
        title_en: "General allowed",
        title_hi: "सामान्य अनुमति",
        body_en: "Should land",
        body_hi: "आना चाहिए",
        push: false,
      });

      const afterAttendanceOff = await db
        .select({ kind: notifications.kind, title_en: notifications.title_en })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, parent.user.id),
            inArray(notifications.kind, ["attendance", "general"]),
          ),
        );
      expect(afterAttendanceOff.some((r) => r.kind === "attendance")).toBe(false);
      expect(afterAttendanceOff.some((r) => r.title_en === "General allowed")).toBe(true);

      await db
        .update(users)
        .set({ notification_preferences: { general: false } })
        .where(eq(users.id, parent.user.id));

      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.user_id, parent.user.id),
            inArray(notifications.kind, ["attendance", "general"]),
          ),
        );

      await notifyUsers({
        userIds: [parent.user.id],
        kind: "general",
        title_en: "General gated",
        title_hi: "सामान्य बंद",
        body_en: "Should be skipped",
        body_hi: "छोड़ा जाना चाहिए",
        push: false,
      });
      await notifyUsers({
        userIds: [parent.user.id],
        kind: "attendance",
        title_en: "Attendance allowed",
        title_hi: "उपस्थिति अनुमति",
        body_en: "Should land",
        body_hi: "आना चाहिए",
        push: false,
      });

      const afterGeneralOff = await db
        .select({ kind: notifications.kind, title_en: notifications.title_en })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, parent.user.id),
            inArray(notifications.kind, ["attendance", "general"]),
          ),
        );
      expect(afterGeneralOff.some((r) => r.kind === "general")).toBe(false);
      expect(afterGeneralOff.some((r) => r.title_en === "Attendance allowed")).toBe(true);
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ notification_preferences: prefsBefore?.prefs ?? {} })
        .where(eq(users.id, parent.user.id));
      await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.user_id, parent.user.id),
            inArray(notifications.kind, ["attendance", "general"]),
          ),
        );
    }
  });
});

describe("notifications — Hindi columns required (FIX #8)", () => {
  it("an insert without Hindi copy is rejected", async () => {
    const parent = await loginAs("parent");
    await expect(
      db.insert(notifications).values({
        user_id: parent.user.id,
        kind: "general",
        title_en: "English only",
        body_en: "No Hindi fields",
      }),
    ).rejects.toThrow();
  });
});

describe("notifications — deep-link data payload (FIX #7)", () => {
  it("the push payload carries kind and entity id", async () => {
    const parent = await loginAs("parent");
    const expoToken = `ExponentPushToken[fix7-data-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    const entityId = "11111111-1111-4111-8111-111111111111";
    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await notifyUsers({
        userIds: [parent.user.id],
        kind: "homework",
        title_en: "Deep link",
        title_hi: "गहन लिंक",
        body_en: "Open the assignment",
        body_hi: "असाइनमेंट खोलें",
        push: true,
        data: { entity_id: entityId },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const payload = (spy.mock.calls[0]![0] as Array<{
        to: string;
        data?: { kind?: string; entity_id?: string };
      }>).find((p) => p.to === expoToken);
      expect(payload?.data?.kind).toBe("homework");
      expect(payload?.data?.entity_id).toBe(entityId);
    } finally {
      spy.mockRestore();
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });
});

describe("notifications — inbox insert failures (FIX #6)", () => {
  it("notifyUsers throws when the inbox insert fails", async () => {
    const parent = await loginAs("parent");
    const origInsert = db.insert.bind(db);
    const insertSpy = vi.spyOn(db, "insert").mockImplementation(((table: unknown) => {
      if (table === notifications) {
        return {
          values: () => Promise.reject(new Error("inbox insert failed")),
        } as ReturnType<typeof db.insert>;
      }
      return origInsert(table as Parameters<typeof db.insert>[0]);
    }) as typeof db.insert);

    try {
      await expect(
        notifyUsers({
          userIds: [parent.user.id],
          kind: "general",
          title_en: "Insert fail",
          title_hi: "असफल",
          body_en: "Body",
          body_hi: "शरीर",
          push: false,
        }),
      ).rejects.toThrow("inbox insert failed");
    } finally {
      insertSpy.mockRestore();
    }
  });

  it("notifyUsers resolves when only the push transport fails", async () => {
    const parent = await loginAs("parent");
    const expoToken = `ExponentPushToken[fix6-push-fail-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    const spy = vi
      .spyOn(pushModule, "sendPush")
      .mockRejectedValue(new Error("Expo transport down"));
    const title = `Fix6 push-fail ${Date.now()}`;
    try {
      await expect(
        notifyUsers({
          userIds: [parent.user.id],
          kind: "general",
          title_en: title,
          title_hi: "पुश असफल",
          body_en: "Body stays in inbox",
          body_hi: "इनबॉक्स में रहता है",
          push: true,
        }),
      ).resolves.toBeUndefined();

      const inbox = await db
        .select({ title_en: notifications.title_en })
        .from(notifications)
        .where(
          and(eq(notifications.user_id, parent.user.id), eq(notifications.title_en, title)),
        );
      expect(inbox.length).toBe(1);
    } finally {
      spy.mockRestore();
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
      await db
        .delete(notifications)
        .where(
          and(eq(notifications.user_id, parent.user.id), eq(notifications.title_en, title)),
        );
    }
  });

  it("a caller in a fire-and-forget path is unaffected", async () => {
    // homework-notify (and gallery-wall-notify) wrap notifyUsers in try/catch so
    // a durable-insert throw does not crash the request handler.
    const parent = await loginAs("parent");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const childId = (children.body.data.items as Array<{ id: string }>)[0]?.id;
    expect(childId).toBeTruthy();

    const notifyMod = await import("../src/lib/notify");
    const { notifyParentsHomeworkAssigned } = await import("../src/lib/homework-notify");
    const notifySpy = vi
      .spyOn(notifyMod, "notifyUsers")
      .mockRejectedValue(new Error("inbox insert failed"));
    try {
      await expect(
        notifyParentsHomeworkAssigned({
          studentIds: [childId!],
          assignmentTitle: "Fix6 fire-and-forget",
          assignmentId: "00000000-0000-4000-8000-000000000066",
        }),
      ).resolves.toBeUndefined();
      expect(notifySpy).toHaveBeenCalled();
    } finally {
      notifySpy.mockRestore();
    }
  });
});

describe("notifications — preferred language on push (FIX #5)", () => {
  it("a Hindi-preference user receives the Devanagari push body", async () => {
    const hiUser = await loginAs("parent");
    const enUser = await loginAs("shikshak");
    const hiToken = `ExponentPushToken[fix5-hi-${Date.now()}]`;
    const enToken = `ExponentPushToken[fix5-en-${Date.now()}]`;

    const [hiLangBefore] = await db
      .select({ preferred_language: users.preferred_language })
      .from(users)
      .where(eq(users.id, hiUser.user.id))
      .limit(1);
    const [enLangBefore] = await db
      .select({ preferred_language: users.preferred_language })
      .from(users)
      .where(eq(users.id, enUser.user.id))
      .limit(1);

    await db.insert(device_push_tokens).values([
      { user_id: hiUser.user.id, expo_token: hiToken, platform: "ios", is_active: true },
      { user_id: enUser.user.id, expo_token: enToken, platform: "android", is_active: true },
    ]);

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ preferred_language: "hi" })
        .where(eq(users.id, hiUser.user.id));
      await db
        .update(users)
        .set({ preferred_language: "en" })
        .where(eq(users.id, enUser.user.id));

      await notifyUsers({
        userIds: [hiUser.user.id, enUser.user.id],
        kind: "general",
        title_en: "English title",
        title_hi: "हिंदी शीर्षक",
        body_en: "English body",
        body_hi: "हिंदी शरीर",
        push: true,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const payloads = spy.mock.calls[0]![0] as Array<{
        to: string;
        title: string;
        body: string;
      }>;
      const hiPayload = payloads.find((p) => p.to === hiToken);
      const enPayload = payloads.find((p) => p.to === enToken);
      expect(hiPayload).toEqual(
        expect.objectContaining({
          to: hiToken,
          title: "हिंदी शीर्षक",
          body: "हिंदी शरीर",
        }),
      );
      expect(enPayload).toEqual(
        expect.objectContaining({
          to: enToken,
          title: "English title",
          body: "English body",
        }),
      );
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ preferred_language: hiLangBefore?.preferred_language ?? "en" })
        .where(eq(users.id, hiUser.user.id));
      await db
        .update(users)
        .set({ preferred_language: enLangBefore?.preferred_language ?? "en" })
        .where(eq(users.id, enUser.user.id));
      await db
        .delete(device_push_tokens)
        .where(inArray(device_push_tokens.expo_token, [hiToken, enToken]));
    }
  });

  it("a user with no preferred_language falls back to English", async () => {
    const parent = await loginAs("parent");
    const expoToken = `ExponentPushToken[fix5-null-${Date.now()}]`;
    const [langBefore] = await db
      .select({ preferred_language: users.preferred_language })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    // Column is NOT NULL in schema; drop briefly so we can plant a real null.
    await pool.query(
      `ALTER TABLE users ALTER COLUMN preferred_language DROP NOT NULL`,
    );
    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await pool.query(`UPDATE users SET preferred_language = NULL WHERE id = $1`, [
        parent.user.id,
      ]);

      await notifyUsers({
        userIds: [parent.user.id],
        kind: "general",
        title_en: "Fallback title",
        title_hi: "फ़ॉलबैक शीर्षक",
        body_en: "Fallback body",
        body_hi: "फ़ॉलबैक शरीर",
        push: true,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const payload = (spy.mock.calls[0]![0] as Array<{ to: string; title: string; body: string }>).find(
        (p) => p.to === expoToken,
      );
      expect(payload?.title).toBe("Fallback title");
      expect(payload?.body).toBe("Fallback body");
      expect(payload?.body).toBeTruthy();
    } finally {
      spy.mockRestore();
      await pool.query(
        `UPDATE users SET preferred_language = $2 WHERE id = $1`,
        [parent.user.id, langBefore?.preferred_language ?? "en"],
      );
      await pool.query(
        `ALTER TABLE users ALTER COLUMN preferred_language SET DEFAULT 'en'`,
      );
      await pool.query(
        `ALTER TABLE users ALTER COLUMN preferred_language SET NOT NULL`,
      );
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });
});

describe("notifications — preference gate (FIX #2)", () => {
  it("a parent with push disabled gets no niyam-rejection push", async () => {
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    const childId = (children.body.data.items as Array<{ id: string }>)[0]?.id;
    expect(childId).toBeTruthy();

    const [prefsBefore] = await db
      .select({ prefs: users.notification_preferences })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    const expoToken = `ExponentPushToken[fix2-reject-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ notification_preferences: { push: false } })
        .where(eq(users.id, parent.user.id));

      const admin = await loginAs("super_admin");
      const proofKey = `niyam-proof/fix2-reject-${Date.now()}.jpg`;
      const proofUrl = `http://localhost:8080/uploads/${proofKey}`;
      await db
        .insert(upload_objects)
        .values({ key: proofKey, uploaded_by: parent.user.id, content_type: "image/jpeg" })
        .onConflictDoUpdate({
          target: upload_objects.key,
          set: { uploaded_by: parent.user.id, content_type: "image/jpeg" },
        });

      const create = await request(app)
        .post("/v1/admin/niyams")
        .set(auth(admin.token))
        .send({
          title_en: `Fix2 reject ${Date.now()}`,
          title_hi: "फिक्स दो",
          niyam_type: "daily",
          proof_type: "either",
          approval_mode: "review",
          proof_required: false,
          max_uploads: 3,
          points: 5,
          start_date: daysAgoIst(60),
        });
      expect([200, 201]).toContain(create.status);
      const niyamId = create.body.data.id as string;

      const submit = await request(app)
        .post("/v1/niyam-submissions")
        .set(auth(parent.token))
        .send({
          niyam_id: niyamId,
          student_id: childId,
          submission_date: todayIst(),
          proof_url: proofUrl,
        });
      expect(submit.status).toBe(200);

      const reject = await request(app)
        .post(`/v1/niyam-submissions/${submit.body.data.id}/reject`)
        .set(auth(shikshak.token))
        .send({
          reason: "Needs a clearer photo of the practice — please resubmit.",
        });
      expect(reject.status).toBe(200);

      const calledWithParentToken = spy.mock.calls.some((call) =>
        (call[0] as Array<{ to: string }>).some((p) => p.to === expoToken),
      );
      expect(calledWithParentToken).toBe(false);
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ notification_preferences: prefsBefore?.prefs ?? {} })
        .where(eq(users.id, parent.user.id));
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });

  it("a parent with niyam_badge disabled still gets birthday notifications", async () => {
    const parent = await loginAs("parent");
    const [prefsBefore] = await db
      .select({ prefs: users.notification_preferences })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    const expoToken = `ExponentPushToken[fix2-badge-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ notification_preferences: { niyam_badge: false } })
        .where(eq(users.id, parent.user.id));

      await db
        .delete(notifications)
        .where(and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "niyam_badge")));

      await notifyBadgesPush({
        parentUserId: parent.user.id,
        studentName: "Fix2 Badge Child",
        badges: [
          { badge_key: "daily_7", streak_length: 7, points_awarded: 25 },
        ],
      });

      const badgePush = spy.mock.calls
        .flatMap((c) => c[0] as Array<{ to: string; data?: { kind?: string } }>)
        .find((p) => p.to === expoToken && p.data?.kind === "niyam_badge");
      expect(badgePush).toBeUndefined();

      await db
        .delete(notifications)
        .where(and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "birthday")));

      const birthday = await runBirthdayWishes(new Date("2020-04-12T06:00:00+05:30"));
      expect(birthday.notifications).toBeGreaterThanOrEqual(1);

      const birthdayPush = spy.mock.calls
        .flatMap((c) => c[0] as Array<{ to: string; data?: { kind?: string } }>)
        .find((p) => p.to === expoToken && p.data?.kind === "birthday");
      expect(birthdayPush).toBeTruthy();
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ notification_preferences: prefsBefore?.prefs ?? {} })
        .where(eq(users.id, parent.user.id));
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });

  it("a parent with push disabled gets no birthday push but still gets the inbox row", async () => {
    const parent = await loginAs("parent");
    const [prefsBefore] = await db
      .select({ prefs: users.notification_preferences })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);

    const expoToken = `ExponentPushToken[fix2-bday-${Date.now()}]`;
    await db.insert(device_push_tokens).values({
      user_id: parent.user.id,
      expo_token: expoToken,
      platform: "ios",
      is_active: true,
    });

    const spy = vi.spyOn(pushModule, "sendPush").mockResolvedValue([]);
    try {
      await db
        .update(users)
        .set({ notification_preferences: { push: false } })
        .where(eq(users.id, parent.user.id));

      await db
        .delete(notifications)
        .where(and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "birthday")));

      const result = await runBirthdayWishes(new Date("2020-04-12T06:00:00+05:30"));
      expect(result.notifications).toBeGreaterThanOrEqual(1);

      const inbox = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.user_id, parent.user.id), eq(notifications.kind, "birthday")));
      expect(inbox.length).toBeGreaterThanOrEqual(1);

      const birthdayPush = spy.mock.calls
        .flatMap((c) => c[0] as Array<{ to: string; data?: { kind?: string } }>)
        .find((p) => p.to === expoToken && p.data?.kind === "birthday");
      expect(birthdayPush).toBeUndefined();
    } finally {
      spy.mockRestore();
      await db
        .update(users)
        .set({ notification_preferences: prefsBefore?.prefs ?? {} })
        .where(eq(users.id, parent.user.id));
      await db.delete(device_push_tokens).where(eq(device_push_tokens.expo_token, expoToken));
    }
  });
});

describe("notifications — parent attendance push scope (FIX #1)", () => {
  it("the parent attendance push names the student it was queued for", async () => {
    const batchPick = await pool.query<{ batch_id: string; centre_id: string }>(
      `select b.id as batch_id, b.centre_id
         from batches b
        where b.deleted_at is null and b.status = 'active'
        limit 1`,
    );
    expect(batchPick.rows.length).toBe(1);
    const { batch_id: batchId, centre_id: centreId } = batchPick.rows[0]!;
    const suffix = `${Date.now()}`;

    const plantedParents: string[] = [];
    const plantedStudents: Array<{
      id: string;
      parent_id: string;
      full_name: string;
      status: "present" | "absent" | "late";
    }> = [];

    const statuses = ["present", "absent", "late"] as const;
    const names = [
      `Fix1 Alpha ${suffix}`,
      `Fix1 Beta ${suffix}`,
      `Fix1 Gamma ${suffix}`,
    ];

    try {
      for (let i = 0; i < 3; i++) {
        const [parent] = await db
          .insert(users)
          .values({
            phone: `+91981${suffix.slice(-7)}${i}`.slice(0, 15),
            role: "parent",
            full_name: `Fix1 Parent ${i} ${suffix}`,
          })
          .returning({ id: users.id });
        plantedParents.push(parent!.id);

        const [stu] = await db
          .insert(students)
          .values({
            centre_id: centreId,
            batch_id: batchId,
            parent_id: parent!.id,
            full_name: names[i]!,
            student_code: `F1${suffix}${i}`,
            status: "active",
            dob: "2015-01-01",
            gender: "male",
            age_group: "bal",
          })
          .returning({ id: students.id, full_name: students.full_name });
        plantedStudents.push({
          id: stu!.id,
          parent_id: parent!.id,
          full_name: stu!.full_name,
          status: statuses[i]!,
        });
      }

      const scheduledDate = "2024-07-18";
      const [session] = await db
        .insert(sessions)
        .values({
          batch_id: batchId,
          scheduled_date: scheduledDate,
          scheduled_start_time: "10:00:00",
          scheduled_end_time: "11:00:00",
          status: "completed",
          topic: `fix1-attn-scope-${suffix}`,
        })
        .onConflictDoUpdate({
          target: [sessions.batch_id, sessions.scheduled_date],
          set: { topic: `fix1-attn-scope-${suffix}`, status: "completed" },
        })
        .returning({ id: sessions.id });

      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
      for (const s of plantedStudents) {
        await db.insert(attendance).values({
          session_id: session!.id,
          student_id: s.id,
          status: s.status,
          session_date: scheduledDate,
          marked_method: "manual",
          revision: 1,
        });
      }

      // Clear any leftover inbox rows for these parents from prior runs.
      await db
        .delete(notifications)
        .where(inArray(notifications.user_id, plantedParents));

      const middle = plantedStudents[1]!;
      await sendParentAttendancePush(middle.id, session!.id);

      const afterMiddle = await db
        .select({
          id: notifications.id,
          user_id: notifications.user_id,
          body_en: notifications.body_en,
        })
        .from(notifications)
        .where(inArray(notifications.user_id, plantedParents));

      expect(afterMiddle.length).toBe(1);
      expect(afterMiddle[0]!.user_id).toBe(middle.parent_id);
      expect(afterMiddle[0]!.body_en).toContain(middle.full_name);
      for (const other of plantedStudents.filter((s) => s.id !== middle.id)) {
        expect(afterMiddle[0]!.body_en).not.toContain(other.full_name);
      }

      // Each parent must receive only their own child's name.
      await db
        .delete(notifications)
        .where(inArray(notifications.user_id, plantedParents));

      for (const s of plantedStudents) {
        await sendParentAttendancePush(s.id, session!.id);
      }

      for (const s of plantedStudents) {
        const notes = await db
          .select({
            user_id: notifications.user_id,
            body_en: notifications.body_en,
          })
          .from(notifications)
          .where(eq(notifications.user_id, s.parent_id));
        expect(notes.length).toBe(1);
        expect(notes[0]!.body_en).toContain(s.full_name);
        for (const other of plantedStudents.filter((o) => o.id !== s.id)) {
          expect(notes[0]!.body_en).not.toContain(other.full_name);
        }
      }

      await db.delete(attendance).where(eq(attendance.session_id, session!.id));
    } finally {
      if (plantedStudents.length) {
        await db
          .delete(notifications)
          .where(inArray(notifications.user_id, plantedParents));
        await db
          .delete(attendance)
          .where(inArray(attendance.student_id, plantedStudents.map((s) => s.id)));
        await db
          .delete(students)
          .where(inArray(students.id, plantedStudents.map((s) => s.id)));
      }
      if (plantedParents.length) {
        await db.delete(users).where(inArray(users.id, plantedParents));
      }
    }
  });
});

describe("notifications — enum parity (T-10)", () => {
  it("NOTIFICATION_KINDS (TS) matches notification_kind_enum (Postgres) exactly", async () => {
    // T-10 (review 2026-08) — NotificationKind is derived from the TS array,
    // but the Postgres type is mutated by hand-written `ALTER TYPE ... ADD
    // VALUE` migrations. Nothing ever tied the two together before this: a
    // kind added to the array without a matching migration produces
    // "invalid input value for enum" on the insert at notifyUsers' call
    // site — a 500 on the user-facing action, not a background job.
    const { rows } = await pool.query<{ enumlabel: string }>(
      `select e.enumlabel
         from pg_type t
         join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'notification_kind_enum'
        order by e.enumlabel`,
    );
    const pgValues = rows.map((r) => r.enumlabel).sort();
    const tsValues = [...NOTIFICATION_KINDS].sort();
    expect(tsValues).toEqual(pgValues);
  });
});
