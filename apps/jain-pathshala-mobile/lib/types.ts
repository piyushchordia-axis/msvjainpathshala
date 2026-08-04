/**
 * DTOs for the mobile app — re-exported from the shared @workspace/api-zod
 * contracts so the app and backend never drift. Legacy aliases keep older
 * screens compiling while everything migrates to the api-zod names.
 */
export type {
  Role,
  SessionUser,
  AuthTokens,
  OtpSendResponse,
  OtpVerifyResponse,
  // Public
  CentreRow,
  CentreDetail,
  PublicBatchRow,
  ShivirRow,
  ShivirDetail,
  NoticeItem,
  PublicLibraryItem,
  PublicGalleryItem,
  // Admin
  OverviewPayload,
  AdminStudentRow,
  EnrolmentRow,
  AdminBatchRow,
  // Persona ("me")
  ChildRow,
  AttendanceRow,
  PunyaTransaction,
  PunyaSummary,
  NiyamSubmissionRow,
  NiyamCatalogRow,
  ShikshakSessionRow,
} from "@workspace/api-zod";

import type {
  CentreRow,
  PublicBatchRow,
  ShivirRow,
  PublicLibraryItem,
  PublicGalleryItem,
  OverviewPayload,
  AdminStudentRow,
  EnrolmentRow,
  AdminBatchRow,
} from "@workspace/api-zod";

// Legacy aliases (used by existing screens during migration).
export type CentreListItem = CentreRow;
export type BatchItem = PublicBatchRow;
export type ShivirListItem = ShivirRow;
export type LibraryItem = PublicLibraryItem;
export type GalleryItem = PublicGalleryItem;
export type AnalyticsOverview = OverviewPayload;
export type AdminStudent = AdminStudentRow;
export type AdminEnrolment = EnrolmentRow;
export type AdminBatch = AdminBatchRow;

export interface ListResponse<T> {
  items: T[];
  /** Present when the endpoint uses keyset pagination (e.g. homework /mine). */
  next_cursor?: string | null;
  has_more?: boolean;
}
