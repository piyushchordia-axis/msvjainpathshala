/**
 * H2 — "use the standard" must be sendable.
 *
 * The dialogs sent `Number(x) || 0`, so clearing a points field to mean "use
 * the punya_features default" produced 0 — which the API reads as DISABLED.
 * Every quiz authored on the web was permanently opted out of AT21, and no
 * amount of catalogue configuration could reach it.
 */
import { describe, expect, it } from 'vitest';
import {
  PUSH_QUIZ_COMPLETION_FEATURE_KEY,
  QUIZ_PARTICIPATION_FEATURE_KEY,
  QUIZ_WIN_FEATURE_KEY,
  formatPointsOverride,
  pointsPayloadValue,
  pointsPlaceholder,
  resolveQuizPointFeatures,
  validatePointsField,
} from '@/pages/admin/quiz-points';

const FEATURES = [
  { key: QUIZ_PARTICIPATION_FEATURE_KEY, min_points: 0, max_points: 5, default_points: 5 },
  { key: QUIZ_WIN_FEATURE_KEY, min_points: 0, max_points: 25, default_points: 25 },
  { key: PUSH_QUIZ_COMPLETION_FEATURE_KEY, min_points: 0, max_points: 5, default_points: 5 },
];

describe('pointsPayloadValue — blank means default, not zero (H2)', () => {
  it('omits the key for a blank or whitespace field', () => {
    // undefined => the caller drops the key => the server stores NULL.
    expect(pointsPayloadValue('')).toBeUndefined();
    expect(pointsPayloadValue('   ')).toBeUndefined();
  });

  it('keeps an explicit 0, which genuinely means disabled', () => {
    expect(pointsPayloadValue('0')).toBe(0);
  });

  it('passes a typed number through', () => {
    expect(pointsPayloadValue('12')).toBe(12);
    expect(pointsPayloadValue(' 7 ')).toBe(7);
  });

  it('omits the key for junk rather than sending NaN', () => {
    expect(pointsPayloadValue('abc')).toBeUndefined();
  });
});

describe('resolveQuizPointFeatures — what a blank field will actually pay', () => {
  it('prefers the active global config over the catalogue default', () => {
    const resolved = resolveQuizPointFeatures(FEATURES, [
      { feature_key: QUIZ_WIN_FEATURE_KEY, points: 20, is_active: true, city_id: null },
    ]);
    expect(resolved[QUIZ_WIN_FEATURE_KEY]?.defaultPoints).toBe(20);
    expect(resolved[QUIZ_WIN_FEATURE_KEY]?.maxPoints).toBe(25);
  });

  it('ignores a city override — points resolve per STUDENT city at award time', () => {
    const resolved = resolveQuizPointFeatures(FEATURES, [
      { feature_key: QUIZ_WIN_FEATURE_KEY, points: 3, is_active: true, city_id: 'some-city' },
    ]);
    // One event can span many cities, so no single city's number is correct
    // for the whole roster; the global row is what an admin can reason about.
    expect(resolved[QUIZ_WIN_FEATURE_KEY]?.defaultPoints).toBe(25);
  });

  it('ignores an inactive global config', () => {
    const resolved = resolveQuizPointFeatures(FEATURES, [
      { feature_key: QUIZ_WIN_FEATURE_KEY, points: 1, is_active: false, city_id: null },
    ]);
    expect(resolved[QUIZ_WIN_FEATURE_KEY]?.defaultPoints).toBe(25);
  });

  it('falls back to zeroes when the catalogue is unavailable', () => {
    const resolved = resolveQuizPointFeatures([], []);
    expect(resolved[QUIZ_PARTICIPATION_FEATURE_KEY]).toEqual({
      defaultPoints: 0,
      minPoints: 0,
      maxPoints: 0,
    });
  });
});

describe('validatePointsField — mirrors the API bounds (H1/M16)', () => {
  const resolved = resolveQuizPointFeatures(FEATURES, []);
  const participation = resolved[QUIZ_PARTICIPATION_FEATURE_KEY];

  it('accepts blank and 0', () => {
    expect(validatePointsField('', 'Participation points', participation)).toBeNull();
    expect(validatePointsField('0', 'Participation points', participation)).toBeNull();
  });

  it('accepts a value at the ceiling', () => {
    expect(validatePointsField('5', 'Participation points', participation)).toBeNull();
  });

  it('names the ceiling rather than leaving an opaque 422', () => {
    expect(validatePointsField('6', 'Participation points', participation)).toBe(
      'Participation points must be at most 5.',
    );
    expect(validatePointsField('10000', 'Win points', resolved[QUIZ_WIN_FEATURE_KEY])).toBe(
      'Win points must be at most 25.',
    );
  });

  it('rejects negatives and non-integers', () => {
    expect(validatePointsField('-1', 'Win points', resolved[QUIZ_WIN_FEATURE_KEY])).toBe(
      'Win points cannot be negative.',
    );
    expect(validatePointsField('2.5', 'Win points', resolved[QUIZ_WIN_FEATURE_KEY])).toBe(
      'Win points must be a whole number.',
    );
  });

  it('defers to the API when the catalogue could not be loaded', () => {
    expect(validatePointsField('9999', 'Win points', undefined)).toBeNull();
  });
});

describe('display helpers', () => {
  it('names the default in the placeholder', () => {
    const resolved = resolveQuizPointFeatures(FEATURES, []);
    expect(pointsPlaceholder(resolved[QUIZ_PARTICIPATION_FEATURE_KEY])).toBe('Default (5)');
    expect(pointsPlaceholder(undefined)).toBe('Default');
  });

  it('distinguishes a null override from a disabled one', () => {
    // These rendered identically as "—" before, so an admin could not tell
    // "pays the standard" from "pays nothing".
    expect(formatPointsOverride(null)).toBe('Default');
    expect(formatPointsOverride(0)).toBe('Disabled');
    expect(formatPointsOverride(12)).toBe('12');
  });
});
