/**
 * Quiz system: question bank + scheduled quiz events + live push quizzes.
 *
 * Self-creating (rerun-safe vs a non-reset DB): every question/event/push quiz
 * is created fresh with unique titles. We resolve the seeded student (Aarav
 * Shah, +919800000007) and his batch directly from the DB so the test does not
 * depend on a particular ordering of seeded rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { pool, db, students, users } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** Resolve Aarav's student row (id + batch_id) via the seeded student user. */
async function aaravStudent(): Promise<{ id: string; batch_id: string | null }> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+919800000007")).limit(1);
  expect(u).toBeDefined();
  const [s] = await db
    .select({ id: students.id, batch_id: students.batch_id })
    .from(students)
    .where(eq(students.user_id, u!.id))
    .limit(1);
  expect(s).toBeDefined();
  return s!;
}

/** Read a student's total punya via the parent's /me endpoint. */
async function punyaTotal(parentToken: string, studentId: string): Promise<number> {
  const res = await request(app)
    .get(`/v1/me/students/${studentId}/punya`)
    .set(auth(parentToken));
  expect(res.status).toBe(200);
  return res.body.data.total_points as number;
}

describe("quiz system — scheduled events", () => {
  it("authors questions + an event, student takes it all-correct, awards once, blocks resubmit", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    // 1) Create two national-scope questions in the bank.
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q1 = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Q1 ${tag} — Which is a Jain principle?`,
        scope: "national",
        options: [{ text_en: "Ahimsa" }, { text_en: "Himsa" }],
        correct_indices: [0],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;
    expect(q1Id).toBeTruthy();

    const q2 = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Q2 ${tag} — Pick the two great vows`,
        scope: "national",
        options: [{ text_en: "Satya" }, { text_en: "Asteya" }, { text_en: "Greed" }],
        correct_indices: [0, 1],
      });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;
    expect(q2Id).toBeTruthy();

    // Reject a question whose correct index is out of range.
    const bad = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Bad ${tag}`,
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [5],
      });
    expect(bad.status).toBe(422);

    // 2) Create an event whose window covers now (national -> applies to Aarav).
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Quiz event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 7,
        win_points: 13,
        question_ids: [q1Id, q2Id],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;
    expect(eventId).toBeTruthy();

    // 3) Student sees it as available (not yet attempted).
    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const avail: Array<{ id: string; already_attempted: boolean }> = available.body.data.items;
    const mine = avail.find((e) => e.id === eventId);
    expect(mine).toBeDefined();
    expect(mine!.already_attempted).toBe(false);

    // 4) Start: questions returned WITHOUT correct_indices.
    const startRes = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(startRes.status).toBe(200);
    const startQuestions: Array<{ id: string; options: unknown[]; correct_indices?: unknown }> =
      startRes.body.data.questions;
    expect(startQuestions.length).toBe(2);
    for (const sq of startQuestions) {
      expect("correct_indices" in sq).toBe(false);
    }

    const before = await punyaTotal(parent.token, aarav.id);

    // 5) Submit all-correct -> score == 2, participation + win awarded.
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({
        student_id: aarav.id,
        answers: { [q1Id]: [0], [q2Id]: [1, 0] }, // order-independent for q2
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.score).toBe(2);
    expect(submit.body.data.correct_count).toBe(2);
    expect(submit.body.data.total_count).toBe(2);
    expect(submit.body.data.all_correct).toBe(true);
    expect(submit.body.data.points_awarded).toBe(20); // 7 + 13

    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(20);

    // 6) Re-submit is blocked (idempotent: no double award).
    const resubmit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [q1Id]: [0], [q2Id]: [0, 1] } });
    expect(resubmit.status).toBe(409);
    const afterResubmit = await punyaTotal(parent.token, aarav.id);
    expect(afterResubmit).toBe(after);

    // available now flags already_attempted.
    const available2 = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(available2.status).toBe(200);
    const mine2 = (available2.body.data.items as Array<{ id: string; already_attempted: boolean }>).find(
      (e) => e.id === eventId,
    );
    expect(mine2?.already_attempted).toBe(true);
  });

  it("rejects start/submit for a student the caller does not own", async () => {
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    // The student persona does NOT own Diya; use a random uuid to prove 404.
    const stranger = "00000000-0000-0000-0000-000000000000";
    const res = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${stranger}`)
      .set(auth(student.token));
    expect(res.status).toBe(404);
    // Sanity: the owned student resolves fine.
    const ok = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(ok.status).toBe(200);
  });

  it("submitting the same event attempt twice awards points exactly once", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    // One question, an event that covers now and targets Aarav (empty age_groups).
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Idem Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Idem event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 5,
        win_points: 11,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const startRes = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(startRes.status).toBe(200);

    const before = await punyaTotal(parent.token, aarav.id);

    // First submit: all-correct -> 5 + 11 = 16 awarded.
    const first = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(first.status).toBe(200);
    expect(first.body.data.points_awarded).toBe(16);

    // Second submit: blocked (idempotent) — no further award.
    const second = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(second.status).toBe(409);

    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(16); // exactly once, not 32
  });

  it("a student outside the event's targeted age_groups cannot see or start it", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent(); // seeded age_group is "bal"

    // Target "kishor" only -> excludes Aarav (a "bal" student).
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Age-gated Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Age-gated event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 7,
        win_points: 13,
        age_groups: ["kishor"],
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    // Not surfaced in available (filtered out by age-group targeting).
    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const avail = available.body.data.items as Array<{ id: string }>;
    expect(avail.find((e) => e.id === eventId)).toBeUndefined();

    // Starting it is rejected as not eligible (422).
    const startRes = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(startRes.status).toBe(422);
    expect(startRes.body.error.code).toBe("ERR_NOT_ELIGIBLE");
  });
});

describe("quiz system — push quizzes", () => {
  it("shikshak starts a push quiz for Aarav's batch; student submits once and is awarded", async () => {
    const shikshak = await loginAs("shikshak");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.batch_id).toBeTruthy();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: expires,
        completion_points: 9,
        questions: [
          {
            question_en: `Push Q1 ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
          {
            question_en: `Push Q2 ${tag}`,
            options: [{ text_en: "A" }, { text_en: "B" }, { text_en: "C" }],
            correct_indices: [1, 2],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;
    expect(pushId).toBeTruthy();

    // Student GET /push/active sees it (questions without correct_indices).
    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(active.status).toBe(200);
    expect(active.body.data.active).toBeTruthy();
    expect(active.body.data.active.id).toBe(pushId);
    const pushQuestions: Array<{ id: string; correct_indices?: unknown }> =
      active.body.data.active.questions;
    expect(pushQuestions.length).toBe(2);
    for (const pq of pushQuestions) {
      expect("correct_indices" in pq).toBe(false);
    }
    const qOrder = pushQuestions.map((q) => q.id);

    const before = await punyaTotal(parent.token, aarav.id);

    // Submit -> completion points awarded once.
    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({
        student_id: aarav.id,
        answers: { [qOrder[0]]: [0], [qOrder[1]]: [2, 1] },
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.score).toBe(2);
    expect(submit.body.data.points_awarded).toBe(9);

    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(9);

    // Re-submit blocked; no double award.
    const resubmit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qOrder[0]]: [0] } });
    expect(resubmit.status).toBe(409);
    const afterResubmit = await punyaTotal(parent.token, aarav.id);
    expect(afterResubmit).toBe(after);
  });
});
