/**
 * Shared types for the curriculum module (SPEC §5.13, §6.16).
 */

import type { CurriculumKind } from '../../db/repositories/curriculum.repository';
import type {
  Curriculum,
  CurriculumItem,
  CurriculumSection,
  StudentCurriculumProgress,
} from '../../db/schema';
import type { CurriculumLevel } from '@jp/shared';

export type { CurriculumKind };

export interface CreateCurriculumInput {
  kind: CurriculumKind;
  name: string;
  academic_year?: string | null;
  template_id?: string | null;
  /** Optional — defaults to 'draft'; admins flip to 'active' explicitly. */
  status?: string;
}

export interface CreateSectionInput {
  title_en: string;
  title_hi: string;
  order_index: number;
}

export interface CreateItemInput {
  section_id: string;
  title_en: string;
  title_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  order_index: number;
}

export interface AssignCurriculumInput {
  centre_id?: string | null;
  batch_id?: string | null;
}

export interface UpsertProgressInput {
  item_id: string;
  level: CurriculumLevel;
  note?: string | null;
}

export interface CurriculumTreeItem {
  id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  order_index: number;
}

export interface CurriculumTreeSection {
  id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
  items: CurriculumTreeItem[];
}

export interface CurriculumTree {
  curriculum: Curriculum;
  sections: CurriculumTreeSection[];
}

export interface CurriculumProgressItem {
  item: CurriculumItem;
  progress: StudentCurriculumProgress | null;
}

export interface CurriculumProgressSection {
  section: CurriculumSection;
  items: CurriculumProgressItem[];
}

export interface StudentProgressResponse {
  curriculum: Curriculum;
  sections: CurriculumProgressSection[];
  /** Aggregate: count of items at each level. */
  totals: {
    not_started: number;
    in_progress: number;
    completed: number;
    mastered: number;
    items: number;
  };
}
