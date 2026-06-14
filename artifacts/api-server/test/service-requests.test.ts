import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end(); // close the shared pg pool so vitest exits cleanly
});

/**
 * Self-creating + rerun-safe: each test creates its own service request via the
 * API (no dependence on specific seed rows). The seeded parent owns at least one
 * child in Mumbai's centreA, so the city_admin (Mumbai) scope always covers the
 * derived centre. We discover the child via /v1/me/children rather than hardcode.
 */
async function firstChildId(parentToken: string): Promise<string> {
  const children = await request(app).get("/v1/me/children").set(auth(parentToken));
  expect(children.status).toBe(200);
  const child = children.body.data.items[0];
  expect(child).toBeTruthy();
  return child.id as string;
}

describe("service-requests", () => {
  it("requires auth on create", async () => {
    const res = await request(app).post("/v1/service-requests").send({});
    expect(res.status).toBe(401);
  });

  it("requires admin panel on the admin list", async () => {
    const { token } = await loginAs("parent");
    const res = await request(app).get("/v1/service-requests").set(auth(token));
    expect(res.status).toBe(403);
  });

  it("rejects creation with an unowned student_id (404)", async () => {
    const parent = await loginAs("parent");
    const res = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: "Foreign child",
        description: "Should not be allowed.",
        student_id: "00000000-0000-0000-0000-000000000000",
      });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("threads a request end-to-end: parent creates, admin sees/assigns/replies/resolves, parent reads", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const marker = `SR-${Date.now()}`;

    // 1. Parent creates a request tied to their child (derives centre/city).
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "attendance",
        subject: marker,
        description: "My child's attendance looks wrong this week.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    expect(create.body.data.status).toBe("submitted");
    const requestId: string = create.body.data.id;

    // 2. Parent finds it in /mine.
    const mine = await request(app).get("/v1/service-requests/mine?limit=300").set(auth(parent.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.find((r: { id: string }) => r.id === requestId)).toBeTruthy();

    // 3. City admin (Mumbai) sees it in the scoped admin list (Aarav is in centreA/Mumbai).
    const cityAdmin = await loginAs("city_admin");
    const list = await request(app).get("/v1/service-requests?limit=300").set(auth(cityAdmin.token));
    expect(list.status).toBe(200);
    const inList = list.body.data.items.find((r: { id: string }) => r.id === requestId);
    expect(inList).toBeTruthy();
    expect(inList.subject).toBe(marker);

    // Status filter narrows correctly.
    const filtered = await request(app)
      .get("/v1/service-requests?status=submitted&limit=300")
      .set(auth(cityAdmin.token));
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.items.find((r: { id: string }) => r.id === requestId)).toBeTruthy();

    // 4. Admin assigns -> in_review.
    const assign = await request(app)
      .post(`/v1/service-requests/${requestId}/assign`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(assign.status).toBe(200);
    expect(assign.body.data.status).toBe("in_review");

    // 5. Admin posts a reply on the thread.
    const replyText = "Thanks for flagging — we are reviewing the records.";
    const reply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(cityAdmin.token))
      .send({ message: replyText });
    expect(reply.status).toBe(200);
    expect(reply.body.data.id).toBeTruthy();

    // 6. Admin resolves.
    const resolve = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe("resolved");

    // 7. Parent reads the detail: sees the admin's message and resolved status.
    const detail = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(parent.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("resolved");
    expect(detail.body.data.resolved_at).toBeTruthy();
    expect(detail.body.data.messages.some((m: { message: string }) => m.message === replyText)).toBe(true);
  });

  it("hides a request from a parent who is not the owner (404 on detail)", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: `SR-owner-${Date.now()}`,
        description: "Owner-only visibility check.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // A student persona is not the owner and not an admin -> 404.
    const stranger = await loginAs("student");
    const detail = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(stranger.token));
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe("ERR_NOT_FOUND");
  });
});
