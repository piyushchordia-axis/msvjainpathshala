/**
 * React Query data layer. Every endpoint the personas consume lives here so
 * screens stay declarative and cache keys never drift. All hooks return the
 * unwrapped DTO (lib/api.ts strips the { data } envelope).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api";
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
