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
import type { PendingProofMedia, SyncUiState } from "@/lib/offline/types";
import type { DrainOpResult, SyncOpOutcome } from "@/lib/offline/sync-engine";
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
  ShivirSessionRow,
  ShivirMyRegistrations,
  ShivirVolunteeringRow,
  StudentAbsencesPayload,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth";
import { galleryHomeKey, galleryWallKey } from "@/lib/gallery-query-keys";
import type { CoursePunyaConfigRow, CoursePunyaFeatureRow } from "@/lib/course-labels";

type List<T> = ListResponse<T>;

export const qk = {
  centres: ["public", "centres"] as const,
  centre: (id: string) => ["public", "centre", id] as const,
  shivirs: ["public", "shivirs"] as const,
  shivir: (id: string) => ["public", "shivir", id] as const,
  shivirSessions: (id: string) => ["public", "shivir", id, "sessions"] as const,
  shivirMyRegistrations: (id: string) => ["me", "shivir", id, "registrations"] as const,
  shivirVolunteering: ["me", "shivirs", "volunteering"] as const,
  shivirScanContext: (id: string) => ["me", "shivir", id, "scan-context"] as const,
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
  /** H22 — CU22 clamp inputs, shared across every certify confirm. */
  adminPunyaConfigs: ["admin", "punya-configs"] as const,
  adminPunyaFeatures: ["admin", "punya-features-all"] as const,
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
  quizHistory: (id: string) => ["me", "quizzes", "history", id] as const,
  pushQuizActive: (id: string) => ["me", "quizzes", "push-active", id] as const,
  shikshakPushQuizzes: ["shikshak", "push-quizzes"] as const,
  pushQuizRoster: (id: string) => ["shikshak", "push-quiz-roster", id] as const,
  openCompetitions: ["me", "competitions", "open"] as const,
  idCard: (id: string) => ["me", "id-card", id] as const,
};

/* ---------------------------------------------------------------- public --- */

/**
 * Offset-paged directory (re-review finding 2): the flat fetch was clamped
 * server-side, so centre 201 silently never appeared. `q` searches
 * name/code/locality/city server-side.
 */
export function useCentres(q = "") {
  return useInfiniteQuery({
    queryKey: [...qk.centres, q],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "200" });
      if (pageParam) params.set("offset", String(pageParam));
      if (q) params.set("q", q);
      return apiGetEnvelope<List<CentreRow>>(`/v1/public/centres?${params.toString()}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.meta?.next_offset;
      return typeof next === "number" ? next : null;
    },
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

/** Offset-paged like useCentres — the shivir list was entirely unbounded. */
export function useShivirs() {
  return useInfiniteQuery({
    queryKey: qk.shivirs,
    queryFn: ({ pageParam }) =>
      apiGetEnvelope<List<ShivirRow>>(
        pageParam ? `/v1/public/shivirs?limit=100&offset=${pageParam}` : "/v1/public/shivirs?limit=100",
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const next = lastPage.meta?.next_offset;
      return typeof next === "number" ? next : null;
    },
  });
}

export function useShivir(id?: string) {
  return useQuery({
    queryKey: qk.shivir(id ?? ""),
    queryFn: () => apiGet<ShivirDetail>(`/v1/public/shivirs/${id}`),
    enabled: !!id,
  });
}


/** Day list for a published shivir. */
export function useShivirSessions(id?: string) {
  return useQuery({
    queryKey: qk.shivirSessions(id ?? ""),
    queryFn: () => apiGet<List<ShivirSessionRow>>(`/v1/shivirs/${id}/sessions`),
    enabled: !!id,
  });
}

/**
 * The caller's children and their registration state for one shivir.
 *
 * Drives the Register / Registered CTA. Before this existed the detail screen
 * offered a parent exactly one action: a volunteer scanner they could not use.
 */
export function useShivirMyRegistrations(id?: string, enabled = true) {
  return useQuery({
    queryKey: qk.shivirMyRegistrations(id ?? ""),
    queryFn: () => apiGet<ShivirMyRegistrations>(`/v1/shivirs/${id}/registrations/mine`),
    enabled: !!id && enabled,
  });
}

/** Shivirs the caller is an assigned volunteer for (mobile 'My shivirs'). */
export function useMyShivirVolunteering(enabled = true) {
  return useQuery({
    queryKey: qk.shivirVolunteering,
    queryFn: () => apiGet<List<ShivirVolunteeringRow>>("/v1/shivirs/mine"),
    enabled,
  });
}

export function useRegisterForShivir(shivirId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ student_id }: { student_id: string }) =>
      apiPost<{ id: string; status: string }>(`/v1/shivirs/${shivirId}/register`, { student_id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shivirMyRegistrations(shivirId ?? "") });
      qc.invalidateQueries({ queryKey: qk.shivir(shivirId ?? "") });
    },
  });
}

export function useCancelShivirRegistration(shivirId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ student_id }: { student_id: string }) =>
      apiDelete<{ id: string }>(`/v1/shivirs/${shivirId}/register/${student_id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.shivirMyRegistrations(shivirId ?? "") });
      qc.invalidateQueries({ queryKey: qk.shivir(shivirId ?? "") });
    },
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

/** BRD 7.2 manual categories, resolved from the catalogue (H6). */
export interface PunyaAwardCategory {
  key: string;
  label: string;
  min_points: number | null;
  max_points: number | null;
  default_points: number | null;
  requires_reason: boolean;
}

export function usePunyaAwardCategories(enabled = true) {
  return useQuery({
    queryKey: ["punya-award-categories"],
    queryFn: () =>
      apiGet<{ items: PunyaAwardCategory[] }>("/v1/admin/punya/award-categories"),
    enabled,
    // Categories change about never; refetching them per sheet-open is waste.
    staleTime: 10 * 60_000,
  });
}

export type AwardPunyaResult = {
  student_id: string;
  points_awarded: number;
  total_points: number;
  tier: string;
  feature_key?: string;
};

export function useAwardPunya() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      student_id: string;
      points: number;
      note?: string;
      /** H6 — which of BRD 7.2's categories this award is for. */
      feature_key?: string;
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
  points_awarded?: number;
  rejection_reason?: string | null;
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
  /**
   * Which submission statuses to list. Defaults to ['pending'] server-side.
   * niyams.approval_mode defaults to 'auto', so a pending-only queue is empty
   * by construction on a default platform — the Sanchalak safety net Q12
   * mandates had nothing to catch until this existed.
   */
  statuses?: string[];
  enabled?: boolean;
}) {
  const batchId = opts.batchId ?? null;
  const niyamType = opts.niyamType ?? null;
  const studentId = opts.studentId ?? null;
  const statuses = opts.statuses ?? ["pending"];
  const enabled = opts.enabled !== false;
  return useInfiniteQuery({
    queryKey: [
      ...qk.pendingNiyam(batchId, niyamType),
      studentId ?? "",
      statuses.join(","),
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: "30" });
      if (batchId) qs.set("batch_id", batchId);
      if (niyamType) qs.set("niyam_type", niyamType);
      if (studentId) qs.set("student_id", studentId);
      for (const s of statuses) qs.append("status", s);
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

/** Cursor-paged (SAN-PRF-03): the flat fetch ended silently at the limit. */
export function useAdminEnrolments(status?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.adminEnrolments(status),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "100" });
      if (status) params.set("status", status);
      if (pageParam) params.set("cursor", String(pageParam));
      return apiGetEnvelope<List<EnrolmentRow>>(`/v1/admin/enrolments?${params.toString()}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      const next = lastPage.meta?.next_cursor;
      return typeof next === "string" && next.length > 0 ? next : null;
    },
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

/**
 * One ranged call with per-date results (SAN-PRF-01) — replaces the 20 serial
 * single-date requests a long break used to need.
 */
export function useCreateCentreHolidayRange() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      centreId,
      start_date,
      end_date,
      reason,
    }: {
      centreId: string;
      start_date: string;
      end_date: string;
      reason?: string;
    }) =>
      apiPost<{ results: Array<{ holiday_date: string; status: "created" | "already_exists" }> }>(
        `/v1/admin/centres/${centreId}/holidays/range`,
        {
          start_date,
          end_date,
          reason: reason || undefined,
          is_published: true,
        },
      ),
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
  media?: Array<{
    url: string;
    kind: string;
    mime?: string;
    size_bytes?: number;
    /** Set for proof captured offline and still in the media-upload queue. */
    local_uri?: string;
    media_upload_id?: string;
    pending_upload?: boolean;
  }>;
  notes?: string;
}
export interface SubmitNiyamNewBadge {
  badge_key: string;
  streak_length: number;
  points_awarded: number;
}
export interface SubmitNiyamResult {
  id: string;
  /** Server submission status ('auto_approved' | 'pending'), or 'queued' when offline. */
  status: string;
  new_badges?: SubmitNiyamNewBadge[];
  /** Points actually awarded, from the server. Absent while queued. */
  points_awarded?: number;
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
      submission_date,
    }: SubmitNiyamInput): Promise<SubmitNiyamResult> => {
      const { enqueueNiyamSubmission, drainQueues } = await import("@/lib/offline/sync-engine");

      const wireMedia: PendingProofMedia[] | undefined =
        media && media.length > 0
          ? media.map((m) => ({
              url: m.url,
              kind: (m.kind === "video" || m.kind === "audio" ? m.kind : "photo") as
                | "photo"
                | "video"
                | "audio",
              mime: m.mime,
              size_bytes: m.size_bytes,
              // Proof still sitting in the media-upload queue (captured offline).
              // planDrain holds the op back until these clear.
              local_uri: m.local_uri,
              media_upload_id: m.media_upload_id,
              pending_upload: m.pending_upload,
            }))
          : proof_url
            ? [{ url: proof_url, kind: "photo" as const }]
            : undefined;

      const submission_op_id = await enqueueNiyamSubmission({
        niyam_id,
        student_id,
        media: wireMedia,
        notes,
        submission_date,
      });

      // Point the queued proof files at the op they belong to, so an upload that
      // completes minutes later knows which submission to fill in.
      const pendingUploadIds = (wireMedia ?? [])
        .filter((m) => m.pending_upload && m.media_upload_id)
        .map((m) => m.media_upload_id as string);
      if (pendingUploadIds.length > 0) {
        const { linkNiyamMediaUploads } = await import(
          "@/lib/offline/media-upload-queue"
        );
        await linkNiyamMediaUploads(submission_op_id, pendingUploadIds);
      }

      // Best-effort immediate drain when online; offline this is a no-op and the
      // loop picks it up. The per-op result is returned so the screen can tell
      // "saved offline" from "the server rejected this".
      const results = await drainQueues();
      const mine = results.find((r) => r.submission_op_id === submission_op_id);

      // The server's own view of the submission — auto_approved vs pending, and
      // the badges the streak just completed. Reporting only "submitted"/"queued"
      // meant an auto-approved niyam was announced as "sent for review" and the
      // badge celebration never fired.
      const server = (mine?.data ?? null) as {
        status?: string;
        points_awarded?: number;
        new_badges?: SubmitNiyamNewBadge[];
      } | null;

      return {
        id: mine?.server_id ?? "",
        status: mine?.status === "success" ? (server?.status ?? "submitted") : "queued",
        new_badges: server?.new_badges ?? [],
        points_awarded: server?.points_awarded,
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
  /**
   * M10 — nullable. Typed as `string` before, so the compiler could not catch a
   * render site that dropped its `?? title_en` and went blank in Hindi.
   */
  title_hi: string | null;
  start_at: string;
  end_at: string;
  /**
   * C3 — RESOLVED values (AT21), not the raw nullable overrides.
   *
   * The stored columns mean "override the catalogue"; null means "pay the
   * punya_features default". The API used to hand those straight over, so a
   * quiz paying 30 Punya arrived as null/null, summed to 0, and rendered an
   * explicit "Practice / अभ्यास" badge. The server resolves them now, so 0 here
   * genuinely means disabled.
   */
  participation_points: number;
  win_points: number;
  already_attempted: boolean;
  /** Open attempt exists but has not been submitted yet. */
  in_progress: boolean;
  /** True when the student submitted with every answer correct. */
  is_winner?: boolean;
  /** Punya actually awarded for this attempt, read off the ledger (C3). */
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
/** M7 — per-question outcome, returned on submit and in history. */
export interface QuizQuestionResult {
  question_id: string;
  correct: boolean;
}
export interface QuizSubmitResponse {
  attempt_id: string;
  score: number;
  correct_count: number;
  total_count: number;
  all_correct: boolean;
  points_awarded: number;
  question_results?: QuizQuestionResult[];
}

/** M8 — a past attempt with everything the review screen needs. */
export interface QuizHistoryQuestion extends QuizQuestion {
  selected_indices: number[];
  correct_indices: number[];
  correct: boolean;
}
export interface QuizHistoryRow {
  attempt_id: string;
  event_id: string;
  title_en: string;
  title_hi: string | null;
  start_at: string;
  end_at: string;
  submitted_at: string;
  correct_count: number;
  total_count: number;
  score: number | null;
  is_winner: boolean;
  points_earned: number;
  questions: QuizHistoryQuestion[];
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
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.quizzesAvailable(vars.student_id) });
      qc.invalidateQueries({ queryKey: qk.quizHistory(vars.student_id) });
    },
  });
}

/**
 * M8 — past quizzes, which used to vanish at end_at.
 *
 * /events/available filters `end_at >= now` and the result view lived in
 * component state, so once a window closed a child could not see what they had
 * scored or revisit a question they got wrong. Fetched lazily: only the History
 * section mounts it.
 */
export function useQuizHistory(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.quizHistory(studentId ?? ""),
    queryFn: () =>
      apiGet<List<QuizHistoryRow>>(`/v1/quizzes/events/history?student_id=${studentId}`),
    enabled: enabled && !!studentId,
  });
}

// --- Push quizzes (live, batch-scoped; shikshak-initiated) ---
export interface PushQuizActive {
  id: string;
  started_at: string;
  expires_at: string;
  /** RESOLVED completion points (AT21) — 0 means disabled, never "unset" (C3). */
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
  question_results?: QuizQuestionResult[];
}

/**
 * Live push quizzes for this student. Polled while the student sits on the
 * quizzes screen so a live push appears without a reload.
 *
 * M4 — `items` is the list; `active` is the newest and is kept for older
 * clients. The endpoint used to return ONE quiz, so two overlapping pushes (a
 * centre-wide one and the Guruji's batch one) left the older permanently
 * unreachable — the student was never shown it and could not ask for it.
 */
export function useActivePushQuiz(studentId?: string, enabled = true) {
  return useQuery({
    queryKey: qk.pushQuizActive(studentId ?? ""),
    queryFn: () =>
      apiGet<{ active: PushQuizActive | null; items?: PushQuizActive[] }>(
        `/v1/quizzes/push/active?student_id=${studentId}`,
      ),
    enabled: enabled && !!studentId,
    // Polling remains the fallback; /push-quizzes/:id is the fast path (H10).
    refetchInterval: 20_000,
  });
}
/* ── H17 — the Guruji's own push-quiz surface ───────────────────────────────
 *
 * SPEC §15.2 calls a push quiz an "instant quiz created on-the-fly by
 * Guruji/Didi during a session", and the API has always admitted a shikshak to
 * POST /push. There was no UI on ANY surface: the web nav gates /admin/quizzes
 * at city_admin, and mobile had /quizzes only in PARENT_ACTIONS. The persona the
 * feature was designed for could not reach it — while the same persona WAS
 * admitted by the API to routes they should not have touched (C1).
 *
 * Mobile, not web: a Guruji mid-class is holding a phone.
 */
export interface ShikshakPushQuizRow {
  id: string;
  scope: string;
  started_at: string;
  expires_at: string;
  completion_points: number | null;
  question_count: number;
  submitted_count: number;
  is_live: boolean;
  batch_ids?: string[];
  batch_id?: string | null;
}

export interface PushQuizAttemptRow {
  attempt_id: string;
  student_id: string;
  full_name: string;
  centre_name: string | null;
  batch_name: string | null;
  submitted_at: string | null;
  correct_count: number;
  total_count: number;
  score: number | null;
  points_awarded: number;
}

export interface PushQuizRosterPayload {
  items: PushQuizAttemptRow[];
  is_live: boolean;
  attempted_count: number;
  submitted_count: number;
  eligible_count: number;
  average_score: number;
}

/** Push quizzes visible to this staff member, live first. */
export function useMyPushQuizzes(enabled = true) {
  return useQuery({
    queryKey: qk.shikshakPushQuizzes,
    queryFn: () => apiGet<List<ShikshakPushQuizRow>>(`/v1/quizzes/push?limit=50`),
    enabled,
  });
}

/**
 * The live roster. Polled at 5s while the quiz is live — the Socket.IO
 * `/push-quizzes/:id` namespace is the fast path; this is the fallback that
 * works when the socket cannot connect.
 */
export function usePushQuizRoster(pushQuizId: string | null, isLive: boolean) {
  return useQuery({
    queryKey: qk.pushQuizRoster(pushQuizId ?? ""),
    queryFn: () => apiGet<PushQuizRosterPayload>(`/v1/quizzes/push/${pushQuizId}/attempts`),
    enabled: !!pushQuizId,
    refetchInterval: isLive ? 5_000 : false,
  });
}

export interface StartPushQuizInput {
  batch_id: string;
  minutes: number;
  completion_points?: number;
  questions: Array<{
    question_en: string;
    question_hi?: string;
    options: Array<{ text_en: string; text_hi?: string }>;
    correct_indices: number[];
  }>;
}

export function useStartPushQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ batch_id, minutes, completion_points, questions }: StartPushQuizInput) =>
      apiPost<{ id: string }>(`/v1/quizzes/push`, {
        scope: "batch",
        batch_ids: [batch_id],
        expires_at: new Date(Date.now() + minutes * 60 * 1000).toISOString(),
        ...(completion_points !== undefined ? { completion_points } : {}),
        questions,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.shikshakPushQuizzes }),
  });
}

/** H12 — stop a live quiz now (sets expires_at = now()). */
export function useEndPushQuiz() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPost<{ ended: boolean }>(`/v1/quizzes/push/${id}/end`, {}),
    onSuccess: (_r, id) => {
      qc.invalidateQueries({ queryKey: qk.shikshakPushQuizzes });
      qc.invalidateQueries({ queryKey: qk.pushQuizRoster(id) });
    },
  });
}

/** H12 — reverse a student's Punya and let them retake. */
export function useResetPushQuizAttempt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pushQuizId, attemptId }: { pushQuizId: string; attemptId: string }) =>
      apiPost<{ points_reversed: number }>(
        `/v1/quizzes/push/${pushQuizId}/attempts/${attemptId}/reset`,
        {},
      ),
    onSuccess: (_r, vars) =>
      qc.invalidateQueries({ queryKey: qk.pushQuizRoster(vars.pushQuizId) }),
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
    // Explicit server max — curricula counts are far below 200; the web
    // directory pages past it if the network ever grows that large.
    queryFn: () => apiGet<List<CourseListRow>>("/v1/public/courses?limit=200"),
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
    /** H22 — the city that gates the CU22 punya_configs lookup for this course. */
    city_id: string | null;
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
 * H22 — the same punya_configs/punya_features rows CoursesAdminPage's H16
 * certify panel reads on web, so the CU18 confirm can show the real clamped
 * Punya value instead of the raw authored punya_points. Long staleTime: these
 * change about never, and re-fetching them per certify-open would just delay
 * the confirm sheet.
 */
export function useAdminPunyaConfigs(enabled = true) {
  return useQuery({
    queryKey: qk.adminPunyaConfigs,
    queryFn: () => apiGet<List<CoursePunyaConfigRow>>("/v1/admin/punya/configs"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useAdminPunyaFeatures(enabled = true) {
  return useQuery({
    queryKey: qk.adminPunyaFeatures,
    queryFn: () => apiGet<List<CoursePunyaFeatureRow>>("/v1/admin/punya/features"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/**
 * C5 — throw whenever a drain resolved to a genuinely terminal outcome
 * (conflict, or failed with attempts exhausted) so `onError` actually fires.
 * "queued" (still retrying) and "duplicate" are NOT errors and must not
 * throw — see resolveSyncOpOutcome's doc for why "failed" alone is not a
 * reliable signal on its own.
 */
function throwIfTerminalSyncOutcome(outcome: SyncOpOutcome): void {
  if (outcome.status !== "conflict" && outcome.status !== "failed") return;
  const err = outcome.result?.error;
  const statusCode = outcome.status === "conflict" ? 409 : 500;
  const fallback =
    outcome.status === "conflict"
      ? "A newer update already exists on the server — refresh and re-mark if needed."
      : "This could not be saved after several attempts — tap retry to try again.";
  throw new ApiError(
    err?.code ?? (outcome.status === "conflict" ? "ERR_CONFLICT" : "ERR_SYNC_FAILED"),
    err?.message ?? fallback,
    statusCode,
  );
}

/** CU13 — resolve a batch's active roster client-side for an offline bulk write (H17). */
async function fetchActiveBatchRoster(batchId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  // Bounded so a misbehaving API can't loop forever.
  for (let page = 0; page < 40; page += 1) {
    const qs = new URLSearchParams({ limit: "50", status: "active", batch_id: batchId });
    if (cursor) qs.set("cursor", cursor);
    const res = await apiGet<AdminStudentsPage>(`/v1/admin/students?${qs.toString()}`);
    ids.push(...res.items.map((s) => s.id));
    cursor = res.next_cursor ?? null;
    if (!cursor) break;
  }
  return ids;
}

/** H21 — immutable patch used by onMutate so a tap shows its own status right away. */
function patchCourseTreeStatus(
  tree: StudentCourseTree,
  nodeKind: "section" | "subsection",
  nodeId: string,
  status: "not_started" | "in_progress" | "completed",
): StudentCourseTree {
  if (nodeKind === "section") {
    return {
      ...tree,
      sections: tree.sections.map((s) => (s.id === nodeId ? { ...s, status } : s)),
    };
  }
  return {
    ...tree,
    sections: tree.sections.map((s) => ({
      ...s,
      subsections: s.subsections.map((sub) => (sub.id === nodeId ? { ...sub, status } : sub)),
    })),
  };
}

export type SetCourseNodeProgressInput = {
  nodeId: string;
  nodeKind: "section" | "subsection";
  student_id: string;
  status: "not_started" | "in_progress" | "completed";
  note?: string;
};

export type CourseSyncWriteResult = {
  submission_op_id?: string;
  result?: DrainOpResult | null;
  queued: boolean;
  duplicate?: boolean;
};

/**
 * Single-student progress write. Guruji/Sanchalak enqueue for offline parity;
 * parent/student now route through the SAME queue path (H20 — CU31 scopes
 * offline parity by op type, not persona).
 *
 * C5 — throws on a conflict or a genuinely exhausted failure so `onError`
 * fires; a still-retrying op resolves normally (it is safely queued).
 */
export async function runSetCourseNodeProgress(
  body: SetCourseNodeProgressInput,
  opts?: { offline?: boolean },
): Promise<CourseSyncWriteResult> {
  if (opts?.offline) {
    const { enqueueCourseProgress, drainQueues, resolveSyncOpOutcome } = await import(
      "@/lib/offline/sync-engine"
    );
    const { QUEUE_KEYS } = await import("@/lib/offline/queue-keys");
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
    const outcome = await resolveSyncOpOutcome(
      QUEUE_KEYS.course_progress,
      submission_op_id,
      results,
    );
    throwIfTerminalSyncOutcome(outcome);
    return {
      submission_op_id,
      result: outcome.result ?? null,
      queued: outcome.status === "queued",
      duplicate: outcome.status === "duplicate",
    };
  }
  // C3/CU31 — the online path is governed by the same newest-wins rule
  // as offline sync; sending marked_at/client_op_id here means an
  // offline replay that arrives later can't silently clobber this tap.
  const { ulid } = await import("@/lib/offline/ulid");
  await apiPost(`/v1/courses/nodes/${body.nodeId}/progress`, {
    student_id: body.student_id,
    status: body.status,
    note: body.note,
    client_op_id: ulid(),
    client_marked_at: new Date().toISOString(),
  });
  return { queued: false };
}

export function useSetCourseNodeProgress(opts?: { offline?: boolean }) {
  const qc = useQueryClient();
  const offline = opts?.offline ?? false;
  return useMutation({
    mutationFn: (body: SetCourseNodeProgressInput) =>
      runSetCourseNodeProgress(body, { offline }),
    // H21 — patch the cached tree immediately so a queued tap shows its own
    // new status right away instead of waiting on a refetch (which, offline,
    // may not resolve for a while). Rolled back in onError.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["courses", "tree"] });
      const previous = qc.getQueriesData<StudentCourseTree>({ queryKey: ["courses", "tree"] });
      qc.setQueriesData<StudentCourseTree>({ queryKey: ["courses", "tree"] }, (old) =>
        old ? patchCourseTreeStatus(old, vars.nodeKind, vars.nodeId, vars.status) : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
    },
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
      void qc.invalidateQueries({ queryKey: qk.adminStudentProgress(vars.student_id) });
    },
  });
}

export type BulkCourseNodeProgressInput = {
  nodeId: string;
  nodeKind?: "section" | "subsection";
  batch_id?: string;
  student_ids?: string[];
  status: "not_started" | "in_progress" | "completed";
  note?: string;
  /** When true (default), queue + drain like every other shikshak write. */
  offline?: boolean;
};

/**
 * H17 — bulk now routes through the EXISTING jp.queue.course_progress queue
 * when offline, same as the single-student write. Its `marks` array already
 * carries a roster (CLAUDE.md offline §1); a `batch_id` alone is resolved to
 * an active student id list client-side first, since the canonical queue
 * payload has no batch_id field for the server to resolve.
 */
export async function runBulkCourseNodeProgress(
  body: BulkCourseNodeProgressInput,
): Promise<{ applied: number; skipped: number; student_ids?: string[] }> {
  const { ulid } = await import("@/lib/offline/ulid");
  const useOffline = body.offline !== false;
  if (useOffline) {
    const studentIds = body.student_ids?.length
      ? body.student_ids
      : body.batch_id
        ? await fetchActiveBatchRoster(body.batch_id)
        : [];
    if (studentIds.length === 0) {
      throw new ApiError(
        "ERR_COURSE_ROSTER_UNAVAILABLE",
        "Could not resolve this batch's roster for a bulk update — check your connection and try again.",
        409,
      );
    }
    const { enqueueCourseProgress, drainQueues, resolveSyncOpOutcome } = await import(
      "@/lib/offline/sync-engine"
    );
    const { QUEUE_KEYS } = await import("@/lib/offline/queue-keys");
    const submission_op_id = await enqueueCourseProgress({
      node_kind: body.nodeKind ?? "section",
      node_id: body.nodeId,
      marks: studentIds.map((student_id) => ({
        student_id,
        status: body.status,
        note: body.note,
        client_op_id: ulid(),
      })),
    });
    const results = await drainQueues();
    const outcome = await resolveSyncOpOutcome(
      QUEUE_KEYS.course_progress,
      submission_op_id,
      results,
    );
    throwIfTerminalSyncOutcome(outcome);
    return { applied: studentIds.length, skipped: 0, student_ids: studentIds };
  }
  // H25 — carry a submission_op_id so a flaky-wifi retry of the same
  // bulk request replays via sync_operations instead of walking the
  // roster a second time.
  return apiPost<{ applied: number; skipped: number; student_ids?: string[] }>(
    `/v1/courses/nodes/${body.nodeId}/progress/bulk`,
    {
      batch_id: body.batch_id,
      student_ids: body.student_ids,
      status: body.status,
      note: body.note,
      submission_op_id: ulid(),
    },
  );
}

export function useBulkCourseNodeProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runBulkCourseNodeProgress,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
      // M26 — a bulk write can touch many students at once; invalidate the
      // whole admin-student-progress prefix rather than one id we don't have.
      void qc.invalidateQueries({ queryKey: ["admin", "student"] });
    },
  });
}

export type CertifyCourseNodeInput = {
  nodeId: string;
  nodeKind: "section" | "subsection";
  student_id: string;
  note?: string;
  /** When true (default for admin personas), queue + drain. */
  offline?: boolean;
};

/**
 * Certify one student. Always enqueue offline for Guruji/Sanchalak so CU31
 * parity holds; call only after CU18 confirm on device.
 *
 * C5 — throws on a conflict or a genuinely exhausted failure so `onError`
 * fires instead of the caller reading loss as success.
 */
export async function runCertifyCourseNode(body: CertifyCourseNodeInput) {
  const useOffline = body.offline !== false;
  if (useOffline) {
    const { enqueueCourseCertification, drainQueues, resolveSyncOpOutcome } = await import(
      "@/lib/offline/sync-engine"
    );
    const { QUEUE_KEYS } = await import("@/lib/offline/queue-keys");
    const submission_op_id = await enqueueCourseCertification({
      node_kind: body.nodeKind,
      node_id: body.nodeId,
      student_id: body.student_id,
      certification_note: body.note,
    });
    const results = await drainQueues();
    const outcome = await resolveSyncOpOutcome(
      QUEUE_KEYS.course_certification,
      submission_op_id,
      results,
    );
    throwIfTerminalSyncOutcome(outcome);
    return {
      submission_op_id,
      result: outcome.result ?? null,
      queued: outcome.status === "queued",
      duplicate: outcome.status === "duplicate",
    } satisfies CourseSyncWriteResult;
  }
  return apiPost(`/v1/courses/nodes/${body.nodeId}/certify`, {
    student_id: body.student_id,
    note: body.note,
  });
}

export function useCertifyCourseNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: runCertifyCourseNode,
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: ["courses", "tree"] });
      void qc.invalidateQueries({ queryKey: qk.studentCertificates(vars.student_id) });
    },
  });
}

/* ---------------- Punya leaderboards (BRD §7.6, H2) ---------------- */

export interface LeaderboardRow {
  rank: number;
  student_id: string;
  full_name: string;
  student_code: string | null;
  tier: string;
  points: number;
}

export interface LeaderboardResponse {
  scope: "batch" | "centre" | "city" | "msv";
  scope_id: string | null;
  period: "month" | "all_time";
  month: string | null;
  items: LeaderboardRow[];
  /** The caller's own child, even when outside the top N (SPEC §6.9). */
  me: LeaderboardRow | null;
  total_ranked: number;
}

/**
 * A scoped Punya leaderboard.
 *
 * There was no leaderboard endpoint at any scope, so nothing on any client
 * could show a child where they stand. Monthly by default because BRD §7.6
 * says the centre and city boards reset monthly.
 */
export function usePunyaLeaderboard(
  scope: "batch" | "centre" | "city" | "msv",
  scopeId?: string | null,
  opts?: { period?: "month" | "all_time"; limit?: number; enabled?: boolean },
) {
  const period = opts?.period ?? "month";
  const limit = opts?.limit ?? 20;
  const needsId = scope !== "msv";
  return useQuery({
    queryKey: ["leaderboard", scope, scopeId ?? "all", period, limit],
    queryFn: () => {
      const params = new URLSearchParams({ scope, period, limit: String(limit) });
      if (scopeId) params.set("id", scopeId);
      return apiGet<LeaderboardResponse>(`/v1/leaderboard?${params.toString()}`);
    },
    enabled: (opts?.enabled ?? true) && (!needsId || !!scopeId),
    // A board that lags a minute is fine; refetching it per focus is not.
    staleTime: 60_000,
  });
}
