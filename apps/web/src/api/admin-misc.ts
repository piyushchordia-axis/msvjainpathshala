/**
 * Misc admin API wrappers — Step 24 (pages added late).
 *
 * Covers: students list, centres list, library, queues stats, platform
 * settings. Used by the corresponding admin pages.
 */

import { authenticatedServerClient } from './server-client';

// ---------------------------------------------------------------------------
// Students
// ---------------------------------------------------------------------------

export interface AdminStudentRow {
  id: string;
  parent_user_id: string;
  full_name: string;
  father_name: string | null;
  dob: string;
  age_group: string;
  centre_id: string | null;
  batch_id: string | null;
  student_code: string;
  msv_status: string;
  status: string;
  enrolled_at: string;
}

export async function listAdminStudents(
  opts: {
    centre_id?: string;
    batch_id?: string;
    status?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<{ items: AdminStudentRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/students', {
    params: { limit: opts.limit ?? 50, ...opts },
  });
  return res.data.data as { items: AdminStudentRow[] };
}

// ---------------------------------------------------------------------------
// Centres
// ---------------------------------------------------------------------------

export interface CentreRow {
  id: string;
  city_id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  pincode: string | null;
  gps_radius_m: number;
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
  academic_year: string | null;
}

export async function listAdminCentres(): Promise<{ items: CentreRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/centres');
  return res.data.data as { items: CentreRow[] };
}

// ---------------------------------------------------------------------------
// Batches (centre-scoped)
// ---------------------------------------------------------------------------

interface RawBatchRow {
  id: string;
  centre_id: string;
  name: string;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  age_group: string;
  shikshak_id: string | null;
  academic_year: string | null;
  status: string;
  capacity: number;
}

export interface AdminBatchRow {
  id: string;
  name: string;
  centre_id: string;
  centre_name: string;
  age_group: string;
  shikshak_id: string | null;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  status: string;
}

/**
 * List batches across the actor's centres. We fetch the in-scope centres,
 * then their batches (capped to the first few centres so the page stays
 * snappy). Batch authoring still lives in the mobile sanchalak flow.
 */
export async function listAdminBatches(
  opts: { maxCentres?: number } = {},
): Promise<{ items: AdminBatchRow[] }> {
  const client = await authenticatedServerClient();
  const centresRes = await client.get('/v1/centres');
  const centres = (centresRes.data.data as { items: CentreRow[] }).items;
  const maxCentres = opts.maxCentres ?? 8;
  const targets = centres.slice(0, maxCentres);

  const nameByCentre = new Map(centres.map((c) => [c.id, c.name]));
  const items: AdminBatchRow[] = [];
  for (const centre of targets) {
    const res = await client.get(`/v1/centres/${centre.id}/batches`);
    const rows = (res.data.data as { items: RawBatchRow[] }).items;
    for (const b of rows) {
      items.push({
        id: b.id,
        name: b.name,
        centre_id: b.centre_id,
        centre_name: nameByCentre.get(b.centre_id) ?? centre.name,
        age_group: b.age_group,
        shikshak_id: b.shikshak_id,
        day_of_week: b.day_of_week ?? [],
        start_time: b.start_time,
        end_time: b.end_time,
        status: b.status,
      });
    }
  }
  return { items };
}

// ---------------------------------------------------------------------------
// Shikshaks (Guruji / Didi roster)
// ---------------------------------------------------------------------------

export interface AdminShikshakRow {
  id: string;
  full_name: string;
  phone: string;
  gender: string | null;
  centre_id_default: string | null;
}

export async function listAdminShikshaks(): Promise<{ items: AdminShikshakRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/shikshaks');
  return res.data.data as { items: AdminShikshakRow[] };
}

// ---------------------------------------------------------------------------
// Audit logs (append-only, read-only)
// ---------------------------------------------------------------------------

export interface AuditLogRow {
  id: string;
  actor_user_id: string;
  actor_role: string;
  action: string;
  entity_kind: string;
  entity_id: string;
  ip: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: string;
}

export async function listAuditLogs(
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: AuditLogRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/audit-logs', {
    params: { limit: opts.limit ?? 100, ...(opts.offset ? { offset: opts.offset } : {}) },
  });
  return res.data.data as { items: AuditLogRow[] };
}

// ---------------------------------------------------------------------------
// Reports (parent-released progress reports for the actor)
// ---------------------------------------------------------------------------

export interface ReportRow {
  id: string;
  student_id: string;
  period_kind: string;
  period_label: string;
  generated_at: string | null;
  released_to_parent: boolean;
  released_at: string | null;
  pdf_asset_id: string | null;
}

export async function listMyReports(): Promise<{ items: ReportRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/reports/me');
  return res.data.data as { items: ReportRow[] };
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

export interface LibraryRow {
  id: string;
  content_type: string;
  title_en: string;
  title_hi: string;
  description_en: string | null;
  description_hi: string | null;
  embed_url: string | null;
  asset_id: string | null;
  tags: string[];
  age_groups: string[];
  languages: string[];
  access_tier: string;
  msv_only: boolean;
  created_at: string;
}

export async function listAdminLibrary(opts: { limit?: number } = {}): Promise<{
  items: LibraryRow[];
}> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/library', { params: { limit: opts.limit ?? 50 } });
  return res.data.data as { items: LibraryRow[] };
}

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export interface QueueStat {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  completed: number;
  failed: number;
  dlq_size: number;
}

export async function getQueueStats(): Promise<{ queues: QueueStat[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/queues/stats');
  return res.data.data as { queues: QueueStat[] };
}

// ---------------------------------------------------------------------------
// Platform settings
// ---------------------------------------------------------------------------

export interface PlatformSettings {
  id: string;
  eighty_g_enabled: boolean;
  eighty_g_registration_number: string | null;
  eighty_g_trust_name: string | null;
  eighty_g_trust_address: string | null;
  eighty_g_section: string;
  last_updated_at: string;
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/platform-settings');
  return res.data.data as PlatformSettings;
}

// ---------------------------------------------------------------------------
// Quiz events (scheduled quizzes)
// ---------------------------------------------------------------------------

export interface QuizEventRow {
  id: string;
  title: string;
  audience_kind: string;
  status: string;
  starts_at: string;
  duration_minutes: number;
  question_ids: string[];
  created_at: string;
}

export async function listQuizEvents(): Promise<{ items: QuizEventRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/quiz-events');
  return res.data.data as { items: QuizEventRow[] };
}

export interface QuizQuestionRow {
  id: string;
  stem: string;
  options: string[];
  correct_index: number;
  language: string;
  age_groups: string[] | null;
  difficulty: number | null;
}

/** Approved questions available to compose a quiz event from (city_admin+). */
export async function listAdminQuestions(): Promise<{ items: QuizQuestionRow[] }> {
  const client = await authenticatedServerClient();
  const res = await client.get('/v1/admin/questions');
  return res.data.data as { items: QuizQuestionRow[] };
}
