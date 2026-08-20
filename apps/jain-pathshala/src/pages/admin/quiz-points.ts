/**
 * H2 — the point fields must be able to say "use the standard".
 *
 * The dialogs defaulted to inlined '5' / '10' / '5' with no relationship to
 * punya_features, and sent `Number(x) || 0`. So `null` could never be sent, and
 * clearing the field to mean "use the standard" silently produced 0 — which the
 * API reads as DISABLED. Every quiz authored on the web was therefore
 * permanently opted out of AT21.
 *
 * H1/M16 — the same catalogue rows carry the min/max the API now enforces, so
 * the form can refuse an out-of-range number instead of surfacing an opaque 422.
 *
 * Both endpoints already exist; nothing new is added server-side.
 */
import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api-client';

export const QUIZ_PARTICIPATION_FEATURE_KEY = 'quiz_participation';
export const QUIZ_WIN_FEATURE_KEY = 'quiz_win';
export const PUSH_QUIZ_COMPLETION_FEATURE_KEY = 'push_quiz_completion';

export interface QuizPointFeature {
  /** What a null override will actually pay. */
  defaultPoints: number;
  minPoints: number;
  maxPoints: number;
}

export type QuizPointFeatures = Record<string, QuizPointFeature>;

interface PunyaFeatureRow {
  key: string;
  min_points: number;
  max_points: number;
  default_points: number | null;
}
interface PunyaConfigRow {
  feature_key: string;
  points: number;
  is_active: boolean;
  city_id: string | null;
}

/**
 * The GLOBAL default, deliberately. Points resolve against the STUDENT's city
 * at award time, and one event can span many cities, so no single number is
 * correct for the whole roster — the global row is the one an admin can reason
 * about, and it is what a city with no override of its own will pay.
 */
export function resolveQuizPointFeatures(
  features: PunyaFeatureRow[],
  configs: PunyaConfigRow[],
): QuizPointFeatures {
  const out: QuizPointFeatures = {};
  for (const key of [
    QUIZ_PARTICIPATION_FEATURE_KEY,
    QUIZ_WIN_FEATURE_KEY,
    PUSH_QUIZ_COMPLETION_FEATURE_KEY,
  ]) {
    const feature = features.find((f) => f.key === key);
    const globalConfig = configs.find((c) => c.feature_key === key && c.city_id === null && c.is_active);
    const defaultPoints = globalConfig?.points ?? feature?.default_points ?? feature?.max_points ?? 0;
    out[key] = {
      defaultPoints,
      minPoints: feature?.min_points ?? 0,
      maxPoints: feature?.max_points ?? 0,
    };
  }
  return out;
}

/** Fetch the catalogue once a dialog opens. Failure degrades to "no hint". */
export function useQuizPointFeatures(open: boolean): QuizPointFeatures | null {
  const [data, setData] = useState<QuizPointFeatures | null>(null);

  useEffect(() => {
    if (!open || data) return;
    let cancelled = false;
    void Promise.all([
      apiGet<{ items: PunyaFeatureRow[] }>('/v1/admin/punya/features'),
      apiGet<{ items: PunyaConfigRow[] }>('/v1/admin/punya/configs'),
    ])
      .then(([f, c]) => {
        if (cancelled) return;
        setData(resolveQuizPointFeatures(f?.items ?? [], c?.items ?? []));
      })
      // A missing hint is a worse form, not a broken one — the API still
      // validates, so never block authoring on this.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, data]);

  return data;
}

/**
 * Field text → API value.
 *
 * '' (or whitespace) → `undefined`, so the key is OMITTED from the payload and
 * the server stores NULL = "use the catalogue default". This is the whole point
 * of H2: `Number('') || 0` used to turn "use the standard" into "disabled".
 */
export function pointsPayloadValue(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** Client-side mirror of the API's catalogue bounds (M16). Null when acceptable. */
export function validatePointsField(
  raw: string,
  label: string,
  feature: QuizPointFeature | undefined,
): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null; // "use the default"
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return `${label} must be a whole number.`;
  if (n < 0) return `${label} cannot be negative.`;
  if (n === 0) return null; // deliberately disabled
  if (!feature) return null; // catalogue unavailable — let the API decide
  if (feature.minPoints > 0 && n < feature.minPoints) {
    return `${label} must be at least ${feature.minPoints}, or 0 to disable.`;
  }
  if (feature.maxPoints > 0 && n > feature.maxPoints) {
    return `${label} must be at most ${feature.maxPoints}.`;
  }
  return null;
}

/** Placeholder that names what an empty field will actually pay. */
export function pointsPlaceholder(feature: QuizPointFeature | undefined): string {
  return feature ? `Default (${feature.defaultPoints})` : 'Default';
}

/** How a stored override reads on a card: null is the default, 0 is off. */
export function formatPointsOverride(value: number | null): string {
  if (value === null) return 'Default';
  if (value === 0) return 'Disabled';
  return String(value);
}
