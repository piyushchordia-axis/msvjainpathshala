/**
 * Full online exams: admin authoring (single_choice + text questions),
 * student take flow (available → start → submit with auto-grade), and
 * admin manual grading of the text answer.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import app from "../src/app";
import { pool, db, students, users } from "@workspace/db";
import { loginAs, auth } from "./helpers";
import {
  clearMemoryRateLimitKeyForTests,
  resetMemoryRateLimitsForTests,
} from "../src/lib/ratelimit";
import { clearExamPointsCache } from "../src/lib/exam-points";

afterAll(async () => {
  await pool.end();
});

/** Resolve Aarav's student row via the seeded student user. */
async function aaravStudent(): Promise<{ id: string }> {
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.phone, "+919800000007")).limit(1);
  expect(u).toBeDefined();
  const [s] = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.user_id, u!.id))
    .limit(1);
  expect(s).toBeDefined();
  return s!;
}

async function examCompletionTxns(studentId: string, attemptId: string) {
  return pool.query<{
    points: number;
    idempotency_key: string;
    reversal_of: string | null;
  }>(
    `select points, idempotency_key, reversal_of
     from punya_transactions
     where student_id = $1
       and source_entity_kind = 'exam_completion'
       and source_entity_id = $2
     order by created_at`,
    [studentId, attemptId],
  );
}

/** Resolve the seeded Mumbai city id via the admin geography endpoint. */
async function mumbaiCityId(token: string): Promise<string> {
  const geo = await request(app).get("/v1/admin/geography").set(auth(token));
  expect(geo.status).toBe(200);
  const cities: Array<{ id: string; name: string }> = geo.body.data.cities;
  const mumbai = cities.find((c) => c.name === "Mumbai");
  expect(mumbai).toBeDefined();
  return mumbai!.id;
}

/** Author a fresh, currently-open Mumbai exam (no OTP) and return its id. */
async function createMumbaiExam(
  token: string,
  cityId: string,
  extras: Record<string, unknown> = {},
): Promise<string> {
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createExam = await request(app)
    .post("/v1/admin/exams")
    .set(auth(token))
    .send({
      title_en: `Vitest Exam ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title_hi: `परीक्षण परीक्षा ${Date.now()}`,
      city_id: cityId,
      window_start: start,
      window_end: end,
      total_marks: 20,
      pass_mark: 5,
      max_attempts: 99,
      exam_otp: "",
      ...extras,
    });
  expect(createExam.status).toBe(200);
  const examId: string = createExam.body.data.id;
  expect(examId).toBeTruthy();
  return examId;
}

describe("online exams", () => {
  it("authors, takes, auto-grades, then manually grades an exam", async () => {
    const admin = await loginAs("super_admin");

    // Discover the city the seeded student (Aarav Shah, Mumbai) sits in by
    // reusing the city of an existing seeded exam in the admin list.
    const existing = await request(app)
      .get("/v1/admin/exams?limit=50")
      .set(auth(admin.token));
    expect(existing.status).toBe(200);
    const seededExams: Array<{ id: string; city_name: string }> = existing.body.data.items;
    expect(seededExams.length).toBeGreaterThan(0);
    const mumbaiExam = seededExams.find((e) => e.city_name === "Mumbai");
    expect(mumbaiExam).toBeDefined();

    // Pull the full city id off the seeded Mumbai exam by reading its city via
    // the geography endpoint (more robust than guessing).
    const geo = await request(app).get("/v1/admin/geography").set(auth(admin.token));
    expect(geo.status).toBe(200);
    const cities: Array<{ id: string; name: string }> = geo.body.data.cities;
    const mumbai = cities.find((c) => c.name === "Mumbai");
    expect(mumbai).toBeDefined();
    const cityId = mumbai!.id;

    // Create a fresh exam for Mumbai: window covers now, high attempts, no OTP.
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createExam = await request(app)
      .post("/v1/admin/exams")
      .set(auth(admin.token))
      .send({
        title_en: `Vitest Exam ${Date.now()}`,
        title_hi: `परीक्षण परीक्षा ${Date.now()}`,
        city_id: cityId,
        window_start: start,
        window_end: end,
        total_marks: 20,
        pass_mark: 5,
        max_attempts: 99,
        exam_otp: "", // empty => treated as no OTP required
      });
    expect(createExam.status).toBe(200);
    const examId: string = createExam.body.data.id;
    expect(examId).toBeTruthy();

    // Add a single_choice question (2 options, 1 correct).
    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;
    expect(q1Id).toBeTruthy();

    // Add a text question (manual grading).
    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Explain aparigraha in your words.",
        question_type: "text",
        marks: 10,
      });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;
    expect(q2Id).toBeTruthy();

    // Admin question listing includes is_correct.
    const qList = await request(app)
      .get(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token));
    expect(qList.status).toBe(200);
    const questions: Array<{
      id: string;
      question_type: string;
      options: Array<{ id: string; is_correct: boolean }>;
    }> = qList.body.data.items;
    expect(questions.length).toBe(2);
    const choiceQ = questions.find((q) => q.id === q1Id)!;
    const correctOption = choiceQ.options.find((o) => o.is_correct)!;
    expect(correctOption).toBeDefined();

    // ── Student flow ──
    const student = await loginAs("student");

    const available = await request(app)
      .get("/v1/exams/available")
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const avail: Array<{ id: string }> = available.body.data.items;
    expect(avail.some((e) => e.id === examId)).toBe(true);

    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    expect(attemptId).toBeTruthy();

    // Student payload must NOT expose is_correct.
    const startQuestions: Array<{
      id: string;
      question_type: string;
      options: Array<{ id: string; is_correct?: boolean }>;
    }> = startRes.body.data.questions;
    expect(startQuestions.length).toBe(2);
    for (const sq of startQuestions) {
      for (const o of sq.options) {
        expect("is_correct" in o).toBe(false);
      }
    }
    // Resolve the correct option id from the student's own payload.
    const studentChoiceQ = startQuestions.find((q) => q.id === q1Id)!;
    const chosenOptionId =
      studentChoiceQ.options.find((o) => o.id === correctOption.id)?.id ?? correctOption.id;

    // Submit: correct choice answer + some text.
    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({
        answers: [
          { question_id: q1Id, selected_option_ids: [chosenOptionId] },
          { question_id: q2Id, text_answer: "Non-possessiveness and limiting attachments." },
        ],
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");
    expect(submit.body.data.needs_grading).toBe(true);
    expect(submit.body.data.auto_score).toBe(10);
    expect(submit.body.data.score).toBeNull();

    // ── Admin grading ──
    const attemptDetail = await request(app)
      .get(`/v1/exams/${examId}/attempts/${attemptId}`)
      .set(auth(admin.token));
    expect(attemptDetail.status).toBe(200);
    expect(attemptDetail.body.data.status).toBe("submitted");
    const detailAnswers: Array<{ question_id: string; question_type: string }> =
      attemptDetail.body.data.answers;
    const textAnswer = detailAnswers.find((a) => a.question_id === q2Id)!;
    expect(textAnswer.question_type).toBe("text");

    const grade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: q2Id, marks_awarded: 8 }] });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("graded");
    expect(grade.body.data.score).toBe(18); // 10 auto + 8 manual

    // Before results are released, the graded score is withheld from the student.
    const withheld = await request(app)
      .get(`/v1/exams/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(withheld.status).toBe(200);
    expect(withheld.body.data.status).toBe("graded");
    expect(withheld.body.data.score).toBeUndefined();
    expect(withheld.body.data.per_question).toBeUndefined();

    // Admin releases results for this exam.
    const release = await request(app)
      .post(`/v1/admin/exams/${examId}/release-results`)
      .set(auth(admin.token));
    expect(release.status).toBe(200);

    // Now the student result reflects the graded score.
    const result = await request(app)
      .get(`/v1/exams/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe("graded");
    expect(result.body.data.score).toBe(18);
    expect(result.body.data.passed).toBe(true);
  });

  it("rejects starting an exam for a non-student via student endpoints", async () => {
    const admin = await loginAs("super_admin");
    const res = await request(app)
      .get("/v1/exams/available")
      .set(auth(admin.token));
    expect(res.status).toBe(403);
  });

  it("withholds the result score until results are released", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    // One single_choice question + one text question so grading is needed.
    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain aparigraha.", question_type: "text", marks: 10 });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;

    // Student starts + submits.
    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const startQuestions: Array<{ id: string; options: Array<{ id: string }> }> =
      startRes.body.data.questions;
    const choiceQ = startQuestions.find((q) => q.id === q1Id)!;
    const chosenOptionId = choiceQ.options[0].id;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({
        answers: [
          { question_id: q1Id, selected_option_ids: [chosenOptionId] },
          { question_id: q2Id, text_answer: "Non-possessiveness." },
        ],
      });
    expect(submit.status).toBe(200);

    // Admin grades the text question -> attempt becomes fully graded.
    const grade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: q2Id, marks_awarded: 6 }] });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("graded");

    // results_released is still false: score + per_question must be withheld,
    // even though the attempt is fully graded.
    const result = await request(app)
      .get(`/v1/exams/attempts/${attemptId}/result`)
      .set(auth(student.token));
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBeDefined();
    expect(result.body.data.score).toBeUndefined();
    expect(result.body.data.passed).toBeUndefined();
    expect(result.body.data.per_question).toBeUndefined();
  });

  it("backfills skipped text answers so grading cannot finalize prematurely", async () => {
    // Regression: previously the submit loop only wrote exam_answers rows for
    // questions in the body, so a SKIPPED text question had no row at all. The
    // grade route counts rows with NULL marks_awarded to decide when grading is
    // complete, so a missing row let it finalize 'graded' with an understated
    // score before the text answer was ever graded. The submit now backfills a
    // NULL-marks row for every gradable question.
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    // One choice question (auto-graded) + one text question (manual).
    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain aparigraha.", question_type: "text", marks: 10 });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;

    // Student starts and submits ONLY the choice answer — the text question is
    // skipped (omitted from the answers array entirely).
    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const startQuestions: Array<{ id: string; options: Array<{ id: string }> }> =
      startRes.body.data.questions;
    const choiceQ = startQuestions.find((q) => q.id === q1Id)!;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: q1Id, selected_option_ids: [choiceQ.options[0].id] }] });
    expect(submit.status).toBe(200);
    // Exam has a text question, so it stays submitted and needs grading even
    // though the student skipped it.
    expect(submit.body.data.status).toBe("submitted");
    expect(submit.body.data.needs_grading).toBe(true);

    // The skipped text question must now have a backfilled answer row (visible
    // in the admin attempt detail) awaiting a grade.
    const detail = await request(app)
      .get(`/v1/exams/${examId}/attempts/${attemptId}`)
      .set(auth(admin.token));
    expect(detail.status).toBe(200);
    const answers: Array<{ question_id: string; marks_awarded: number | null }> =
      detail.body.data.answers;
    const textRow = answers.find((a) => a.question_id === q2Id)!;
    expect(textRow).toBeDefined();
    expect(textRow.marks_awarded).toBeNull();

    // A grade call that omits the skipped text question must NOT finalize the
    // attempt to 'graded' — it stays submitted because the text answer is
    // still ungraded.
    const partial = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: q1Id, marks_awarded: 10 }] });
    expect(partial.status).toBe(200);
    expect(partial.body.data.status).toBe("submitted");
    expect(partial.body.data.needs_grading).toBe(true);

    // Grading the text question completes it -> auto 10 + manual 0 = 10.
    const finalize = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: q2Id, marks_awarded: 0 }] });
    expect(finalize.status).toBe(200);
    expect(finalize.body.data.status).toBe("graded");
    expect(finalize.body.data.score).toBe(10);
  });

  it("rejects grading an in-progress (never-submitted) attempt with 422", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const qt = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain ahimsa.", question_type: "text", marks: 10 });
    expect(qt.status).toBe(200);
    const qtId: string = qt.body.data.id;

    // Student starts but never submits -> attempt stays in_progress.
    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;

    const grade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: qtId, marks_awarded: 5 }] });
    expect(grade.status).toBe(422);
    expect(grade.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  /** Author a fresh, open Mumbai exam that REQUIRES an OTP gate; return id+otp. */
  async function createOtpGatedExam(
    token: string,
    cityId: string,
  ): Promise<{ examId: string; otp: string }> {
    const otp = `OTP${Date.now().toString().slice(-6)}`;
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createExam = await request(app)
      .post("/v1/admin/exams")
      .set(auth(token))
      .send({
        title_en: `Vitest OTP Exam ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title_hi: `परीक्षण OTP परीक्षा ${Date.now()}`,
        city_id: cityId,
        window_start: start,
        window_end: end,
        total_marks: 20,
        pass_mark: 5,
        max_attempts: 99,
        exam_otp: otp,
      });
    expect(createExam.status).toBe(200);
    const examId: string = createExam.body.data.id;
    expect(examId).toBeTruthy();
    // Plaintext is returned once on create; DB stores only the hash.
    expect(createExam.body.data.exam_otp).toBe(otp);
    const stored = await pool.query(
      `select exam_otp, exam_otp_hash from online_exams where id = $1`,
      [examId],
    );
    expect(stored.rows[0]!.exam_otp).toBeNull();
    expect(stored.rows[0]!.exam_otp_hash).toMatch(/^\$argon2id\$/);
    return { examId, otp };
  }

  it("OTP-gated take flow: blocks start without/with wrong OTP, allows with correct OTP", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const { examId, otp } = await createOtpGatedExam(admin.token, cityId);

    // A single objective question so the take flow has something to grade.
    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const student = await loginAs("student");

    // The available listing should flag this exam as requiring an OTP.
    const available = await request(app)
      .get("/v1/exams/available")
      .set(auth(student.token));
    expect(available.status).toBe(200);
    const listed: Array<{ id: string; requires_otp: boolean }> = available.body.data.items;
    const me = listed.find((e) => e.id === examId);
    expect(me).toBeDefined();
    expect(me!.requires_otp).toBe(true);

    // Start with NO OTP -> 401 OTP invalid (the gate the route enforces).
    const noOtp = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(noOtp.status).toBe(401);
    expect(noOtp.body.error.code).toBe("ERR_OTP_INVALID");

    // Start with a WRONG OTP -> 401 OTP invalid.
    const wrongOtp = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({ otp: "not-the-code" });
    expect(wrongOtp.status).toBe(401);
    expect(wrongOtp.body.error.code).toBe("ERR_OTP_INVALID");

    // Start with the CORRECT OTP -> attempt opens and questions come back.
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({ otp });
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    expect(attemptId).toBeTruthy();
    const startQuestions: Array<{ id: string; options: Array<{ id: string }> }> =
      startRes.body.data.questions;
    const choiceQ = startQuestions.find((q) => q.id === q1Id)!;
    expect(choiceQ).toBeDefined();

    // Submit the correct option -> objective-only exam auto-grades to 10.
    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: q1Id, selected_option_ids: [choiceQ.options[0].id] }] });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("graded");
    expect(submit.body.data.needs_grading).toBe(false);
    expect(submit.body.data.auto_score).toBe(10);
    expect(submit.body.data.score).toBe(10);
  });

  it("auto-grades objective answers: full marks for correct, zero for wrong", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);

    // Two objective questions worth 10 + 5 = 15 marks; no text question so the
    // submission auto-grades immediately to a known score.
    const examId = await createMumbaiExam(admin.token, cityId);
    const qCorrect = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(qCorrect.status).toBe(200);
    const qCorrectId: string = qCorrect.body.data.id;

    const qWrong = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "How many tattvas?",
        question_type: "single_choice",
        marks: 5,
        options: [
          { option_en: "Seven", is_correct: true },
          { option_en: "Three", is_correct: false },
        ],
      });
    expect(qWrong.status).toBe(200);
    const qWrongId: string = qWrong.body.data.id;

    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const startQuestions: Array<{
      id: string;
      options: Array<{ id: string; option_en: string }>;
    }> = startRes.body.data.questions;

    // Answer Q1 correctly (Ahimsa) and Q2 incorrectly (Three) -> 10 + 0 = 10.
    const sq1 = startQuestions.find((q) => q.id === qCorrectId)!;
    const sq2 = startQuestions.find((q) => q.id === qWrongId)!;
    const correctOpt = sq1.options.find((o) => o.option_en === "Ahimsa")!;
    const wrongOpt = sq2.options.find((o) => o.option_en === "Three")!;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({
        answers: [
          { question_id: qCorrectId, selected_option_ids: [correctOpt.id] },
          { question_id: qWrongId, selected_option_ids: [wrongOpt.id] },
        ],
      });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("graded");
    expect(submit.body.data.needs_grading).toBe(false);
    expect(submit.body.data.auto_score).toBe(10);
    expect(submit.body.data.score).toBe(10);
  });

  it("skipped TEXT question keeps the attempt pending manual grade (not finalized)", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    // One objective (auto, 10) + one text (manual, 10).
    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain anekantavada.", question_type: "text", marks: 10 });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;

    // Student answers ONLY the objective question; the text question is skipped.
    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const startQuestions: Array<{ id: string; options: Array<{ id: string }> }> =
      startRes.body.data.questions;
    const choiceQ = startQuestions.find((q) => q.id === q1Id)!;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: q1Id, selected_option_ids: [choiceQ.options[0].id] }] });
    expect(submit.status).toBe(200);
    // Must NOT auto-finalize: the unanswered text question keeps it pending the
    // manual grade. The route models "pending manual grade" as status=submitted
    // with needs_grading=true and a withheld (null) overall score.
    expect(submit.body.data.status).toBe("submitted");
    expect(submit.body.data.needs_grading).toBe(true);
    expect(submit.body.data.score).toBeNull();
    // The objective half still scored.
    expect(submit.body.data.auto_score).toBe(10);

    // The admin attempt detail confirms it is not finalized and the skipped text
    // answer has a NULL marks row awaiting grading.
    const detail = await request(app)
      .get(`/v1/exams/${examId}/attempts/${attemptId}`)
      .set(auth(admin.token));
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("submitted");
    expect(detail.body.data.needs_grading).toBe(true);
    expect(detail.body.data.score).toBeNull();
    const answers: Array<{ question_id: string; marks_awarded: number | null }> =
      detail.body.data.answers;
    const textRow = answers.find((a) => a.question_id === q2Id)!;
    expect(textRow.marks_awarded).toBeNull();

    // Manual grading the text answer NOW finalizes: auto 10 + manual 7 = 17.
    const grade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: q2Id, marks_awarded: 7 }] });
    expect(grade.status).toBe(200);
    expect(grade.body.data.status).toBe("graded");
    expect(grade.body.data.score).toBe(17);
  });

  it("authorization: students cannot grade, and unauthorized roles are rejected", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const qt = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain ahimsa.", question_type: "text", marks: 10 });
    expect(qt.status).toBe(200);
    const qtId: string = qt.body.data.id;

    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qtId, text_answer: "Non-violence in thought and deed." }] });
    expect(submit.status).toBe(200);
    expect(submit.body.data.needs_grading).toBe(true);

    // A student cannot grade their own (or any) attempt -> 403 admin-panel gate.
    const studentGrade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(student.token))
      .send({ grades: [{ question_id: qtId, marks_awarded: 10 }] });
    expect(studentGrade.status).toBe(403);
    expect(studentGrade.body.error.code).toBe("ERR_FORBIDDEN");

    // A student also cannot read the admin attempt detail.
    const studentDetail = await request(app)
      .get(`/v1/exams/${examId}/attempts/${attemptId}`)
      .set(auth(student.token));
    expect(studentDetail.status).toBe(403);

    // No auth at all on the grade route -> 401 unauthorized.
    const anonGrade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .send({ grades: [{ question_id: qtId, marks_awarded: 10 }] });
    expect(anonGrade.status).toBe(401);

    // A non-admin-panel role (parent) cannot grade either -> 403.
    const parent = await loginAs("parent");
    const parentGrade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(parent.token))
      .send({ grades: [{ question_id: qtId, marks_awarded: 10 }] });
    expect(parentGrade.status).toBe(403);
    expect(parentGrade.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("authorization: shikshak cannot author questions, grade, or release results (SPEC 6.17)", async () => {
    // Shikshak can open the admin panel but must NOT touch exam content/results.
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "What is Ahimsa?", question_type: "text", marks: 10 });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, text_answer: "Non-violence." }] });
    expect(submit.status).toBe(200);

    const shikshak = await loginAs("shikshak");

    const addQ = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(shikshak.token))
      .send({ question_en: "Forbidden question?", question_type: "text", marks: 5 });
    expect(addQ.status).toBe(403);
    expect(addQ.body.error.code).toBe("ERR_FORBIDDEN");

    const delQ = await request(app)
      .delete(`/v1/exams/${examId}/questions/${qId}`)
      .set(auth(shikshak.token));
    expect(delQ.status).toBe(403);
    expect(delQ.body.error.code).toBe("ERR_FORBIDDEN");

    const grade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(shikshak.token))
      .send({ grades: [{ question_id: qId, marks_awarded: 10 }] });
    expect(grade.status).toBe(403);
    expect(grade.body.error.code).toBe("ERR_FORBIDDEN");

    const release = await request(app)
      .post(`/v1/admin/exams/${examId}/release-results`)
      .set(auth(shikshak.token))
      .send({});
    expect(release.status).toBe(403);
    expect(release.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("6th wrong access code within 15 minutes returns 429; correct code after window clears sets otp_verified_at", async () => {
    process.env.JP_TEST_RATE_LIMIT = "1";
    resetMemoryRateLimitsForTests();
    try {
      const admin = await loginAs("super_admin");
      const cityId = await mumbaiCityId(admin.token);
      const { examId, otp } = await createOtpGatedExam(admin.token, cityId);

      const student = await loginAs("student");
      const aarav = await aaravStudent();
      // Per-exam OTP limiter keys on caller + student (N4), not caller alone.
      const examKey = `exam:start:exam:${examId}:user:${student.user.id}:${aarav.id}`;
      const userKey = `exam:start:user:${student.user.id}`;

      for (let i = 0; i < 5; i++) {
        const wrong = await request(app)
          .post(`/v1/exams/${examId}/start`)
          .set(auth(student.token))
          .send({ otp: `WRONG${i}` });
        expect(wrong.status).toBe(401);
        expect(wrong.body.error.code).toBe("ERR_OTP_INVALID");
        // Keep the per-exam 5/900s bucket; clear the hourly bucket so this test
        // isolates the per-exam window (same pattern as niyam rate-limit tests).
        clearMemoryRateLimitKeyForTests(userKey);
      }

      const blocked = await request(app)
        .post(`/v1/exams/${examId}/start`)
        .set(auth(student.token))
        .send({ otp: "WRONG6" });
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("ERR_RATE_LIMITED");

      // Simulate the 15-minute window elapsing.
      clearMemoryRateLimitKeyForTests(examKey);
      clearMemoryRateLimitKeyForTests(userKey);

      const okStart = await request(app)
        .post(`/v1/exams/${examId}/start`)
        .set(auth(student.token))
        .send({ otp });
      expect(okStart.status).toBe(200);
      const attemptId: string = okStart.body.data.attempt_id;
      expect(attemptId).toBeTruthy();

      const row = await pool.query(
        `select otp_verified_at from exam_attempts where id = $1`,
        [attemptId],
      );
      expect(row.rows[0]!.otp_verified_at).not.toBeNull();
    } finally {
      delete process.env.JP_TEST_RATE_LIMIT;
      resetMemoryRateLimitsForTests();
    }
  });

  it("PATCH updates exam metadata; blocks marks edits after results_released", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const patchOk = await request(app)
      .patch(`/v1/admin/exams/${examId}`)
      .set(auth(admin.token))
      .send({
        title_en: "Updated exam title",
        title_hi: "अद्यतन शीर्षक",
        total_marks: 50,
        pass_mark: 20,
        max_attempts: 3,
      });
    expect(patchOk.status).toBe(200);
    expect(patchOk.body.data.title_en).toBe("Updated exam title");
    expect(patchOk.body.data.total_marks).toBe(50);
    expect(patchOk.body.data.pass_mark).toBe(20);
    expect(patchOk.body.data.max_attempts).toBe(3);

    // Release refuses while the paper (question marks) disagrees with the
    // declared total (CTY-API-07b) — author a matching paper first.
    const releaseBlocked = await request(app)
      .post(`/v1/admin/exams/${examId}/release-results`)
      .set(auth(admin.token))
      .send({});
    expect(releaseBlocked.status).toBe(409);

    const paper = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 50,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(paper.status).toBe(200);

    const release = await request(app)
      .post(`/v1/admin/exams/${examId}/release-results`)
      .set(auth(admin.token))
      .send({});
    expect(release.status).toBe(200);

    const patchMarks = await request(app)
      .patch(`/v1/admin/exams/${examId}`)
      .set(auth(admin.token))
      .send({ total_marks: 80 });
    expect(patchMarks.status).toBe(409);
    expect(patchMarks.body.error.code).toBe("ERR_RESULTS_PUBLISHED");

    const patchTitle = await request(app)
      .patch(`/v1/admin/exams/${examId}`)
      .set(auth(admin.token))
      .send({ title_en: "Still editable after release" });
    expect(patchTitle.status).toBe(200);
    expect(patchTitle.body.data.title_en).toBe("Still editable after release");
  });

  it("editing an exam that has attempts returns 409", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);

    const addAfter = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Should not be allowed",
        question_type: "text",
        marks: 5,
      });
    expect(addAfter.status).toBe(409);
    expect(addAfter.body.error.code).toBe("ERR_EXAM_HAS_ATTEMPTS");

    const delAfter = await request(app)
      .delete(`/v1/exams/${examId}/questions/${q1Id}`)
      .set(auth(admin.token));
    expect(delAfter.status).toBe(409);
    expect(delAfter.body.error.code).toBe("ERR_EXAM_HAS_ATTEMPTS");
  });

  it("submitting after window_end returns 422", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const student = await loginAs("student");
    const startRes = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(startRes.status).toBe(200);
    const attemptId: string = startRes.body.data.attempt_id;
    const optionId: string = startRes.body.data.questions[0].options[0].id;

    // Close the window under the open attempt — submit must not grade or persist.
    await pool.query(`update online_exams set window_end = now() - interval '1 minute' where id = $1`, [
      examId,
    ]);

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: q1Id, selected_option_ids: [optionId] }] });
    expect(submit.status).toBe(422);
    expect(submit.body.error.code).toBe("ERR_WINDOW_CLOSED");

    const row = await pool.query<{ status: string }>(
      `select status from exam_attempts where id = $1`,
      [attemptId],
    );
    expect(row.rows[0]!.status).toBe("in_progress");

    const answers = await pool.query<{ n: string }>(
      `select count(*)::text as n from exam_answers where attempt_id = $1`,
      [attemptId],
    );
    expect(Number(answers.rows[0]?.n ?? 0)).toBe(0);
  });

  it("an abandoned attempt frees a max_attempts slot", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);

    // max_attempts=1 so a non-abandoned attempt would permanently block a restart.
    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const createExam = await request(app)
      .post("/v1/admin/exams")
      .set(auth(admin.token))
      .send({
        title_en: `Vitest Exam abandon ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title_hi: `परीक्षण परीक्षा छोड़ ${Date.now()}`,
        city_id: cityId,
        window_start: start,
        window_end: end,
        total_marks: 10,
        pass_mark: 5,
        max_attempts: 1,
        exam_otp: "",
      });
    expect(createExam.status).toBe(200);
    const examId: string = createExam.body.data.id;

    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);

    const student = await loginAs("student");
    const first = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(first.status).toBe(200);
    const attemptId: string = first.body.data.attempt_id;

    const capped = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(capped.status).toBe(409);
    expect(capped.body.error.code).toBe("ERR_MAX_ATTEMPTS");

    const reset = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/reset`)
      .set(auth(admin.token))
      .send({});
    expect(reset.status).toBe(200);
    expect(reset.body.data.status).toBe("abandoned");

    const available = await request(app).get("/v1/exams/available").set(auth(student.token));
    expect(available.status).toBe(200);
    const item = (
      available.body.data.items as Array<{ id: string; already_attempted_count: number }>
    ).find((e) => e.id === examId);
    expect(item?.already_attempted_count).toBe(0);

    const again = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.data.attempt_id).toBeTruthy();
    expect(again.body.data.attempt_id).not.toBe(attemptId);
  });

  it("parent with multiple children must pass student_id; each valid child works; foreign child 404", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Parent context Q",
        question_type: "single_choice",
        marks: 5,
        options: [
          { option_en: "Yes", is_correct: true },
          { option_en: "No", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);

    const parent = await loginAs("parent");
    const childrenRes = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(childrenRes.status).toBe(200);
    const kids: Array<{ id: string; full_name: string }> = childrenRes.body.data.items;
    expect(kids.length).toBeGreaterThanOrEqual(2);
    const [childA, childB] = kids;

    // Omitted student_id with multiple children → 422.
    const missing = await request(app)
      .get("/v1/exams/available")
      .set(auth(parent.token));
    expect(missing.status).toBe(422);
    expect(missing.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(missing.body.error.message).toMatch(/Choose which child/i);

    const missingStart = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(parent.token))
      .send({});
    expect(missingStart.status).toBe(422);
    expect(missingStart.body.error.code).toBe("ERR_VALIDATION_FAILED");

    // Each owned child can list and start.
    for (const kid of [childA, childB]) {
      const avail = await request(app)
        .get(`/v1/exams/available?student_id=${kid.id}`)
        .set(auth(parent.token));
      expect(avail.status).toBe(200);
      expect(avail.body.data.items.some((e: { id: string }) => e.id === examId)).toBe(true);

      const start = await request(app)
        .post(`/v1/exams/${examId}/start`)
        .set(auth(parent.token))
        .send({ student_id: kid.id });
      expect(start.status).toBe(200);
      expect(start.body.data.attempt_id).toBeTruthy();
    }

    // A student this parent does not own → 404.
    const foreign = await pool.query<{ id: string }>(
      `select s.id
       from students s
       where s.deleted_at is null
         and s.status = 'active'
         and s.id <> all($1::uuid[])
       order by s.student_code
       limit 1`,
      [kids.map((k) => k.id)],
    );
    expect(foreign.rows[0]?.id).toBeTruthy();
    const notMine = await request(app)
      .get(`/v1/exams/available?student_id=${foreign.rows[0]!.id}`)
      .set(auth(parent.token));
    expect(notMine.status).toBe(404);
    expect(notMine.body.error.code).toBe("ERR_NOT_FOUND");

    const notMineStart = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(parent.token))
      .send({ student_id: foreign.rows[0]!.id });
    expect(notMineStart.status).toBe(404);
    expect(notMineStart.body.error.code).toBe("ERR_NOT_FOUND");
  });

  it("autosave upserts answers without grading; rejects foreign option ids", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Autosave MCQ",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Right", is_correct: true },
          { option_en: "Wrong", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const student = await loginAs("student");
    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;
    const optionId: string = start.body.data.questions[0].options[0].id;

    const saved = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${qId}`)
      .set(auth(student.token))
      .send({ selected_option_ids: [optionId] });
    expect(saved.status).toBe(200);
    expect(saved.body.data.selected_option_ids).toEqual([optionId]);

    const row = await pool.query<{
      is_correct: boolean | null;
      marks_awarded: number | null;
      selected_option_ids: string[];
    }>(
      `select is_correct, marks_awarded, selected_option_ids
       from exam_answers
       where attempt_id = $1 and question_id = $2`,
      [attemptId, qId],
    );
    expect(row.rows[0]?.selected_option_ids).toEqual([optionId]);
    expect(row.rows[0]?.is_correct).toBeNull();
    expect(row.rows[0]?.marks_awarded).toBeNull();

    const bad = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${qId}`)
      .set(auth(student.token))
      .send({ selected_option_ids: ["00000000-0000-4000-8000-000000000099"] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe("ERR_VALIDATION_FAILED");
  });

  it("submit with a foreign option id returns 422 and persists nothing", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Submit foreign option",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Right", is_correct: true },
          { option_en: "Wrong", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const student = await loginAs("student");
    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({
        answers: [
          {
            question_id: qId,
            selected_option_ids: ["00000000-0000-4000-8000-000000000099"],
          },
        ],
      });
    expect(submit.status).toBe(422);
    expect(submit.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(submit.body.error.message).toMatch(/do not belong to this question/i);

    const attemptRow = await pool.query<{ status: string }>(
      `select status from exam_attempts where id = $1`,
      [attemptId],
    );
    expect(attemptRow.rows[0]?.status).toBe("in_progress");

    const answerCount = await pool.query<{ n: string }>(
      `select count(*)::text as n from exam_answers where attempt_id = $1`,
      [attemptId],
    );
    expect(Number(answerCount.rows[0]?.n ?? 0)).toBe(0);
  });

  it("submit keeps autosaved answers for questions absent from the body", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Autosave baseline Q1",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Autosave baseline Q2 text",
        question_type: "text",
        marks: 10,
      });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;

    const qList = await request(app)
      .get(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token));
    const choiceQ = (qList.body.data.items as Array<{
      id: string;
      options: Array<{ id: string; is_correct: boolean }>;
    }>).find((q) => q.id === q1Id)!;
    const correctOptionId = choiceQ.options.find((o) => o.is_correct)!.id;

    const student = await loginAs("student");
    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;

    // Autosave both answers, then submit with an empty answers array —
    // saved rows must remain the grading baseline.
    const save1 = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${q1Id}`)
      .set(auth(student.token))
      .send({ selected_option_ids: [correctOptionId] });
    expect(save1.status).toBe(200);

    const save2 = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${q2Id}`)
      .set(auth(student.token))
      .send({ text_answer: "Non-attachment in daily life." });
    expect(save2.status).toBe(200);

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [] });
    expect(submit.status).toBe(200);
    expect(submit.body.data.auto_score).toBe(10);
    expect(submit.body.data.needs_grading).toBe(true);
    expect(submit.body.data.status).toBe("submitted");

    const persisted = await pool.query<{
      question_id: string;
      selected_option_ids: string[];
      text_answer: string | null;
      marks_awarded: number | null;
    }>(
      `select question_id, selected_option_ids, text_answer, marks_awarded
       from exam_answers
       where attempt_id = $1
       order by question_id`,
      [attemptId],
    );
    const byQ = new Map(persisted.rows.map((r) => [r.question_id, r]));
    expect(byQ.get(q1Id)?.selected_option_ids).toEqual([correctOptionId]);
    expect(byQ.get(q1Id)?.marks_awarded).toBe(10);
    expect(byQ.get(q2Id)?.text_answer).toBe("Non-attachment in daily life.");
    expect(byQ.get(q2Id)?.marks_awarded).toBeNull();

    // After submit, further autosave is rejected.
    const late = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${q1Id}`)
      .set(auth(student.token))
      .send({ selected_option_ids: [correctOptionId] });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("ERR_ALREADY_SUBMITTED");
  });

  it("available reports open_attempt_id for an in-progress attempt", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Resume probe",
        question_type: "single_choice",
        marks: 5,
        options: [
          { option_en: "A", is_correct: true },
          { option_en: "B", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);

    const student = await loginAs("student");
    const before = await request(app).get("/v1/exams/available").set(auth(student.token));
    expect(before.status).toBe(200);
    const beforeItem = (before.body.data.items as Array<{ id: string; open_attempt_id: string | null }>).find(
      (e) => e.id === examId,
    );
    expect(beforeItem?.open_attempt_id).toBeNull();

    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;

    const after = await request(app).get("/v1/exams/available").set(auth(student.token));
    expect(after.status).toBe(200);
    const afterItem = (after.body.data.items as Array<{ id: string; open_attempt_id: string | null }>).find(
      (e) => e.id === examId,
    );
    expect(afterItem?.open_attempt_id).toBe(attemptId);
  });

  it("resume returns saved answers without correctness fields", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q1 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "MCQ for resume",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Right", is_correct: true },
          { option_en: "Wrong", is_correct: false },
        ],
      });
    expect(q1.status).toBe(200);
    const q1Id: string = q1.body.data.id;

    const q2 = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Text for resume",
        question_type: "text",
        marks: 5,
      });
    expect(q2.status).toBe(200);
    const q2Id: string = q2.body.data.id;

    const student = await loginAs("student");
    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;
    const optionId: string = start.body.data.questions[0].options[0].id;

    const saveMcq = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${q1Id}`)
      .set(auth(student.token))
      .send({ selected_option_ids: [optionId] });
    expect(saveMcq.status).toBe(200);

    const saveText = await request(app)
      .put(`/v1/exams/attempts/${attemptId}/answers/${q2Id}`)
      .set(auth(student.token))
      .send({ text_answer: "Non-violence in daily life." });
    expect(saveText.status).toBe(200);

    const resume = await request(app)
      .get(`/v1/exams/attempts/${attemptId}`)
      .set(auth(student.token));
    expect(resume.status).toBe(200);
    expect(resume.body.data.attempt_id).toBe(attemptId);
    expect(resume.body.data.exam_id).toBe(examId);
    expect(resume.body.data.title_en).toBeTruthy();
    expect(resume.body.data.title_hi).toBeTruthy();
    expect(resume.body.data.window_end).toBeTruthy();

    const questions: Array<{
      id: string;
      options: Array<Record<string, unknown>>;
    }> = resume.body.data.questions;
    expect(questions.length).toBe(2);
    for (const q of questions) {
      for (const o of q.options) {
        expect("is_correct" in o).toBe(false);
      }
    }

    const answers: Array<{
      question_id: string;
      selected_option_ids: string[];
      text_answer: string | null;
      is_correct?: unknown;
      marks_awarded?: unknown;
    }> = resume.body.data.answers;
    expect(answers.length).toBe(2);
    const byQ = new Map(answers.map((a) => [a.question_id, a]));
    expect(byQ.get(q1Id)?.selected_option_ids).toEqual([optionId]);
    expect(byQ.get(q2Id)?.text_answer).toBe("Non-violence in daily life.");
    for (const a of answers) {
      expect("is_correct" in a).toBe(false);
      expect("marks_awarded" in a).toBe(false);
    }
  });

  it("resume on a submitted attempt returns 409 ERR_ALREADY_SUBMITTED", async () => {
    const admin = await loginAs("super_admin");
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId);

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Submit then resume",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Yes", is_correct: true },
          { option_en: "No", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const student = await loginAs("student");
    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;
    const optionId: string = start.body.data.questions[0].options[0].id;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, selected_option_ids: [optionId] }] });
    expect(submit.status).toBe(200);

    const resume = await request(app)
      .get(`/v1/exams/attempts/${attemptId}`)
      .set(auth(student.token));
    expect(resume.status).toBe(409);
    expect(resume.body.error.code).toBe("ERR_ALREADY_SUBMITTED");
  });

  it("submitting the same attempt twice awards completion Punya once", async () => {
    clearExamPointsCache();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId, {
      completion_points: 15,
      pass_mark: 5,
      total_marks: 10,
    });

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({
        question_en: "Which is a Jain principle?",
        question_type: "single_choice",
        marks: 10,
        options: [
          { option_en: "Ahimsa", is_correct: true },
          { option_en: "Himsa", is_correct: false },
        ],
      });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;
    const opts = await request(app).get(`/v1/exams/${examId}/questions`).set(auth(admin.token));
    const correctId = opts.body.data.items[0].options.find(
      (o: { is_correct: boolean }) => o.is_correct,
    ).id;

    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    expect(start.status).toBe(200);
    const attemptId: string = start.body.data.attempt_id;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, selected_option_ids: [correctId] }] });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("graded");
    expect(submit.body.data.score).toBe(10);

    const replay = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, selected_option_ids: [correctId] }] });
    expect(replay.status).toBe(409);

    const txns = await examCompletionTxns(aarav.id, attemptId);
    const awards = txns.rows.filter((r) => r.points > 0);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.points).toBe(15);
    expect(awards[0]!.idempotency_key).toBe(
      `exam:${examId}:${aarav.id}:${attemptId}:completion`,
    );
  });

  it("re-grading an attempt does not double-award completion Punya", async () => {
    clearExamPointsCache();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId, {
      completion_points: 12,
      pass_mark: 5,
      total_marks: 10,
    });

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain Ahimsa.", question_type: "text", marks: 10 });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    const attemptId: string = start.body.data.attempt_id;

    const submit = await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, text_answer: "Non-violence." }] });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("submitted");

    const grade1 = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: qId, marks_awarded: 10 }] });
    expect(grade1.status).toBe(200);
    expect(grade1.body.data.status).toBe("graded");

    const grade2 = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: qId, marks_awarded: 9 }] });
    expect(grade2.status).toBe(200);
    expect(grade2.body.data.status).toBe("graded");

    const txns = await examCompletionTxns(aarav.id, attemptId);
    const awards = txns.rows.filter((r) => r.points > 0);
    const reversals = txns.rows.filter((r) => r.points < 0);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.points).toBe(12);
    expect(reversals).toHaveLength(0);
  });

  it("writes a reversal when a re-grade drops a student below the pass mark", async () => {
    clearExamPointsCache();
    const admin = await loginAs("super_admin");
    const student = await loginAs("student");
    const aarav = await aaravStudent();
    const cityId = await mumbaiCityId(admin.token);
    const examId = await createMumbaiExam(admin.token, cityId, {
      completion_points: 18,
      pass_mark: 8,
      total_marks: 10,
    });

    const q = await request(app)
      .post(`/v1/exams/${examId}/questions`)
      .set(auth(admin.token))
      .send({ question_en: "Explain Aparigraha.", question_type: "text", marks: 10 });
    expect(q.status).toBe(200);
    const qId: string = q.body.data.id;

    const start = await request(app)
      .post(`/v1/exams/${examId}/start`)
      .set(auth(student.token))
      .send({});
    const attemptId: string = start.body.data.attempt_id;

    await request(app)
      .post(`/v1/exams/attempts/${attemptId}/submit`)
      .set(auth(student.token))
      .send({ answers: [{ question_id: qId, text_answer: "Non-attachment." }] });

    const pass = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: qId, marks_awarded: 10 }] });
    expect(pass.status).toBe(200);
    expect(pass.body.data.score).toBe(10);

    const failGrade = await request(app)
      .post(`/v1/exams/${examId}/attempts/${attemptId}/grade`)
      .set(auth(admin.token))
      .send({ grades: [{ question_id: qId, marks_awarded: 2 }] });
    expect(failGrade.status).toBe(200);
    expect(failGrade.body.data.score).toBe(2);

    const txns = await examCompletionTxns(aarav.id, attemptId);
    const awards = txns.rows.filter((r) => r.points > 0);
    const reversals = txns.rows.filter((r) => r.points < 0);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.points).toBe(18);
    expect(reversals).toHaveLength(1);
    expect(reversals[0]!.points).toBe(-18);
    expect(reversals[0]!.reversal_of).toBeTruthy();
    expect(reversals[0]!.idempotency_key).toBe(`${awards[0]!.idempotency_key}:reversal`);
  });
});
