/**
 * React Query data layer. Every endpoint the personas consume lives here so
 * screens stay declarative and cache keys never drift. All hooks return the
 * unwrapped DTO (lib/api.ts strips the { data } envelope).
 */
import { Alert } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, ApiError } from "@/lib/api";
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

type List<T> = ListResponse<T>;

export const qk = {
  centres: ["public", "centres"] as const,
  centre: (id: string) => ["public", "centre", id] as const,
  shivirs: ["public", "shivirs"] as const,
  shivir: (id: string) => ["public", "shivir", id] as const,
  library: ["public", "library"] as const,
  notices: ["public", "notices"] as const,
  gallery: ["public", "gallery"] as const,
  children: ["me", "children"] as const,
  attendance: (id: string) => ["me", "attendance", id] as const,
  punya: (id: string) => ["me", "punya", id] as const,
  niyams: (id: string) => ["me", "niyams", id] as const,
  niyamCatalog: ["me", "niyam-catalog"] as const,
  today: ["me", "today"] as const,
  overview: ["admin", "overview"] as const,
  adminStudents: (s?: string) => ["admin", "students", s ?? "all"] as const,
  adminEnrolments: (s?: string) => ["admin", "enrolments", s ?? "all"] as const,
  adminBatches: ["admin", "batches"] as const,
  // Wave 4 (new student/parent flows)
  notifications: ["me", "notifications"] as const,
  homework: (id: string) => ["me", "homework", id] as const,
  quizzesAvailable: ["me", "quizzes", "available"] as const,
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

export function useGallery() {
  return useQuery({
    queryKey: qk.gallery,
    queryFn: () => apiGet<List<PublicGalleryItem>>("/v1/gallery?limit=60"),
  });
}

/* ------------------------------------------------------------------- me --- */

export function useChildren(enabled = true) {
  return useQuery({
    queryKey: qk.children,
    queryFn: () => apiGet<List<ChildRow>>("/v1/me/children"),
    enabled,
  });
}

export function useAttendance(studentId?: string) {
  return useQuery({
    queryKey: qk.attendance(studentId ?? ""),
    queryFn: () =>
      apiGet<List<AttendanceRow>>(`/v1/me/students/${studentId}/attendance`),
    enabled: !!studentId,
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

export function useNiyamCatalog(enabled = true) {
  return useQuery({
    queryKey: qk.niyamCatalog,
    queryFn: () => apiGet<List<NiyamCatalogRow>>("/v1/me/niyam-catalog"),
    enabled,
  });
}

export function useToday(enabled = true) {
  return useQuery({
    queryKey: qk.today,
    queryFn: () => apiGet<List<ShikshakSessionRow>>("/v1/me/today"),
    enabled,
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
  notes?: string;
}
interface SubmitNiyamResult { id: string; status: string }
export function useSubmitNiyam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId: _studentId, ...body }: SubmitNiyamInput) =>
      apiPost<SubmitNiyamResult>("/v1/niyam-submissions", body),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: qk.niyams(vars.studentId) });
      qc.invalidateQueries({ queryKey: qk.punya(vars.studentId) });
    },
  });
}

// --- Homework ---
export interface HomeworkRow {
  id: string;
  assignment_id: string;
  title: string;
  due_date: string;
  status: string;
  submission_url: string | null;
  feedback_note: string | null;
  late: boolean;
}
export function useHomework(studentId?: string) {
  return useQuery({
    queryKey: qk.homework(studentId ?? ""),
    queryFn: () => apiGet<List<HomeworkRow>>(`/v1/homework/mine?student_id=${studentId}`),
    enabled: !!studentId,
  });
}
export function useSubmitHomework() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, submission_url }: { id: string; studentId: string; submission_url: string }) =>
      apiPost<{ id: string; status: string }>(`/v1/homework/submissions/${id}/submit`, { submission_url }),
    onSuccess: (_data, vars) => qc.invalidateQueries({ queryKey: qk.homework(vars.studentId) }),
    onError: (err) => Alert.alert("Could not submit", err instanceof Error ? err.message : "Please try again."),
  });
}

// --- Quizzes ---
export interface QuizEventRow {
  id: string;
  title_en: string;
  title_hi: string;
  start_at: string;
  end_at: string;
  already_attempted: boolean;
  total_questions?: number;
}
export interface QuizOption { text_en: string; text_hi: string }
export interface QuizQuestion { id: string; question_en: string; question_hi: string; options: QuizOption[] }
export interface QuizStartResponse { attempt_id: string; questions: QuizQuestion[] }
export interface QuizSubmitResponse { score: number; correct_count: number; total_count: number }
export function useAvailableQuizzes(enabled = true) {
  return useQuery({
    queryKey: qk.quizzesAvailable,
    queryFn: () => apiGet<List<QuizEventRow>>("/v1/quizzes/events/available"),
    enabled,
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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.quizzesAvailable }),
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
  version_no: number;
  is_active: boolean;
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
