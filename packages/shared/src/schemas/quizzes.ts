/** Push-quiz DTOs (SPEC §5.14, §6.18). Realtime via Socket.IO `/push-quizzes`. */

import { z } from 'zod';

import { QUIZ_SCOPES } from '../enums/exam.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

export const quizCreateSchema = bilingualText('question', { max: 2000 }).merge(
  z.object({
    scope: z.enum(QUIZ_SCOPES),
    scope_id: uuid.nullable().optional(),
    options: z
      .array(
        z.object({
          id: z.string().min(1),
          text_en: z.string().min(1),
          text_hi: z.string().min(1),
        }),
      )
      .min(2)
      .max(6),
    correct_option_id: z.string().min(1),
    /** Duration the quiz is open after broadcast. */
    duration_seconds: z.number().int().min(10).max(600),
    punya_reward: z.number().int().min(0).max(100).default(5),
  }),
);
export type QuizCreateDto = z.infer<typeof quizCreateSchema>;

export const quizSchema = quizCreateSchema.merge(
  z.object({
    id: uuid,
    expires_at: isoDatetime,
    created_at: isoDatetime,
  }),
);
export type QuizDto = z.infer<typeof quizSchema>;

export const quizAnswerSchema = z.object({
  quiz_id: uuid,
  student_id: uuid,
  selected_option_id: z.string().min(1),
  client_timestamp: isoDatetime,
});
export type QuizAnswerDto = z.infer<typeof quizAnswerSchema>;
