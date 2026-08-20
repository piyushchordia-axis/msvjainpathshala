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
import { and, eq, gte, lte } from "drizzle-orm";
import app from "../src/app";
import { pool, db, students, users, centres, quiz_events, push_quizzes } from "@workspace/db";
import { quizMatchesStudent, quizMatchesStudentSql } from "../src/lib/quiz-scope";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

/** Resolve Aarav's student row (id + batch + centre + age) via the seeded student user. */
async function aaravStudent(): Promise<{
  id: string;
  batch_id: string | null;
  centre_id: string | null;
  age_group: string | null;
}> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+919800000007")).limit(1);
  expect(u).toBeDefined();
  const [s] = await db
    .select({
      id: students.id,
      batch_id: students.batch_id,
      centre_id: students.centre_id,
      age_group: students.age_group,
    })
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

/** Close leftover open events so /events/available LIMIT 100 stays deterministic. */
async function expireOpenQuizEvents(): Promise<void> {
  await pool.query(
    `update quiz_events set end_at = now() - interval '1 minute' where end_at >= now()`,
  );
}

describe("quiz system — scheduled events", () => {
  it("authors questions + an event, student takes it all-correct, awards once, blocks resubmit", async () => {
    await expireOpenQuizEvents();
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
        participation_points: 5,
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
    expect(submit.body.data.points_awarded).toBe(18); // 5 + 13 — participation is capped at 5 by punya_features (H1)

    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(18);

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
        participation_points: 5,
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

  it("start twice resumes the same attempt; available reports in_progress", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Resume Q ${tag}`,
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
        title_en: `Resume event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 1,
        win_points: 0,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const first = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(first.status).toBe(200);
    expect(first.body.data.resumed).toBe(false);
    const attemptId: string = first.body.data.attempt_id;
    expect(attemptId).toBeTruthy();

    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const mine = (available.body.data.items as Array<{
      id: string;
      already_attempted: boolean;
      in_progress: boolean;
    }>).find((e) => e.id === eventId);
    expect(mine).toBeDefined();
    expect(mine!.already_attempted).toBe(false);
    expect(mine!.in_progress).toBe(true);

    const second = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(second.status).toBe(200);
    expect(second.body.data.resumed).toBe(true);
    expect(second.body.data.attempt_id).toBe(attemptId);
    expect(second.body.data.answers).toEqual({});
  });

  it("start after submit returns 409 ERR_ALREADY_SUBMITTED", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Submitted start Q ${tag}`,
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
        title_en: `Submitted start event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 0,
        win_points: 0,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const startRes = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(startRes.status).toBe(200);

    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);

    const again = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("ERR_ALREADY_SUBMITTED");
  });

  it("two concurrent starts both succeed with the same attempt_id", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Concurrent start Q ${tag}`,
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
        title_en: `Concurrent start event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 0,
        win_points: 0,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const [a, b] = await Promise.all([
      request(app)
        .post(`/v1/quizzes/events/${eventId}/start`)
        .set(auth(student.token))
        .send({ student_id: aarav.id }),
      request(app)
        .post(`/v1/quizzes/events/${eventId}/start`)
        .set(auth(student.token))
        .send({ student_id: aarav.id }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.attempt_id).toBe(b.body.data.attempt_id);
    expect(a.body.data.attempt_id).toBeTruthy();
  });

  it("NULL participation_points awards the punya_features / global config default", async () => {
    const { clearQuizPointsCache } = await import("../src/lib/quiz-points");
    clearQuizPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Default points Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    // Omit participation_points / win_points → NULL → catalogue default (5 + 0 win).
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Default points event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        win_points: 0,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const row = await pool.query<{ participation_points: number | null }>(
      `select participation_points from quiz_events where id = $1`,
      [eventId],
    );
    expect(row.rows[0]!.participation_points).toBeNull();

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    const before = await punyaTotal(parent.token, aarav.id);
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(5);
    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(5);
  });

  it("city-scoped punya_configs overrides quiz participation default", async () => {
    const { clearQuizPointsCache } = await import("../src/lib/quiz-points");
    clearQuizPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();

    const city = await pool.query<{ city_id: string }>(
      `select city_id from centres where id = $1`,
      [aarav.centre_id],
    );
    const cityId = city.rows[0]!.city_id;

    await pool.query(
      `delete from punya_configs where feature_key = 'quiz_participation' and city_id = $1`,
      [cityId],
    );
    await pool.query(
      `insert into punya_configs (feature_key, points, city_id, is_active)
       values ('quiz_participation', 17, $1, true)`,
      [cityId],
    );
    clearQuizPointsCache();

    try {
      const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const q = await request(app)
        .post("/v1/quizzes/questions")
        .set(auth(admin.token))
        .send({
          question_en: `City override Q ${tag}`,
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
          title_en: `City override event ${tag}`,
          scope: "national",
          start_at: start,
          end_at: end,
          win_points: 0,
          question_ids: [qId],
        });
      expect(ev.status).toBe(200);
      const eventId: string = ev.body.data.id;

      await request(app)
        .post(`/v1/quizzes/events/${eventId}/start`)
        .set(auth(student.token))
        .send({ student_id: aarav.id });

      const submit = await request(app)
        .post(`/v1/quizzes/events/${eventId}/submit`)
        .set(auth(student.token))
        .send({ student_id: aarav.id, answers: { [qId]: [0] } });
      expect(submit.status).toBe(200);
      expect(submit.body.data.points_awarded).toBe(17);
    } finally {
      await pool.query(
        `delete from punya_configs where feature_key = 'quiz_participation' and city_id = $1`,
        [cityId],
      );
      clearQuizPointsCache();
    }
  });

  it("explicit participation_points 0 disables the award", async () => {
    const { clearQuizPointsCache } = await import("../src/lib/quiz-points");
    clearQuizPointsCache();

    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Zero points Q ${tag}`,
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
        title_en: `Zero points event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        participation_points: 0,
        win_points: 0,
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    const before = await punyaTotal(parent.token, aarav.id);
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(0);
    const after = await punyaTotal(parent.token, aarav.id);
    expect(after).toBe(before);
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
        completion_points: 5,
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
    expect(submit.body.data.points_awarded).toBe(5);

    const after = await punyaTotal(parent.token, aarav.id);
    expect(after - before).toBe(5);

    // Re-submit blocked; no double award.
    const resubmit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qOrder[0]]: [0] } });
    expect(resubmit.status).toBe(409);
    const afterResubmit = await punyaTotal(parent.token, aarav.id);
    expect(afterResubmit).toBe(after);
  });

  it("centre-scoped push quiz can be submitted by a student at that centre", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();

    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "centre",
        centre_ids: [aarav.centre_id],
        expires_at: expires,
        completion_points: 0,
        questions: [
          {
            question_en: `Centre push ${Date.now()}`,
            options: [{ text_en: "A" }, { text_en: "B" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: {} });
    expect(submit.status).toBe(200);
  });

  it("national-scoped push quiz can be submitted by a batched student", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.batch_id).toBeTruthy();

    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "national",
        expires_at: expires,
        completion_points: 0,
        questions: [
          {
            question_en: `National push ${Date.now()}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: {} });
    expect(submit.status).toBe(200);
  });

  it("student outside the targeted centre gets 403 on a centre-scoped push quiz", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from centres where id <> $1 and deleted_at is null limit 1`,
      [aarav.centre_id],
    );
    expect(other.rows[0]?.id).toBeTruthy();
    const otherCentreId = other.rows[0]!.id;

    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "centre",
        centre_ids: [otherCentreId],
        expires_at: expires,
        completion_points: 0,
        questions: [
          {
            question_en: `Other centre push ${Date.now()}`,
            options: [{ text_en: "A" }, { text_en: "B" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: {} });
    expect(submit.status).toBe(403);
    expect(submit.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("student with batch_id = null gets 403 on a centre-scoped push quiz aimed elsewhere", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();
    expect(aarav.batch_id).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from centres where id <> $1 and deleted_at is null limit 1`,
      [aarav.centre_id],
    );
    expect(other.rows[0]?.id).toBeTruthy();
    const otherCentreId = other.rows[0]!.id;

    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "centre",
        centre_ids: [otherCentreId],
        expires_at: expires,
        completion_points: 0,
        questions: [
          {
            question_en: `Null-batch elsewhere push ${Date.now()}`,
            options: [{ text_en: "A" }, { text_en: "B" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    // Previously null === null on batch_id bypassed the gate for any non-batch push.
    await pool.query(`update students set batch_id = null where id = $1`, [aarav.id]);
    try {
      const submit = await request(app)
        .post(`/v1/quizzes/push/${pushId}/submit`)
        .set(auth(student.token))
        .send({ student_id: aarav.id, answers: {} });
      expect(submit.status).toBe(403);
      expect(submit.body.error.code).toBe("ERR_FORBIDDEN");
    } finally {
      await pool.query(`update students set batch_id = $1 where id = $2`, [aarav.batch_id, aarav.id]);
    }
  });

  it("GET /push/active still returns a targeted quiz behind 45 newer unrelated live quizzes", async () => {
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.batch_id).toBeTruthy();
    expect(aarav.centre_id).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from centres where id <> $1 and deleted_at is null limit 1`,
      [aarav.centre_id],
    );
    expect(other.rows[0]?.id).toBeTruthy();
    const otherCentreId = other.rows[0]!.id;

    // Prior tests leave live push quizzes; expire them so ordering is deterministic.
    await pool.query(`update push_quizzes set expires_at = now() - interval '1 minute' where expires_at >= now()`);

    const expires = new Date(Date.now() + 60 * 60 * 1000);
    const targetedStarted = new Date(Date.now() - 120_000);

    const [targeted] = await db
      .insert(push_quizzes)
      .values({
        scope: "batch",
        batch_ids: [aarav.batch_id!],
        batch_id: aarav.batch_id,
        started_at: targetedStarted,
        expires_at: expires,
        completion_points: 0,
      })
      .returning({ id: push_quizzes.id });
    expect(targeted?.id).toBeTruthy();

    // 45 newer centre-scoped quizzes aimed elsewhere — previously hid the target past limit(40).
    const decoys = Array.from({ length: 45 }, (_, i) => ({
      scope: "centre" as const,
      centre_ids: [otherCentreId],
      started_at: new Date(Date.now() - 60_000 + i * 1000),
      expires_at: expires,
      completion_points: 0,
    }));
    await db.insert(push_quizzes).values(decoys);

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(active.status).toBe(200);
    expect(active.body.data.active).toBeTruthy();
    expect(active.body.data.active.id).toBe(targeted!.id);
  });
});

describe("quiz system — SQL scope predicate agreement", () => {
  it("quizMatchesStudentSql returns the same open-event ids as quizMatchesStudent", async () => {
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();
    expect(aarav.batch_id).toBeTruthy();

    const [geo] = await db
      .select({ city_id: centres.city_id, state_id: centres.state_id })
      .from(centres)
      .where(eq(centres.id, aarav.centre_id!))
      .limit(1);
    expect(geo?.city_id).toBeTruthy();
    expect(geo?.state_id).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from centres where id <> $1 and deleted_at is null limit 1`,
      [aarav.centre_id],
    );
    const otherCentreId = other.rows[0]?.id;
    expect(otherCentreId).toBeTruthy();

    const tag = `agree-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = new Date(Date.now() - 60 * 60 * 1000);
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.insert(quiz_events).values([
      {
        scope: "national",
        title_en: `${tag} national`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "centre",
        centre_ids: [aarav.centre_id!],
        centre_id: aarav.centre_id,
        title_en: `${tag} centre hit`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "centre",
        centre_ids: [otherCentreId!],
        centre_id: otherCentreId,
        title_en: `${tag} centre miss`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "batch",
        batch_ids: [aarav.batch_id!],
        batch_id: aarav.batch_id,
        title_en: `${tag} batch hit`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "city",
        city_ids: [geo!.city_id],
        city_id: geo!.city_id,
        title_en: `${tag} city hit`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "city",
        city_ids: [],
        city_id: geo!.city_id,
        title_en: `${tag} legacy city`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "state",
        state_ids: [geo!.state_id],
        title_en: `${tag} state hit`,
        start_at: start,
        end_at: end,
        age_groups: [],
      },
      {
        scope: "national",
        title_en: `${tag} age miss`,
        start_at: start,
        end_at: end,
        age_groups: ["yuva"],
      },
      {
        scope: "national",
        title_en: `${tag} age hit`,
        start_at: start,
        end_at: end,
        age_groups: ["bal"],
      },
    ]);

    const student = {
      centre_id: aarav.centre_id,
      batch_id: aarav.batch_id,
      age_group: aarav.age_group,
    };
    const now = new Date();

    const open = await db
      .select()
      .from(quiz_events)
      .where(and(lte(quiz_events.start_at, now), gte(quiz_events.end_at, now)));

    const jsIds = open
      .filter((ev) => quizMatchesStudent(ev, student, geo!.city_id, geo!.state_id))
      .map((ev) => ev.id)
      .sort();

    const sqlRows = await db
      .select({ id: quiz_events.id })
      .from(quiz_events)
      .where(
        and(
          lte(quiz_events.start_at, now),
          gte(quiz_events.end_at, now),
          quizMatchesStudentSql(
            {
              scope: quiz_events.scope,
              state_ids: quiz_events.state_ids,
              city_ids: quiz_events.city_ids,
              centre_ids: quiz_events.centre_ids,
              batch_ids: quiz_events.batch_ids,
              city_id: quiz_events.city_id,
              centre_id: quiz_events.centre_id,
              batch_id: quiz_events.batch_id,
              age_groups: quiz_events.age_groups,
            },
            student,
            geo!.city_id,
            geo!.state_id,
          ),
        ),
      );
    const sqlIds = sqlRows.map((r) => r.id).sort();

    expect(sqlIds).toEqual(jsIds);
    // Sanity: our fixtures actually exercised hit + miss paths.
    const titles = open.filter((e) => e.title_en.startsWith(tag)).map((e) => e.title_en);
    expect(titles.some((t) => t.includes("centre miss"))).toBe(true);
    const matchedTitles = open
      .filter((ev) => quizMatchesStudent(ev, student, geo!.city_id, geo!.state_id))
      .filter((e) => e.title_en.startsWith(tag))
      .map((e) => e.title_en);
    expect(matchedTitles.some((t) => t.includes("centre miss"))).toBe(false);
    expect(matchedTitles.some((t) => t.includes("age miss"))).toBe(false);
    expect(matchedTitles.some((t) => t.includes("national"))).toBe(true);
    expect(matchedTitles.some((t) => t.includes("legacy city"))).toBe(true);
  });
});

describe("quiz system — admin results", () => {
  it("sanchalak gets 403 on another centre's event attempts", async () => {
    const admin = await loginAs("super_admin");
    const sanchalak = await loginAs("sanchalak");
    const aarav = await aaravStudent();
    expect(aarav.centre_id).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from centres where id <> $1 and deleted_at is null limit 1`,
      [aarav.centre_id],
    );
    expect(other.rows[0]?.id).toBeTruthy();
    const otherCentreId = other.rows[0]!.id;

    // Confirm sanchalak is not assigned to the other centre.
    const assigned = await pool.query<{ n: string }>(
      `select count(*)::text as n from sanchalak_centre_assignments
       where user_id = (select id from users where phone = '+919800000004')
         and centre_id = $1 and is_active = true`,
      [otherCentreId],
    );
    expect(Number(assigned.rows[0]?.n ?? 0)).toBe(0);

    const tag = `${Date.now()}-admin-scope`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Scope Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Other centre event ${tag}`,
        scope: "centre",
        centre_ids: [otherCentreId],
        start_at: start,
        end_at: end,
        question_ids: [q.body.data.id],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const attempts = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(sanchalak.token));
    expect(attempts.status).toBe(403);
    expect(attempts.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("event attempts roster returns one row with per-question flags and matching average_score", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();

    const tag = `${Date.now()}-roster`;
    const q1 = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Roster Q1 ${tag}`,
        scope: "national",
        options: [{ text_en: "Yes" }, { text_en: "No" }],
        correct_indices: [0],
      });
    const q2 = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Roster Q2 ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [1],
      });
    expect(q1.status).toBe(200);
    expect(q2.status).toBe(200);
    const q1Id: string = q1.body.data.id;
    const q2Id: string = q2.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Roster event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        question_ids: [q1Id, q2Id],
        participation_points: 3,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    // One correct, one wrong → score 1.
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({
        student_id: aarav.id,
        answers: { [q1Id]: [0], [q2Id]: [0] },
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.score).toBe(1);

    const roster = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(admin.token));
    expect(roster.status).toBe(200);
    expect(roster.body.data.items).toHaveLength(1);
    const row = roster.body.data.items[0];
    expect(row.student_id).toBe(aarav.id);
    expect(row.score).toBe(1);
    expect(row.correct_count).toBe(1);
    expect(row.total_count).toBe(2);
    expect(row.points_awarded).toBe(3);
    expect(row.question_results).toEqual(
      expect.arrayContaining([
        { question_id: q1Id, correct: true },
        { question_id: q2Id, correct: false },
      ]),
    );
    expect(roster.body.data.attempted_count).toBe(1);
    expect(roster.body.data.submitted_count).toBe(1);
    expect(roster.body.data.average_score).toBe(1);

    const list = await request(app).get("/v1/quizzes/push?limit=50").set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
  });

  it("push attempts roster includes is_live and per-question correctness", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.batch_id).toBeTruthy();

    const tag = `${Date.now()}-push-roster`;
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "batch",
        batch_ids: [aarav.batch_id],
        expires_at: expires,
        completion_points: 0,
        questions: [
          {
            question_en: `Push roster ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(active.status).toBe(200);
    const qId: string = active.body.data.active.questions[0].id;

    await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });

    const roster = await request(app)
      .get(`/v1/quizzes/push/${pushId}/attempts`)
      .set(auth(admin.token));
    expect(roster.status).toBe(200);
    expect(roster.body.data.is_live).toBe(true);
    expect(roster.body.data.items).toHaveLength(1);
    expect(roster.body.data.items[0].question_results[0]).toEqual({
      question_id: qId,
      correct: true,
    });
    expect(roster.body.data.average_score).toBe(roster.body.data.items[0].score);
    expect(roster.body.data.submitted_count).toBe(1);
  });
});

describe("quiz system — correction path", () => {
  it("editing a question linked to an attempted event returns 409 ERR_QUESTION_IN_USE", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-in-use`;

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `In use ${tag}`,
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
        title_en: `In use event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    // Even an in-progress attempt blocks answer-key edits.
    const patch = await request(app)
      .patch(`/v1/quizzes/questions/${qId}`)
      .set(auth(admin.token))
      .send({ correct_indices: [1] });
    expect(patch.status).toBe(409);
    expect(patch.body.error.code).toBe("ERR_QUESTION_IN_USE");

    // Soft-delete still works.
    const del = await request(app)
      .delete(`/v1/quizzes/questions/${qId}`)
      .set(auth(admin.token));
    expect(del.status).toBe(200);
    expect(del.body.data.is_active).toBe(false);

    const inactive = await request(app)
      .get("/v1/quizzes/questions?is_active=false&limit=50")
      .set(auth(admin.token));
    expect(inactive.status).toBe(200);
    expect(inactive.body.data.items.some((r: { id: string }) => r.id === qId)).toBe(true);
  });

  it("reset reverses awarded points, is idempotent, and re-take awards again", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-reset`;

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Reset Q ${tag}`,
        scope: "national",
        options: [{ text_en: "Yes" }, { text_en: "No" }],
        correct_indices: [0],
      });
    const qId: string = q.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Reset event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        question_ids: [qId],
        participation_points: 5,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    const before = await punyaTotal(parent.token, aarav.id);
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(5);
    const afterSubmit = await punyaTotal(parent.token, aarav.id);
    expect(afterSubmit - before).toBe(5);

    const attemptId: string = submit.body.data.attempt_id;
    const reset1 = await request(app)
      .post(`/v1/quizzes/events/${eventId}/attempts/${attemptId}/reset`)
      .set(auth(admin.token));
    expect(reset1.status).toBe(200);
    expect(reset1.body.data.points_reversed).toBe(5);
    const afterReset = await punyaTotal(parent.token, aarav.id);
    expect(afterReset).toBe(before);

    const reset2 = await request(app)
      .post(`/v1/quizzes/events/${eventId}/attempts/${attemptId}/reset`)
      .set(auth(admin.token));
    expect(reset2.status).toBe(200);
    // Nothing left to reverse — second call must not debit again.
    expect(reset2.body.data.points_reversed).toBe(0);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before);

    // Re-take awards again.
    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    const resubmit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.points_awarded).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 5);
  });

  it("deleting an event with attempts requires force and leaves the ledger balanced", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-force-del`;

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Force del ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    const qId: string = q.body.data.id;

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Force del event ${tag}`,
        scope: "national",
        start_at: start,
        end_at: end,
        question_ids: [qId],
        participation_points: 5,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    const before = await punyaTotal(parent.token, aarav.id);
    await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 5);

    const blocked = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_EVENT_HAS_ATTEMPTS");
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 5);

    const forced = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.data.points_reversed).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before);

    const gone = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(admin.token));
    expect(gone.status).toBe(404);
  });
});

/**
 * C1 — the read gate and the write gate are different questions.
 *
 * `quizTargetsInAdminScope` answered "may this admin view results" and was then
 * reused as the only authorization on PATCH/DELETE/reset/force-delete. It
 * returned true unconditionally for national scope and existentially for
 * state/city, so holding ONE centre inside a targeted city was enough to
 * mutate a quiz aimed at the whole city — and to read every attempting child's
 * name, centre, batch, score and per-question answers across all of it.
 *
 * None of these branches had a single assertion in either direction, which is
 * why it shipped. Every object below is created inside the test, so nothing
 * here depends on seed ordering.
 */
describe("quiz system — admin read/write scope (C1)", () => {
  const openWindow = () => ({
    start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  async function nationalQuestion(token: string, tag: string): Promise<string> {
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(token))
      .send({
        question_en: `C1 Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);
    return q.body.data.id as string;
  }

  /** Plant graded attempts without driving the take-flow — the row filter is the point. */
  async function plantAttempts(eventId: string, questionId: string, studentIds: string[]) {
    for (const sid of studentIds) {
      await pool.query(
        `insert into quiz_attempts (quiz_event_id, student_id, started_at, submitted_at,
                                    score, correct_count, total_count, answers)
         values ($1, $2, now(), now(), 1, 1, 1, $3::jsonb)
         on conflict do nothing`,
        [eventId, sid, JSON.stringify({ [questionId]: [0] })],
      );
    }
  }

  async function forceDelete(token: string, eventId: string) {
    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(token))
      .send({ force: true });
  }

  it("city_admin cannot rewrite the answer key of a national question", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const qId = await nationalQuestion(admin.token, `${Date.now()}-c1-natq`);

    const patched = await request(app)
      .patch(`/v1/quizzes/questions/${qId}`)
      .set(auth(cityAdmin.token))
      .send({ correct_indices: [1] });
    expect(patched.status).toBe(403);
    expect(patched.body.error.code).toBe("ERR_FORBIDDEN");

    const deleted = await request(app)
      .delete(`/v1/quizzes/questions/${qId}`)
      .set(auth(cityAdmin.token));
    expect(deleted.status).toBe(403);

    const stillCorrect = await pool.query<{ correct_indices: number[] }>(
      `select correct_indices from questions where id = $1`,
      [qId],
    );
    expect(stillCorrect.rows[0]?.correct_indices).toEqual([0]);

    // super_admin is unaffected by the new gate.
    const asSuper = await request(app)
      .patch(`/v1/quizzes/questions/${qId}`)
      .set(auth(admin.token))
      .send({ topic: "c1-regression" });
    expect(asSuper.status).toBe(200);
  });

  it("city_admin cannot delete a state-scoped event covering their own state", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");

    // The state containing the city_admin's own city: the OLD existential check
    // passed here (they hold centres in it), which is exactly the hole.
    const own = await pool.query<{ state_id: string }>(
      `select c.state_id from users u join cities c on c.id = u.city_id
        where u.phone = '+919800000003'`,
    );
    const stateId = own.rows[0]?.state_id;
    expect(stateId).toBeTruthy();

    const tag = `${Date.now()}-c1-state`;
    const qId = await nationalQuestion(admin.token, tag);
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 state event ${tag}`,
        scope: "state",
        state_ids: [stateId],
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const del = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(cityAdmin.token))
      .send({ force: true });
    expect(del.status).toBe(403);
    expect(del.body.error.code).toBe("ERR_FORBIDDEN");

    // Reading it is still allowed — the read gate is deliberately existential.
    const read = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(cityAdmin.token));
    expect(read.status).toBe(200);

    await forceDelete(admin.token, eventId);
  });

  it("city_admin cannot mutate a multi-city event that also targets a city outside their scope", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");

    const own = await pool.query<{ city_id: string }>(
      `select city_id from users where phone = '+919800000003'`,
    );
    const ownCity = own.rows[0]?.city_id;
    expect(ownCity).toBeTruthy();

    const other = await pool.query<{ id: string }>(
      `select id from cities where id <> $1 limit 1`,
      [ownCity],
    );
    const otherCity = other.rows[0]?.id;
    expect(otherCity).toBeTruthy();

    const tag = `${Date.now()}-c1-multicity`;
    const qId = await nationalQuestion(admin.token, tag);
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 multi-city event ${tag}`,
        scope: "city",
        city_ids: [ownCity, otherCity],
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    // Containment, not existence: holding one of the two cities is not enough.
    const del = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(cityAdmin.token))
      .send({ force: true });
    expect(del.status).toBe(403);

    // A single-city event in their OWN city stays writable — the gate narrows,
    // it does not lock a city_admin out of their own work.
    const mine = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 own-city event ${tag}`,
        scope: "city",
        city_ids: [ownCity],
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(mine.status).toBe(200);
    const mineDel = await request(app)
      .delete(`/v1/quizzes/events/${mine.body.data.id}`)
      .set(auth(cityAdmin.token))
      .send({ force: true });
    expect(mineDel.status).toBe(200);

    await forceDelete(admin.token, eventId);
  });

  it("sanchalak reads a city-wide roster but only their own centre's rows", async () => {
    const admin = await loginAs("super_admin");
    const sanchalak = await loginAs("sanchalak");

    const held = await pool.query<{ centre_id: string; city_id: string }>(
      `select a.centre_id, c.city_id
         from sanchalak_centre_assignments a
         join centres c on c.id = a.centre_id
        where a.user_id = (select id from users where phone = '+919800000004')
          and a.is_active = true
          and c.deleted_at is null
        limit 1`,
    );
    const heldCentre = held.rows[0]?.centre_id;
    const cityId = held.rows[0]?.city_id;
    expect(heldCentre).toBeTruthy();

    const inScope = await pool.query<{ id: string }>(
      `select id from students
        where centre_id = $1 and status = 'active' and deleted_at is null limit 1`,
      [heldCentre],
    );
    // A student at a centre the sanchalak does NOT hold. Deliberately not
    // restricted to the same city: the seed has only one centre with students
    // per city, so a same-city filter made this assertion vacuous — and the
    // roster query lists attempts, it does not re-check eligibility, so any
    // out-of-scope student proves whether the row filter is doing its job.
    const outScope = await pool.query<{ id: string }>(
      `select s.id from students s
        where s.status = 'active' and s.deleted_at is null
          and s.centre_id is not null
          and s.centre_id not in (
            select centre_id from sanchalak_centre_assignments
             where user_id = (select id from users where phone = '+919800000004')
               and is_active = true
          )
        limit 1`,
    );
    expect(inScope.rows[0]?.id).toBeTruthy();
    expect(outScope.rows[0]?.id).toBeTruthy();

    const tag = `${Date.now()}-c1-roster`;
    const qId = await nationalQuestion(admin.token, tag);
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 city roster ${tag}`,
        scope: "city",
        city_ids: [cityId],
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const planted = [inScope.rows[0]!.id, outScope.rows[0]!.id];
    await plantAttempts(eventId, qId, planted);

    const roster = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(sanchalak.token));
    expect(roster.status).toBe(200);

    const returnedIds: string[] = roster.body.data.items.map(
      (i: { student_id: string }) => i.student_id,
    );
    expect(returnedIds).toContain(inScope.rows[0]!.id);
    if (outScope.rows[0]?.id) {
      expect(returnedIds).not.toContain(outScope.rows[0].id);
    }

    // Every returned row must belong to a centre the sanchalak actually holds.
    const leaked = await pool.query<{ n: string }>(
      `select count(*)::text as n from students
        where id = any($1::uuid[])
          and centre_id not in (
            select centre_id from sanchalak_centre_assignments
             where user_id = (select id from users where phone = '+919800000004')
               and is_active = true
          )`,
      [returnedIds],
    );
    expect(Number(leaked.rows[0]?.n ?? 0)).toBe(0);
    expect(roster.body.data.attempted_count).toBe(returnedIds.length);

    // super_admin still sees every planted row on the same event.
    const asSuper = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(admin.token));
    expect(asSuper.status).toBe(200);
    expect(asSuper.body.data.items.length).toBe(planted.length);

    await forceDelete(admin.token, eventId);
  });

  it("shikshak reads a national roster narrowed to their own batches", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");

    const batchRows = await pool.query<{ batch_id: string }>(
      `select batch_id from shikshak_batch_assignments
        where user_id = (select id from users where phone = '+919800000005')
          and is_active = true`,
    );
    const batchIds = batchRows.rows.map((r) => r.batch_id);
    expect(batchIds.length).toBeGreaterThan(0);

    const mine = await pool.query<{ id: string }>(
      `select id from students
        where batch_id = any($1::uuid[]) and status = 'active' and deleted_at is null limit 1`,
      [batchIds],
    );
    const theirs = await pool.query<{ id: string }>(
      `select id from students
        where (batch_id is null or batch_id <> all($1::uuid[]))
          and status = 'active' and deleted_at is null limit 1`,
      [batchIds],
    );
    expect(mine.rows[0]?.id).toBeTruthy();

    const tag = `${Date.now()}-c1-shikshak`;
    const qId = await nationalQuestion(admin.token, tag);
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 national roster ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    const planted = [mine.rows[0]!.id, theirs.rows[0]?.id].filter(Boolean) as string[];
    await plantAttempts(eventId, qId, planted);

    const roster = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(shikshak.token));
    expect(roster.status).toBe(200);
    const returnedIds: string[] = roster.body.data.items.map(
      (i: { student_id: string }) => i.student_id,
    );
    expect(returnedIds).toContain(mine.rows[0]!.id);
    if (theirs.rows[0]?.id) {
      expect(returnedIds).not.toContain(theirs.rows[0].id);
    }

    // Whatever the roster shows, a shikshak may not destroy a national event.
    const del = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
    expect(del.status).toBe(403);

    await forceDelete(admin.token, eventId);
  });

  it("state_admin cannot mutate an event targeting a city outside their state", async () => {
    const admin = await loginAs("super_admin");
    const stateAdmin = await loginAs("state_admin");

    const own = await pool.query<{ state_id: string }>(
      `select state_id from users where phone = '+919800000002'`,
    );
    const stateId = own.rows[0]?.state_id;
    expect(stateId).toBeTruthy();

    const insideCity = await pool.query<{ id: string }>(
      `select id from cities where state_id = $1 limit 1`,
      [stateId],
    );
    const outsideCity = await pool.query<{ id: string }>(
      `select id from cities where state_id <> $1 limit 1`,
      [stateId],
    );
    expect(insideCity.rows[0]?.id).toBeTruthy();

    const tag = `${Date.now()}-c1-stateadmin`;
    const qId = await nationalQuestion(admin.token, tag);

    // Their own state's city is writable...
    const inEv = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C1 in-state ${tag}`,
        scope: "city",
        city_ids: [insideCity.rows[0]!.id],
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    expect(inEv.status).toBe(200);
    const inDel = await request(app)
      .delete(`/v1/quizzes/events/${inEv.body.data.id}`)
      .set(auth(stateAdmin.token))
      .send({ force: true });
    expect(inDel.status).toBe(200);

    // ...a city in another state is not, even bundled with one of their own.
    if (outsideCity.rows[0]?.id) {
      const mixed = await request(app)
        .post("/v1/quizzes/events")
        .set(auth(admin.token))
        .send({
          title_en: `C1 mixed-state ${tag}`,
          scope: "city",
          city_ids: [insideCity.rows[0]!.id, outsideCity.rows[0].id],
          ...openWindow(),
          question_ids: [qId],
          participation_points: 0,
          win_points: 0,
        });
      expect(mixed.status).toBe(200);
      const mixedDel = await request(app)
        .delete(`/v1/quizzes/events/${mixed.body.data.id}`)
        .set(auth(stateAdmin.token))
        .send({ force: true });
      expect(mixedDel.status).toBe(403);
      await forceDelete(admin.token, mixed.body.data.id);
    }
  });
});

/**
 * C3 + H1 — the points a student is shown, and the ceiling an admin cannot pass.
 *
 * Migration 0031 made participation/win/completion nullable OVERRIDES (null =
 * the punya_features default, 0 = disabled) but nothing was carried through:
 * /events/available kept reading the raw columns, so a quiz paying 30 Punya
 * rendered no points pills and an explicit "Practice" badge, and points_earned
 * dropped to 0 seconds after the result screen had shown +30. Separately, the
 * override path was `Math.max(0, override)` with Zod allowing 0..10000, so the
 * seeded max_points was decorative.
 */
describe("quiz system — resolved points and catalogue bounds (C3, H1)", () => {
  const openWindow = () => ({
    start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  /** punya_features bounds for a quiz feature, as seeded by migration 0031. */
  async function bounds(featureKey: string): Promise<{ min: number; max: number }> {
    const r = await pool.query<{ min_points: number; max_points: number }>(
      `select min_points, max_points from punya_features where key = $1 and is_active = true limit 1`,
      [featureKey],
    );
    expect(r.rows[0]).toBeDefined();
    return { min: r.rows[0]!.min_points, max: r.rows[0]!.max_points };
  }

  async function makeQuestion(token: string, tag: string): Promise<string> {
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(token))
      .send({
        question_en: `Points Q ${tag}`,
        scope: "national",
        options: [{ text_en: "Yes" }, { text_en: "No" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);
    return q.body.data.id as string;
  }

  it("rejects a participation override above the punya_features ceiling", async () => {
    const admin = await loginAs("super_admin");
    const tag = `${Date.now()}-h1-cap`;
    const qId = await makeQuestion(admin.token, tag);
    const { max } = await bounds("quiz_participation");

    const tooHigh = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `H1 over cap ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: max + 1,
      });
    expect(tooHigh.status).toBe(422);
    expect(tooHigh.body.error.code).toBe("ERR_VALIDATION_FAILED");
    // The admin is told the range, not silently given a different number.
    expect(tooHigh.body.error.message).toContain(String(max));

    // 10,000 Punya per win — the value the review called out — is refused too.
    const absurd = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `H1 absurd ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        win_points: 10000,
      });
    expect(absurd.status).toBe(422);

    // Exactly at the ceiling is fine, and so is 0 (deliberately disabled).
    const atCap = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `H1 at cap ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: max,
        win_points: 0,
      });
    expect(atCap.status).toBe(200);
    await request(app)
      .delete(`/v1/quizzes/events/${atCap.body.data.id}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("rejects a push completion override above the ceiling", async () => {
    const shikshak = await loginAs("shikshak");
    const aarav = await aaravStudent();
    const { max } = await bounds("push_quiz_completion");

    const res = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        completion_points: max + 100,
        questions: [
          {
            question_en: `H1 push ${Date.now()}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain(String(max));
  });

  it("clamps a legacy out-of-bounds override at award time", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-h1-legacy`;
    const qId = await makeQuestion(admin.token, tag);
    const { max } = await bounds("quiz_participation");

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `H1 legacy ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: max,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    // Rows authored before the guard — or edited straight in the DB — must not
    // out-pay the catalogue either. Belt and braces: this is the clamp, not the
    // authoring check, so it is written past the API on purpose.
    await pool.query(`update quiz_events set participation_points = 9999 where id = $1`, [eventId]);

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    const before = await punyaTotal(parent.token, aarav.id);
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(max);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + max);

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("available reports the RESOLVED default for a null override, never 0", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-c3-null`;
    const qId = await makeQuestion(admin.token, tag);

    // Omit both point fields entirely — the "use the standard" case.
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C3 default points ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    // Stored as NULL — the override really is absent, not defaulted on write.
    const stored = await pool.query<{ participation_points: number | null; win_points: number | null }>(
      `select participation_points, win_points from quiz_events where id = $1`,
      [eventId],
    );
    expect(stored.rows[0]?.participation_points).toBeNull();
    expect(stored.rows[0]?.win_points).toBeNull();

    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const mine = (
      available.body.data.items as Array<{
        id: string;
        participation_points: number;
        win_points: number;
      }>
    ).find((e) => e.id === eventId);
    expect(mine).toBeDefined();

    // Pre-fix these were null, so the mobile card summed them to 0 and rendered
    // an explicit "Practice / अभ्यास" badge on a quiz that pays.
    expect(mine!.participation_points).toBeGreaterThan(0);
    expect(mine!.win_points).toBeGreaterThan(0);

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("points_earned comes from the ledger and survives a refetch", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-c3-earned`;
    const qId = await makeQuestion(admin.token, tag);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `C3 earned ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    const awarded: number = submit.body.data.points_awarded;
    expect(awarded).toBeGreaterThan(0);

    // The refetch the result screen triggers. This is where the pill vanished:
    // points_earned was recomputed from the NULL override columns and came back 0.
    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    const mine = (
      available.body.data.items as Array<{ id: string; points_earned: number; already_attempted: boolean }>
    ).find((e) => e.id === eventId);
    expect(mine?.already_attempted).toBe(true);
    expect(mine?.points_earned).toBe(awarded);

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("push/active reports resolved completion points for a null override", async () => {
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-c3-push`;

    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `C3 push Q ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);

    const stored = await pool.query<{ completion_points: number | null }>(
      `select completion_points from push_quizzes where id = $1`,
      [create.body.data.id],
    );
    expect(stored.rows[0]?.completion_points).toBeNull();

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(active.status).toBe(200);
    expect(active.body.data.active?.completion_points).toBeGreaterThan(0);

    await pool.query(`update push_quizzes set expires_at = now() - interval '1 minute' where id = $1`, [
      create.body.data.id,
    ]);
  });
});

/**
 * The take-flow integrity set: answer review, history, empty answer keys,
 * bilingual fallbacks and the window boundaries the suite never touched.
 */
describe("quiz system — take flow (M7, M8, M18, L9, L12) and windows", () => {
  const openWindow = () => ({
    start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  async function makeQuestion(
    token: string,
    tag: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(token))
      .send({
        question_en: `TF Q ${tag}`,
        scope: "national",
        options: [{ text_en: "Yes" }, { text_en: "No" }],
        correct_indices: [0],
        ...extra,
      });
    expect(q.status).toBe(200);
    return q.body.data.id as string;
  }

  it("submit returns question_results so the student can review (M7)", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-m7`;

    const right = await makeQuestion(admin.token, `${tag}-a`);
    const wrong = await makeQuestion(admin.token, `${tag}-b`);
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `M7 review ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [right, wrong],
        participation_points: 0,
        win_points: 0,
      });
    expect(ev.status).toBe(200);
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    // One right, one deliberately wrong.
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [right]: [0], [wrong]: [1] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.correct_count).toBe(1);
    expect(submit.body.data.total_count).toBe(2);

    const results: Array<{ question_id: string; correct: boolean }> =
      submit.body.data.question_results;
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.question_id === right)?.correct).toBe(true);
    expect(results.find((r) => r.question_id === wrong)?.correct).toBe(false);

    // The answer key itself still never reaches the student.
    expect(JSON.stringify(submit.body.data)).not.toContain("correct_indices");

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("history returns a closed quiz with the full review (M8)", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-m8`;
    const qId = await makeQuestion(admin.token, tag);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `M8 history ${tag}`,
        title_hi: `M8 इतिहास ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });

    // Close the window — this is the state that used to make it disappear.
    await pool.query(`update quiz_events set end_at = now() - interval '1 minute' where id = $1`, [
      eventId,
    ]);

    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(
      (available.body.data.items as Array<{ id: string }>).some((e) => e.id === eventId),
    ).toBe(false);

    const history = await request(app)
      .get(`/v1/quizzes/events/history?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(history.status).toBe(200);
    const mine = (history.body.data.items as Array<{ event_id: string; title_hi: string | null; questions: unknown[] }>)
      .find((r) => r.event_id === eventId);
    expect(mine).toBeDefined();
    expect(mine!.title_hi).toBe(`M8 इतिहास ${tag}`);
    expect(mine!.questions).toHaveLength(1);

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("history refuses a student the caller does not own", async () => {
    const student = await loginAs("student");
    const other = await pool.query<{ id: string }>(
      `select s.id from students s
        where s.status = 'active' and s.deleted_at is null
          and s.user_id is distinct from (select id from users where phone = '+919800000007')
          and s.parent_id is distinct from (select id from users where phone = '+919800000007')
        limit 1`,
    );
    expect(other.rows[0]?.id).toBeTruthy();
    const res = await request(app)
      .get(`/v1/quizzes/events/history?student_id=${other.rows[0]!.id}`)
      .set(auth(student.token));
    expect(res.status).toBe(404);
  });

  it("a question with an empty answer key is not graded at all (M18)", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-m18`;

    const good = await makeQuestion(admin.token, `${tag}-good`);
    const broken = await makeQuestion(admin.token, `${tag}-broken`);
    // Zod requires min(1) on create, so this state only reaches legacy/seeded
    // rows — which is exactly why nobody was looking at it.
    await pool.query(`update questions set correct_indices = '{}' where id = $1`, [broken]);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `M18 empty key ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [good, broken],
        participation_points: 0,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    // Answer the good one, leave the broken one blank. Pre-fix the blank
    // counted as CORRECT (sameIndexSet([], []) is true) and the child scored 2/2.
    const submit = await request(app)
      .post(`/v1/quizzes/events/${eventId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [good]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.total_count).toBe(1);
    expect(submit.body.data.correct_count).toBe(1);
    expect(submit.body.data.all_correct).toBe(true);
    const ids = (submit.body.data.question_results as Array<{ question_id: string }>).map(
      (r) => r.question_id,
    );
    expect(ids).toEqual([good]);

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("start and submit are refused outside the window (ERR_WINDOW_CLOSED)", async () => {
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-window`;
    const qId = await makeQuestion(admin.token, tag);

    // Not open yet.
    const future = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Window future ${tag}`,
        scope: "national",
        start_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    const futureId: string = future.body.data.id;
    const early = await request(app)
      .post(`/v1/quizzes/events/${futureId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe("ERR_WINDOW_CLOSED");

    // Open, started, then closed underneath the student — the exact race the
    // paused push polling made invisible on mobile.
    const open = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Window closing ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    const openId: string = open.body.data.id;
    const started = await request(app)
      .post(`/v1/quizzes/events/${openId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(started.status).toBe(200);

    await pool.query(`update quiz_events set end_at = now() - interval '1 second' where id = $1`, [
      openId,
    ]);
    const late = await request(app)
      .post(`/v1/quizzes/events/${openId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe("ERR_WINDOW_CLOSED");

    for (const id of [futureId, openId]) {
      await request(app).delete(`/v1/quizzes/events/${id}`).set(auth(admin.token)).send({ force: true });
    }
  });

  it("an expired push quiz refuses a submit", async () => {
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-pushwindow`;

    const create = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        completion_points: 0,
        questions: [
          {
            question_en: `Push window ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(create.status).toBe(200);
    const pushId: string = create.body.data.id;

    await pool.query(`update push_quizzes set expires_at = now() - interval '1 second' where id = $1`, [
      pushId,
    ]);
    const late = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: {} });
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe("ERR_WINDOW_CLOSED");
  });

  it("blank Hindi is stored as NULL so the ?? fallback still fires (L9)", async () => {
    const admin = await loginAs("super_admin");
    const tag = `${Date.now()}-l9`;

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `L9 Q ${tag}`,
        question_hi: "   ",
        scope: "national",
        options: [
          { text_en: "Yes", text_hi: "" },
          { text_en: "No", text_hi: "नहीं" },
        ],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);

    const row = await pool.query<{ question_hi: string | null; options: Array<{ text_hi?: string | null }> }>(
      `select question_hi, options from questions where id = $1`,
      [q.body.data.id],
    );
    // "" used to be stored verbatim, and `title_hi ?? title_en` only fires on
    // null/undefined — so a Hindi reader got a blank line, not the English.
    expect(row.rows[0]?.question_hi).toBeNull();
    expect(row.rows[0]?.options[0]?.text_hi ?? null).toBeNull();
    expect(row.rows[0]?.options[1]?.text_hi).toBe("नहीं");
  });

  it("bilingual content round-trips to the student list and back", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-bilingual`;

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Which vow is non-violence? ${tag}`,
        question_hi: `कौन सा व्रत अहिंसा है? ${tag}`,
        scope: "national",
        options: [
          { text_en: "Ahimsa", text_hi: "अहिंसा" },
          { text_en: "Satya", text_hi: "सत्य" },
        ],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Bilingual quiz ${tag}`,
        title_hi: `द्विभाषी प्रश्नोत्तरी ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [q.body.data.id],
        participation_points: 0,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    const available = await request(app)
      .get(`/v1/quizzes/events/available?student_id=${aarav.id}`)
      .set(auth(student.token));
    const listed = (available.body.data.items as Array<{ id: string; title_hi: string | null }>)
      .find((e) => e.id === eventId);
    expect(listed?.title_hi).toBe(`द्विभाषी प्रश्नोत्तरी ${tag}`);

    const start = await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });
    expect(start.status).toBe(200);
    const first = start.body.data.questions[0];
    expect(first.question_hi).toBe(`कौन सा व्रत अहिंसा है? ${tag}`);
    expect(first.options[0].text_hi).toBe("अहिंसा");

    await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("a push quiz cannot be set to run for a month (L12)", async () => {
    const shikshak = await loginAs("shikshak");
    const aarav = await aaravStudent();

    const res = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `L12 ${Date.now()}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(res.status).toBe(422);
    // L8 — the envelope carries the reason instead of an empty details[].
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });

  it("a deactivated question cannot be attached to a new event (M3)", async () => {
    const admin = await loginAs("super_admin");
    const tag = `${Date.now()}-m3`;
    const qId = await makeQuestion(admin.token, tag);

    const off = await request(app)
      .delete(`/v1/quizzes/questions/${qId}`)
      .set(auth(admin.token));
    expect(off.status).toBe(200);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `M3 inactive ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
      });
    expect(ev.status).toBe(422);
    expect(ev.body.error.message).toContain("deactivated");

    // Reactivating makes it usable again — deactivation is not a one-way door.
    const on = await request(app)
      .patch(`/v1/quizzes/questions/${qId}`)
      .set(auth(admin.token))
      .send({ is_active: true });
    expect(on.status).toBe(200);
    const ok2 = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `M3 reactivated ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
      });
    expect(ok2.status).toBe(200);
    await request(app)
      .delete(`/v1/quizzes/events/${ok2.body.data.id}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("deleting an event with an IN-PROGRESS attempt needs force too (H3)", async () => {
    await expireOpenQuizEvents();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-h3`;
    const qId = await makeQuestion(admin.token, tag);

    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `H3 in-progress ${tag}`,
        scope: "national",
        ...openWindow(),
        question_ids: [qId],
        participation_points: 0,
        win_points: 0,
      });
    const eventId: string = ev.body.data.id;

    // Started but NOT submitted — a child part-way through.
    await request(app)
      .post(`/v1/quizzes/events/${eventId}/start`)
      .set(auth(student.token))
      .send({ student_id: aarav.id });

    // The guard used to filter on submitted_at IS NOT NULL, so this deleted
    // silently and destroyed their work.
    const blocked = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_EVENT_HAS_ATTEMPTS");
    expect(blocked.body.error.details[0].in_progress_attempts).toBe(1);
    expect(blocked.body.error.details[0].submitted_attempts).toBe(0);

    const forced = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
    expect(forced.status).toBe(200);
  });
});

/**
 * H12/H10 — push quizzes get the correction path events already had, and the
 * module finally tells anyone that a quiz exists.
 *
 * Scheduled events got PATCH/DELETE/reset with Punya reversal; push quizzes got
 * none of it, so a Guruji who started a live quiz with a wrong answer key had no
 * route at all and it kept awarding until it expired on its own.
 */
describe("quiz system — push correction path and notifications (H12, H10)", () => {
  async function startPush(
    token: string,
    batchId: string | null,
    tag: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(token))
      .send({
        batch_id: batchId,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        completion_points: 0,
        questions: [
          {
            question_en: `Push corr ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
        ...extra,
      });
    expect(res.status).toBe(200);
    return res.body.data.id as string;
  }

  it("a shikshak can end their own live push quiz early", async () => {
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-end`;
    const pushId = await startPush(shikshak.token, aarav.batch_id, tag);

    // Live before.
    const before = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(before.body.data.active?.id).toBe(pushId);

    const ended = await request(app)
      .post(`/v1/quizzes/push/${pushId}/end`)
      .set(auth(shikshak.token))
      .send({});
    expect(ended.status).toBe(200);
    expect(ended.body.data.already_ended).toBe(false);

    // Gone from the student's live surface immediately. Asserted by id, not
    // null: other suites leave live push quizzes behind in a shared database.
    const after = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(after.body.data.active?.id).not.toBe(pushId);

    // Idempotent — a double-tap mid-class is not an error.
    const again = await request(app)
      .post(`/v1/quizzes/push/${pushId}/end`)
      .set(auth(shikshak.token))
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.data.already_ended).toBe(true);

    await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
  });

  it("the answer key can be fixed before anyone submits, and is locked after", async () => {
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-patch`;
    const pushId = await startPush(shikshak.token, aarav.batch_id, tag);

    const fixed = await request(app)
      .patch(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({
        questions: [
          {
            question_en: `Push corrected ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [1],
          },
        ],
      });
    expect(fixed.status).toBe(200);

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    const qId: string = active.body.data.active.questions[0].id;
    expect(active.body.data.active.questions[0].question_en).toBe(`Push corrected ${tag}`);

    // Answering the CORRECTED key scores.
    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [1] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.correct_count).toBe(1);

    // Now that a child has been graded against it, the key is history.
    const locked = await request(app)
      .patch(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({
        questions: [
          {
            question_en: `Push relocked ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe("ERR_QUESTION_IN_USE");

    await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
  });

  it("resetting a push attempt reverses Punya and lets the student retake", async () => {
    const shikshak = await loginAs("shikshak");
    const parent = await loginAs("parent");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-pushreset`;

    const pushId = await startPush(shikshak.token, aarav.batch_id, tag, {
      completion_points: 5,
    });
    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    const qId: string = active.body.data.active.questions[0].id;

    const before = await punyaTotal(parent.token, aarav.id);
    const submit = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(submit.status).toBe(200);
    expect(submit.body.data.points_awarded).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 5);

    const roster = await request(app)
      .get(`/v1/quizzes/push/${pushId}/attempts`)
      .set(auth(shikshak.token));
    const attemptId: string = roster.body.data.items[0].attempt_id;

    const reset = await request(app)
      .post(`/v1/quizzes/push/${pushId}/attempts/${attemptId}/reset`)
      .set(auth(shikshak.token))
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.data.points_reversed).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before);

    // A retake mints a NEW award revision rather than being swallowed by
    // ON CONFLICT on the original idempotency key.
    const retake = await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });
    expect(retake.status).toBe(200);
    expect(retake.body.data.points_awarded).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 5);

    const del = await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
    expect(del.status).toBe(200);
    expect(del.body.data.points_reversed).toBe(5);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before);
  });

  it("deleting a push quiz with attempts requires force", async () => {
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-pushdel`;
    const pushId = await startPush(shikshak.token, aarav.batch_id, tag);

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    const qId: string = active.body.data.active.questions[0].id;
    await request(app)
      .post(`/v1/quizzes/push/${pushId}/submit`)
      .set(auth(student.token))
      .send({ student_id: aarav.id, answers: { [qId]: [0] } });

    const blocked = await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.details[0].submitted_attempts).toBe(1);

    const forced = await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
    expect(forced.status).toBe(200);
  });

  it("the C1 write gate covers the new push routes too", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const tag = `${Date.now()}-pushgate`;

    // A national push quiz — outside a shikshak's authoring cap entirely.
    const national = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "national",
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `Push gate ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(national.status).toBe(200);
    const pushId: string = national.body.data.id;

    for (const call of [
      request(app).patch(`/v1/quizzes/push/${pushId}`).set(auth(shikshak.token)).send({ completion_points: 0 }),
      request(app).post(`/v1/quizzes/push/${pushId}/end`).set(auth(shikshak.token)).send({}),
      request(app).delete(`/v1/quizzes/push/${pushId}`).set(auth(shikshak.token)).send({ force: true }),
    ]) {
      const res = await call;
      expect(res.status).toBe(403);
    }

    await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(admin.token))
      .send({ force: true });
  });

  it("starting a push quiz notifies the targeted batch's families (H10)", async () => {
    const shikshak = await loginAs("shikshak");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-notify`;

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where kind = 'quiz'`,
    );

    const pushId = await startPush(shikshak.token, aarav.batch_id, tag);

    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where kind = 'quiz'`,
    );
    // Zero before this change: quizzes.ts never imported notify at all.
    expect(Number(after.rows[0]!.n)).toBeGreaterThan(Number(before.rows[0]!.n));

    // Aarav's own parent is among the recipients. The inbox table carries no
    // JSON payload column — `data` is the PUSH payload only — so assert on the
    // row that actually reaches the family, which is what H10 was about.
    const parentRow = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications
        where kind = 'quiz'
          and user_id = (select parent_id from students where id = $1)
          and created_at > now() - interval '2 minutes'`,
      [aarav.id],
    );
    expect(Number(parentRow.rows[0]!.n)).toBeGreaterThan(0);

    await request(app)
      .delete(`/v1/quizzes/push/${pushId}`)
      .set(auth(shikshak.token))
      .send({ force: true });
  });

  it("an event that is not open yet notifies nobody", async () => {
    const admin = await loginAs("super_admin");
    const tag = `${Date.now()}-notifyfuture`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Notify Q ${tag}`,
        scope: "national",
        options: [{ text_en: "Yes" }, { text_en: "No" }],
        correct_indices: [0],
      });

    const before = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where kind = 'quiz'`,
    );
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `Future quiz ${tag}`,
        scope: "national",
        start_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
        question_ids: [q.body.data.id],
      });
    expect(ev.status).toBe(200);
    const after = await pool.query<{ n: string }>(
      `select count(*)::text as n from notifications where kind = 'quiz'`,
    );
    // A quiz opening next week must not push today.
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);

    await request(app)
      .delete(`/v1/quizzes/events/${ev.body.data.id}`)
      .set(auth(admin.token))
      .send({ force: true });
  });
});

/**
 * Listing scope, age targeting, and the counts a Guruji reads off a roster.
 */
describe("quiz system — listing scope and age targeting (H13, H15, M4, M5, M6, L7)", () => {
  const openWindow = () => ({
    start_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    end_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  it("GET /push filters in SQL, so an old quiz is not pushed past the limit (H13)", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-h13`;

    // The shikshak's own quiz...
    const mine = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `H13 mine ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(mine.status).toBe(200);
    const mineId: string = mine.body.data.id;

    // ...buried under newer national ones they cannot see. Pre-fix the route
    // fetched `limit` rows globally then filtered in JS, so theirs fell off.
    const created: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const other = await request(app)
        .post("/v1/quizzes/push")
        .set(auth(admin.token))
        .send({
          scope: "national",
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          questions: [
            {
              question_en: `H13 noise ${tag}-${i}`,
              options: [{ text_en: "Yes" }, { text_en: "No" }],
              correct_indices: [0],
            },
          ],
        });
      created.push(other.body.data.id);
    }

    const listed = await request(app)
      .get(`/v1/quizzes/push?limit=5`)
      .set(auth(shikshak.token));
    expect(listed.status).toBe(200);
    const ids: string[] = listed.body.data.items.map((i: { id: string }) => i.id);
    // A national quiz genuinely reaches their students, so it may appear —
    // what must NOT happen is the page coming back empty of anything visible.
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(5);

    // And with room for it, their own quiz is present.
    const wide = await request(app)
      .get(`/v1/quizzes/push?limit=100`)
      .set(auth(shikshak.token));
    expect(wide.body.data.items.map((i: { id: string }) => i.id)).toContain(mineId);

    for (const id of [...created, mineId]) {
      await request(app).delete(`/v1/quizzes/push/${id}`).set(auth(admin.token)).send({ force: true });
    }
  });

  it("the question bank no longer leaks another centre's questions (H15)", async () => {
    const admin = await loginAs("super_admin");
    const sanchalak = await loginAs("sanchalak");
    const tag = `${Date.now()}-h15`;

    const held = await pool.query<{ centre_id: string; city_id: string }>(
      `select a.centre_id, c.city_id
         from sanchalak_centre_assignments a
         join centres c on c.id = a.centre_id
        where a.user_id = (select id from users where phone = '+919800000004')
          and a.is_active = true and c.deleted_at is null
        limit 1`,
    );
    const heldCentre = held.rows[0]!.centre_id;
    const cityId = held.rows[0]!.city_id;

    // Another centre in the SAME city — the exact case that leaked, because
    // primaryCityForTargets stamps a centre-scoped question with its city.
    const other = await pool.query<{ id: string }>(
      `select id from centres
        where city_id = $1 and id <> $2 and deleted_at is null limit 1`,
      [cityId, heldCentre],
    );

    const mine = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `H15 mine ${tag}`,
        scope: "centre",
        centre_ids: [heldCentre],
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(mine.status).toBe(200);

    const listed = await request(app)
      .get(`/v1/quizzes/questions?limit=300`)
      .set(auth(sanchalak.token));
    expect(listed.status).toBe(200);
    const ids: string[] = listed.body.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(mine.body.data.id);

    if (other.rows[0]?.id) {
      const theirs = await request(app)
        .post("/v1/quizzes/questions")
        .set(auth(admin.token))
        .send({
          question_en: `H15 theirs ${tag}`,
          scope: "centre",
          centre_ids: [other.rows[0].id],
          options: [{ text_en: "A" }, { text_en: "B" }],
          correct_indices: [0],
        });
      expect(theirs.status).toBe(200);

      const again = await request(app)
        .get(`/v1/quizzes/questions?limit=300`)
        .set(auth(sanchalak.token));
      const ids2: string[] = again.body.data.items.map((i: { id: string }) => i.id);
      expect(ids2).not.toContain(theirs.body.data.id);

      // And it cannot be smuggled onto an event either.
      const ev = await request(app)
        .post("/v1/quizzes/events")
        .set(auth(sanchalak.token))
        .send({
          title_en: `H15 smuggle ${tag}`,
          scope: "centre",
          centre_ids: [heldCentre],
          ...openWindow(),
          question_ids: [theirs.body.data.id],
        });
      expect([403]).toContain(ev.status);
    }
  });

  it("search reaches a question past the list ceiling (M12)", async () => {
    const admin = await loginAs("super_admin");
    const needle = `zzsearch${Date.now()}`;
    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `Findable ${needle} question`,
        scope: "national",
        topic: needle,
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });
    expect(q.status).toBe(200);

    const found = await request(app)
      .get(`/v1/quizzes/questions?limit=300&q=${needle}`)
      .set(auth(admin.token));
    expect(found.status).toBe(200);
    expect(found.body.data.items).toHaveLength(1);
    expect(found.body.data.items[0].id).toBe(q.body.data.id);

    const none = await request(app)
      .get(`/v1/quizzes/questions?limit=300&q=${needle}-absent`)
      .set(auth(admin.token));
    expect(none.body.data.items).toHaveLength(0);
  });

  it("push/active returns every live quiz, not just the newest (M4)", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const tag = `${Date.now()}-m4`;

    // Older: the Guruji's batch quiz.
    const older = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `M4 batch ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(older.status).toBe(200);

    // Newer: a national one that also reaches them.
    const newer = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(admin.token))
      .send({
        scope: "national",
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `M4 national ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(newer.status).toBe(200);

    const active = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(active.status).toBe(200);
    const ids: string[] = (active.body.data.items as Array<{ id: string }>).map((i) => i.id);
    // Pre-fix only the newest came back, so the batch quiz was unreachable.
    expect(ids).toContain(older.body.data.id);
    expect(ids).toContain(newer.body.data.id);
    // `active` stays the newest, for clients that only read that field.
    expect(active.body.data.active.id).toBe(newer.body.data.id);

    for (const id of [older.body.data.id, newer.body.data.id]) {
      await request(app).delete(`/v1/quizzes/push/${id}`).set(auth(admin.token)).send({ force: true });
    }
  });

  it("a push quiz can target one age group, and the eligible count respects it (M5, M6)", async () => {
    const admin = await loginAs("super_admin");
    const shikshak = await loginAs("shikshak");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    expect(aarav.age_group).toBeTruthy();
    const tag = `${Date.now()}-m5`;

    // Aim it at an age group Aarav is NOT in.
    const otherGroup = ["bal", "kishor", "tarun", "yuva"].find((g) => g !== aarav.age_group)!;
    const missed = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        age_groups: [otherGroup],
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `M5 wrong group ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    expect(missed.status).toBe(200);

    const activeMissed = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    const missedIds: string[] = (activeMissed.body.data.items as Array<{ id: string }>).map(
      (i) => i.id,
    );
    // Pre-fix push_quizzes had no age_groups column at all, so this was
    // impossible to express and every child in the batch saw it.
    expect(missedIds).not.toContain(missed.body.data.id);

    // Aimed at Aarav's own group, it reaches him.
    const hit = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        age_groups: [aarav.age_group],
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `M5 right group ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });
    const activeHit = await request(app)
      .get(`/v1/quizzes/push/active?student_id=${aarav.id}`)
      .set(auth(student.token));
    expect(
      (activeHit.body.data.items as Array<{ id: string }>).map((i) => i.id),
    ).toContain(hit.body.data.id);

    // M6 — the roster's eligible count must not include children the quiz was
    // never offered to. An age-targeted quiz has a smaller denominator than an
    // untargeted one on the same batch.
    const untargeted = await request(app)
      .post("/v1/quizzes/push")
      .set(auth(shikshak.token))
      .send({
        batch_id: aarav.batch_id,
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        questions: [
          {
            question_en: `M6 all groups ${tag}`,
            options: [{ text_en: "Yes" }, { text_en: "No" }],
            correct_indices: [0],
          },
        ],
      });

    const targetedRoster = await request(app)
      .get(`/v1/quizzes/push/${hit.body.data.id}/attempts`)
      .set(auth(shikshak.token));
    const allRoster = await request(app)
      .get(`/v1/quizzes/push/${untargeted.body.data.id}/attempts`)
      .set(auth(shikshak.token));
    expect(targetedRoster.status).toBe(200);
    expect(allRoster.status).toBe(200);
    expect(targetedRoster.body.data.eligible_count).toBeLessThanOrEqual(
      allRoster.body.data.eligible_count,
    );
    expect(targetedRoster.body.data.eligible_count).toBeGreaterThan(0);

    for (const id of [missed.body.data.id, hit.body.data.id, untargeted.body.data.id]) {
      await request(app).delete(`/v1/quizzes/push/${id}`).set(auth(admin.token)).send({ force: true });
    }
  });

  it("a multi-city event is visible to every targeted city's admin (L7)", async () => {
    const admin = await loginAs("super_admin");
    const cityAdmin = await loginAs("city_admin");
    const tag = `${Date.now()}-l7`;

    const own = await pool.query<{ city_id: string }>(
      `select city_id from users where phone = '+919800000003'`,
    );
    const ownCity = own.rows[0]!.city_id;
    const other = await pool.query<{ id: string }>(
      `select id from cities where id <> $1 limit 1`,
      [ownCity],
    );
    expect(other.rows[0]?.id).toBeTruthy();

    const q = await request(app)
      .post("/v1/quizzes/questions")
      .set(auth(admin.token))
      .send({
        question_en: `L7 Q ${tag}`,
        scope: "national",
        options: [{ text_en: "A" }, { text_en: "B" }],
        correct_indices: [0],
      });

    // city_ids[0] is the OTHER city, so the legacy single-column filter put
    // this event out of reach of the city_admin it also targets.
    const ev = await request(app)
      .post("/v1/quizzes/events")
      .set(auth(admin.token))
      .send({
        title_en: `L7 multi-city ${tag}`,
        scope: "city",
        city_ids: [other.rows[0]!.id, ownCity],
        ...openWindow(),
        question_ids: [q.body.data.id],
      });
    expect(ev.status).toBe(200);

    const listed = await request(app)
      .get(`/v1/quizzes/events?limit=300`)
      .set(auth(cityAdmin.token));
    expect(listed.status).toBe(200);
    expect(
      (listed.body.data.items as Array<{ id: string }>).map((i) => i.id),
    ).toContain(ev.body.data.id);

    await request(app)
      .delete(`/v1/quizzes/events/${ev.body.data.id}`)
      .set(auth(admin.token))
      .send({ force: true });
  });
});
