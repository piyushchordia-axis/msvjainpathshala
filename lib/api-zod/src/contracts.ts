import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function envelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    data,
    meta: z.record(z.string(), z.unknown()).optional(),
  });
}

/* ------------------------------------------------------------------ */
/* Enums (mirror lib/db/src/schema/enums.ts)                          */
/* ------------------------------------------------------------------ */

export const roleSchema = z.enum([
  "super_admin",
  "state_admin",
  "city_admin",
  "sanchalak",
  "shikshak",
  "parent",
  "student",
  "guest",
]);
export type Role = z.infer<typeof roleSchema>;

export const languageSchema = z.enum(["en", "hi"]);
export const ageGroupSchema = z.enum(["bal", "kishor", "tarun", "yuva"]);
export const enrolmentStatusSchema = z.enum(["pending", "approved", "rejected", "waitlisted"]);
export const studentStatusSchema = z.enum(["active", "inactive"]);
export const libraryContentTypeSchema = z.enum(["pdf", "video", "audio", "image"]);

export const ADMIN_PANEL_ROLES: Role[] = [
  "super_admin",
  "state_admin",
  "city_admin",
  "sanchalak",
  "shikshak",
];

export function canAccessAdminPanel(role: Role | null | undefined): boolean {
  return !!role && ADMIN_PANEL_ROLES.includes(role);
}

/* ------------------------------------------------------------------ */
/* Auth                                                               */
/* ------------------------------------------------------------------ */

export const otpSendRequestSchema = z.object({
  phase: z.literal("send"),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (+91…)"),
});

export const otpVerifyRequestSchema = z.object({
  phase: z.literal("verify"),
  otp_token: z.string().min(16),
  code: z.string().length(6).regex(/^\d{6}$/),
  device_id: z.string().min(1).max(128),
});

export const loginRequestSchema = z.discriminatedUnion("phase", [
  otpSendRequestSchema,
  otpVerifyRequestSchema,
]);

export const otpSendResponseSchema = z.object({
  otp_token: z.string(),
  expires_in_seconds: z.number(),
  dev_code: z.string().optional(),
});
export type OtpSendResponse = z.infer<typeof otpSendResponseSchema>;

export const sessionUserSchema = z.object({
  id: z.string(),
  phone: z.string(),
  role: roleSchema,
  full_name: z.string(),
  preferred_language: languageSchema,
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const authTokensSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  access_expires_at: z.string(),
  refresh_expires_at: z.string(),
});
export type AuthTokens = z.infer<typeof authTokensSchema>;

export const otpVerifyResponseSchema = z.object({
  user: sessionUserSchema,
  tokens: authTokensSchema,
});
export type OtpVerifyResponse = z.infer<typeof otpVerifyResponseSchema>;

/* ------------------------------------------------------------------ */
/* Admin DTOs                                                         */
/* ------------------------------------------------------------------ */

export const overviewSchema = z.object({
  active_students: z.number(),
  centres: z.number(),
  open_service_requests: z.number(),
  attendance_rate_30d: z.number(),
  punya_awarded_30d: z.number(),
  msv_active: z.number(),
  donations_total_paise_ytd: z.number(),
});
export type OverviewPayload = z.infer<typeof overviewSchema>;

export const enrolmentRowSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  requested_centre_id: z.string(),
  requested_batch_id: z.string(),
  status: enrolmentStatusSchema,
});
export type EnrolmentRow = z.infer<typeof enrolmentRowSchema>;

export const adminStudentRowSchema = z.object({
  id: z.string(),
  full_name: z.string().nullable(),
  student_code: z.string(),
  age_group: z.string(),
  dob: z.string().nullable(),
  msv_status: z.string(),
  status: studentStatusSchema,
});
export type AdminStudentRow = z.infer<typeof adminStudentRowSchema>;

export const adminBatchRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  centre_name: z.string(),
  age_group: z.string(),
  shikshak_name: z.string().nullable(),
  day_of_week: z.array(z.number()),
  start_time: z.string(),
  end_time: z.string(),
  status: studentStatusSchema,
});
export type AdminBatchRow = z.infer<typeof adminBatchRowSchema>;

export const enrolmentActionSchema = z.object({
  reason: z.string().optional(),
});

export const studentStatusActionSchema = z.object({
  action: z.enum(["deactivate", "reactivate"]),
  reason: z.string().optional(),
});

/* ------------------------------------------------------------------ */
/* Public DTOs                                                        */
/* ------------------------------------------------------------------ */

export const centreRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  locality: z.string().nullable(),
  city_name: z.string(),
  state_name: z.string(),
  batch_count: z.number(),
});
export type CentreRow = z.infer<typeof centreRowSchema>;

export const centreDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  locality: z.string().nullable(),
  pincode: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_email: z.string().nullable(),
  city_name: z.string(),
  state_name: z.string(),
});
export type CentreDetail = z.infer<typeof centreDetailSchema>;

export const publicBatchRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  age_group: z.string(),
  day_of_week: z.array(z.number()),
  start_time: z.string(),
  end_time: z.string(),
  capacity: z.number(),
  language_preference: z.string().nullable(),
});
export type PublicBatchRow = z.infer<typeof publicBatchRowSchema>;

export const shivirRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  location_text: z.string().nullable(),
  city_name: z.string(),
});
export type ShivirRow = z.infer<typeof shivirRowSchema>;

export const shivirDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  location_text: z.string().nullable(),
  city_name: z.string(),
  state_name: z.string(),
  capacity: z.number().nullable(),
  contact_info: z.string().nullable(),
});
export type ShivirDetail = z.infer<typeof shivirDetailSchema>;

export const noticeItemSchema = z.object({
  id: z.string(),
  title_en: z.string().nullable(),
  title_hi: z.string().nullable(),
  content_en: z.string().nullable(),
  content_hi: z.string().nullable(),
  pinned: z.boolean(),
  is_critical: z.boolean(),
  created_at: z.string(),
});
export type NoticeItem = z.infer<typeof noticeItemSchema>;

export const libraryItemSchema = z.object({
  id: z.string(),
  content_type: libraryContentTypeSchema,
  title_en: z.string(),
  title_hi: z.string().nullable(),
  description_en: z.string().nullable(),
  description_hi: z.string().nullable(),
  embed_url: z.string().nullable(),
});
export type PublicLibraryItem = z.infer<typeof libraryItemSchema>;

export const galleryItemSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  age_group: z.string(),
  niyam_title_en: z.string(),
  niyam_title_hi: z.string(),
  niyam_type: z.string(),
  is_featured: z.boolean(),
  created_at: z.string(),
});
export type PublicGalleryItem = z.infer<typeof galleryItemSchema>;

/* ------------------------------------------------------------------ */
/* Persona ("me") DTOs — parent / student / shikshak scoped reads      */
/* ------------------------------------------------------------------ */

export const childRowSchema = z.object({
  id: z.string(),
  full_name: z.string(),
  student_code: z.string(),
  age_group: z.string(),
  centre_name: z.string().nullable(),
  batch_name: z.string().nullable(),
  msv_status: z.string(),
  status: studentStatusSchema,
  total_points: z.number(),
  tier: z.string(),
});
export type ChildRow = z.infer<typeof childRowSchema>;

export const attendanceRowSchema = z.object({
  id: z.string(),
  session_date: z.string(),
  status: z.string(),
  topic: z.string().nullable(),
  batch_name: z.string().nullable(),
});
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;

export const punyaTransactionSchema = z.object({
  id: z.string(),
  feature_key: z.string(),
  points: z.number(),
  note: z.string().nullable(),
  created_at: z.string(),
});
export type PunyaTransaction = z.infer<typeof punyaTransactionSchema>;

export const punyaSummarySchema = z.object({
  total_points: z.number(),
  tier: z.string(),
  transactions: z.array(punyaTransactionSchema),
});
export type PunyaSummary = z.infer<typeof punyaSummarySchema>;

export const niyamSubmissionRowSchema = z.object({
  id: z.string(),
  niyam_title_en: z.string(),
  niyam_title_hi: z.string(),
  niyam_type: z.string(),
  submission_date: z.string(),
  status: z.string(),
  points_awarded: z.number(),
  is_featured: z.boolean(),
});
export type NiyamSubmissionRow = z.infer<typeof niyamSubmissionRowSchema>;

export const niyamCatalogRowSchema = z.object({
  id: z.string(),
  title_en: z.string(),
  title_hi: z.string(),
  description_en: z.string().nullable(),
  description_hi: z.string().nullable(),
  niyam_type: z.string(),
  points: z.number(),
});
export type NiyamCatalogRow = z.infer<typeof niyamCatalogRowSchema>;

export const shikshakSessionRowSchema = z.object({
  id: z.string(),
  session_date: z.string(),
  status: z.string(),
  topic: z.string().nullable(),
  batch_name: z.string().nullable(),
  centre_name: z.string().nullable(),
  present_count: z.number(),
  total_count: z.number(),
});
export type ShikshakSessionRow = z.infer<typeof shikshakSessionRowSchema>;
