/**
 * Cached student snapshots keyed by student_id. Used for attendance roster
 * rendering, ID-card preview, child selector. Full schema lands in
 * Step 10 (Enrolment).
 */

import { CacheStore } from './_cache-base';

export interface StudentSnapshot {
  id: string;
  full_name: string;
  dob: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  parent_user_id: string;
  msv_flag: boolean;
  active: boolean;
}

export const studentsCache = new CacheStore<StudentSnapshot>('jp.cache.students');
