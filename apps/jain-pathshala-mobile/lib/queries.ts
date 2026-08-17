/**
 * React Query data layer. Every endpoint the personas consume lives here so
 * screens stay declarative and cache keys never drift. All hooks return the
 * unwrapped DTO (lib/api.ts strips the { data } envelope).
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiGetEnvelope, ApiError } from "@/lib/api";
// Type-only: the sync engine itself is imported dynamically at each call site so
// the offline module stays out of the initial bundle.
import type { SyncUiState } from "@/lib/offline/types";
import type {
  AdminBatchRow,
  AdminStudentRow,
  AbsenceNotificationRow,
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
  PunyaSummary,
  ShikshakSessionRow,
  ShivirDetail,
  ShivirRow,
  StudentAbsencesPayload,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth";
import { galleryHomeKey, galleryWallKey } from "@/lib/gallery-query-keys";

type List<T> = ListResponse<T>;

export const qk = {
  centres: ["public", "centres"] as const,
  centre: (id: string) => ["public", "centre", id] as const,
  shivirs: ["public", "shivirs"] as const,
  shivir: (id: string) => ["public", "shivir", id] as const,
  notices: ["public", "notices"] as const,
  /** Home carousel — distinct from wall so caches never collide. */
  galleryHome: galleryHomeKey,
  /** Punya Wall — distinct from home so caches never collide. */
  galleryWall: galleryWallKey,
  clientSettings: ["public", "settings"] as const,
  children: ["me", "children"] as const,
  attendance: (id: string) => ["me", "attendance", id] as const,
  studentAbsences: (id: string, month?: string) =>
    ["me", "absences", id, month ?? "all"] as const,
  centreHolidaysPublic: (id: string) => ["public", "centre-holidays", id] as const,
  punya: (id: string) => ["me", "punya", id] as const,
  niyams: (id: string) => ["me", "niyams", id] as const,
  niyamCatalog: (studentId?: string) => ["me", "niyam-catalog", studentId ?? ""] as const,
  today: ["me", "today"] as const,
  attendanceSession: (id: string) => ["shikshak", "attendance-session", id] as const,
  overview: ["admin", "overview"] as const,
  adminGallery: (filter: string) => ["admin", "gallery", filter] as const,
  adminStudents: (opts?: { status?: string; q?: string; batchId?: string }) =>
    ["admin", "students", opts?.status ?? "all", opts?.q ?? "", opts?.batchId ?? ""] as const,
  adminStudent: (id: string) => ["admin", "student", id] as const,
  adminStudentPunya: (id: string) => ["admin", "student", id, "punya"] as const,
  adminStudentHomework: (id: string) => ["admin", "student", id, "homework"] as const,
  adminStudentNiyams: (id: string) => ["admin", "student", id, "niyams"] as const,
  adminStudentIdCard: (id: string) => ["admin", "student", id, "id-card"] as const,
  adminStudentProgress: (id: string) => ["admin", "student", id, "progress"] as const,
  courses: (scope: string) => ["courses", scope] as const,
  adminCourses: (status?: string) => ["admin", "courses", status ?? "all"] as const,
  adminCourseTree: (courseId: string) => ["admin", "courses", "tree", courseId] as const,
  courseTree: (courseId: string, studentId: string) =>
    ["courses", "tree", courseId, studentId] as const,
  studentCertificates: (studentId: string) =>
    ["students", studentId, "certificates"] as const,
  punyaAwardLimit: () => ["admin", "punya-award-limit"] as const,
  pendingNiyam: (batchId: string | null, niyamType: string | null) =>
    ["shikshak", "niyam-pending", batchId ?? "all", niyamType ?? "all"] as const,
  batchPunyaStandings: (batchId: string, month: string) =>
    ["shikshak", "punya-standings", batchId, month] as const,
  adminEnrolments: (s?: string) => ["admin", "enrolments", s ?? "all"] as const,
  adminBatches: ["admin", "batches"] as const,
  adminCentres: ["admin", "centres"] as const,
  adminCentreSanchalaks: (id: string) => ["admin", "centres", id, "sanchalaks"] as const,
  adminCentreShikshaks: (id: string) => ["admin", "centres", id, "shikshaks"] as const,
  adminBatchShikshaks: (id: string) => ["admin", "batches", id, "shikshaks"] as const,
  adminUsersPick: (role: string, centreId: string) =>
    ["admin", "users", "pick", role, centreId] as const,
  adminCentreHolidays: (id: string) => ["admin", "centres", id, "holidays"] as const,
  adminCentreReports: (id: string, month: string) =>
    ["admin", "centres", id, "reports", month] as const,
  adminNotices: ["admin", "notices"] as const,
  adminAttendanceAlerts: (centreId: string, date: string) =>
    ["admin", "attendance", "alerts", centreId, date] as const,
  adminCentreToday: (centreId: string, date: string) =>
    ["admin", "sessions", "today", centreId, date] as const,
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

export type AdminGalleryFilter = "needs_attention" | "all" | "hidden" | "opted_out";

export type AdminGalleryItem = {
  id: string;
  student_id: string | null;
  first_name: string;
  age_group: string;
  centre_name: string | null;
  niyam_title_en: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  caption_hi: string | null;
  featured_gallery: boolean;
  featured_home: boolean;
  is_featured: boolean;
  is_public: boolean;
  consent_opt_in: boolean | null;
  created_at: string;
};

export type AdminGalleryPage = {
  items: AdminGalleryItem[];
  next_cursor: string | null;
  has_more: boolean;
};

function daysAgoYmd(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Admin gallery list — never dehydrate to AsyncStorage (see query-persist-keys).
 * Default filter is needs_attention (public + last 14 days).
 */
export function useAdminGalleryInfinite(filter: AdminGalleryFilter, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.adminGallery(filter),
    initialPageParam: null as string | null,
    gcTime: 0,
    staleTime: 0,
    queryFn: async ({ pageParam }): Promise<AdminGalleryPage> => {
      const qs = new URLSearchParams({ limit: "40" });
      if (filter === "needs_attention") {
        qs.set("is_public", "true");
        qs.set("since", daysAgoYmd(14));
      } else if (filter === "hidden") {
        qs.set("is_public", "false");
      } else if (filter === "opted_out") {
        qs.set("opt_in", "false");
      }
      if (pageParam) qs.set("cursor", pageParam);
      const env = await apiGetEnvelope<{ items: AdminGalleryItem[] }>(
        `/v1/gallery/admin?${qs.toString()}`,
      );
      const next =
        typeof env.meta?.next_cursor === "string" && env.meta.next_cursor.length > 0
          ? env.meta.next_cursor
          : null;
      return {
        items: env.data?.items ?? [],
        next_cursor: next,
        has_more: env.meta?.has_more === true,
      };
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });
}

export function useGalleryVisibility() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_public }: { id: string; is_public: boolean }) =>
      apiPatch(`/v1/gallery/admin/${id}/visibility`, { is_public }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "gallery"] });
    },
  });
}

export function useGalleryTakedown() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiDelete(`/v1/gallery/admin/${id}`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "gallery"] });
    },
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

export function useAttendance(
  studentId?: string,
  enabled = true,
  opts?: number | { month?: string; limit?: number },
) {
  const resolved = typeof opts === "number" ? { limit: opts } : (opts ?? {});
  const baseKey = qk.attendance(studentId ?? "");
  const queryKey = [...baseKey, resolved] as const;
  const params = new URLSearchParams();
  if (resolved.month) params.set("month", resolved.month);
  if (resolved.limit != null) params.set("limit", String(resolved.limit));
  const qs = params.toString();
  const path = `/v1/students/${studentId}/attendance${qs ? `?${qs}` : ""}`;
  return useQuery({
    queryKey,
    queryFn: () => apiGet<StudentAttendancePayload>(path),
    enabled: enabled && !!studentId,
  });
}

export function useStudentAbsences(studentId?: string, month?: string, enabled = true) {
  return useQuery({
    queryKey: qk.studentAbsences(studentId ?? "", month),
    queryFn: () => {
      const qs = month ? `?month=${encodeURIComponent(month)}` : "";
      return apiGet<StudentAbsencesPayload>(`/v1/students/${studentId}/absences${qs}`);
    },
    enabled: enabled && !!studentId,
  });
}

export type PublicHolidayRow = {
  id: string;
  holiday_date: string;
  reason: string | null;
};

export function useCentreHolidaysPublic(centreId?: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.centreHolidaysPublic(centreId ?? ""),
    queryFn: () => apiGet<List<PublicHolidayRow>>(`/v1/centres/${centreId}/holidays`),
    enabled: enabled && !!centreId,
  });
}

export function useCreateStudentAbsence(studentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { start_date: string; end_date: string; reason?: string }) =>
      apiPost<AbsenceNotificationRow>(`/v1/students/${studentId}/absences`, body),
    onSuccess: () => {
      if (!studentId) return;
      void qc.invalidateQueries({ queryKey: ["me", "absences", studentId] });
      void qc.invalidateQueries({ queryKey: qk.attendance(studentId) });
    },
  });
}

/** How many ledger rows to add per "show more" tap. */
export const PUNYA_LEDGER_PAGE = 50;

/**
 * Punya balance + ledger.
 *
 * `limit` grows on demand rather than paging with a cursor: the ledger is read
 * top-down and the total is the headline number, so a single growing window
 * keeps the running sum meaningful. Server clamps at 200 per request.
 */
export function usePunya(studentId?: string, opts?: { limit?: number }) {
  const limit = opts?.limit ?? PUNYA_LEDGER_PAGE;
  return useQuery({
    queryKey: [...qk.punya(studentId ?? ""), limit],
    queryFn: () =>
      apiGet<PunyaSummary>(
        `/v1/me/students/${studentId}/punya?limit=${encodeURIComponent(String(limit))}`,
      ),
    enabled: !!studentId,
  });
}

export function useStudentNiyams(studentId?: string, opts?: { limit?: number }) {
  const limit = opts?.limit;
  return useQuery({
    queryKey: [...qk.niyams(studentId ?? ""), limit ?? "default"] as const,
    queryFn: () => {
      const qs = limit != null ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return apiGet<List<NiyamSubmissionRow>>(`/v1/me/students/${studentId}/niyams${qs}`);
    },
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
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.today,
    queryFn: async () => {
      const res = await apiGet<List<ShikshakSessionRow>>("/v1/sessions/today");
      // The server already ships each session's full roster here (it is batch-
      // bounded for a shikshak). Seed the per-session cache with it so opening a
      // session is instant and does not refetch rows we just downloaded and
      // would otherwise discard.
      for (const item of res.items ?? []) {
        const roster = (item as { roster?: unknown }).roster;
        if (Array.isArray(roster) && roster.length > 0) {
          qc.setQueryData(qk.attendanceSession(item.id), { session: item, roster });
        }
      }
      return res;
    },
    enabled,
  });
}

export type CentreTodaySession = ShikshakSessionRow & {
  centre_id?: string;
  check_in_at?: string | null;
  gps_flagged?: boolean;
  gps_unverified?: boolean;
  conducted_by_name?: string | null;
  scheduled_start_time?: string | null;
  scheduled_end_time?: string | null;
  roster?: AttendanceRosterRow[];
};

export function useCentreTodaySessions(
  centreId: string | null,
  date: string,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.adminCentreToday(centreId ?? "", date),
    queryFn: () =>
      apiGet<{ items: CentreTodaySession[]; date: string }>(
        `/v1/sessions/today?centre_id=${centreId}&date=${date}&limit=100`,
      ),
    enabled: enabled && !!centreId,
  });
}

export function useCentreSessionDetail(
  centreId: string | null,
  sessionId: string | null,
  date: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["admin", "sessions", "today", centreId, date, sessionId],
    queryFn: () =>
      apiGet<{ items: CentreTodaySession[]; date: string }>(
        `/v1/sessions/today?centre_id=${centreId}&date=${date}&session_id=${sessionId}`,
      ),
    enabled: enabled && !!centreId && !!sessionId,
  });
}

export type AttendanceAlertsPayload = {
  consecutive_absences: Array<{
    student_id: string;
    student_name: string;
    batch_id: string | null;
    batch_name: string | null;
    consecutive_absent_count: number;
    last_attended_date: string | null;
    parent_phone: string | null;
  }>;
  unmarked_sessions: Array<{
    id: string;
    batch_id: string;
    batch_name: string;
    status: string;
    scheduled_date: string;
    scheduled_start_time: string | null;
    scheduled_end_time: string | null;
    label: "not_marked";
  }>;
  gps_flagged_sessions: Array<{
    id: string;
    batch_id: string;
    batch_name: string;
    status: string;
    scheduled_date: string;
    check_in_at: string | null;
  }>;
  not_checked_in_sessions: Array<{
    id: string;
    batch_id: string;
    batch_name: string;
    status: string;
    scheduled_date: string;
    label: "not_checked_in";
  }>;
  date: string;
};

export type AttendanceAlertsMeta = {
  consecutive_absence_count: number;
  unmarked_count: number;
  gps_flagged_count: number;
  not_checked_in_count: number;
  alert_count: number;
};

export function useAttendanceAlerts(centreId: string | null, date: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminAttendanceAlerts(centreId ?? "", date),
    queryFn: () =>
      apiGetEnvelope<AttendanceAlertsPayload>(
        `/v1/admin/attendance/alerts?centre_id=${centreId}&date=${date}`,
      ),
    enabled: enabled && !!centreId,
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
    check_in_at: string | null;
    check_out_at: string | null;
    gps_flagged: boolean;
    gps_unverified: boolean;
    unscheduled: boolean;
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
  check_in_at?: string | null;
  check_out_at?: string | null;
  check_in_distance_m?: number | null;
  check_out_distance_m?: number | null;
  gps_flagged?: boolean;
  gps_unverified?: boolean;
  duration_minutes?: number | null;
  auto_checked_out?: boolean;
  unscheduled?: boolean;
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
          check_in_at: row.check_in_at ?? null,
          check_out_at: row.check_out_at ?? null,
          gps_flagged: !!row.gps_flagged,
          gps_unverified: !!row.gps_unverified,
          unscheduled: !!row.unscheduled,
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
  method: "manual";
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
      // Best-effort immediate drain when online. The per-op result is returned
      // rather than discarded: this used to always report success, so a server
      // 409 (cancelled session, AT26 edit window expired) rendered as a green
      // "Saved — will sync" that never resolved.
      const results = await drainQueues();
      const mine = results.find((r) => r.submission_op_id === submission_op_id);
      const sync_state: SyncUiState =
        mine?.status === "success"
          ? "synced"
          : mine?.status === "duplicate"
            ? "duplicate"
            : mine?.status === "conflict"
              ? "conflict"
              : mine?.status === "failed"
                ? "failed"
                : "queued";
      return {
        session_id: mine?.server_id ?? "",
        marked: records.length,
        method: "manual" as const,
        submission_op_id,
        queued: sync_state === "queued",
        sync_state,
        sync_error: mine?.error,
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

export type AdminStudentsPage = {
  items: AdminStudentRow[];
  next_cursor: string | null;
};

export function useAdminStudents(opts?: {
  status?: string;
  q?: string;
  batchId?: string;
  enabled?: boolean;
}) {
  const status = opts?.status?.trim() || undefined;
  const q = opts?.q?.trim() || undefined;
  const batchId = opts?.batchId?.trim() || undefined;
  const enabled = opts?.enabled !== false;
  return useInfiniteQuery({
    queryKey: qk.adminStudents({ status, q, batchId }),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "50" });
      if (status) qs.set("status", status);
      if (q) qs.set("q", q);
      if (batchId) qs.set("batch_id", batchId);
      if (pageParam) qs.set("cursor", pageParam);
      return apiGet<AdminStudentsPage>(`/v1/admin/students?${qs.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
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
  /** Q12 — false when the caller may see the row but not approve/reject. */
  can_decide?: boolean;
  media?: PendingNiyamMedia[];
}

export type PendingNiyamPage = {
  items: PendingNiyamRow[];
  next_cursor: string | null;
};

export function usePendingNiyamInfinite(opts: {
  batchId?: string | null;
  niyamType?: string | null;
  /**
   * Server-side narrowing for the "review this child's niyams" deep link.
   * Filtering client-side only searched already-loaded pages, so a submission
   * past page 1 showed the empty state — and because the list then never
   * rendered, onEndReached could not fire to load more.
   */
  studentId?: string | null;
  enabled?: boolean;
}) {
  const batchId = opts.batchId ?? null;
  const niyamType = opts.niyamType ?? null;
  const studentId = opts.studentId ?? null;
  const enabled = opts.enabled !== false;
  return useInfiniteQuery({
    queryKey: [...qk.pendingNiyam(batchId, niyamType), studentId ?? ""],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "30" });
      if (batchId) qs.set("batch_id", batchId);
      if (niyamType) qs.set("niyam_type", niyamType);
      if (studentId) qs.set("student_id", studentId);
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

export type AdminCentreRow = {
  id: string;
  code: string | null;
  name: string;
  locality: string | null;
  pincode: string | null;
  city_name: string;
  state_name: string;
  contact_phone: string | null;
  contact_email: string | null;
  gps_radius_meters: number;
  status: string;
  batch_count: number;
  active_student_count: number;
};

export function useAdminCentres(enabled = true) {
  return useQuery({
    queryKey: qk.adminCentres,
    queryFn: () => apiGet<List<AdminCentreRow>>("/v1/admin/centres"),
    enabled,
  });
}

export type CentreSanchalakRow = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  assigned_at: string | Date;
};

export function useCentreSanchalaks(centreId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.adminCentreSanchalaks(centreId ?? ""),
    queryFn: () =>
      apiGet<List<CentreSanchalakRow>>(`/v1/admin/centres/${centreId}/sanchalaks`),
    enabled: enabled && !!centreId,
  });
}

export type CentreShikshakBatch = {
  batch_id: string;
  batch_name: string;
  is_primary: boolean;
};

export type CentreShikshakRow = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | "other" | null;
  is_active: boolean;
  batch_count: number;
  batches: CentreShikshakBatch[];
};

export function useCentreShikshaks(centreId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.adminCentreShikshaks(centreId ?? ""),
    queryFn: () =>
      apiGet<List<CentreShikshakRow>>(`/v1/admin/centres/${centreId}/shikshaks`),
    enabled: enabled && !!centreId,
  });
}

export type BatchShikshakRow = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | "other" | null;
  is_primary: boolean;
};

export function useBatchShikshaks(batchId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.adminBatchShikshaks(batchId ?? ""),
    queryFn: () =>
      apiGet<{ items: BatchShikshakRow[]; centre_id?: string }>(
        `/v1/admin/batches/${batchId}/shikshaks`,
      ),
    enabled: enabled && !!batchId,
  });
}

export type UserPickRow = {
  id: string;
  full_name: string;
  phone: string;
  gender: "male" | "female" | "other" | null;
  role: string;
};

export function useUsersPick(
  role: "shikshak" | "sanchalak",
  centreId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: qk.adminUsersPick(role, centreId ?? ""),
    queryFn: () =>
      apiGet<List<UserPickRow>>(
        `/v1/admin/users/pick?role=${role}&centre_id=${centreId}`,
      ),
    enabled: enabled && !!centreId,
  });
}

export type CentreHolidayRow = {
  id: string;
  holiday_date: string;
  reason: string | null;
  is_published: boolean;
  restorable_session_count?: number;
};

export function useCentreHolidays(centreId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.adminCentreHolidays(centreId ?? ""),
    queryFn: () =>
      apiGet<List<CentreHolidayRow>>(`/v1/admin/centres/${centreId}/holidays`),
    enabled: enabled && !!centreId,
  });
}

export type AdminNoticeRow = {
  id: string;
  title_en: string;
  title_hi: string | null;
  content_en: string | null;
  content_hi: string | null;
  audience: string;
  state_id: string | null;
  city_id: string | null;
  centre_id: string | null;
  batch_id: string | null;
  centre_name: string | null;
  batch_name: string | null;
  is_public: boolean;
  pinned: boolean;
  is_critical: boolean;
  published_at: string | null;
  expires_at: string | null;
  is_expired: boolean;
  created_at: string;
};

export function useAdminNotices(enabled = true) {
  return useQuery({
    queryKey: qk.adminNotices,
    queryFn: () => apiGet<List<AdminNoticeRow>>("/v1/notices/admin?limit=100"),
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

export type CreateAdminStudentBody = {
  full_name: string;
  centre_id: string;
  dob: string;
  batch_id?: string;
  gender?: "male" | "female" | "other";
  blood_group?: string;
  parent_full_name: string;
  parent_phone: string;
  guardian_relation: "father" | "mother" | "guardian";
};

export type CreateAdminStudentResult = {
  id: string;
  student_code: string;
  full_name: string;
  age_group: string;
  parent_id: string;
  blood_group: string | null;
  parent_created: boolean;
};

export function useCreateAdminStudent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminStudentBody) =>
      apiPost<CreateAdminStudentResult>("/v1/admin/students", body),
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

export type CreateAdminBatchBody = {
  centre_id: string;
  name: string;
  age_groups: Array<"bal" | "kishor" | "tarun" | "yuva">;
  start_time: string;
  end_time: string;
  day_of_week: number[];
  capacity: number;
  primary_shikshak_id?: string;
};

export function useCreateAdminBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAdminBatchBody) =>
      apiPost<{ id: string; name: string }>("/v1/admin/batches", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminBatches }),
  });
}

function wrongRoleMessage(e: unknown, hi: boolean): string {
  if (e instanceof ApiError && e.code === "ERR_WRONG_ROLE") {
    return hi
      ? "यह व्यक्ति गुरुजी के रूप में पंजीकृत नहीं है"
      : "That person is not registered as a Guruji";
  }
  return e instanceof Error ? e.message : "Action failed";
}

export function useAssignCentreShikshak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ centreId, userId }: { centreId: string; userId: string }) =>
      apiPost(`/v1/admin/centres/${centreId}/shikshaks`, { user_id: userId }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreShikshaks(v.centreId) });
      qc.invalidateQueries({ queryKey: ["admin", "users", "pick"] });
    },
  });
}

export function useRemoveCentreShikshak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ centreId, userId }: { centreId: string; userId: string }) =>
      apiPost(`/v1/admin/centres/${centreId}/shikshaks/${userId}/remove`, {}),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreShikshaks(v.centreId) });
      qc.invalidateQueries({ queryKey: ["admin", "batches"] });
      qc.invalidateQueries({ queryKey: ["admin", "users", "pick"] });
    },
  });
}

export function useAssignBatchShikshak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      batchId,
      userId,
      isPrimary,
    }: {
      batchId: string;
      userId: string;
      isPrimary?: boolean;
    }) =>
      apiPost(`/v1/admin/batches/${batchId}/shikshaks`, {
        user_id: userId,
        ...(isPrimary ? { is_primary: true } : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "batches"] });
      qc.invalidateQueries({ queryKey: ["admin", "centres"] });
    },
  });
}

export function useRemoveBatchShikshak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, userId }: { batchId: string; userId: string }) =>
      apiPost(`/v1/admin/batches/${batchId}/shikshaks/${userId}/remove`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "batches"] });
      qc.invalidateQueries({ queryKey: ["admin", "centres"] });
    },
  });
}

export function useSetBatchPrimary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, userId }: { batchId: string; userId: string }) =>
      apiPost(`/v1/admin/batches/${batchId}/primary`, { user_id: userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "batches"] });
      qc.invalidateQueries({ queryKey: ["admin", "centres"] });
    },
  });
}

export function useCreateCentreHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      centreId,
      holiday_date,
      reason,
    }: {
      centreId: string;
      holiday_date: string;
      reason?: string;
    }) =>
      apiPost(`/v1/admin/centres/${centreId}/holidays`, {
        holiday_date,
        reason: reason || undefined,
        is_published: true,
      }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreHolidays(v.centreId) });
    },
  });
}

export function usePatchCentreHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      centreId,
      holidayId,
      is_published,
    }: {
      centreId: string;
      holidayId: string;
      is_published: boolean;
    }) =>
      apiPatch(`/v1/admin/centres/${centreId}/holidays/${holidayId}`, { is_published }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreHolidays(v.centreId) });
    },
  });
}

export function useDeleteCentreHoliday() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ centreId, holidayId }: { centreId: string; holidayId: string }) =>
      apiDelete(`/v1/admin/centres/${centreId}/holidays/${holidayId}`),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreHolidays(v.centreId) });
    },
  });
}

export type CentreMonthlyReportRow = {
  id: string;
  centre_id: string;
  month: string;
  status: "queued" | "generating" | "ready" | "failed" | string;
  pdf_url: string | null;
  error_message: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export function useCentreMonthlyReports(centreId: string | null, month: string) {
  return useQuery({
    queryKey: qk.adminCentreReports(centreId ?? "", month),
    queryFn: () =>
      apiGet<List<CentreMonthlyReportRow>>(
        `/v1/admin/centres/${centreId}/reports?month=${encodeURIComponent(month)}`,
      ),
    enabled: !!centreId && /^\d{4}-\d{2}$/.test(month),
    refetchInterval: (q) => {
      const items = q.state.data?.items ?? [];
      const pending = items.some((r) => r.status === "queued" || r.status === "generating");
      return pending ? 2000 : false;
    },
  });
}

export function useGenerateCentreMonthlyReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ centreId, month }: { centreId: string; month: string }) =>
      apiPost<{ job_id: string; status: string }>(
        `/v1/admin/centres/${centreId}/reports/monthly`,
        { month },
      ),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: qk.adminCentreReports(v.centreId, v.month) });
    },
  });
}

export type NoticeWriteBody = {
  title_en: string;
  title_hi: string;
  content_en: string;
  content_hi: string;
  audience: "centre" | "batch";
  centre_id?: string;
  batch_id?: string;
  is_public?: boolean;
  pinned?: boolean;
  is_critical?: boolean;
  expires_at?: string | null;
};

export function useCreateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NoticeWriteBody) => apiPost("/v1/notices/admin", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminNotices }),
  });
}

export function useUpdateNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: NoticeWriteBody }) =>
      apiPatch(`/v1/notices/admin/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminNotices }),
  });
}

export function useDeleteNotice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/v1/notices/admin/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.adminNotices }),
  });
}

/** Shared ERR_WRONG_ROLE copy for staffing assign failures. */
export { wrongRoleMessage };

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
export type NotificationsResponse = {
  items: NotificationRow[];
  unread_count: number;
  /** Keyset cursor — the server returns it in `data`, not `meta`. */
  next_cursor?: string | null;
};

/**
 * Notifications inbox, paged.
 *
 * The server pages at 50 with `next_cursor`; this fetched the bare path once, so
 * everything past the 50th notification was permanently unreachable — with no
 * "load more" and no sign anything had been truncated. A parent of two children
 * at an active centre passes 50 in a few weeks.
 *
 * Note `next_cursor` lives inside `data` here, not `meta` (notifications.ts:196)
 * — unlike gallery/homework, which put it in `meta`.
 */
export function useNotifications(enabled = true) {
  const query = useInfiniteQuery({
    queryKey: qk.notifications,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet<NotificationsResponse>(
        pageParam ? `/v1/notifications?cursor=${encodeURIComponent(pageParam)}` : "/v1/notifications",
      ),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled,
  });

  const pages = query.data?.pages ?? [];
  return {
    ...query,
    // Flattened view so call sites keep the shape they had before paging.
    data: pages.length
      ? {
          items: pages.flatMap((p) => p.items),
          // Only page 0 carries the count — the server omits it on later pages.
          unread_count: pages[0]?.unread_count ?? 0,
        }
      : undefined,
  };
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
  /** True when the submission was queued offline rather than confirmed by the server. */
  queued?: boolean;
  /** Present when queued — lets the screen surface queued/conflict/failed state. */
  submission_op_id?: string;
  sync_state?: SyncUiState;
  sync_error?: { code: string; message: string };
}

/**
 * Submit a niyam through the offline queue.
 *
 * This used to POST directly, so a submission made out of signal threw and was
 * lost — along with the proof the parent had just recorded, which lived only in
 * component state. Everything now goes through jp.queue.niyam_submissions and
 * /v1/sync/batch (CLAUDE.md offline sync §4: one transport, no parallel path).
 */
export function useSubmitNiyam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      studentId: _studentId,
      niyam_id,
      student_id,
      media,
      notes,
      proof_url,
    }: SubmitNiyamInput): Promise<SubmitNiyamResult> => {
      const { enqueueNiyamSubmission, drainQueues } = await import("@/lib/offline/sync-engine");

      const wireMedia =
        media && media.length > 0
          ? media.map((m) => ({
              url: m.url,
              kind: (m.kind === "video" || m.kind === "audio" ? m.kind : "photo") as
                | "photo"
                | "video"
                | "audio",
              mime: m.mime,
              size_bytes: m.size_bytes,
            }))
          : proof_url
            ? [{ url: proof_url, kind: "photo" as const }]
            : undefined;

      const submission_op_id = await enqueueNiyamSubmission({
        niyam_id,
        student_id,
        media: wireMedia,
        notes,
      });

      // Best-effort immediate drain when online; offline this is a no-op and the
      // loop picks it up. The per-op result is returned so the screen can tell
      // "saved offline" from "the server rejected this".
      const results = await drainQueues();
      const mine = results.find((r) => r.submission_op_id === submission_op_id);

      return {
        id: mine?.server_id ?? "",
        status: mine?.status === "success" ? "submitted" : "queued",
        queued: mine?.status !== "success",
        submission_op_id,
        sync_state:
          mine?.status === "success"
            ? "synced"
            : mine?.status === "duplicate"
              ? "duplicate"
              : mine?.status === "conflict"
                ? "conflict"
                : mine?.status === "failed"
                  ? "failed"
                  : "queued",
        sync_error: mine?.error,
      };
    },
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
  /** EN source of truth; `*_hi` is null on rows authored before bilingual support. */
  title: string;
  title_hi?: string | null;
  description?: string | null;
  description_hi?: string | null;
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
/**
 * Per-student when studentId is set; combined across children when allChildren.
 *
 * Pages on demand. This used to loop up to 50 cursor pages SERIALLY before
 * painting a single row — so a parent of three children at year end waited on up
 * to 50 blocking round trips, then got 2,500 rows mounted at once.
 *
 * Note the server already orders overdue-first within each page; sorting the
 * accumulated set client-side would reshuffle across page boundaries and make
 * rows jump as later pages arrive, so we keep server order.
 */
export function useHomework(studentId?: string | null, opts?: { allChildren?: boolean }) {
  const allChildren = opts?.allChildren === true;
  const query = useInfiniteQuery({
    queryKey: qk.homework(allChildren ? "__all__" : studentId ?? ""),
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "50" });
      if (!allChildren && studentId) qs.set("student_id", studentId);
      if (pageParam) qs.set("cursor", pageParam);
      const envelope = await apiGetEnvelope<List<HomeworkRow>>(
        `/v1/homework/mine?${qs.toString()}`,
      );
      const next = envelope.meta?.next_cursor;
      return {
        items: envelope.data?.items ?? [],
        next_cursor: typeof next === "string" && next.length > 0 ? next : null,
      };
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    enabled: allChildren || !!studentId,
  });

  const pages = query.data?.pages ?? [];
  return {
    ...query,
    // Flattened so existing call sites keep reading `.data.items`.
    data: pages.length ? { items: pages.flatMap((p) => p.items) } : undefined,
  };
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
  centre_id: string;
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
      /** Optional Hindi — clients fall back to the EN column when absent. */
      title_hi?: string;
      due_date: string;
      description?: string;
      description_hi?: string;
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
// Error handling deliberately lives at the CALL SITE, not here: this module has
// no access to useLocale(), so an Alert raised from a hook is always English —
// over an all-Devanagari screen — and it also pre-empts the screen's own onError,
// leaving the failure with no on-screen trace.
export function useStartQuiz() {
  return useMutation({
    mutationFn: ({ id, student_id }: { id: string; student_id: string }) =>
      apiPost<QuizStartResponse>(`/v1/quizzes/events/${id}/start`, { student_id }),
  });
}
/**
 * Persist in-progress quiz answers without grading, so an app kill mid-attempt
 * does not lose them. Failures are intentionally swallowed: autosave is a safety
 * net, and an alert mid-question would be worse than a silent retry on the next
 * change.
 */
export function useAutosaveQuizAnswers() {
  return useMutation({
    mutationFn: ({
      attemptId,
      student_id,
      answers,
    }: {
      attemptId: string;
      student_id: string;
      answers: Record<string, number[]>;
    }) =>
      apiPut<{ attempt_id: string; saved: boolean }>(
        `/v1/quizzes/events/attempts/${attemptId}/answers`,
        { student_id, answers },
      ),
  });
}

export function useSubmitQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, student_id, answers }: { id: string; student_id: string; answers: Record<string, number[]> }) =>
      apiPost<QuizSubmitResponse>(`/v1/quizzes/events/${id}/submit`, { student_id, answers }),
    onSuccess: (_res, vars) => qc.invalidateQueries({ queryKey: qk.quizzesAvailable(vars.student_id) }),
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
    // See useStartQuiz — errors are surfaced bilingually at the call site.
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
  /** Which of the caller's children are already registered — server truth. */
  registered_student_ids?: string[] | null;
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

/* ---------------------------------------------------------------- courses (CU3–CU31) --- */

export type CourseListRow = {
  id: string;
  name_en: string;
  name_hi: string | null;
  kind: string;
  academic_year: string | null;
  status?: string;
  punya_points: number;
  city_id?: string | null;
  city_name?: string | null;
};

export type CourseTreeSubsection = {
  id: string;
  title_en: string;
  title_hi: string;
  description_en?: string | null;
  description_hi?: string | null;
  order_index: number;
  status: "not_started" | "in_progress" | "completed";
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
};

export type CourseTreeSection = {
  id: string;
  title_en: string;
  title_hi: string;
  order_index: number;
  punya_points: number;
  status: "not_started" | "in_progress" | "completed";
  certified_at: string | null;
  certified_by: string | null;
  certified_by_gender: string | null;
  derived_status: "not_started" | "in_progress" | "completed" | null;
  derived_leaf_total: number;
  derived_leaf_reached: number;
  derived_coverage: number | null;
  status_diverges: boolean;
  subsections: CourseTreeSubsection[];
};

export type StudentCourseTree = {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    academic_year: string | null;
    punya_points: number;
  };
  progress: {
    coverage: number | null;
    mastery: number | null;
    leaf_total?: number;
    leaf_reached?: number;
  };
  sections: CourseTreeSection[];
};

export type CourseCertificateRow = {
  id: string;
  kind: string;
  /** Stable join key for badging a course — titles change, ids don't. */
  course_id: string | null;
  title_en: string;
  title_hi: string | null;
  issued_at: string;
  voided_at: string | null;
  status: "ready" | "issuing" | "void" | string;
  pdf_url: string | null;
  verification_code: string;
  honorific_en: string | null;
  honorific_hi: string | null;
};

/**
 * Parent/student catalogue — CU3 active courses for the active child.
 * Parents pass studentId so city/MSV visibility matches ChildSwitcher scope.
 */
export function useCoursesCatalogue(studentId?: string, enabled = true) {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
  return useQuery({
    queryKey: qk.courses(studentId ? `catalogue:${studentId}` : "catalogue"),
    queryFn: () => apiGet<List<CourseListRow>>(`/v1/courses${qs}`),
    enabled: enabled && (studentId ? !!studentId : true),
  });
}

/** Guest catalogue — published active courses, no student scope. */
export function usePublicCoursesCatalogue(enabled = true) {
  return useQuery({
    queryKey: qk.courses("public"),
    queryFn: () => apiGet<List<CourseListRow>>("/v1/public/courses"),
    enabled,
  });
}

/** Admin list — shikshak/sanchalak authoring-side catalogue. */
export function useAdminCourses(
  status: "draft" | "active" | "archived" | "all" = "active",
  enabled = true,
) {
  const qs = status === "all" ? "" : `?status=${status}`;
  return useQuery({
    queryKey: qk.adminCourses(status),
    queryFn: () => apiGet<List<CourseListRow>>(`/v1/admin/courses${qs}`),
    enabled,
  });
}

/** Structure-only tree (no student progress) for Guruji browse. */
export type AdminCourseBrowseTree = {
  course: {
    id: string;
    name_en: string;
    name_hi: string | null;
    kind: string;
    academic_year: string | null;
    status: string;
    punya_points: number;
  };
  sections: Array<{
    id: string;
    title_en: string;
    title_hi: string | null;
    order_index: number;
    punya_points: number;
    subsections: Array<{
      id: string;
      title_en: string;
      title_hi: string | null;
      description_en: string | null;
      description_hi: string | null;
      order_index: number;
    }>;
  }>;
};

export function useAdminCourseTree(courseId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminCourseTree(courseId ?? ""),
    queryFn: () => apiGet<AdminCourseBrowseTree>(`/v1/admin/courses/${courseId}/tree`),
    enabled: !!courseId && enabled,
  });
}

export function useCourseTree(courseId?: string, studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.courseTree(courseId ?? "", studentId ?? ""),
    queryFn: () =>
      apiGet<StudentCourseTree>(
        `/v1/courses/${courseId}/tree?student_id=${encodeURIComponent(studentId!)}`,
      ),
    enabled: !!courseId && !!studentId && enabled,
  });
}

export function usePublicCourseTree(courseId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.courseTree(courseId ?? "", "public"),
    queryFn: () => apiGet<StudentCourseTree>(`/v1/public/courses/${courseId}/tree`),
    enabled: !!courseId && enabled,
  });
}

export function useStudentCertificates(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.studentCertificates(studentId ?? ""),
    queryFn: () =>
      apiGet<List<CourseCertificateRow>>(`/v1/students/${studentId}/certificates`),
    enabled: !!studentId && enabled,
  });
}

/**
 * Single-student progress write. Guruji/Sanchalak enqueue for offline parity;
 * parent/student hit the online path (CU11 bidirectional).
 */
export function useSetCourseNodeProgress(opts?: { offline?: boolean }) {
  const qc = useQueryClient();
  const offline = opts?.offline ?? false;
  return useMutation({
    mutationFn: async (body: {
      nodeId: string;
      nodeKind: "section" | "subsection";
      student_id: string;
      status: "not_started" | "in_progress" | "completed";
      note?: string;
    }) => {
      if (offline) {
        const { enqueueCourseProgress, drainQueues } = await import(
          "@/lib/offline/sync-engine"
        );
        const { ulid } = await import("@/lib/offline/ulid");
        const submission_op_id = await enqueueCourseProgress({
          node_kind: body.nodeKind,
          node_id: body.nodeId,
          marks: [
            {
              student_id: body.student_id,
              status: body.status,
              note: body.note,
              client_op_id: ulid(),
            },
          ],
        });
        const results = await drainQueues();
        const mine = results.find((r) => r.submission_op_id === submission_op_id);
        return { submission_op_id, result: mine ?? null, queued: true as const };
      }
      return apiPost(`/v1/courses/nodes/${body.nodeId}/progress`, {
        student_id: body.student_id,
        status: body.status,
        note: body.note,
      });
    },
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
      void qc.invalidateQueries({ queryKey: qk.adminStudentProgress(vars.student_id) });
    },
  });
}

export function useBulkCourseNodeProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      nodeId: string;
      batch_id?: string;
      student_ids?: string[];
      status: "not_started" | "in_progress" | "completed";
      note?: string;
    }) =>
      apiPost<{ applied: number; skipped: number; student_ids?: string[] }>(
        `/v1/courses/nodes/${body.nodeId}/progress/bulk`,
        {
          batch_id: body.batch_id,
          student_ids: body.student_ids,
          status: body.status,
          note: body.note,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
    },
  });
}

/**
 * Certify one student. Always enqueue offline for Guruji/Sanchalak so CU31
 * parity holds; call only after CU18 confirm on device.
 */
export function useCertifyCourseNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      nodeId: string;
      nodeKind: "section" | "subsection";
      student_id: string;
      note?: string;
      /** When true (default for admin personas), queue + drain. */
      offline?: boolean;
    }) => {
      const useOffline = body.offline !== false;
      if (useOffline) {
        const { enqueueCourseCertification, drainQueues } = await import(
          "@/lib/offline/sync-engine"
        );
        const submission_op_id = await enqueueCourseCertification({
          node_kind: body.nodeKind,
          node_id: body.nodeId,
          student_id: body.student_id,
          certification_note: body.note,
        });
        const results = await drainQueues();
        const mine = results.find((r) => r.submission_op_id === submission_op_id);
        return { submission_op_id, result: mine ?? null, queued: true as const };
      }
      return apiPost(`/v1/courses/nodes/${body.nodeId}/certify`, {
        student_id: body.student_id,
        note: body.note,
      });
    },
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
      void qc.invalidateQueries({ queryKey: qk.studentCertificates(vars.student_id) });
    },
  });
}
