/**
 * Quiz question draft → API payload.
 *
 * Extracted from QuizzesPage so the index mapping can be tested without
 * mounting the editor. It is pure on purpose: the bug it exists to prevent
 * (C2) was invisible in the UI and only showed up as children being graded
 * against the wrong option weeks later.
 */

export interface QuizDraftOption {
  text_en: string;
  text_hi?: string;
}

export interface DraftQ {
  question_en: string;
  question_hi?: string;
  options: QuizDraftOption[];
  correct: boolean[];
}

export interface QuizQuestionPayload {
  question_en: string;
  question_hi?: string;
  options: QuizDraftOption[];
  correct_indices: number[];
}

export function emptyDraftQ(): DraftQ {
  return { question_en: '', options: [{ text_en: '' }, { text_en: '' }], correct: [false, false] };
}

/**
 * C2 — correct_indices must index the array we actually SEND.
 *
 * This used to filter blanks out of `options` while deriving `correct_indices`
 * from the UNFILTERED draft, so one blank option above a ticked one shifted the
 * answer key downward: ticking option 2 of [blank, Ahimsa, Satya] sent
 * options=[Ahimsa, Satya] with correct_indices=[1] — pointing at Satya. It
 * passed the local validation and passed the server's range check (1 < 2), and
 * every student who picked Ahimsa was graded wrong and lost the win bonus.
 *
 * Indices are now mapped through the kept array, so they cannot drift from the
 * options they label.
 */
export function draftToPayload(d: DraftQ): QuizQuestionPayload {
  const kept = d.options.map((o, i) => ({ o, i })).filter(({ o }) => o.text_en.trim());
  const options: QuizDraftOption[] = kept.map(({ o }) => ({
    text_en: o.text_en.trim(),
    ...(o.text_hi?.trim() ? { text_hi: o.text_hi.trim() } : {}),
  }));
  // Position within `kept` is the index the server will see.
  const correct_indices = kept
    .map(({ i }, newIndex) => (d.correct[i] ? newIndex : -1))
    .filter((i) => i >= 0);

  return {
    question_en: d.question_en.trim(),
    ...(d.question_hi?.trim() ? { question_hi: d.question_hi.trim() } : {}),
    options,
    correct_indices,
  };
}

/**
 * A blank-but-present option is REJECTED rather than silently dropped. The
 * silent drop is what made C2 invisible: the admin saw the row they had typed
 * around, and nothing said it would not be sent.
 */
export function validateDraft(d: DraftQ): string | null {
  if (!d.question_en.trim()) return 'Question text is required.';
  const blankIndex = d.options.findIndex((o) => !o.text_en.trim());
  if (blankIndex >= 0) {
    return `Option ${blankIndex + 1} is empty — fill it in or remove it.`;
  }
  if (d.options.length < 2) return 'At least two options are required.';
  if (draftToPayload(d).correct_indices.length < 1) return 'Mark at least one correct option.';
  return null;
}
