import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { AUDIT_ACTIONS } from "@workspace/db/enums";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * The audit trail is read-only here. Rows are seeded by lib/db/src/seed.ts
 * (a 'config_change' on settings and an 'approve' on an enrolment), so the
 * list and filter assertions lean on the seed rather than self-creating data.
 * Self-created data is not possible because there is no write endpoint.
 */
describe("audit-logs", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/v1/audit-logs");
    expect(res.status).toBe(401);
  });

  it("forbids city_admin (high-trust gate -> 403)", async () => {
    const { token } = await loginAs("city_admin");
    const res = await request(app).get("/v1/audit-logs").set(auth(token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("forbids shikshak and sanchalak", async () => {
    for (const role of ["shikshak", "sanchalak"] as const) {
      const { token } = await loginAs(role);
      const res = await request(app).get("/v1/audit-logs").set(auth(token));
      expect(res.status).toBe(403);
    }
  });

  it("super_admin lists audit logs newest first with actor + role", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app).get("/v1/audit-logs?limit=200").set(auth(token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{
      id: string;
      action: string;
      entity_kind: string;
      actor_role: string | null;
      actor_name: string | null;
      created_at: string;
    }>;
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(1);

    // Each row shape is sane and every action is a valid enum value.
    for (const row of items) {
      expect(typeof row.id).toBe("string");
      expect((AUDIT_ACTIONS as readonly string[]).includes(row.action)).toBe(true);
      expect(typeof row.entity_kind).toBe("string");
      expect(typeof row.created_at).toBe("string");
    }

    // Newest first: created_at non-increasing.
    for (let i = 1; i < items.length; i++) {
      expect(new Date(items[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(
        new Date(items[i].created_at).getTime(),
      );
    }
  });

  it("state_admin may also read the audit logs", async () => {
    const { token } = await loginAs("state_admin");
    const res = await request(app).get("/v1/audit-logs").set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("filters by action=config_change returns only config_change rows (>=1 from seed)", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/audit-logs?action=config_change")
      .set(auth(token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ action: string }>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.action === "config_change")).toBe(true);
  });

  it("rejects an invalid action filter gracefully (ignores it, still 200)", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/audit-logs?action=not_a_real_action")
      .set(auth(token));
    // safeParse fails -> filter dropped -> full list returned.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });

  it("invalid action + valid entity_kind still honors the entity_kind filter (independent parse)", async () => {
    const { token } = await loginAs("super_admin");

    // Baseline: the unfiltered superset (what a buggy combined-parse would return).
    const allRes = await request(app).get("/v1/audit-logs?limit=300").set(auth(token));
    expect(allRes.status).toBe(200);
    const allItems = allRes.body.data.items as Array<{ entity_kind: string }>;
    // The seed contains rows of more than one entity_kind, so the superset is
    // strictly larger than the settings-only subset — that's the bug surface.
    const settingsInAll = allItems.filter((r) => r.entity_kind === "settings");
    const nonSettingsInAll = allItems.filter((r) => r.entity_kind !== "settings");
    expect(settingsInAll.length).toBeGreaterThanOrEqual(1);
    expect(nonSettingsInAll.length).toBeGreaterThanOrEqual(1);

    // Invalid action MUST NOT drop the valid entity_kind=settings filter.
    const res = await request(app)
      .get("/v1/audit-logs?action=not_a_real_action&entity_kind=settings&limit=300")
      .set(auth(token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ entity_kind: string }>;

    // Every returned row is entity_kind=settings (filter honored, not dropped).
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.every((r) => r.entity_kind === "settings")).toBe(true);
    // And it is the settings-only subset, NOT the unfiltered superset.
    expect(items.length).toBeLessThan(allItems.length);
  });

  it("filters by entity_kind", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/audit-logs?entity_kind=settings")
      .set(auth(token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<{ entity_kind: string }>;
    expect(items.every((r) => r.entity_kind === "settings")).toBe(true);
  });

  it("GET /v1/audit-logs/actions returns the full enum list", async () => {
    const { token } = await loginAs("super_admin");
    const res = await request(app).get("/v1/audit-logs/actions").set(auth(token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as string[];
    expect(items).toEqual([...AUDIT_ACTIONS]);
  });

  it("requires auth on /actions too", async () => {
    const res = await request(app).get("/v1/audit-logs/actions");
    expect(res.status).toBe(401);
  });
});
