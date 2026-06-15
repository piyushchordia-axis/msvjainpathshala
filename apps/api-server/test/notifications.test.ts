import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { db, pool, notifications } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { runBirthdayWishes } from "../src/routes/v1/notifications";

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
});

describe("notifications — inbox + read flow", () => {
  it("lists the caller's notifications with an unread_count and marks one read", async () => {
    const session = await loginAs("parent");
    const uid = session.user.id;

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
    expect(listRes.body.data.unread_count).toBeGreaterThanOrEqual(1);
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

    // Re-reading is idempotent (still 200).
    const readAgain = await request(app)
      .post(`/v1/notifications/${created.id}/read`)
      .set(auth(session.token))
      .send({});
    expect(readAgain.status).toBe(200);
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
        body_en: "Private to the parent.",
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
