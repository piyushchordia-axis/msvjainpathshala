/**
 * ExamsService — Step 19 (SPEC §5.14, §6.17, §8.9).
 *
 * Lifecycle:
 *   create() → generateOtp() → startAttempt() → saveAnswer() … → submit() →
 *   gradeAnswer() (admin, short_text only) → releaseResults().
 *
 * Key invariants:
 *   • Exam OTP is class-wide, not per-student (SPEC §8.9). Admin generates,
 *     distributes verbally.
 *   • OTP only valid during the first 30 minutes of the exam window. After
 *     that → ERR_EXAM_OTP_WINDOW_EXPIRED (409).
 *   • Auto-grade is fully deterministic for mcq_single / mcq_multi /
 *     true_false. short_text rows wait for the admin grading queue.
 *   • Release-results computes ranks by `score DESC, submitted_at ASC`, awards
 *     `completion_points` to every submitter and `top_score_points` to the
 *     top 3 (tie-break by submitted_at). Idempotency keys:
 *       exam:{exam_id}:completion:{student_id}
 *       exam:{exam_id}:top:{student_id}
 *
 * No per-student attempt-bound JWT — the simpler MVP keeps the parent's
 * existing access token gating the answer/submit calls and verifies the
 * attempt belongs to one of the parent's students on every write.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ExamsRepository, StudentsRepository } from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  EXAM_OTP_WINDOW_MS,
  type CreateExamInput,
  type GenerateOtpResult,
  type GradeAnswerInput,
  type ReleaseResultsResult,
  type SaveAnswerInput,
  type StartAttemptInput,
  type StartAttemptResult,
  type SubmitAttemptResult,
} from './exams.types';

import type {
  ExamAnswer,
  ExamAttempt,
  ExamQuestionOption,
  OnlineExam,
  Student,
} from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly exams: ExamsRepository,
    private readonly students: StudentsRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Admin — create exam (with questions + options atomic-ish)
  // ===========================================================================

  async create(
    actor: ScopedActor,
    input: CreateExamInput,
  ): Promise<{
    exam: OnlineExam;
    questions: number;
    options: number;
  }> {
    this.assertCanAdmin(actor);
    if (!actor.city_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'city_admin scope required',
        statusCode: 403,
      });
    }
    if (!input.title_en?.trim() || !input.title_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both title_en and title_hi are required',
        statusCode: 422,
      });
    }
    const start = new Date(input.window_start);
    const end = new Date(input.window_end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_DATETIME_FORMAT,
        message: 'window_end must be after window_start',
        statusCode: 422,
      });
    }
    if (input.questions.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'At least one question is required',
        statusCode: 422,
      });
    }
    const total_marks = input.questions.reduce((s, q) => s + q.marks, 0);

    const exam = await this.exams.insertExam({
      city_id: actor.city_id,
      title_en: input.title_en.trim(),
      title_hi: input.title_hi.trim(),
      description_en: input.description_en ?? null,
      description_hi: input.description_hi ?? null,
      target_audience: input.target_audience ?? null,
      window_start: start,
      window_end: end,
      max_attempts: input.max_attempts ?? 1,
      total_marks,
      pass_mark: input.pass_mark,
      completion_points: input.completion_points ?? 20,
      top_score_points: input.top_score_points ?? 50,
      show_rank: input.show_rank ?? false,
      created_by: actor.user_id,
      updated_by: actor.user_id,
    });

    let optionsInserted = 0;
    for (const q of input.questions) {
      const question = await this.exams.insertQuestion({
        exam_id: exam.id,
        question_type: q.question_type,
        question_en: q.question_en,
        question_hi: q.question_hi,
        marks: q.marks,
        order_index: q.order_index,
      });
      // MCQ + true/false → options required (true/false has 2 canonical options).
      if (q.options && q.options.length > 0) {
        for (const o of q.options) {
          await this.exams.insertOption({
            question_id: question.id,
            label_en: o.label_en,
            label_hi: o.label_hi,
            is_correct: o.is_correct,
            order_index: o.order_index,
          });
          optionsInserted += 1;
        }
      }
    }

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'online_exam',
        entity_id: exam.id,
        after: {
          title_en: exam.title_en,
          window_start: exam.window_start,
          window_end: exam.window_end,
          questions: input.questions.length,
          total_marks,
        },
      })
      .catch(() => undefined);

    return { exam, questions: input.questions.length, options: optionsInserted };
  }

  // ===========================================================================
  // Admin — generate / rotate OTP
  // ===========================================================================

  async generateOtp(actor: ScopedActor, examId: string): Promise<GenerateOtpResult> {
    this.assertCanAdmin(actor);
    const exam = await this.requireExam(examId);
    this.assertCityScope(actor, exam);
    const otp = this.randomNumericOtp(6);
    const updated = await this.exams.updateExam(examId, { exam_otp: otp });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'OTP set failed',
        statusCode: 500,
      });
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'update',
        entity_kind: 'online_exam',
        entity_id: examId,
        after: { otp_generated: true },
      })
      .catch(() => undefined);
    return {
      exam_id: examId,
      exam_otp: otp,
      otp_valid_until: new Date(updated.window_start.getTime() + EXAM_OTP_WINDOW_MS).toISOString(),
    };
  }

  // ===========================================================================
  // Reads (parent)
  // ===========================================================================

  async listForCaller(actor: ScopedActor): Promise<OnlineExam[]> {
    if (actor.role === 'parent') {
      const kids = await this.students.findByParent(actor.user_id);
      const first = kids.find((s) => s.status === 'active');
      if (!first) return [];
      const centreId = first.centre_id;
      void centreId;
      // For the MVP we list every exam in the city the parent's child belongs
      // to that is currently within its window (or upcoming).
      const list = await this.exams.listForCity(actor.city_id ?? '');
      // Filter unreleased OTPs out of the past-window list — parents only see
      // in-window or upcoming exams.
      const now = Date.now();
      return list.filter((e) => e.window_end.getTime() >= now);
    }
    this.assertCanAdmin(actor);
    if (!actor.city_id) return [];
    return this.exams.listForCity(actor.city_id);
  }

  // ===========================================================================
  // Parent — start attempt
  // ===========================================================================

  async startAttempt(
    actor: ScopedActor,
    examId: string,
    input: StartAttemptInput,
  ): Promise<StartAttemptResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents (or student-view) can start an exam',
        statusCode: 403,
      });
    }
    const exam = await this.requireExam(examId);
    const now = new Date();

    // Window check first — both bounds.
    if (now < exam.window_start || now > exam.window_end) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_WINDOW_CLOSED,
        message: 'Exam is not in its window',
        statusCode: 409,
      });
    }

    // OTP set?
    if (!exam.exam_otp) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_OTP_NOT_SET,
        message: 'OTP not generated yet — please contact your Guruji',
        statusCode: 409,
      });
    }

    // OTP only valid first 30 minutes of window.
    const otpDeadline = new Date(exam.window_start.getTime() + EXAM_OTP_WINDOW_MS);
    if (now > otpDeadline) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_OTP_WINDOW_EXPIRED,
        message: 'OTP window has expired — you can no longer start this exam',
        statusCode: 409,
      });
    }

    if (input.exam_otp !== exam.exam_otp) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_OTP_INVALID,
        message: 'Incorrect exam OTP',
        statusCode: 401,
      });
    }

    const student = await this.requireStudent(input.student_id);
    await this.assertParentReachStudent(actor, student);

    // Existing in-progress attempt?
    const past = await this.exams.findAttemptsByStudent(examId, student.id);
    const inProgress = past.find((a) => a.status === 'in_progress');
    if (inProgress) {
      // Return the existing attempt — idempotent restart.
      const questions = await this.loadQuestionsForAttempt(examId);
      return { attempt: inProgress, questions, server_now: now.toISOString() };
    }
    if (past.length >= exam.max_attempts) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_MAX_ATTEMPTS_REACHED,
        message: `Maximum attempts (${exam.max_attempts}) already reached`,
        statusCode: 409,
      });
    }

    const attempt = await this.exams.insertAttempt({
      exam_id: examId,
      student_id: student.id,
      started_at: now,
      status: 'in_progress',
      otp_verified_at: now,
    });

    const questions = await this.loadQuestionsForAttempt(examId);
    return { attempt, questions, server_now: now.toISOString() };
  }

  // ===========================================================================
  // Parent — save answer (autosave / debounced from client)
  // ===========================================================================

  async saveAnswer(
    actor: ScopedActor,
    attemptId: string,
    input: SaveAnswerInput,
  ): Promise<{ answer: ExamAnswer }> {
    const attempt = await this.requireAttempt(attemptId);
    await this.assertParentCanReachAttempt(actor, attempt);

    if (attempt.status !== 'in_progress') {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_ATTEMPT_NOT_IN_PROGRESS,
        message: 'Attempt is no longer in progress',
        statusCode: 409,
      });
    }

    const question = await this.exams.findQuestionById(input.question_id);
    if (!question || question.exam_id !== attempt.exam_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_QUESTION_NOT_FOUND,
        message: 'Question is not part of this attempt',
        statusCode: 404,
      });
    }

    const answer = await this.exams.upsertAnswer({
      attempt_id: attemptId,
      question_id: input.question_id,
      selected_option_ids: input.selected_option_ids ?? null,
      short_text_answer: input.short_text_answer ?? null,
    });
    return { answer };
  }

  // ===========================================================================
  // Parent — submit attempt (auto-grades MCQ + true/false)
  // ===========================================================================

  async submitAttempt(actor: ScopedActor, attemptId: string): Promise<SubmitAttemptResult> {
    const attempt = await this.requireAttempt(attemptId);
    await this.assertParentCanReachAttempt(actor, attempt);

    if (attempt.status !== 'in_progress') {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_ATTEMPT_NOT_IN_PROGRESS,
        message: 'Attempt is not in progress',
        statusCode: 409,
      });
    }
    const exam = await this.requireExam(attempt.exam_id);
    const questions = await this.exams.listQuestions(exam.id);
    const options = await this.exams.listOptionsForQuestions(questions.map((q) => q.id));
    const optsByQuestion = new Map<string, ExamQuestionOption[]>();
    for (const o of options) {
      const arr = optsByQuestion.get(o.question_id) ?? [];
      arr.push(o);
      optsByQuestion.set(o.question_id, arr);
    }
    const answers = await this.exams.listAnswers(attemptId);
    const answersByQuestion = new Map<string, ExamAnswer>();
    for (const a of answers) answersByQuestion.set(a.question_id, a);

    let autoScore = 0;
    let manualPending = false;
    for (const q of questions) {
      const answer = answersByQuestion.get(q.id);
      if (q.question_type === 'short_text' || q.question_type === 'image_based') {
        // Manual grading required — score stays null until admin grades.
        if (answer && (answer.short_text_answer ?? '').trim().length > 0) {
          manualPending = true;
        }
        continue;
      }
      // Auto-grading for mcq_single / mcq_multi / true_false.
      if (!answer) continue;
      const correctIds = new Set(
        (optsByQuestion.get(q.id) ?? []).filter((o) => o.is_correct).map((o) => o.id),
      );
      const selected = new Set(answer.selected_option_ids ?? []);
      let correct = false;
      if (q.question_type === 'mcq_single' || q.question_type === 'true_false') {
        correct =
          selected.size === 1 && correctIds.size === 1 && [...selected][0] === [...correctIds][0];
      } else {
        // mcq_multi — exact set match.
        if (selected.size === correctIds.size) {
          correct = [...selected].every((id) => correctIds.has(id));
        }
      }
      const earned = correct ? q.marks : 0;
      autoScore += earned;
      await this.exams.updateAnswer(answer.id, { auto_score: earned });
    }

    const finalStatus = manualPending ? 'submitted' : 'graded';
    const submittedAt = new Date();
    const updated = await this.exams.updateAttempt(attemptId, {
      submitted_at: submittedAt,
      auto_score: autoScore,
      manual_score: manualPending ? null : 0,
      score: manualPending ? null : autoScore,
      status: finalStatus,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Failed to submit attempt',
        statusCode: 500,
      });
    }
    return { attempt: updated, auto_score: autoScore, manual_pending: manualPending };
  }

  // ===========================================================================
  // Admin — grade a short-text answer
  // ===========================================================================

  async gradeAnswer(
    actor: ScopedActor,
    attemptId: string,
    answerId: string,
    input: GradeAnswerInput,
  ): Promise<{ answer: ExamAnswer; attempt: ExamAttempt }> {
    this.assertCanAdmin(actor);
    const attempt = await this.requireAttempt(attemptId);
    const exam = await this.requireExam(attempt.exam_id);
    this.assertCityScope(actor, exam);

    const answer = await this.exams.findAnswerById(answerId);
    if (!answer || answer.attempt_id !== attemptId) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_ANSWER_NOT_FOUND,
        message: 'Answer not found in this attempt',
        statusCode: 404,
      });
    }
    const question = await this.exams.findQuestionById(answer.question_id);
    if (!question) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_QUESTION_NOT_FOUND,
        message: 'Question vanished',
        statusCode: 500,
      });
    }
    if (input.manual_score < 0 || input.manual_score > question.marks) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: `manual_score must be between 0 and ${question.marks}`,
        statusCode: 422,
      });
    }

    const updatedAnswer = await this.exams.updateAnswer(answerId, {
      manual_score: input.manual_score,
      admin_comment: input.admin_comment ?? null,
      graded_by_user_id: actor.user_id,
    });

    // Recompute the attempt's manual_score + score from ALL graded answers.
    const all = await this.exams.listAnswers(attemptId);
    const auto = all.reduce((s, a) => s + (a.auto_score ?? 0), 0);
    const manual = all.reduce((s, a) => s + (a.manual_score ?? 0), 0);
    const updatedAttempt = await this.exams.updateAttempt(attemptId, {
      auto_score: auto,
      manual_score: manual,
      score: auto + manual,
      status: 'graded',
    });

    return { answer: updatedAnswer!, attempt: updatedAttempt! };
  }

  // ===========================================================================
  // Admin — release results
  // ===========================================================================

  async releaseResults(actor: ScopedActor, examId: string): Promise<ReleaseResultsResult> {
    this.assertCanAdmin(actor);
    const exam = await this.requireExam(examId);
    this.assertCityScope(actor, exam);
    if (exam.results_released) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_RESULTS_ALREADY_RELEASED,
        message: 'Results have already been released',
        statusCode: 409,
      });
    }
    const attempts = await this.exams.listAttemptsForExam(examId);
    // Rank: score DESC, submitted_at ASC. Only graded attempts count.
    const ranked = attempts
      .filter((a) => a.status === 'graded')
      .sort((a, b) => {
        const sa = a.score ?? 0;
        const sb = b.score ?? 0;
        if (sa !== sb) return sb - sa;
        return (a.submitted_at?.getTime() ?? 0) - (b.submitted_at?.getTime() ?? 0);
      });

    let punyaAwards = 0;
    let pushesEnqueued = 0;
    for (let i = 0; i < ranked.length; i += 1) {
      const attempt = ranked[i]!;
      const rank = i + 1;
      const student = await this.students.findById(attempt.student_id);
      if (!student) continue;

      // Completion points for every graded submitter.
      if (exam.completion_points > 0) {
        await this.punya
          .award({
            student_id: student.id,
            feature_key: 'exam_completion',
            points: exam.completion_points,
            reason: `Exam completed: ${exam.title_en}`,
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'exam_attempt',
            source_entity_id: attempt.id,
            idempotency_key: `exam:${exam.id}:completion:${student.id}`,
          })
          .then(() => {
            punyaAwards += 1;
          })
          .catch((err) =>
            this.logger.warn(`exam completion punya failed: ${(err as Error).message}`),
          );
      }
      // Top-3 reward.
      if (rank <= 3 && exam.top_score_points > 0) {
        await this.punya
          .award({
            student_id: student.id,
            feature_key: 'exam_top_score',
            points: exam.top_score_points,
            reason: `Exam top-${rank}: ${exam.title_en}`,
            awarded_by_user_id: actor.user_id,
            source_entity_kind: 'exam_attempt',
            source_entity_id: attempt.id,
            idempotency_key: `exam:${exam.id}:top:${student.id}`,
          })
          .then(() => {
            punyaAwards += 1;
          })
          .catch((err) => this.logger.warn(`exam top punya failed: ${(err as Error).message}`));
      }

      // Push to the parent.
      await this.fanoutQueue
        .add('exam.result_published', {
          event: 'exam.result_published',
          recipient_user_ids: [student.parent_user_id],
          source: { kind: 'online_exam', id: exam.id },
          data: {
            exam_name: exam.title_en,
            exam_name_hi: exam.title_hi,
            score: attempt.score ?? 0,
            total_marks: exam.total_marks,
            rank: exam.show_rank ? rank : null,
            full_name: student.full_name,
          },
          deep_link: `/exams/${exam.id}`,
        })
        .then(() => {
          pushesEnqueued += 1;
        })
        .catch(() => undefined);
    }

    const updated = await this.exams.updateExam(examId, {
      results_released: true,
      updated_by: actor.user_id,
    });
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'approve',
        entity_kind: 'online_exam',
        entity_id: examId,
        after: {
          results_released: true,
          ranked: ranked.length,
          punya_awards: punyaAwards,
        },
      })
      .catch(() => undefined);

    return {
      exam: updated ?? exam,
      ranks_emitted: ranked.length,
      punya_awards: punyaAwards,
      pushes_enqueued: pushesEnqueued,
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async loadQuestionsForAttempt(examId: string): Promise<StartAttemptResult['questions']> {
    const questions = await this.exams.listQuestions(examId);
    const options = await this.exams.listOptionsForQuestions(questions.map((q) => q.id));
    const byQuestion = new Map<string, ExamQuestionOption[]>();
    for (const o of options) {
      const arr = byQuestion.get(o.question_id) ?? [];
      // Strip `is_correct` from the parent payload — clients must not see it.
      arr.push({ ...o, is_correct: false });
      byQuestion.set(o.question_id, arr);
    }
    return questions.map((q) => ({ question: q, options: byQuestion.get(q.id) ?? [] }));
  }

  private async requireExam(id: string): Promise<OnlineExam> {
    const e = await this.exams.findExamById(id);
    if (!e) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_NOT_FOUND,
        message: 'Exam not found',
        statusCode: 404,
      });
    }
    return e;
  }

  private async requireAttempt(id: string): Promise<ExamAttempt> {
    const a = await this.exams.findAttemptById(id);
    if (!a) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXAM_ATTEMPT_NOT_FOUND,
        message: 'Attempt not found',
        statusCode: 404,
      });
    }
    return a;
  }

  private async requireStudent(id: string): Promise<Student> {
    const s = await this.students.findById(id);
    if (!s) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return s;
  }

  private assertCanAdmin(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only city_admin+ can manage exams',
        statusCode: 403,
      });
    }
  }

  private assertCityScope(actor: ScopedActor, exam: OnlineExam): void {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.city_id !== exam.city_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Exam is outside your city',
        statusCode: 403,
      });
    }
  }

  private async assertParentReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Student is not yours',
      statusCode: 403,
    });
  }

  private async assertParentCanReachAttempt(
    actor: ScopedActor,
    attempt: ExamAttempt,
  ): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    const student = await this.requireStudent(attempt.student_id);
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents/student-view can write answers',
        statusCode: 403,
      });
    }
    if (student.parent_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Attempt is not yours',
        statusCode: 403,
      });
    }
  }

  /** Crypto-safe enough for a 6-digit class OTP (manual verbal distribution). */
  private randomNumericOtp(len: number): string {
    let s = '';
    for (let i = 0; i < len; i += 1) {
      s += Math.floor(Math.random() * 10).toString();
    }
    return s;
  }
}
