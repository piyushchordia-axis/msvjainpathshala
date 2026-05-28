/** Exam DTOs (SPEC §5.14, §6.17, §8.9 — exam OTP access control). */

import { z } from 'zod';

import { EXAM_QUESTION_TYPES } from '../enums/exam.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

export const examCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('instructions', { max: 4000 }))
  .merge(
    z.object({
      batch_id: uuid,
      starts_at: isoDatetime,
      ends_at: isoDatetime,
      duration_minutes: z.number().int().min(1).max(600),
      /** OTP-gated start (SPEC §8.9). */
      requires_otp: z.boolean().default(true),
    }),
  );
export type ExamCreateDto = z.infer<typeof examCreateSchema>;

export const examSchema = examCreateSchema.merge(
  z.object({
    id: uuid,
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type ExamDto = z.infer<typeof examSchema>;

const optionSchema = z.object({
  id: z.string().min(1),
  text_en: z.string().min(1),
  text_hi: z.string().min(1),
  is_correct: z.boolean().optional(),
});

export const examQuestionCreateSchema = bilingualText('prompt', { max: 2000 }).merge(
  z.object({
    exam_id: uuid,
    type: z.enum(EXAM_QUESTION_TYPES),
    points: z.number().int().min(1).max(50),
    options: z.array(optionSchema).optional(),
    image_asset_id: uuid.optional(),
  }),
);
export type ExamQuestionCreateDto = z.infer<typeof examQuestionCreateSchema>;

export const examStartSchema = z.object({
  exam_id: uuid,
  /** Per-student per-attempt OTP issued by shikshak just before start. */
  otp: z.string().length(6).regex(/^\d+$/),
});
export type ExamStartDto = z.infer<typeof examStartSchema>;

export const examAnswerSchema = z.object({
  question_id: uuid,
  /** Shape varies by question type — array of option ids OR free text. */
  value: z.union([z.array(z.string()), z.string()]),
});

export const examSubmitSchema = z.object({
  exam_id: uuid,
  attempt_id: uuid,
  answers: z.array(examAnswerSchema).min(1),
});
export type ExamSubmitDto = z.infer<typeof examSubmitSchema>;
