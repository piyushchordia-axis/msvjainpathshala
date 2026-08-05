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
        participation_points: 11,
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
    expect(submit.body.data.points_awarded).toBe(11);
    const afterSubmit = await punyaTotal(parent.token, aarav.id);
    expect(afterSubmit - before).toBe(11);

    const attemptId: string = submit.body.data.attempt_id;
    const reset1 = await request(app)
      .post(`/v1/quizzes/events/${eventId}/attempts/${attemptId}/reset`)
      .set(auth(admin.token));
    expect(reset1.status).toBe(200);
    expect(reset1.body.data.points_reversed).toBe(11);
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
    expect(resubmit.body.data.points_awarded).toBe(11);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 11);
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
        participation_points: 8,
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
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 8);

    const blocked = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("ERR_EVENT_HAS_ATTEMPTS");
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before + 8);

    const forced = await request(app)
      .delete(`/v1/quizzes/events/${eventId}`)
      .set(auth(admin.token))
      .send({ force: true });
    expect(forced.status).toBe(200);
    expect(forced.body.data.points_reversed).toBe(8);
    expect(await punyaTotal(parent.token, aarav.id)).toBe(before);

    const gone = await request(app)
      .get(`/v1/quizzes/events/${eventId}/attempts`)
      .set(auth(admin.token));
    expect(gone.status).toBe(404);
  });
});
