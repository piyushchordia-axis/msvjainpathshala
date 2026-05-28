/**
 * Cached curriculum lookups (chapters / topics). Key = curriculum_id.
 * Full schema lands in Step 14 (Curriculum + Punya).
 */

import { CacheStore } from './_cache-base';

export interface CurriculumSnapshot {
  id: string;
  title_en: string;
  title_hi: string;
  kind: 'standard' | 'msv';
  chapters: Array<{ id: string; title_en: string; title_hi: string }>;
}

export const curriculumCache = new CacheStore<CurriculumSnapshot>('jp.cache.curriculum');
