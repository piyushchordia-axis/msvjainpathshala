/**
 * PATCH /v1/me/gallery-visibility — Q6 blanket consent write path.
 * Visibility is query-time only; these tests prove no backfill is required.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import app from "../src/app";
import { db, pool, users, audit_logs } from "@workspace/db";
import { loginAs, auth } from "./helpers";

const MOUNT = "/v1/gallery";

function uploadUrl(tag: string): string {
  return `http://localhost:8080/uploads/gallery/${tag}.jpg`;
}

function uniqueTag(label: string): string {
  return `me-galvis-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function parentChildren(token: string): Promise<Array<{ id: string }>> {
  const res = await request(app).get("/v1/me/children").set(auth(token));
  expect(res.status).toBe(200);
  const items = res.body.data.items as Array<{ id: string }>;
  expect(items.length).toBeGreaterThan(0);
  return items;
}

afterAll(async () => {
  await pool.end();
});

describe("PATCH /v1/me/gallery-visibility", () => {
  it("opt_in true shows a featured item on the wall; false hides all children instantly; restore works; audit writes; takedown stays hidden", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const children = await parentChildren(parent.token);
    const studentIds = children.map((c) => c.id);

    const [ownerRow] = await db
      .select({ id: users.id, optIn: users.gallery_visibility_opt_in })
      .from(users)
      .where(eq(users.id, parent.user.id))
      .limit(1);
    expect(ownerRow).toBeTruthy();
    const seededOptIn = ownerRow.optIn;

    const createdIds: string[] = [];

    try {
      // One featured public item per child (covers multi-child blanket hide).
      for (const sid of studentIds.slice(0, Math.min(2, studentIds.length))) {
        const tag = uniqueTag(`child-${sid.slice(0, 8)}`);
        const create = await request(app)
          .post(`${MOUNT}/admin`)
          .set(auth(admin.token))
          .send({
            image_url: uploadUrl(tag),
            caption: `cap-${tag}`,
            student_id: sid,
            is_public: true,
          });
        expect(create.status).toBe(201);
        const id = create.body.data.id as string;
        createdIds.push(id);

        const feature = await request(app)
          .patch(`${MOUNT}/admin/${id}/featured`)
          .set(auth(admin.token))
          .send({ featured_gallery: true });
        expect(feature.status).toBe(200);
      }
      expect(createdIds.length).toBeGreaterThan(0);

      // Start opted out via the real endpoint (not a DB poke).
      const off = await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: false });
      expect(off.status).toBe(200);
      expect(off.body.data.gallery_visibility_opt_in).toBe(false);
      expect(off.body.data.user.gallery_visibility_opt_in).toBe(false);

      const wallOff = await request(app).get(`${MOUNT}?surface=wall&limit=500`);
      expect(wallOff.status).toBe(200);
      for (const id of createdIds) {
        expect(
          wallOff.body.data.items.some((r: { id: string }) => r.id === id),
          `item ${id} must be hidden when opted out`,
        ).toBe(false);
      }

      // Same request cycle — no job between write and read.
      const on = await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: true });
      expect(on.status).toBe(200);
      expect(on.body.data.gallery_visibility_opt_in).toBe(true);

      const wallOn = await request(app).get(`${MOUNT}?surface=wall&limit=500`);
      expect(wallOn.status).toBe(200);
      for (const id of createdIds) {
        expect(
          wallOn.body.data.items.some((r: { id: string }) => r.id === id),
          `item ${id} must appear when opted in`,
        ).toBe(true);
      }

      // Opt out again — every child's item disappears immediately.
      const offAgain = await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: false });
      expect(offAgain.status).toBe(200);

      const wallOffAgain = await request(app).get(`${MOUNT}?surface=wall&limit=500`);
      for (const id of createdIds) {
        expect(
          wallOffAgain.body.data.items.some((r: { id: string }) => r.id === id),
        ).toBe(false);
      }

      // Restore.
      await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: true });
      const wallRestored = await request(app).get(`${MOUNT}?surface=wall&limit=500`);
      for (const id of createdIds) {
        expect(
          wallRestored.body.data.items.some((r: { id: string }) => r.id === id),
        ).toBe(true);
      }

      // Admin soft-delete (takedown) — stays hidden through both toggles.
      const takenDown = createdIds[0]!;
      const del = await request(app)
        .delete(`${MOUNT}/admin/${takenDown}`)
        .set(auth(admin.token))
        .send({ reason: "Consent-path takedown fixture." });
      expect(del.status).toBe(200);

      await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: false });
      await request(app)
        .patch("/v1/me/gallery-visibility")
        .set(auth(parent.token))
        .send({ opt_in: true });

      const wallAfterTakedown = await request(app).get(`${MOUNT}?surface=wall&limit=500`);
      expect(
        wallAfterTakedown.body.data.items.some((r: { id: string }) => r.id === takenDown),
      ).toBe(false);

      // Audit row for each consent change (at least the toggles above).
      const audits = await db
        .select({
          summary: audit_logs.summary,
          metadata: audit_logs.metadata,
        })
        .from(audit_logs)
        .where(
          and(eq(audit_logs.entity_kind, "user"), eq(audit_logs.entity_id, parent.user.id)),
        )
        .orderBy(desc(audit_logs.created_at))
        .limit(20);

      const consentAudits = audits.filter(
        (a) =>
          typeof a.summary === "string" &&
          a.summary.includes("Gallery visibility"),
      );
      expect(consentAudits.length).toBeGreaterThanOrEqual(4);
    } finally {
      await db
        .update(users)
        .set({ gallery_visibility_opt_in: seededOptIn })
        .where(eq(users.id, ownerRow.id));
      for (const id of createdIds) {
        await request(app)
          .delete(`${MOUNT}/admin/${id}`)
          .set(auth(admin.token))
          .send({ reason: "Test cleanup take down." })
          .catch(() => undefined);
      }
    }
  });

  it("rejects a non-boolean body", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .patch("/v1/me/gallery-visibility")
      .set(auth(parent.token))
      .send({ opt_in: "yes" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });
});
