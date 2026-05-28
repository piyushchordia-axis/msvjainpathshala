/**
 * Curriculum admin API wrappers (web admin) — Step 19.
 */

import { authenticatedServerClient } from './server-client';

export type CurriculumKind = 'standard' | 'msv';
export type CurriculumLevel = 'not_started' | 'in_progress' | 'completed' | 'mastered';

export interface CurriculumRow {
  id: string;
  city_id: string | null;
  kind: CurriculumKind;
  name: string;
  academic_year: string | null;
  status: string | null;
}

export interface CurriculumSectionRow {
  id: string;
  curriculum_id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
}

export interface CurriculumItemRow {
  id: string;
  section_id: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  order_index: number;
}

export interface CurriculumTree {
  curriculum: CurriculumRow;
  sections: Array<{
    id: string;
    title_en: string;
    title_hi: string;
    order_index: number;
    items: Array<{
      id: string;
      title_en: string;
      title_hi: string;
      description_en: string | null;
      description_hi: string | null;
      order_index: number;
    }>;
  }>;
}

export async function listAdminCurricula(opts: { kind?: CurriculumKind } = {}): Promise<{
  items: CurriculumRow[];
}> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/curricula', { params: opts });
  return res.data.data as { items: CurriculumRow[] };
}

export async function createCurriculum(input: {
  kind: CurriculumKind;
  name: string;
  academic_year?: string;
  template_id?: string;
  status?: 'draft' | 'active' | 'archived';
}): Promise<CurriculumRow> {
  const client = await authenticatedServerClient();
  const res = await client.post('/v1/admin/curricula', input);
  return res.data.data as CurriculumRow;
}

export async function setCurriculumStatus(
  id: string,
  status: 'draft' | 'active' | 'archived',
): Promise<CurriculumRow> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/curricula/${id}/status`, { status });
  return res.data.data as CurriculumRow;
}

export async function getCurriculumTree(id: string): Promise<CurriculumTree> {
  const client = await authenticatedServerClient();
  const res = await client.get(`/v1/admin/curricula/${id}/tree`);
  return res.data.data as CurriculumTree;
}

export async function addSection(
  curriculumId: string,
  input: { title_en: string; title_hi: string; order_index: number },
): Promise<CurriculumSectionRow> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/curricula/${curriculumId}/sections`, input);
  return res.data.data as CurriculumSectionRow;
}

export async function addItem(
  curriculumId: string,
  input: {
    section_id: string;
    title_en: string;
    title_hi: string;
    description_en?: string;
    description_hi?: string;
    order_index: number;
  },
): Promise<CurriculumItemRow> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/curricula/${curriculumId}/items`, input);
  return res.data.data as CurriculumItemRow;
}

export async function assignCurriculum(
  curriculumId: string,
  input: { centre_id?: string; batch_id?: string },
): Promise<{
  id: string;
  curriculum_id: string;
  batch_id: string | null;
  centre_id: string | null;
}> {
  const client = await authenticatedServerClient();
  const res = await client.post(`/v1/admin/curricula/${curriculumId}/assign`, input);
  return res.data.data;
}
