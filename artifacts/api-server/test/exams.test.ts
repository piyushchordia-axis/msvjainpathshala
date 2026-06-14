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

    // Student result reflects the graded score.
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
});
