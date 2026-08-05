/**
 * PERF #17 — Socket.IO auth, CORS allow-list, Redis aggregate counter.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { loginAs } from "./helpers";
import {
  authenticateAdminDashboardSocket,
  adminFeedAggregateKey,
  peekAdminFeedAggregate,
  recordAdminAttendanceMark,
  WINDOW_MS,
} from "../src/lib/admin-dashboard-feed";
import { isCorsOriginAllowed } from "../src/lib/cors-origins";

afterAll(async () => {
  const { workerPool } = await import("@workspace/db");
  await Promise.all([pool.end(), workerPool.end()]);
});

describe("PERF #17 Socket.IO admin feed", () => {
  it("a connection without a valid token is rejected", async () => {
    const result = await authenticateAdminDashboardSocket({
      auth: {},
      query: { cityId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(result).toEqual({ error: "unauthenticated" });

    const bad = await authenticateAdminDashboardSocket({
      auth: { token: "not.a.token" },
      query: { cityId: "00000000-0000-0000-0000-000000000001" },
    });
    expect(bad).toEqual({ error: "invalid_token" });
  });

  it("a city_admin cannot join a city they do not administer", async () => {
    const { token, user } = await loginAs("city_admin");
    expect(user.city_id).toBeTruthy();
    const otherCity = await pool.query<{ id: string }>(
      `select id from cities where id <> $1 limit 1`,
      [user.city_id],
    );
    const cityId =
      otherCity.rows[0]?.id ?? "00000000-0000-4000-8000-000000000099";
    const result = await authenticateAdminDashboardSocket({
      auth: { token },
      query: { cityId },
    });
    expect(result).toEqual({ error: "city_forbidden" });
  });

  it("an origin outside CORS_ORIGINS is rejected", () => {
    const prevEnv = process.env.NODE_ENV;
    const prevCors = process.env.CORS_ORIGINS;
    process.env.NODE_ENV = "production";
    process.env.CORS_ORIGINS = "https://admin.example.com";
    try {
      expect(isCorsOriginAllowed("https://admin.example.com")).toBe(true);
      expect(isCorsOriginAllowed("https://evil.example.com")).toBe(false);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevCors === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = prevCors;
    }
  });

  it("the aggregate count reads through Redis rather than a local variable", async () => {
    if (!process.env.REDIS_URL?.trim()) {
      // Without Redis we keep the in-memory path; assert the key helper still
      // is what a cluster counter would use so the wiring cannot silently drift.
      const a = adminFeedAggregateKey("city-a", 0);
      const b = adminFeedAggregateKey("city-a", WINDOW_MS - 1);
      const c = adminFeedAggregateKey("city-a", WINDOW_MS);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a.startsWith("admin_feed:agg:")).toBe(true);
      return;
    }

    const cityId = `perf17-${Date.now()}`;
    const before = await peekAdminFeedAggregate(cityId);
    expect(before).toBe(0);
    recordAdminAttendanceMark(cityId);
    recordAdminAttendanceMark(cityId);
    // Allow the async INCR to land.
    await new Promise((r) => setTimeout(r, 50));
    const after = await peekAdminFeedAggregate(cityId);
    expect(after).toBe(2);
  });
});
