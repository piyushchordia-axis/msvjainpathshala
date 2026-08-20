/**
 * C2 — a blank option must not shift the stored answer key.
 *
 * The option editor filtered blanks out of the payload but derived
 * correct_indices from the unfiltered draft. Nothing in the UI showed it: the
 * form validated, the API's range check passed, and the corruption only
 * surfaced as children being graded against the wrong option.
 *
 * Every case below asserts the OPTION TEXT the indices resolve to, not the
 * indices themselves — an index assertion would have passed against the bug.
 */
import { describe, expect, it } from 'vitest';
import { draftToPayload, emptyDraftQ, validateDraft, type DraftQ } from '@/pages/admin/quiz-draft';

/** What a child is actually graded against. */
function markedAnswers(d: DraftQ): string[] {
  const p = draftToPayload(d);
  return p.correct_indices.map((i) => p.options[i]?.text_en ?? `<out of range: ${i}>`);
}

function draft(options: string[], correctIndexes: number[]): DraftQ {
  return {
    question_en: 'Which vow is non-violence?',
    options: options.map((text_en) => ({ text_en })),
    correct: options.map((_, i) => correctIndexes.includes(i)),
  };
}

describe('draftToPayload — answer key integrity (C2)', () => {
  it('keeps the ticked option when a blank sits ABOVE it', () => {
    // The exact review case: tick option 2 of [blank, Ahimsa, Satya].
    const d = draft(['', 'Ahimsa', 'Satya'], [1]);
    const p = draftToPayload(d);

    expect(p.options.map((o) => o.text_en)).toEqual(['Ahimsa', 'Satya']);
    // Pre-fix this sent correct_indices=[1] — pointing at Satya.
    expect(markedAnswers(d)).toEqual(['Ahimsa']);
    expect(p.correct_indices).toEqual([0]);
  });

  it('keeps the ticked option when several blanks sit above it', () => {
    const d = draft(['', '', 'Ahimsa', 'Satya'], [3]);
    expect(markedAnswers(d)).toEqual(['Satya']);
  });

  it('is unaffected by a blank BELOW the ticked option', () => {
    const d = draft(['Ahimsa', 'Satya', ''], [0]);
    expect(markedAnswers(d)).toEqual(['Ahimsa']);
  });

  it('preserves every answer in a multi-select key across a blank', () => {
    const d = draft(['', 'Ahimsa', 'Satya', 'Asteya'], [1, 3]);
    expect(markedAnswers(d)).toEqual(['Ahimsa', 'Asteya']);
    expect(draftToPayload(d).correct_indices).toEqual([0, 2]);
  });

  it('drops a tick that belongs to a blank option', () => {
    const d = draft(['', 'Ahimsa', 'Satya'], [0, 2]);
    expect(markedAnswers(d)).toEqual(['Satya']);
  });

  it('trims option text and never emits an out-of-range index', () => {
    const d = draft(['  Ahimsa  ', '  Satya  '], [1]);
    const p = draftToPayload(d);
    expect(p.options.map((o) => o.text_en)).toEqual(['Ahimsa', 'Satya']);
    for (const i of p.correct_indices) {
      expect(i).toBeLessThan(p.options.length);
      expect(i).toBeGreaterThanOrEqual(0);
    }
  });

  it('round-trips Hindi option text and omits it when blank (H4/L9)', () => {
    const d: DraftQ = {
      question_en: 'Which vow is non-violence?',
      question_hi: 'कौन सा व्रत अहिंसा है?',
      options: [
        { text_en: 'Ahimsa', text_hi: 'अहिंसा' },
        { text_en: 'Satya', text_hi: '   ' },
      ],
      correct: [true, false],
    };
    const p = draftToPayload(d);
    expect(p.question_hi).toBe('कौन सा व्रत अहिंसा है?');
    expect(p.options[0]).toEqual({ text_en: 'Ahimsa', text_hi: 'अहिंसा' });
    // Whitespace-only Hindi is omitted, so `text_hi ?? text_en` still fires.
    expect(p.options[1]).toEqual({ text_en: 'Satya' });
  });
});

describe('validateDraft — blanks are refused, not dropped (C2)', () => {
  it('names the empty option rather than silently discarding it', () => {
    expect(validateDraft(draft(['', 'Ahimsa', 'Satya'], [1]))).toBe(
      'Option 1 is empty — fill it in or remove it.',
    );
    expect(validateDraft(draft(['Ahimsa', '   ', 'Satya'], [0]))).toBe(
      'Option 2 is empty — fill it in or remove it.',
    );
  });

  it('still requires question text, two options and one correct answer', () => {
    expect(validateDraft(emptyDraftQ())).toBe('Question text is required.');
    expect(validateDraft(draft(['Ahimsa', 'Satya'], []))).toBe('Mark at least one correct option.');
  });

  it('accepts a well-formed draft', () => {
    expect(validateDraft(draft(['Ahimsa', 'Satya'], [0]))).toBeNull();
  });
});
