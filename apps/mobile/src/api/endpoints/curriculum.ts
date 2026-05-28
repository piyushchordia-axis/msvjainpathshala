/**
 * Curriculum endpoint wrappers — Step 19.
 *
 * Parent / student-view read paths land here; shikshak progress writes use
 * the admin POST endpoint via the same client.
 */

import { api, unwrap } from '../client';

export type CurriculumLevel = 'not_started' | 'in_progress' | 'completed' | 'mastered';
export type CurriculumKind = 'standard' | 'msv';

export interface CurriculumDto {
  id: string;
  city_id: string | null;
  kind: CurriculumKind;
  name: string;
  academic_year: string | null;
  status: string | null;
}

export interface CurriculumItemDto {
  id: string;
  section_id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  order_index: number;
}

export interface CurriculumSectionDto {
  id: string;
  curriculum_id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
}

export interface ProgressDto {
  id: string;
  student_id: string;
  curriculum_item_id: string;
  level: CurriculumLevel;
  note: string | null;
  updated_at: string;
}

export interface ProgressItemDto {
  item: CurriculumItemDto;
  progress: ProgressDto | null;
}

export interface ProgressSectionDto {
  section: CurriculumSectionDto;
  items: ProgressItemDto[];
}

export interface StudentProgressResponseDto {
  curriculum: CurriculumDto;
  sections: ProgressSectionDto[];
  totals: {
    not_started: number;
    in_progress: number;
    completed: number;
    mastered: number;
    items: number;
  };
}

export const curriculumApi = {
  async listForAdmin(opts: { kind?: CurriculumKind } = {}): Promise<{ items: CurriculumDto[] }> {
    return unwrap<{ items: CurriculumDto[] }>(api.get('/v1/admin/curricula', { params: opts }));
  },

  async studentProgress(
    studentId: string,
    curriculumId: string,
  ): Promise<StudentProgressResponseDto> {
    return unwrap<StudentProgressResponseDto>(
      api.get(`/v1/students/${studentId}/curriculum-progress`, {
        params: { curriculum_id: curriculumId },
      }),
    );
  },
};
