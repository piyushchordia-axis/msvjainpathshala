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

  // 1. Consumer create flow — a non-admin user creates a request (no student_id).
  it("lets a non-admin consumer (student) create a request without a student_id", async () => {
    const student = await loginAs("student");
    const marker = `SR-consumer-${Date.now()}`;
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(student.token))
      .send({
        category: "general",
        subject: marker,
        description: "I need help accessing my learning materials.",
      });
    expect(create.status).toBe(200);
    expect(create.body.data.status).toBe("submitted");
    const requestId: string = create.body.data.id;

    // The creator (owner) sees it in /mine and can read its detail.
    const mine = await request(app).get("/v1/service-requests/mine?limit=300").set(auth(student.token));
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.find((r: { id: string }) => r.id === requestId)).toBeTruthy();

    const detail = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(student.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.subject).toBe(marker);
    expect(detail.body.data.status).toBe("submitted");
    expect(detail.body.data.resolved_at).toBeNull();
    expect(detail.body.data.messages).toEqual([]);
  });

  // 2. Reply thread — both the requester and an admin post replies, ordered.
  it("threads replies from both requester and admin in chronological order", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const marker = `SR-thread-${Date.now()}`;
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: marker,
        description: "Opening a conversation.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // Requester posts the first reply.
    const ownerMsg = `owner-msg-${Date.now()}`;
    const ownerReply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(parent.token))
      .send({ message: ownerMsg });
    expect(ownerReply.status).toBe(200);
    expect(ownerReply.body.data.id).toBeTruthy();
    // Replying to a submitted request leaves it submitted (no reopen).
    expect(ownerReply.body.data.status).toBe("submitted");
    expect(ownerReply.body.data.reopened).toBe(false);

    // Admin (Mumbai city_admin, in scope of the parent's child) posts a reply.
    const cityAdmin = await loginAs("city_admin");
    const adminMsg = `admin-msg-${Date.now()}`;
    const adminReply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(cityAdmin.token))
      .send({ message: adminMsg });
    expect(adminReply.status).toBe(200);

    // Detail returns both messages in chronological (insertion) order.
    const detail = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(parent.token));
    expect(detail.status).toBe(200);
    const msgs: Array<{ message: string }> = detail.body.data.messages;
    const ownerIdx = msgs.findIndex((m) => m.message === ownerMsg);
    const adminIdx = msgs.findIndex((m) => m.message === adminMsg);
    expect(ownerIdx).toBeGreaterThanOrEqual(0);
    expect(adminIdx).toBeGreaterThanOrEqual(0);
    expect(ownerIdx).toBeLessThan(adminIdx);
  });

  // 3. Status lifecycle + resolved_at consistency (the Phase 2 invariant).
  it("keeps resolved_at consistent across resolve / reopen / re-assign", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const cityAdmin = await loginAs("city_admin");
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: `SR-lifecycle-${Date.now()}`,
        description: "Lifecycle invariant check.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    const readDetail = async () => {
      const d = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(parent.token));
      expect(d.status).toBe(200);
      return d.body.data as { status: string; resolved_at: string | null };
    };

    // Fresh request: submitted, resolved_at null.
    let detail = await readDetail();
    expect(detail.status).toBe("submitted");
    expect(detail.resolved_at).toBeNull();

    // Assign -> in_review, resolved_at stays null.
    const assign = await request(app)
      .post(`/v1/service-requests/${requestId}/assign`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(assign.status).toBe(200);
    expect(assign.body.data.status).toBe("in_review");
    detail = await readDetail();
    expect(detail.status).toBe("in_review");
    expect(detail.resolved_at).toBeNull();

    // Resolve -> resolved, resolved_at set.
    const resolve = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe("resolved");
    detail = await readDetail();
    expect(detail.status).toBe("resolved");
    expect(detail.resolved_at).toBeTruthy();

    // Reply to a resolved request reopens it. Since an admin is assigned, it
    // returns to in_review and resolved_at is cleared (invariant: resolved_at
    // is non-null iff status === "resolved").
    const reopenReply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(parent.token))
      .send({ message: `reopen-${Date.now()}` });
    expect(reopenReply.status).toBe(200);
    expect(reopenReply.body.data.reopened).toBe(true);
    expect(reopenReply.body.data.status).toBe("in_review");
    detail = await readDetail();
    expect(detail.status).toBe("in_review");
    expect(detail.resolved_at).toBeNull();

    // Resolve again, then re-assign: assigning a resolved request also clears
    // resolved_at and moves it to in_review.
    const resolve2 = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(resolve2.status).toBe(200);
    detail = await readDetail();
    expect(detail.resolved_at).toBeTruthy();

    const reassign = await request(app)
      .post(`/v1/service-requests/${requestId}/assign`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(reassign.status).toBe(200);
    expect(reassign.body.data.status).toBe("in_review");
    detail = await readDetail();
    expect(detail.status).toBe("in_review");
    expect(detail.resolved_at).toBeNull();
  });

  // 3b. Reopen with no assignee falls back to "submitted".
  it("reopens an unassigned resolved request back to submitted on reply", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const cityAdmin = await loginAs("city_admin");
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: `SR-reopen-unassigned-${Date.now()}`,
        description: "Reopen-to-submitted check.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // Resolve without ever assigning (resolve does not set assigned_to).
    const resolve = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(cityAdmin.token))
      .send({});
    expect(resolve.status).toBe(200);

    // Owner replies -> reopened to submitted (no assignee), resolved_at cleared.
    const reply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(parent.token))
      .send({ message: `reopen-unassigned-${Date.now()}` });
    expect(reply.status).toBe(200);
    expect(reply.body.data.reopened).toBe(true);
    expect(reply.body.data.status).toBe("submitted");

    const detail = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(parent.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("submitted");
    expect(detail.body.data.resolved_at).toBeNull();
  });

  // 4. Authorization / scoping on replies and admin actions.
  it("forbids a non-owner non-admin from reading or replying to another user's request", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: `SR-authz-${Date.now()}`,
        description: "Authz isolation check.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // A student persona is neither owner nor admin -> 404 on read and on reply.
    const stranger = await loginAs("student");
    const read = await request(app).get(`/v1/service-requests/${requestId}`).set(auth(stranger.token));
    expect(read.status).toBe(404);
    expect(read.body.error.code).toBe("ERR_NOT_FOUND");

    const reply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(stranger.token))
      .send({ message: "I should not be able to post here." });
    expect(reply.status).toBe(404);
    expect(reply.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("rejects assign/resolve from unauthenticated and non-admin callers", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: `SR-admin-guard-${Date.now()}`,
        description: "Admin action guard check.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // Unauthenticated -> 401.
    const anonAssign = await request(app).post(`/v1/service-requests/${requestId}/assign`).send({});
    expect(anonAssign.status).toBe(401);
    const anonResolve = await request(app).post(`/v1/service-requests/${requestId}/resolve`).send({});
    expect(anonResolve.status).toBe(401);

    // The owner is a parent (no admin panel) -> 403 on admin actions.
    const ownerAssign = await request(app)
      .post(`/v1/service-requests/${requestId}/assign`)
      .set(auth(parent.token))
      .send({});
    expect(ownerAssign.status).toBe(403);
    const ownerResolve = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(parent.token))
      .send({});
    expect(ownerResolve.status).toBe(403);
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

  it("sanchalak sees only centre-scoped requests; claim, resolve, parent reply reopens", async () => {
    const parent = await loginAs("parent");
    const studentId = await firstChildId(parent.token);
    const marker = `SR-sanchalak-${Date.now()}`;

    const create = await request(app)
      .post("/v1/service-requests")
      .set(auth(parent.token))
      .send({
        category: "general",
        subject: marker,
        description: "Centre-scoped inbox check for the Sanchalak.",
        student_id: studentId,
      });
    expect(create.status).toBe(200);
    const requestId: string = create.body.data.id;

    // Plant an out-of-scope request on another centre (Kothrud) — same parent row is fine;
    // centre_id alone drives the admin list filter.
    const otherCentre = await pool.query<{ id: string }>(
      `select id from centres where name = 'Kothrud Jain Pathshala' limit 1`,
    );
    expect(otherCentre.rows[0]?.id).toBeTruthy();
    const foreign = await pool.query<{ id: string }>(
      `insert into service_requests
         (parent_user_id, category, subject, description, status, centre_id)
       values ($1, 'general', $2, 'Out of scope for Mumbai Sanchalak.', 'submitted', $3)
       returning id`,
      [parent.user.id, `SR-foreign-${Date.now()}`, otherCentre.rows[0]!.id],
    );
    const foreignId = foreign.rows[0]!.id;

    const sanchalak = await loginAs("sanchalak");
    const list = await request(app)
      .get("/v1/service-requests?limit=300")
      .set(auth(sanchalak.token));
    expect(list.status).toBe(200);
    const ids = (list.body.data.items as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(requestId);
    expect(ids).not.toContain(foreignId);

    // Claim → in_review + assigned_to self.
    const claim = await request(app)
      .post(`/v1/service-requests/${requestId}/assign`)
      .set(auth(sanchalak.token))
      .send({});
    expect(claim.status).toBe(200);
    expect(claim.body.data.status).toBe("in_review");

    const afterClaim = await request(app)
      .get(`/v1/service-requests/${requestId}`)
      .set(auth(sanchalak.token));
    expect(afterClaim.status).toBe(200);
    expect(afterClaim.body.data.status).toBe("in_review");
    expect(afterClaim.body.data.assigned_to).toBe(sanchalak.user.id);

    // Resolve, then parent reply reopens onto the open list.
    const resolve = await request(app)
      .post(`/v1/service-requests/${requestId}/resolve`)
      .set(auth(sanchalak.token))
      .send({});
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe("resolved");

    const resolvedList = await request(app)
      .get("/v1/service-requests?status=resolved&limit=300")
      .set(auth(sanchalak.token));
    expect(resolvedList.body.data.items.find((r: { id: string }) => r.id === requestId)).toBeTruthy();

    const parentReply = await request(app)
      .post(`/v1/service-requests/${requestId}/messages`)
      .set(auth(parent.token))
      .send({ message: "Thanks — I still need help with this." });
    expect(parentReply.status).toBe(200);
    expect(parentReply.body.data.reopened).toBe(true);
    expect(parentReply.body.data.status).toBe("in_review"); // still assigned

    const openList = await request(app)
      .get("/v1/service-requests?limit=300")
      .set(auth(sanchalak.token));
    expect(openList.status).toBe(200);
    const reopened = openList.body.data.items.find((r: { id: string; status: string }) => r.id === requestId);
    expect(reopened).toBeTruthy();
    expect(reopened.status).toBe("in_review");
    expect(
      openList.body.data.items
        .filter((r: { status: string }) => r.status === "resolved")
        .find((r: { id: string }) => r.id === requestId),
    ).toBeUndefined();
  });
});
