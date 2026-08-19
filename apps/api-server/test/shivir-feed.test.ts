/**
 * The /shivirs/:shivirId Socket.IO join gate.
 *
 * CLAUDE.md freezes this namespace and nothing implemented it, so the "live"
 * dashboard was neither live nor polling. The gate reuses assertShivirScanAccess
 * — the same rule as the HTTP scan — so a volunteer who may scan may watch and
 * nobody else can, with no second copy of the rule to drift.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, cities, shivir_volunteers } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { authenticateShivirSocket, extractSocketAccessToken } from "../src/lib/shivir-feed";

afterAll(async () => {
  await pool.end();
});

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function createShivir(token: string): Promise<string> {
  const [city] = await db.select({ id: cities.id }).from(cities).where(eq(cities.name, "Mumbai")).limit(1);
  const res = await request(app)
    .post("/v1/admin/shivirs")
    .set(auth(token))
    .send({
      name_en: `Vitest feed ${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
      city_id: city!.id,
      start_date: isoDate(1),
      end_date: isoDate(2),
    });
  expect(res.status).toBe(200);
  return res.body.data.id as string;
}

describe("extractSocketAccessToken", () => {
  it("prefers auth.token (the mobile contract)", () => {
    expect(extractSocketAccessToken({ auth: { token: "abc" } })).toBe("abc");
  });

  it("accepts an Authorization header", () => {
    expect(extractSocketAccessToken({ headers: { authorization: "Bearer xyz" } })).toBe("xyz");
  });

  it("accepts the jp_access cookie — the only way the web admin can connect", () => {
    // The web keeps its token in an httpOnly cookie that JavaScript cannot read,
    // so without this branch the one client this dashboard exists for could
    // never open the socket.
    expect(
      extractSocketAccessToken({ headers: { cookie: "other=1; jp_access=tok123; more=2" } }),
    ).toBe("tok123");
  });

  it("returns null when there is no token anywhere", () => {
    expect(extractSocketAccessToken({ headers: { cookie: "theme=dark" } })).toBeNull();
  });
});

describe("shivir socket join gate", () => {
  it("rejects an unauthenticated handshake", async () => {
    const result = await authenticateShivirSocket(
      "/shivirs/00000000-0000-4000-8000-000000000001",
      {},
    );
    expect(result).toEqual({ error: "unauthenticated" });
  });

  it("rejects a namespace that is not a shivir id", async () => {
    const { token } = await loginAs("super_admin");
    const result = await authenticateShivirSocket("/shivirs/not-a-uuid", {
      auth: { token },
    });
    expect(result).toEqual({ error: "bad_namespace" });
  });

  it("rejects a parent, admits an assigned volunteer, and rejects them again once revoked", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const shikshak = await loginAs("shikshak");
    const shivirId = await createShivir(admin.token);
    const nsp = `/shivirs/${shivirId}`;

    const asParent = await authenticateShivirSocket(nsp, { auth: { token: parent.token } });
    expect(asParent).toEqual({ error: "forbidden" });

    const beforeAssign = await authenticateShivirSocket(nsp, { auth: { token: shikshak.token } });
    expect(beforeAssign).toEqual({ error: "forbidden" });

    await request(app)
      .post(`/v1/admin/shivirs/${shivirId}/volunteers`)
      .set(auth(admin.token))
      .send({ user_id: shikshak.user.id });

    try {
      const afterAssign = await authenticateShivirSocket(nsp, { auth: { token: shikshak.token } });
      expect("error" in afterAssign).toBe(false);
      if (!("error" in afterAssign)) {
        expect(afterAssign.shivirId).toBe(shivirId);
        expect(afterAssign.user.id).toBe(shikshak.user.id);
      }
    } finally {
      await db
        .update(shivir_volunteers)
        .set({ revoked_at: new Date() })
        .where(
          and(
            eq(shivir_volunteers.shivir_id, shivirId),
            eq(shivir_volunteers.user_id, shikshak.user.id),
            isNull(shivir_volunteers.revoked_at),
          ),
        );
    }

    const afterRevoke = await authenticateShivirSocket(nsp, { auth: { token: shikshak.token } });
    expect(afterRevoke).toEqual({ error: "forbidden" });
  });

  it("admits a super_admin over the cookie path", async () => {
    const admin = await loginAs("super_admin");
    const shivirId = await createShivir(admin.token);
    const result = await authenticateShivirSocket(`/shivirs/${shivirId}`, {
      headers: { cookie: `jp_access=${admin.token}` },
    });
    expect("error" in result).toBe(false);
  });
});
