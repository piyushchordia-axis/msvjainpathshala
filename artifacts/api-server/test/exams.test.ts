/**
 * Full online exams: admin authoring (single_choice + text questions),
 * student take flow (available → start → submit with auto-grade), and
 * admin manual grading of the text answer.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

afterAll(async () => {
  await pool.end();
});

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
async function createMumbaiExam(token: string, cityId: string): Promise<string> {
  const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const createExam = await request(app)
    .post("/v1/admin/exams")
    .set(auth(token))
    .send({
      title_en: `Vitest Exam ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      city_id: cityId,
      window_start: start,
      window_end: end,
      total_marks: 20,
      pass_mark: 5,
      max_attempts: 99,
      exam_otp: "",
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
});
