/**
 * React Query data layer. Every endpoint the personas consume lives here so
 * screens stay declarative and cache keys never drift. All hooks return the
 * unwrapped DTO (lib/api.ts strips the { data } envelope).
 */
import { Alert } from "react-native";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiGetEnvelope, ApiError } from "@/lib/api";
import type {
  AdminBatchRow,
  AdminStudentRow,
  AttendanceRow,
  CentreDetail,
  CentreRow,
  ChildRow,
  EnrolmentRow,
  ListResponse,
  NiyamCatalogRow,
  NiyamSubmissionRow,
  NoticeItem,
  OverviewPayload,
  PublicBatchRow,
  PublicGalleryItem,
  PublicLibraryItem,
  PunyaSummary,
  ShikshakSessionRow,
  ShivirDetail,
  ShivirRow,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth";
import { galleryHomeKey, galleryWallKey } from "@/lib/gallery-query-keys";

type List<T> = ListResponse<T>;

export const qk = {
  centres: ["public", "centres"] as const,
  centre: (id: string) => ["public", "centre", id] as const,
  shivirs: ["public", "shivirs"] as const,
  shivir: (id: string) => ["public", "shivir", id] as const,
  library: ["public", "library"] as const,
  notices: ["public", "notices"] as const,
  /** Home carousel — distinct from wall so caches never collide. */
  galleryHome: galleryHomeKey,
  /** Punya Wall — distinct from home so caches never collide. */
  galleryWall: galleryWallKey,
  clientSettings: ["public", "settings"] as const,
  children: ["me", "children"] as const,
  attendance: (id: string) => ["me", "attendance", id] as const,
  punya: (id: string) => ["me", "punya", id] as const,
  niyams: (id: string) => ["me", "niyams", id] as const,
  niyamCatalog: (studentId?: string) => ["me", "niyam-catalog", studentId ?? ""] as const,
  today: ["me", "today"] as const,
  attendanceSession: (id: string) => ["shikshak", "attendance-session", id] as const,
  overview: ["admin", "overview"] as const,
  adminStudents: (s?: string) => ["admin", "students", s ?? "all"] as const,
  adminStudent: (id: string) => ["admin", "student", id] as const,
  adminStudentPunya: (id: string) => ["admin", "student", id, "punya"] as const,
  adminStudentHomework: (id: string) => ["admin", "student", id, "homework"] as const,
  adminStudentNiyams: (id: string) => ["admin", "student", id, "niyams"] as const,
  adminStudentIdCard: (id: string) => ["admin", "student", id, "id-card"] as const,
  adminStudentProgress: (id: string) => ["admin", "student", id, "progress"] as const,
  punyaAwardLimit: () => ["admin", "punya-award-limit"] as const,
  pendingNiyam: (batchId: string | null, niyamType: string | null) =>
    ["shikshak", "niyam-pending", batchId ?? "all", niyamType ?? "all"] as const,
  batchPunyaStandings: (batchId: string, month: string) =>
    ["shikshak", "punya-standings", batchId, month] as const,
  adminEnrolments: (s?: string) => ["admin", "enrolments", s ?? "all"] as const,
  adminBatches: ["admin", "batches"] as const,
  staffingMe: ["admin", "staffing", "me"] as const,
  // Wave 4 (new student/parent flows)
  notifications: ["me", "notifications"] as const,
  homework: (id: string) => ["me", "homework", id] as const,
  homeworkAssignments: (overdue?: boolean) =>
    ["shikshak", "homework-assignments", overdue ? "overdue" : "all"] as const,
  homeworkSubmissions: (assignmentId: string) =>
    ["shikshak", "homework-submissions", assignmentId] as const,
  homeworkCurriculumTopics: (batchId: string) =>
    ["shikshak", "homework-curriculum-topics", batchId] as const,
  quizzesAvailable: (id: string) => ["me", "quizzes", "available", id] as const,
  pushQuizActive: (id: string) => ["me", "quizzes", "push-active", id] as const,
  openCompetitions: ["me", "competitions", "open"] as const,
  idCard: (id: string) => ["me", "id-card", id] as const,
};

/* ---------------------------------------------------------------- public --- */

export function useCentres() {
  return useQuery({
    queryKey: qk.centres,
    queryFn: () => apiGet<List<CentreRow>>("/v1/public/centres"),
  });
}

export function useCentre(id?: string) {
  return useQuery({
    queryKey: qk.centre(id ?? ""),
    queryFn: () =>
      apiGet<{ centre: CentreDetail; batches: PublicBatchRow[] }>(
        `/v1/public/centres/${id}`,
      ),
    enabled: !!id,
  });
}

export function useShivirs() {
  return useQuery({
    queryKey: qk.shivirs,
    queryFn: () => apiGet<List<ShivirRow>>("/v1/public/shivirs"),
  });
}

export function useShivir(id?: string) {
  return useQuery({
    queryKey: qk.shivir(id ?? ""),
    queryFn: () => apiGet<ShivirDetail>(`/v1/public/shivirs/${id}`),
    enabled: !!id,
  });
}

export function useLibrary() {
  return useQuery({
    queryKey: qk.library,
    queryFn: () => apiGet<List<PublicLibraryItem>>("/v1/public/library?limit=60"),
  });
}

export function useNotices() {
  return useQuery({
    queryKey: qk.notices,
    queryFn: () => apiGet<List<NoticeItem>>("/v1/notices/public?limit=50"),
  });
}

export type GalleryMediaItem = PublicGalleryItem & {
  image_url?: string | null;
  thumbnail_url?: string | null;
  caption?: string | null;
  caption_hi?: string | null;
};

/** Home carousel surface (`featured_home`). Default limit 12. */
export function useHomeGallery(limit = 12) {
  return useQuery({
    queryKey: qk.galleryHome(limit),
    queryFn: () =>
      apiGet<List<GalleryMediaItem>>(`/v1/gallery?surface=home&limit=${limit}`),
  });
}

/** Punya Wall surface (`featured_gallery`). Default limit 60.
 * Pass `enabled: false` for staff shells that use a separate admin gallery query
 * so both hooks are not in flight at once (PERF #24). */
export function useWallGallery(limit = 60, enabled = true) {
  return useQuery({
    queryKey: qk.galleryWall(limit),
    queryFn: () =>
      apiGet<List<GalleryMediaItem>>(`/v1/gallery?surface=wall&limit=${limit}`),
    enabled,
  });
}

export type ClientSettingRow = { key: string; value: string };

export function useClientSettings(enabled = true) {
  return useQuery({
    queryKey: qk.clientSettings,
    queryFn: () => apiGet<{ items: ClientSettingRow[] }>("/v1/settings/public"),
    enabled,
  });
}

/** Parse allowlisted carousel interval; clamp 1000–15000; default 2000. */
export function carouselIntervalMs(
  data: { items: ClientSettingRow[] } | undefined | null,
): number {
  const raw = data?.items?.find((i) => i.key === "gallery_carousel_interval_ms")?.value;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return 2000;
  return Math.min(15000, Math.max(1000, n));
}

/* ------------------------------------------------------------------- me --- */

export function useChildren(enabled = true) {
  return useQuery({
    queryKey: qk.children,
    queryFn: () => apiGet<List<ChildRow>>("/v1/me/children"),
    enabled,
  });
}

export type StudentAttendancePayload = List<AttendanceRow> & {
  /** AT5 SQL ratio 0–1 (null when no countable marks). */
  attendance_rate?: number | null;
  /** Whole-number percent from AT5 — never recompute client-side. */
  attendance_percent?: number | null;
};

export function useAttendance(studentId?: string, enabled = true, limit?: number) {
  const baseKey = qk.attendance(studentId ?? "");
  const queryKey =
    limit != null ? ([...baseKey, { limit }] as const) : baseKey;
  const path =
    limit != null
      ? `/v1/students/${studentId}/attendance?limit=${limit}`
      : `/v1/students/${studentId}/attendance`;
  return useQuery({
    queryKey,
    queryFn: () => apiGet<StudentAttendancePayload>(path),
    enabled: enabled && !!studentId,
  });
}

export function usePunya(studentId?: string) {
  return useQuery({
    queryKey: qk.punya(studentId ?? ""),
    queryFn: () => apiGet<PunyaSummary>(`/v1/me/students/${studentId}/punya`),
    enabled: !!studentId,
  });
}

export function useStudentNiyams(studentId?: string) {
  return useQuery({
    queryKey: qk.niyams(studentId ?? ""),
    queryFn: () =>
      apiGet<List<NiyamSubmissionRow>>(`/v1/me/students/${studentId}/niyams`),
    enabled: !!studentId,
  });
}

export function useNiyamCatalog(enabled = true, studentId?: string | null) {
  return useQuery({
    queryKey: qk.niyamCatalog(studentId ?? undefined),
    queryFn: () =>
      apiGet<List<NiyamCatalogRow>>(
        studentId
          ? `/v1/me/niyam-catalog?student_id=${encodeURIComponent(studentId)}`
          : "/v1/me/niyam-catalog",
      ),
    // Require an explicit student when one is expected so status never bleeds across children.
    enabled: enabled && (studentId == null || studentId.length > 0),
  });
}

export function useToday(enabled = true) {
  return useQuery({
    queryKey: qk.today,
    queryFn: () => apiGet<List<ShikshakSessionRow>>("/v1/sessions/today"),
    enabled,
  });
}

/* ----------------------------------------- attendance marking (shikshak) --- */

/** One student's row in a session roster. status is null until marked. */
export interface AttendanceRosterRow {
  student_id: string;
  full_name: string | null;
  student_code: string;
  status: "present" | "absent" | "late" | "excused" | null;
  marked_method: string | null;
  /** AT4 — pre-fill from unresolved absence_notifications when status is null. */
  suggested_status?: "excused" | null;
  absence_reason?: string | null;
}
export interface AttendanceSessionDetail {
  session: {
    id: string;
    batch_id: string;
    session_date: string;
    status: string;
    topic: string | null;
    gps_required: boolean;
    batch_name: string | null;
    centre_name: string | null;
    /** centre has configured lat/lng — geofence can actually be enforced. */
    has_gps: boolean;
  };
  roster: AttendanceRosterRow[];
}

type TodaySessionRow = {
  id: string;
  batch_id: string;
  scheduled_date: string;
  session_date?: string;
  status: string;
  topic: string | null;
  gps_required: boolean;
  batch_name: string | null;
  centre_name: string | null;
  has_gps: boolean;
  roster: AttendanceRosterRow[];
};

/**
 * Session detail + roster via frozen GET /v1/sessions/today?session_id=
 * (roster embedded; no legacy /v1/attendance/* routes).
 */
export function useAttendanceSession(sessionId?: string) {
  return useQuery({
    queryKey: qk.attendanceSession(sessionId ?? ""),
    queryFn: async () => {
      const res = await apiGet<{ items: TodaySessionRow[] }>(
        `/v1/sessions/today?session_id=${encodeURIComponent(sessionId!)}`,
      );
      const row = res.items?.[0];
      if (!row) {
        throw new ApiError("ERR_NOT_FOUND", "Session not found for today.", 404);
      }
      return {
        session: {
          id: row.id,
          batch_id: row.batch_id,
          session_date: row.scheduled_date ?? row.session_date ?? "",
          status: row.status,
          topic: row.topic ?? null,
          gps_required: !!row.gps_required,
          batch_name: row.batch_name,
          centre_name: row.centre_name,
          has_gps: !!row.has_gps,
        },
        roster: row.roster ?? [],
      } satisfies AttendanceSessionDetail;
    },
    enabled: !!sessionId,
  });
}

export type AttendanceMark = "present" | "absent" | "late" | "excused";
export interface MarkAttendanceResult {
  session_id: string;
  marked: number;
  /** "gps" when a geofence was enforced, else "manual". */
  method: "gps" | "manual";
}
/**
 * Queue attendance for offline sync. Payload keys on (batch_id, session_date)
 * — NEVER a client-minted session_id. Transport is POST /v1/sync/batch only.
 */
export function useMarkAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      batchId,
      sessionDate,
      records,
    }: {
      /** @deprecated ignored — kept for call-site migration */
      sessionId?: string;
      batchId: string;
      sessionDate: string;
      records: { student_id: string; status: AttendanceMark; notes?: string }[];
      lat?: number;
      lng?: number;
    }) => {
      const { enqueueAttendance, drainQueues } = await import("@/lib/offline/sync-engine");
      const { ulid } = await import("@/lib/offline/ulid");
      const submission_op_id = await enqueueAttendance({
        batch_id: batchId,
        session_date: sessionDate,
        marks: records.map((r) => ({
          student_id: r.student_id,
          status: r.status,
          notes: r.notes,
          client_op_id: ulid(),
        })),
      });
      // Best-effort immediate drain when online.
      await drainQueues();
      return {
        session_id: "",
        marked: records.length,
        method: "manual" as const,
        submission_op_id,
        queued: true,
      };
    },
    onSuccess: (_res, vars) => {
      if (vars.sessionId) {
        qc.invalidateQueries({ queryKey: qk.attendanceSession(vars.sessionId) });
      }
      qc.invalidateQueries({ queryKey: qk.today });
    },
  });
}

/* ---------------------------------------------------------------- admin --- */

export function useOverview(enabled = true) {
  return useQuery({
    queryKey: qk.overview,
    queryFn: () => apiGet<OverviewPayload>("/v1/admin/analytics/overview"),
    enabled,
  });
}

export function useAdminStudents(status?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudents(status),
    queryFn: () =>
      apiGet<List<AdminStudentRow>>(
        `/v1/admin/students${status ? `?status=${status}` : ""}`,
      ),
    enabled,
  });
}

/** Shikshak dossier — profile + parent/student contact. */
export interface AdminStudentDetail {
  id: string;
  full_name: string;
  student_code: string;
  age_group: string;
  dob: string | null;
  msv_status: string;
  status: string;
  blood_group: string | null;
  photo_url?: string | null;
  centre_id?: string | null;
  batch_id?: string | null;
  batch_name?: string | null;
  centre_name?: string | null;
  student_phone: string | null;
  parent: {
    full_name: string | null;
    phone: string | null;
    email?: string | null;
    relation: string | null;
  } | null;
}

export function useAdminStudentDetail(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudent(studentId ?? ""),
    queryFn: () => apiGet<AdminStudentDetail>(`/v1/admin/students/${studentId}`),
    enabled: !!studentId && enabled,
  });
}

export function useAdminStudentPunya(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudentPunya(studentId ?? ""),
    queryFn: () => apiGet<PunyaSummary>(`/v1/admin/students/${studentId}/punya`),
    enabled: !!studentId && enabled,
  });
}

export interface StudentHomeworkHistoryRow {
  id: string;
  assignment_id: string;
  title: string;
  due_date: string;
  status: string;
  late: boolean;
  overdue: boolean;
  marked_at?: string | null;
  submission_url?: string | null;
  feedback_note: string | null;
  batch_name: string | null;
}

export function useStudentHomeworkHistory(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudentHomework(studentId ?? ""),
    queryFn: () =>
      apiGet<List<StudentHomeworkHistoryRow>>(
        `/v1/homework/students/${studentId}/submissions`,
      ),
    enabled: !!studentId && enabled,
  });
}

export interface AdminNiyamByStudentRow {
  id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  submission_date: string;
  status: string;
  points_awarded: number | null;
  proof_url?: string | null;
}

export function useAdminNiyamByStudent(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudentNiyams(studentId ?? ""),
    queryFn: () =>
      apiGet<List<AdminNiyamByStudentRow>>(
        `/v1/admin/niyam-submissions?student_id=${encodeURIComponent(studentId!)}&limit=60`,
      ),
    enabled: !!studentId && enabled,
  });
}

export function useAdminIdCard(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudentIdCard(studentId ?? ""),
    queryFn: async () => {
      try {
        return await apiGet<IdCardRow>(`/v1/id-cards/${studentId}`);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
    enabled: !!studentId && enabled,
  });
}

export interface StudentProgressItem {
  item_id: string;
  title_en: string;
  title_hi: string | null;
  section_title: string | null;
  level: string;
  note: string | null;
}

export function useStudentProgress(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminStudentProgress(studentId ?? ""),
    queryFn: () =>
      apiGet<List<StudentProgressItem>>(`/v1/progress/students/${studentId}`),
    enabled: !!studentId && enabled,
  });
}

export interface PunyaAwardLimit {
  role: string;
  max_points_per_award: number;
  max_points_per_day: number | null;
  points_awarded_today: number;
  remaining_today: number | null;
}

export function usePunyaAwardLimit(enabled = true) {
  return useQuery({
    queryKey: qk.punyaAwardLimit(),
    queryFn: () => apiGet<PunyaAwardLimit>("/v1/admin/punya/award-limit"),
    enabled,
  });
}

export type AwardPunyaResult = {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
};

export function useAwardPunya() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      student_id: string;
      points: number;
      note?: string;
      idempotency_key?: string;
    }) => apiPost<AwardPunyaResult>("/v1/admin/punya/award", body),
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: qk.adminStudentPunya(vars.student_id) });
      void qc.invalidateQueries({ queryKey: qk.punya(vars.student_id) });
      void qc.invalidateQueries({ queryKey: qk.punyaAwardLimit() });
      void qc.invalidateQueries({ queryKey: qk.adminStudent(vars.student_id) });
    },
  });
}

export interface BatchPunyaStandingRow {
  student_id: string;
  full_name: string;
  student_code: string;
  age_group?: string;
  total_points: number;
  tier: string;
  rank: number;
  month_points: number;
  by_source?: Record<string, number>;
}

export interface BatchPunyaStandingsMeta {
  batch_id?: string;
  batch_name?: string;
  month?: string;
  student_count?: number;
  batch_total?: number;
  batch_average?: number;
  tier_counts?: Record<string, number>;
  by_source?: Record<string, number>;
}

export function useBatchPunyaStandings(
  batchId: string | null,
  month: string,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.batchPunyaStandings(batchId ?? "", month),
    queryFn: async () => {
      const qs = month ? `?month=${encodeURIComponent(month)}` : "";
      const env = await apiGetEnvelope<{
        items: BatchPunyaStandingRow[];
        meta?: BatchPunyaStandingsMeta;
      }>(`/v1/admin/batches/${batchId}/punya-standings${qs}`);
      const nested = env.data?.meta;
      return {
        items: env.data?.items ?? [],
        meta: (nested ??
          (env.meta as BatchPunyaStandingsMeta | undefined) ??
          {}) as BatchPunyaStandingsMeta,
      };
    },
    enabled: enabled && !!batchId,
  });
}

export interface PendingNiyamMedia {
  id: string;
  url: string;
  kind: string;
  mime?: string | null;
  size_bytes?: number | null;
  ordinal?: number;
}

export interface PendingNiyamRow {
  id: string;
  student_id: string;
  student_name: string;
  student_code?: string | null;
  batch_id?: string | null;
  batch_name?: string | null;
  niyam_id: string;
  niyam_title_en: string;
  niyam_title_hi: string;
  niyam_type?: string;
  proof_url?: string | null;
  notes?: string | null;
  submission_date: string;
  period_key?: string | null;
  status: string;
  created_at?: string;
  can_reject?: boolean;
  media?: PendingNiyamMedia[];
}

export type PendingNiyamPage = {
  items: PendingNiyamRow[];
  next_cursor: string | null;
};

export function usePendingNiyamInfinite(opts: {
  batchId?: string | null;
  niyamType?: string | null;
  enabled?: boolean;
}) {
  const batchId = opts.batchId ?? null;
  const niyamType = opts.niyamType ?? null;
  const enabled = opts.enabled !== false;
  return useInfiniteQuery({
    queryKey: qk.pendingNiyam(batchId, niyamType),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "30" });
      if (batchId) qs.set("batch_id", batchId);
      if (niyamType) qs.set("niyam_type", niyamType);
      if (pageParam) qs.set("cursor", pageParam);
      return apiGet<PendingNiyamPage>(`/v1/niyam-submissions/pending?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function useApproveNiyam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiPost(`/v1/niyam-submissions/${id}/approve`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shikshak", "niyam-pending"] });
    },
  });
}

export function useRejectNiyam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiPost(`/v1/niyam-submissions/${id}/reject`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shikshak", "niyam-pending"] });
    },
  });
}

export type BulkApproveNiyamResult = {
  results: Array<{
    id: string;
    status: "approved" | "skipped" | "failed";
    error?: { code: string; message: string };
  }>;
};

export function useBulkApproveNiyams() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (submission_ids: string[]) =>
      apiPost<BulkApproveNiyamResult>("/v1/niyam-submissions/bulk-approve", {
        submission_ids,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shikshak", "niyam-pending"] });
    },
  });
}

export function useAdminEnrolments(status?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminEnrolments(status),
    queryFn: () =>
      apiGet<List<EnrolmentRow>>(
        `/v1/admin/enrolments${status ? `?status=${status}` : ""}`,
      ),
    enabled,
  });
}

export function useAdminBatches(enabled = true) {
  return useQuery({
    queryKey: qk.adminBatches,
    queryFn: () => apiGet<List<AdminBatchRow>>("/v1/admin/batches"),
    enabled,
  });
}

export type StaffingMePayload = {
  user_id: string;
  centres: { centre_id: string; centre_name: string }[];
  batches: {
    batch_id: string;
    batch_name: string | null;
    centre_id: string;
    is_primary: boolean;
  }[];
  sanchalak_centres?: { centre_id: string; centre_name: string }[];
};

export function useMyStaffing(enabled = true) {
  return useQuery({
    queryKey: qk.staffingMe,
    queryFn: () => apiGet<StaffingMePayload>("/v1/admin/staffing/me"),
    enabled,
  });
}

/* ------------------------------------------------------------ mutations --- */

export function useEnrolmentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "approve" | "waitlist" | "reject";
      reason?: string;
    }) =>
      apiPost(`/v1/admin/enrolments/${id}/${action}`, reason ? { reason } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "enrolments"] });
      qc.invalidateQueries({ queryKey: qk.overview });
    },
  });
}

export function useStudentStatusAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "deactivate" | "reactivate" }) =>
      apiPost(`/v1/admin/students/${id}/status`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "students"] }),
  });
}

export function useBatchAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "activate" | "deactivate" }) =>
      apiPost(`/v1/admin/batches/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminBatches }),
  });
}

/* ---------------------------------------------------- wave 4 (new flows) --- */

// --- Notifications inbox ---
export type NotificationRow = {
  id: string;
  kind: string;
  title_en: string;
  title_hi: string;
  body_en: string | null;
  body_hi: string | null;
  read_at: string | null;
  created_at: string;
};
export type NotificationsResponse = { items: NotificationRow[]; unread_count: number };

export function useNotifications(enabled = true) {
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => apiGet<NotificationsResponse>("/v1/notifications"),
    enabled,
  });
}
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => apiPost(`/v1/notifications/${id}/read`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

// --- Niyam submission ---
interface SubmitNiyamInput {
  studentId: string; // for cache invalidation only; not sent in body
  niyam_id: string;
  student_id: string;
  submission_date?: string;
  proof_url?: string;
  media?: Array<{ url: string; kind: string; mime?: string; size_bytes?: number }>;
  notes?: string;
}
export interface SubmitNiyamNewBadge {
  badge_key: string;
  streak_length: number;
  points_awarded: number;
}
export interface SubmitNiyamResult {
  id: string;
  status: string;
  new_badges?: SubmitNiyamNewBadge[];
}
export function useSubmitNiyam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId: _studentId, ...body }: SubmitNiyamInput) =>
      apiPost<SubmitNiyamResult>("/v1/niyam-submissions", body),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.niyams(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.punya(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.niyamCatalog(vars.studentId) });
    },
  });
}

// --- Homework ---
export interface HomeworkRow {
  id: string;
  assignment_id: string;
  title: string;
  description?: string | null;
  due_date: string;
  attachment_url?: string | null;
  status: string;
  submission_url: string | null;
  feedback_note: string | null;
  late: boolean;
  overdue?: boolean;
  student_id?: string;
  student_name?: string;
  curriculum_topic_en?: string | null;
  curriculum_topic_hi?: string | null;
}
/** Per-student when studentId is set; combined across children when allChildren. */
export function useHomework(studentId?: string | null, opts?: { allChildren?: boolean }) {
  const allChildren = opts?.allChildren === true;
  return useQuery({
    queryKey: qk.homework(allChildren ? "__all__" : studentId ?? ""),
    queryFn: async () => {
      const collected: HomeworkRow[] = [];
      let cursor: string | null = null;
      let guard = 0;
      do {
        const qs = new URLSearchParams({ limit: "50" });
        if (!allChildren && studentId) qs.set("student_id", studentId);
        if (cursor) qs.set("cursor", cursor);
        const envelope = await apiGetEnvelope<List<HomeworkRow>>(
          `/v1/homework/mine?${qs.toString()}`,
        );
        collected.push(...(envelope.data?.items ?? []));
        const next = envelope.meta?.next_cursor;
        cursor = typeof next === "string" && next.length > 0 ? next : null;
        guard += 1;
      } while (cursor && guard < 50);
      // Overdue first across the full feed (F11).
      collected.sort((a, b) => Number(!!b.overdue) - Number(!!a.overdue));
      return { items: collected } satisfies List<HomeworkRow>;
    },
    enabled: allChildren || !!studentId,
  });
}
export function useSubmitHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      studentId,
      submissionId,
      submission_url,
    }: {
      assignmentId: string;
      studentId: string;
      /** Optional back-compat — server resolves from assignment_id + student_id. */
      submissionId?: string;
      submission_url: string;
    }) => {
      const { enqueueHomeworkSubmission, drainQueues } = await import(
        "@/lib/offline/sync-engine"
      );
      const submission_op_id = await enqueueHomeworkSubmission({
        assignment_id: assignmentId,
        student_id: studentId,
        submission_id: submissionId,
        proof_asset_id: submission_url,
      });
      // Best-effort immediate drain when online — /v1/sync/batch is the only transport.
      await drainQueues();
      return { submission_op_id, queued: true as const };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.homework(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.homework("__all__") });
    },
  });
}

/** Parent mark-done without an upload — acknowledgements queue (F1). */
export function useMarkHomeworkDone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      studentId,
      submissionId,
    }: {
      studentId: string;
      submissionId: string;
    }) => {
      const { enqueueHomeworkMarkDone, drainQueues } = await import(
        "@/lib/offline/sync-engine"
      );
      const submission_op_id = await enqueueHomeworkMarkDone({
        submission_id: submissionId,
      });
      await drainQueues();
      return { submission_op_id, queued: true as const };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: qk.homework(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.homework("__all__") });
    },
  });
}

/* ---------------- Shikshak / admin homework (assign + grade) ---------------- */

export type HomeworkAssignmentRow = {
  id: string;
  title: string;
  description: string | null;
  due_date: string;
  attachment_url: string | null;
  is_msv: boolean;
  curriculum_item_id: string | null;
  curriculum_topic_en: string | null;
  curriculum_topic_hi: string | null;
  batch_id: string;
  batch_name: string | null;
  centre_name: string;
  created_at: string;
  total: number;
  submitted: number;
  graded: number;
  overdue: number;
};

export type HomeworkSubmissionAdminRow = {
  id: string;
  student_id: string;
  student_name: string;
  student_code: string;
  status: "pending" | "submitted" | "approved" | "starred" | "late" | "acknowledged" | "returned";
  submission_url: string | null;
  feedback_note: string | null;
  late: boolean;
  marked_at: string | null;
};

export function useHomeworkAssignments(opts?: { overdue?: boolean; enabled?: boolean }) {
  const overdue = opts?.overdue === true;
  return useQuery({
    queryKey: qk.homeworkAssignments(overdue),
    queryFn: () => {
      const qs = new URLSearchParams({ limit: "100" });
      if (overdue) qs.set("overdue", "1");
      return apiGet<List<HomeworkAssignmentRow>>(`/v1/homework/assignments?${qs.toString()}`);
    },
    enabled: opts?.enabled !== false,
  });
}

export function useHomeworkSubmissions(assignmentId: string | undefined) {
  return useQuery({
    queryKey: qk.homeworkSubmissions(assignmentId ?? ""),
    queryFn: () =>
      apiGet<List<HomeworkSubmissionAdminRow>>(
        `/v1/homework/assignments/${assignmentId}/submissions`,
      ),
    enabled: !!assignmentId,
  });
}

export type CurriculumTopicOption = {
  id: string;
  label_en: string;
  label_hi: string;
  curriculum_name: string;
};

/** Topics available for a batch (non-MSV create path — matches web NewAssignmentDialog). */
export function useHomeworkCurriculumTopics(batchId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.homeworkCurriculumTopics(batchId ?? ""),
    queryFn: () =>
      apiGet<List<CurriculumTopicOption>>(
        `/v1/homework/batches/${batchId}/curriculum-topics?is_msv=false`,
      ),
    enabled: enabled && !!batchId,
  });
}

export function useCreateHomeworkAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      batch_id: string;
      title: string;
      due_date: string;
      description?: string;
      attachment_url?: string;
    }) =>
      apiPost<{ id: string; submissions_created: number }>("/v1/homework/assignments", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["shikshak", "homework-assignments"] });
    },
  });
}

export function useGradeHomeworkSubmission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      submissionId,
      status,
      feedback_note,
    }: {
      submissionId: string;
      status: "approved" | "starred" | "returned";
      feedback_note?: string | null;
      assignmentId: string;
    }) => {
      const body: {
        status: "approved" | "starred" | "returned";
        feedback_note?: string | null;
      } = { status };
      if (feedback_note !== undefined) body.feedback_note = feedback_note;
      return apiPost(`/v1/homework/submissions/${submissionId}/grade`, body);
    },
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.homeworkSubmissions(vars.assignmentId) });
      void qc.invalidateQueries({ queryKey: ["shikshak", "homework-assignments"] });
    },
  });
}

export function useGradeAllHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      assignmentId,
      work_kind,
    }: {
      assignmentId: string;
      work_kind?: "all" | "uploaded" | "acknowledged";
    }) =>
      apiPost<{
        summary: {
          graded: number;
          skipped: number;
          failed: number;
          points_awarded: number;
        };
      }>(`/v1/homework/assignments/${assignmentId}/grade-all`, {
        status: "approved",
        ...(work_kind ? { work_kind } : {}),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: qk.homeworkSubmissions(vars.assignmentId) });
      void qc.invalidateQueries({ queryKey: ["shikshak", "homework-assignments"] });
    },
  });
}

// --- Quizzes (scheduled events) ---
// Field shapes mirror /v1/quizzes responses exactly. Option text_hi is nullable
// in the bank; questions are returned WITHOUT correct_indices (student-safe).
export interface QuizEventRow {
  id: string;
  scope: string;
  title_en: string;
  title_hi: string;
  start_at: string;
  end_at: string;
  participation_points: number;
  win_points: number;
  already_attempted: boolean;
  /** Open attempt exists but has not been submitted yet. */
  in_progress: boolean;
  /** True when the student submitted with every answer correct. */
  is_winner?: boolean;
  /** Punya awarded for this attempt (participation + win if applicable). */
  points_earned?: number;
}
export interface QuizOption { text_en: string; text_hi: string | null }
export interface QuizQuestion { id: string; question_en: string; question_hi: string | null; options: QuizOption[] }
export interface QuizStartResponse {
  attempt_id: string;
  questions: QuizQuestion[];
  /** True when start resumed an existing in-progress attempt. */
  resumed?: boolean;
  /** Prior answers when resumed — keyed by question id. */
  answers?: Record<string, number[]>;
}
export interface QuizSubmitResponse {
  attempt_id: string;
  score: number;
  correct_count: number;
  total_count: number;
  all_correct: boolean;
  points_awarded: number;
}

/** Open scheduled quiz events for the active student. student_id is required by
 * the API (each event is age-group + scope filtered for that student). */
export function useAvailableQuizzes(studentId?: string) {
  return useQuery({
    queryKey: qk.quizzesAvailable(studentId ?? ""),
    queryFn: () =>
      apiGet<List<QuizEventRow>>(
        `/v1/quizzes/events/available?student_id=${studentId}`,
      ),
    enabled: !!studentId,
  });
}
export function useStartQuiz() {
  return useMutation({
    mutationFn: ({ id, student_id }: { id: string; student_id: string }) =>
      apiPost<QuizStartResponse>(`/v1/quizzes/events/${id}/start`, { student_id }),
    onError: (err) => Alert.alert("Could not start quiz", err instanceof Error ? err.message : "Please try again."),
  });
}
export function useSubmitQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, student_id, answers }: { id: string; student_id: string; answers: Record<string, number[]> }) =>
      apiPost<QuizSubmitResponse>(`/v1/quizzes/events/${id}/submit`, { student_id, answers }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: qk.quizzesAvailable(vars.student_id) }),
    onError: (err) => Alert.alert("Could not submit quiz", err instanceof Error ? err.message : "Please try again."),
  });
}

// --- Push quizzes (live, batch-scoped; shikshak-initiated) ---
export interface PushQuizActive {
  id: string;
  started_at: string;
  expires_at: string;
  completion_points: number;
  already_submitted: boolean;
  questions: QuizQuestion[];
}
export interface PushQuizSubmitResponse {
  push_quiz_id: string;
  score: number;
  correct_count: number;
  total_count: number;
  points_awarded: number;
}

/** The single active push quiz for the student's batch, or null. Polled while a
 * student sits on the quizzes screen so a live push appears without a reload. */
export function useActivePushQuiz(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.pushQuizActive(studentId ?? ""),
    queryFn: () =>
      apiGet<{ active: PushQuizActive | null }>(
        `/v1/quizzes/push/active?student_id=${studentId}`,
      ),
    enabled: enabled && !!studentId,
    // Cheap, polling-based liveness (the API is explicitly polling, no sockets).
    refetchInterval: 20_000,
  });
}
export function useSubmitPushQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, student_id, answers }: { id: string; student_id: string; answers: Record<string, number[]> }) =>
      apiPost<PushQuizSubmitResponse>(`/v1/quizzes/push/${id}/submit`, { student_id, answers }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: qk.pushQuizActive(vars.student_id) }),
    onError: (err) => Alert.alert("Could not submit quiz", err instanceof Error ? err.message : "Please try again."),
  });
}

// --- Competitions ---
export interface OpenCompetitionRow {
  id: string;
  name_en: string;
  name_hi: string;
  category: string | null;
  event_date: string;
  registration_window_end: string;
  winner_points: number;
  participant_points: number;
  eligible_student_ids?: string[] | null;
}
export function useOpenCompetitions(enabled = true) {
  return useQuery({
    queryKey: qk.openCompetitions,
    queryFn: () => apiGet<List<OpenCompetitionRow>>("/v1/competitions/open"),
    enabled,
  });
}
export function useRegisterCompetition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, student_id }: { id: string; student_id: string }) =>
      apiPost<{ id: string }>(`/v1/competitions/${id}/register`, { student_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.openCompetitions }),
  });
}

// --- Digital ID card ---
export interface IdCardRow {
  student_id: string;
  card_number: string;
  png_url: string;
  photo_url?: string | null;
  version_no: number;
  is_active: boolean;
  last_regenerated_at?: string | null;
}
export function useMyIdCard(studentId?: string) {
  return useQuery({
    queryKey: qk.idCard(studentId ?? ""),
    queryFn: async () => {
      try {
        return await apiGet<IdCardRow>(`/v1/id-cards/mine?student_id=${studentId}`);
      } catch (err) {
        if (err instanceof ApiError && err.statusCode === 404) return null;
        throw err;
      }
    },
    enabled: !!studentId,
  });
}

export function useSetStudentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      studentId,
      photo_url,
    }: {
      studentId: string;
      photo_url: string | null;
    }) =>
      apiPut<{
        student_id: string;
        photo_url: string | null;
        id_card: IdCardRow;
      }>(`/v1/me/students/${studentId}/photo`, { photo_url }),
    onSuccess: (res, vars) => {
      // Apply the freshly rendered card immediately so the UI doesn't keep the
      // previous PNG (expo-image + signed URL cache) until a later refetch.
      if (res?.id_card) {
        qc.setQueryData<IdCardRow | null>(qk.idCard(vars.studentId), {
          ...res.id_card,
          photo_url: res.photo_url ?? res.id_card.photo_url,
        });
      }
      void qc.invalidateQueries({ queryKey: qk.idCard(vars.studentId) });
      void qc.invalidateQueries({ queryKey: qk.children });
    },
  });
}

/** Set the logged-in user's profile avatar (`users.photo_url`). */
export function useSetUserPhoto() {
  return useMutation({
    mutationFn: (photo_url: string | null) =>
      apiPut<{ user: SessionUser }>("/v1/me/photo", { photo_url }),
  });
}
