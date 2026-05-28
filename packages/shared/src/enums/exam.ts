/** `exam_question_type_enum`, `quiz_scope_enum` (SPEC §5.1). */

export const EXAM_QUESTION_TYPES = [
  'mcq_single',
  'mcq_multi',
  'true_false',
  'short_text',
  'image_based',
] as const;
export type ExamQuestionType = (typeof EXAM_QUESTION_TYPES)[number];

export const QUIZ_SCOPES = ['national', 'state', 'city', 'centre', 'batch'] as const;
export type QuizScope = (typeof QUIZ_SCOPES)[number];
