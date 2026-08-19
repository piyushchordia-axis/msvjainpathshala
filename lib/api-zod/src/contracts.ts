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
export type AgeGroup = z.infer<typeof ageGroupSchema>;

/** AT1 — attendance mark status. */
export const attendanceStatusSchema = z.enum(["present", "absent", "late", "excused"]);
export type AttendanceStatus = z.infer<typeof attendanceStatusSchema>;

export const sessionStatusSchema = z.enum(["scheduled", "in_progress", "completed", "cancelled"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

/** Crockford Base32 ULID (26 chars) — AT19 / offline sync ids. */
export const ulidSchema = z
  .string()
  .length(26)
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Must be a Crockford Base32 ULID");

/**
 * Two-level offline id scheme (AT19):
 * - submission_op_id: one per sync batch / HTTP submission (sync_operations)
 * - client_op_id: one per attendance item (attendance.client_op_id)
 */
export const syncSubmissionSchema = z.object({
  submission_op_id: ulidSchema,
  items: z
    .array(
      z.object({
        client_op_id: ulidSchema,
        session_id: z.string().uuid(),
        student_id: z.string().uuid(),
        status: attendanceStatusSchema,
      }),
    )
    .min(1),
});
export type SyncSubmission = z.infer<typeof syncSubmissionSchema>;

/**
 * Homework offline op payload (CLAUDE.md §1). Prefer assignment_id + student_id;
 * submission_id is optional back-compat for older clients.
 */
export const homeworkSyncPayloadSchema = z.object({
  assignment_id: z.string().uuid().optional(),
  student_id: z.string().uuid().optional(),
  submission_id: z.string().uuid().optional(),
  /** Canonical proof field — http(s) URL or upload asset id resolved by the client. */
  proof_asset_id: z.string().optional(),
  /** Legacy alias for proof_asset_id. */
  file_url: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});
export type HomeworkSyncPayload = z.infer<typeof homeworkSyncPayloadSchema>;

export const markAttendanceRecordSchema = z.object({
  student_id: z.string().uuid(),
  status: attendanceStatusSchema,
  client_op_id: ulidSchema.optional(),
});
export type MarkAttendanceRecord = z.infer<typeof markAttendanceRecordSchema>;

/** Display metadata for age groups (mirrors lib/db/src/schema/enums.ts). */
export const AGE_GROUPS = ["bal", "kishor", "tarun", "yuva"] as const;
export const AGE_GROUP_META = {
  bal: { label_en: "Bal 5-8 years", label_hi: "बाल 5-8 वर्ष", min: 5, max: 8 },
  kishor: { label_en: "Kishor 9-12 years", label_hi: "किशोर 9-12 वर्ष", min: 9, max: 12 },
  tarun: { label_en: "Tarun 13-16 years", label_hi: "तरुण 13-16 वर्ष", min: 13, max: 16 },
  yuva: { label_en: "Yuva 17-21 years", label_hi: "युवा 17-21 वर्ष", min: 17, max: 21 },
} as const satisfies Record<AgeGroup, { label_en: string; label_hi: string; min: number; max: number }>;

/** Whole years completed as of `on` (default today, local calendar). */
export function ageYearsFromDob(dob: string | Date, on: Date = new Date()): number {
  const d = typeof dob === "string" ? new Date(`${dob.slice(0, 10)}T00:00:00`) : dob;
  if (Number.isNaN(d.getTime())) return NaN;
  let age = on.getFullYear() - d.getFullYear();
  const monthDelta = on.getMonth() - d.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && on.getDate() < d.getDate())) age -= 1;
  return age;
}

/**
 * Two age gates, kept as separate constants even while they hold the same
 * value: they gate different capabilities (holding a login vs being the
 * authoritative writer of your own progress record) and have moved
 * independently before, so collapsing them into one would lose that seam.
 *
 * Both are enforced server-side (join provisioning / auth + course services),
 * never only on the client. A missing or unparseable DOB fails both.
 */

/** Minimum age to be provisioned an independent OTP login (users.role='student'). */
export const MIN_STUDENT_LOGIN_AGE = 8;

/**
 * Q4 — minimum age for student-view capabilities (writing one's own course
 * progress). Lowered 13 → 8 in August 2026 to match the login age: a child old
 * enough to sign in on their own is treated as old enough to tick off their own
 * progress. Callers must build their messages from this constant, never retype
 * the number.
 */
export const MIN_STUDENT_VIEW_AGE = 8;

function meetsAge(dob: string | Date | null | undefined, min: number, on: Date): boolean {
  if (!dob) return false;
  const age = ageYearsFromDob(dob, on);
  return Number.isFinite(age) && age >= min;
}

/** Whether a student may be provisioned their own OTP login. */
export function meetsStudentLoginAge(
  dob: string | Date | null | undefined,
  on: Date = new Date(),
): boolean {
  return meetsAge(dob, MIN_STUDENT_LOGIN_AGE, on);
}

/**
 * Whether a student is old enough for student-view capabilities (Q4).
 * Returns a plain boolean — callers build their own error envelope, because the
 * existing gates disagree on response shape.
 */
export function meetsStudentViewAge(
  dob: string | Date | null | undefined,
  on: Date = new Date(),
): boolean {
  return meetsAge(dob, MIN_STUDENT_VIEW_AGE, on);
}

/** Map DOB → age group using AGE_GROUP_META ranges. Null if outside 5–21. */
export function ageGroupFromDob(dob: string | Date, on: Date = new Date()): AgeGroup | null {
  const age = ageYearsFromDob(dob, on);
  if (!Number.isFinite(age) || age < 0) return null;
  for (const g of AGE_GROUPS) {
    const meta = AGE_GROUP_META[g];
    if (age >= meta.min && age <= meta.max) return g;
  }
  return null;
}

export function formatAgeGroup(code: string, lang: "en" | "hi" = "en"): string {
  const meta = AGE_GROUP_META[code as AgeGroup];
  if (!meta) return code;
  return lang === "hi" ? meta.label_hi : meta.label_en;
}

/** Join labels; all four known groups → "All age groups" / "सभी आयु वर्ग". */
export function formatAgeGroups(codes: string[] | null | undefined, lang: "en" | "hi" = "en"): string {
  const list = (codes ?? []).filter(Boolean);
  if (list.length === 0) return "—";
  const allKnown = AGE_GROUPS.every((g) => list.includes(g)) && list.length >= AGE_GROUPS.length;
  if (allKnown) return lang === "hi" ? "सभी आयु वर्ग" : "All age groups";
  return list.map((c) => formatAgeGroup(c, lang)).join(" · ");
}

export const enrolmentStatusSchema = z.enum(["pending", "approved", "rejected", "waitlisted"]);
export const studentStatusSchema = z.enum(["active", "inactive"]);
/** Mirrors LIBRARY_SECTION_TYPES — `granth` added by Section 17 v3 §17.1.2. */
export const librarySectionTypeSchema = z.enum(["item_list", "deeplink", "panchang", "granth"]);
export const libraryDownloadStatusSchema = z.enum([
  "queued",
  "downloading",
  "complete",
  "failed",
]);

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

/**
 * Who may feature gallery items onto Punya Wall / home carousel.
 *
 * Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can
 * open the admin panel but must NOT feature media. Do not "fix" this by
 * reusing ADMIN_PANEL_ROLES.
 */
export const FEATURE_MEDIA_ROLES: Role[] = ["super_admin", "state_admin", "city_admin"];

export function canFeatureMedia(role: Role | null | undefined): boolean {
  return !!role && FEATURE_MEDIA_ROLES.includes(role);
}

/**
 * Who may author exam questions, grade attempts, and release results.
 * Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can
 * open the admin panel but must NOT touch exam content or results (SPEC 6.17).
 * Do not "fix" this by reusing ADMIN_PANEL_ROLES.
 */
export const EXAM_ADMIN_ROLES: Role[] = ["super_admin", "state_admin", "city_admin"];

export function canAdministerExams(role: Role | null | undefined): boolean {
  return !!role && EXAM_ADMIN_ROLES.includes(role);
}

/**
 * Who may see organisation-wide donation figures.
 *
 * Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can
 * open the admin panel but must NOT see donation totals, matching the
 * /admin/donations page gate. Do not "fix" this by reusing ADMIN_PANEL_ROLES.
 *
 * `donations` carries no centre_id and no direct city_id (only a nullable
 * campaign_id → donation_campaigns.city_id), so a centre-scoped sum is not
 * expressible. The figure is therefore withheld, never silently national.
 */
export const DONATION_VIEW_ROLES: Role[] = ["super_admin", "state_admin", "city_admin"];

export function canViewDonations(role: Role | null | undefined): boolean {
  return !!role && DONATION_VIEW_ROLES.includes(role);
}

/**
 * Who may create, edit, unpublish or export a shivir (SPEC 6.14 "city_admin+").
 *
 * Deliberately NARROWER than canAccessAdminPanel — sanchalak and shikshak can
 * open the admin panel but must NOT author or delete shivirs. Do not "fix" this
 * by reusing ADMIN_PANEL_ROLES.
 */
export const SHIVIR_ADMIN_ROLES: Role[] = ["super_admin", "state_admin", "city_admin"];

export function canAdministerShivirs(role: Role | null | undefined): boolean {
  return !!role && SHIVIR_ADMIN_ROLES.includes(role);
}

/**
 * Who may run a shivir day-to-day: create sessions, assign and revoke
 * volunteers, watch the live dashboard, and scan without a volunteer row
 * (SPEC 6.14 grants the live dashboard and volunteer assignment to sanchalak).
 *
 * Deliberately NARROWER than canAccessAdminPanel — **shikshak is excluded on
 * purpose**. A Guruji at the venue scans because they were assigned as a
 * volunteer for that shivir, not because they hold a teaching role somewhere in
 * the city; the assignment is what makes the scan attributable. Do not "fix"
 * this by reusing ADMIN_PANEL_ROLES.
 */
export const SHIVIR_OPS_ROLES: Role[] = [
  "super_admin",
  "state_admin",
  "city_admin",
  "sanchalak",
];

export function canOperateShivirs(role: Role | null | undefined): boolean {
  return !!role && SHIVIR_OPS_ROLES.includes(role);
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
  state_id: z.string().nullable().optional(),
  city_id: z.string().nullable().optional(),
  photo_url: z.string().nullable().optional(),
  /** Q6 — blanket parent consent for children's gallery items on public surfaces. */
  gallery_visibility_opt_in: z.boolean(),
});
export type SessionUser = z.infer<typeof sessionUserSchema>;

export const galleryVisibilityBodySchema = z.object({
  opt_in: z.boolean(),
});
export type GalleryVisibilityBody = z.infer<typeof galleryVisibilityBodySchema>;

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
  pending_enrolments: z.number(),
  attendance_rate_30d: z.number(),
  punya_awarded_30d: z.number(),
  msv_active: z.number(),
  /** Omitted entirely for roles outside DONATION_VIEW_ROLES — never a national figure on a scoped endpoint. */
  donations_total_paise_ytd: z.number().optional(),
});
export type OverviewPayload = z.infer<typeof overviewSchema>;

export const enrolmentRowSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  decided_at: z.string().nullable(),
  requested_centre_id: z.string(),
  requested_batch_id: z.string(),
  status: enrolmentStatusSchema,
  student_name: z.string().nullable().optional(),
  student_code: z.string().nullable().optional(),
  centre_name: z.string().nullable().optional(),
  batch_name: z.string().nullable().optional(),
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
  batch_id: z.string().nullable().optional(),
  centre_id: z.string().nullable().optional(),
  batch_name: z.string().nullable().optional(),
  centre_name: z.string().nullable().optional(),
});
export type AdminStudentRow = z.infer<typeof adminStudentRowSchema>;

export const adminBatchRowSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  centre_id: z.string().optional(),
  centre_name: z.string(),
  age_groups: z.array(z.string()),
  shikshak_name: z.string().nullable(),
  day_of_week: z.array(z.number()),
  start_time: z.string(),
  end_time: z.string(),
  status: studentStatusSchema,
});
export type AdminBatchRow = z.infer<typeof adminBatchRowSchema>;

export const staffingAssignBodySchema = z.object({
  user_id: z.string().uuid(),
});

export const createStaffUserBodySchema = z.object({
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  full_name: z.string().min(1).max(200),
  role: z.enum(["sanchalak", "shikshak"]),
  gender: z.enum(["male", "female", "other"]).optional(),
  city_id: z.string().uuid().optional(),
  state_id: z.string().uuid().optional(),
  centre_id: z.string().uuid().optional(),
});

export const centreStaffBodySchema = z.object({
  role: z.enum(["sanchalak", "shikshak"]),
  user_id: z.string().uuid().optional(),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),
  full_name: z.string().min(1).max(200).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  batch_ids: z.array(z.string().uuid()).max(50).optional(),
  primary_batch_id: z.string().uuid().optional(),
});

export const staffingCentreShikshakRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  gender: z.string().nullable().optional(),
  is_active: z.boolean(),
  batch_count: z.number().optional(),
  batches: z
    .array(
      z.object({
        batch_id: z.string(),
        batch_name: z.string(),
        is_primary: z.boolean(),
      }),
    )
    .optional(),
});

export const staffingBatchShikshakRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  full_name: z.string().nullable(),
  phone: z.string().nullable(),
  gender: z.string().nullable().optional(),
  is_primary: z.boolean(),
});

export const staffingMeSchema = z.object({
  user_id: z.string(),
  centres: z.array(
    z.object({
      centre_id: z.string(),
      centre_name: z.string(),
    }),
  ),
  batches: z.array(
    z.object({
      batch_id: z.string(),
      batch_name: z.string().nullable(),
      centre_id: z.string(),
      is_primary: z.boolean(),
    }),
  ),
  sanchalak_centres: z
    .array(
      z.object({
        centre_id: z.string(),
        centre_name: z.string(),
      }),
    )
    .optional(),
});
export type StaffingMe = z.infer<typeof staffingMeSchema>;

/**
 * Rejection reasons reach the PARENT — bounds shared by mobile, web and the
 * server so a one-character "x" can never be sent to a family (SAN-API-03).
 */
export const REJECT_REASON_MIN = 10;
export const REJECT_REASON_MAX = 300;

export const enrolmentActionSchema = z.object({
  reason: z.string().max(REJECT_REASON_MAX).optional(),
});

export const studentStatusActionSchema = z.object({
  action: z.enum(["deactivate", "reactivate"]),
  reason: z.string().max(REJECT_REASON_MAX).optional(),
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
  age_groups: z.array(z.string()),
  day_of_week: z.array(z.number()),
  start_time: z.string(),
  end_time: z.string(),
  capacity: z.number(),
  language_preference: z.string().nullable(),
});
export type PublicBatchRow = z.infer<typeof publicBatchRowSchema>;

/**
 * Bilingual per CLAUDE.md. `_hi` is nullable, so every render site is
 * `hi ? (x_hi ?? x_en) : x_en` — an admin who has the dates but not yet the
 * Devanagari is not blocked from publishing, and a Hindi reader still gets
 * something rather than a blank.
 */
export const shivirRowSchema = z.object({
  id: z.string(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  description_en: z.string().nullable(),
  description_hi: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  location_text: z.string().nullable(),
  city_name: z.string(),
  // Present on the row so a card can badge MSV and show remaining places
  // without a second request.
  capacity: z.number().nullable(),
  msv_only: z.boolean(),
});
export type ShivirRow = z.infer<typeof shivirRowSchema>;

export const shivirDetailSchema = z.object({
  id: z.string(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  description_en: z.string().nullable(),
  description_hi: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  location_text: z.string().nullable(),
  city_name: z.string(),
  state_name: z.string(),
  capacity: z.number().nullable(),
  msv_only: z.boolean(),
  attendance_mode: z.enum(["in_out", "present_only"]),
  contact_info: z.string().nullable(),
  registered_count: z.number(),
});
export type ShivirDetail = z.infer<typeof shivirDetailSchema>;

export const shivirSessionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  day_number: z.number().nullable(),
  session_date: z.string(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
});
export type ShivirSessionRow = z.infer<typeof shivirSessionRowSchema>;

/** What the detail screens need to render the right CTA per child. */
export const shivirMyRegistrationsSchema = z.object({
  shivir_id: z.string(),
  capacity: z.number().nullable(),
  registered_count: z.number(),
  is_full: z.boolean(),
  registration_open: z.boolean(),
  msv_only: z.boolean(),
  students: z.array(
    z.object({
      student_id: z.string(),
      full_name: z.string(),
      status: z.enum(["registered", "not_registered"]),
      registered_at: z.string().nullable(),
      eligible: z.boolean(),
    }),
  ),
});
export type ShivirMyRegistrations = z.infer<typeof shivirMyRegistrationsSchema>;

/** A shivir the caller volunteers at — the mobile "My shivirs" surface. */
export const shivirVolunteeringRowSchema = z.object({
  id: z.string(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  start_date: z.string(),
  end_date: z.string(),
  location_text: z.string().nullable(),
  city_name: z.string(),
  attendance_mode: z.enum(["in_out", "present_only"]),
  role_label: z.string().nullable(),
  session_count: z.number(),
});
export type ShivirVolunteeringRow = z.infer<typeof shivirVolunteeringRowSchema>;

/**
 * One line of the venue roster. `state` is the single word a Sanchalak needs:
 * counts alone answered neither "who is here?" nor "who is missing?".
 */
export const shivirRosterRowSchema = z.object({
  student_id: z.string(),
  full_name: z.string(),
  student_code: z.string().nullable(),
  registered: z.boolean(),
  last_scan_kind: z.enum(["present", "check_in", "check_out"]).nullable(),
  last_scanned_at: z.string().nullable(),
  scan_count: z.number(),
  state: z.enum(["registered", "scanned", "walk_in", "not_arrived"]),
});
export type ShivirRosterRow = z.infer<typeof shivirRosterRowSchema>;

export const shivirVolunteerRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  full_name: z.string(),
  role: z.string(),
  phone: z.string().nullable(),
  role_label: z.string().nullable(),
  assigned_at: z.string(),
  revoked_at: z.string().nullable(),
  is_active: z.boolean(),
});
export type ShivirVolunteerRow = z.infer<typeof shivirVolunteerRowSchema>;

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

/** Shared write body for POST/PATCH /v1/notices/admin (and any legacy admin create). */
export const noticeWriteSchema = z
  .object({
    title_en: z.string().min(1).max(300),
    title_hi: z.string().max(300).optional(),
    content_en: z.string().max(8000).optional(),
    content_hi: z.string().max(8000).optional(),
    audience: z.enum(["batch", "centre", "city", "state", "national", "msv"]),
    state_id: z.string().uuid().optional(),
    city_id: z.string().uuid().optional(),
    centre_id: z.string().uuid().optional(),
    batch_id: z.string().uuid().optional(),
    is_public: z.boolean().optional(),
    pinned: z.boolean().optional(),
    is_critical: z.boolean().optional(),
    expires_at: z.string().datetime().nullable().optional(),
    publish_at: z.string().datetime().nullable().optional(),
    publish_now: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === "state" && !v.state_id) {
      ctx.addIssue({ code: "custom", message: "state_id required for state audience", path: ["state_id"] });
    }
    if (v.audience === "city" && !v.city_id) {
      ctx.addIssue({ code: "custom", message: "city_id required for city audience", path: ["city_id"] });
    }
    if (v.audience === "centre" && !v.centre_id) {
      ctx.addIssue({ code: "custom", message: "centre_id required for centre audience", path: ["centre_id"] });
    }
    if (v.audience === "batch" && !v.batch_id) {
      ctx.addIssue({ code: "custom", message: "batch_id required for batch audience", path: ["batch_id"] });
    }
  });
export type NoticeWrite = z.infer<typeof noticeWriteSchema>;

/**
 * v3 §17.1.3 — a Tarj is one short caption line ("sung to the tune of X"),
 * never rich text and never a paragraph. Normalising server-side rather than
 * only in the admin UI stops a pasted multi-line value from breaking the
 * single-line caption in every surface that renders it.
 */
export const TARJ_MAX_LEN = 200;

/** Collapse a Tarj to one line; blank becomes null so "set" and "cleared" differ. */
export function normalizeTarj(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const line = String(raw).replace(/\s+/g, " ").trim();
  return line.length === 0 ? null : line.slice(0, TARJ_MAX_LEN);
}

export const tarjLineSchema = z.string().max(TARJ_MAX_LEN);

export const libraryItemSchema = z.object({
  id: z.string().uuid(),
  section_id: z.string().uuid(),
  subsection_id: z.string().uuid().nullable(),
  item_code: z.string(),
  title_en: z.string(),
  title_hi: z.string().nullable(),
  title_gu: z.string().nullable(),
  order_index: z.number().int(),
  audio_url: z.string().nullable(),
  audio_size_bytes: z.number().int().nullable(),
  audio_duration_sec: z.number().int().nullable(),
  youtube_url: z.string().nullable(),
  text_content_en: z.string().nullable(),
  text_content_hi: z.string().nullable(),
  text_content_gu: z.string().nullable(),
  /** §17.1.3 — optional melody caption; both null means render nothing. */
  tarj_en: z.string().nullable(),
  tarj_hi: z.string().nullable(),
  /**
   * §17.1.3 PDF modality. pdf_url is freshly signed on every read (1h TTL),
   * so a cached tree's copy expires — clients re-fetch the item at download
   * time rather than reusing what the tree gave them.
   */
  pdf_url: z.string().nullable(),
  pdf_size_bytes: z.number().int().nullable(),
  /** Extracted asynchronously post-upload; null until the job lands. */
  pdf_page_count: z.number().int().nullable(),
  /** §17.1.3 external-link modality — documents only, never video (Q7). */
  external_url: z.string().nullable(),
  content_version: z.number().int(),
  is_published: z.boolean(),
});
export type LibraryItemDto = z.infer<typeof libraryItemSchema>;

export const librarySubsectionSchema = z.object({
  id: z.string().uuid(),
  section_id: z.string().uuid(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  name_gu: z.string().nullable(),
  order_index: z.number().int(),
  is_published: z.boolean(),
  content_version: z.number().int(),
  items: z.array(libraryItemSchema).optional(),
});
export type LibrarySubsectionDto = z.infer<typeof librarySubsectionSchema>;

export const libraryReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});
export type LibraryReorder = z.infer<typeof libraryReorderSchema>;

export const librarySectionWriteSchema = z.object({
  key: z.string().min(1).max(80),
  name_en: z.string().min(1),
  name_hi: z.string().nullable().optional(),
  name_gu: z.string().nullable().optional(),
  icon_url: z.string().nullable().optional(),
  type: librarySectionTypeSchema,
  deeplink_target: z.string().nullable().optional(),
  requires_login: z.boolean().optional(),
});
export type LibrarySectionWrite = z.infer<typeof librarySectionWriteSchema>;

export const libraryItemWriteSchema = z.object({
  section_id: z.string().uuid(),
  subsection_id: z.string().uuid().nullable().optional(),
  item_code: z.string().min(1).max(80),
  title_en: z.string().min(1),
  title_hi: z.string().nullable().optional(),
  title_gu: z.string().nullable().optional(),
  youtube_url: z.string().nullable().optional(),
  text_content_en: z.string().nullable().optional(),
  text_content_hi: z.string().nullable().optional(),
  text_content_gu: z.string().nullable().optional(),
  tarj_en: tarjLineSchema.nullable().optional(),
  tarj_hi: tarjLineSchema.nullable().optional(),
  external_url: httpUrl(2000).nullable().optional(),
});
export type LibraryItemWrite = z.infer<typeof libraryItemWriteSchema>;

/**
 * v3 §17.9 — access-log events. Distinct reach per (item, actor, event):
 * the server upserts and bumps a count, so a client may report the same
 * event as often as it likes without inflating anything.
 *
 * Analytics only. Nothing on this path awards Punya (§17.8).
 */
export const LIBRARY_ACCESS_EVENTS = [
  "view",
  "pdf_view",
  "pdf_download",
  "granth_view",
  "external_link_open",
] as const;
export const libraryAccessEventSchema = z.enum(LIBRARY_ACCESS_EVENTS);
export type LibraryAccessEvent = z.infer<typeof libraryAccessEventSchema>;

/**
 * Exactly one target. Most events fire on a piece of content, but
 * `granth_view` is a SECTION open (§17.9) and a section id is not an item
 * id — sent in the wrong field it silently matches nothing.
 */
/* ── v3 §17.11.3 Granth directory ──────────────────────────────────────── */

/**
 * A physical library that holds granths. Contact details live HERE and
 * nowhere else (§17.11.3) — entries never duplicate them, so a phone number
 * that changes is corrected in one row.
 */
export const granthLibrarySchema = z.object({
  id: z.string().uuid(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  address_en: z.string(),
  address_hi: z.string().nullable(),
  city_id: z.string().uuid(),
  /** Denormalised so the client can group and filter offline. */
  city_name: z.string(),
  contact_name: z.string().nullable(),
  contact_phone: z.string().nullable(),
  has_whatsapp: z.boolean(),
  timings_en: z.string().nullable(),
  timings_hi: z.string().nullable(),
  /** Numbers, not the numeric-as-string Postgres hands back. */
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  note_en: z.string().nullable(),
  note_hi: z.string().nullable(),
  order_index: z.number().int(),
  content_version: z.number().int(),
});
export type GranthLibraryDto = z.infer<typeof granthLibrarySchema>;

export const granthEntrySchema = z.object({
  id: z.string().uuid(),
  title_en: z.string(),
  title_hi: z.string().nullable(),
  author_en: z.string().nullable(),
  author_hi: z.string().nullable(),
  /** Free text — granths run to Prakrit, Sanskrit and Gujarati. */
  language: z.string().nullable(),
  description_en: z.string().nullable(),
  description_hi: z.string().nullable(),
  /** "Read online" — the library item carrying the PDF / text / link. */
  linked_item_id: z.string().uuid().nullable(),
  order_index: z.number().int(),
  content_version: z.number().int(),
});
export type GranthEntryDto = z.infer<typeof granthEntrySchema>;

/** The M2M join, shipped flat so the client can index it both ways. */
export const granthAvailabilitySchema = z.object({
  granth_id: z.string().uuid(),
  library_id: z.string().uuid(),
  note: z.string().nullable(),
});
export type GranthAvailabilityDto = z.infer<typeof granthAvailabilitySchema>;

/**
 * One payload, cached beside the section tree (§17.11.4): the directory has
 * to be fully browsable offline, and three separate fetches would leave a
 * reader with libraries but no catalogue the first time one of them failed.
 */
export const granthDirectorySchema = z.object({
  libraries: z.array(granthLibrarySchema),
  entries: z.array(granthEntrySchema),
  availability: z.array(granthAvailabilitySchema),
});
export type GranthDirectoryDto = z.infer<typeof granthDirectorySchema>;

export const libraryAccessLogWriteSchema = z
  .object({
    item_id: z.string().uuid().optional(),
    section_id: z.string().uuid().optional(),
    event: libraryAccessEventSchema,
    /** Guests only — signed-in callers are keyed by their session. */
    device_id: z.string().min(1).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    const targets = [v.item_id, v.section_id].filter(Boolean).length;
    if (targets !== 1) {
      ctx.addIssue({
        code: "custom",
        message: "Send exactly one of item_id or section_id.",
        path: ["item_id"],
      });
    }
  });
export type LibraryAccessLogWrite = z.infer<typeof libraryAccessLogWriteSchema>;

export const librarySectionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  name_en: z.string(),
  name_hi: z.string().nullable(),
  name_gu: z.string().nullable(),
  icon_url: z.string().nullable(),
  order_index: z.number().int(),
  type: librarySectionTypeSchema,
  deeplink_target: z.string().nullable(),
  requires_login: z.boolean(),
  is_published: z.boolean(),
  content_version: z.number().int(),
  subsections: z.array(librarySubsectionSchema).optional(),
  items: z.array(libraryItemSchema).optional(),
});
export type LibrarySectionDto = z.infer<typeof librarySectionSchema>;

export const libraryVersionManifestSchema = z.object({
  sections: z.record(z.string().uuid(), z.number().int()),
  items: z.record(z.string().uuid(), z.number().int()),
});
export type LibraryVersionManifest = z.infer<typeof libraryVersionManifestSchema>;

/* ------------------------------------------------------------------ */
/* Library content requests — Section 17 v3 §17.10                     */
/* ------------------------------------------------------------------ */

/**
 * A URL field that must use the http(s) scheme.
 *
 * Plain `z.string().url()` ACCEPTS dangerous schemes (`javascript:`, `data:`,
 * `vbscript:`) — when such a value is later rendered into an `<a href>` (admin
 * review screens, public library) or opened via `Linking.openURL`, it becomes a
 * stored XSS that crosses a privilege boundary (guest → admin). Use this for
 * any user-supplied URL that is later linked or opened.
 *
 * Lives here rather than in api-server so the request contract and the routes
 * cannot end up with two different ideas of what a safe URL is;
 * `apps/api-server/src/lib/validation.ts` re-exports it.
 */
export function httpUrl(max = 2000) {
  return z
    .string()
    .url()
    .max(max)
    // Scheme checked on the string, not via `new URL(...).protocol`. This
    // module is consumed by React Native, whose built-in URL is partial, and a
    // contracts package should not depend on a platform global for a security
    // check. The scheme is the prefix, so a prefix test is exact — and it is
    // marginally STRICTER than the parser was: `http:x.com` (a scheme with no
    // authority, which WHATWG happily parses) is now rejected too.
    .refine((u) => /^https?:\/\//i.test(u.trim()), "URL must use http(s).");
}

/** §17.10.6 abuse controls. One place, so route, tests and client copy agree. */
export const LIBRARY_REQUEST_LIMITS = {
  /** Submissions per day per device-or-user. */
  perRequesterPerDay: 3,
  /** Submissions per day per IP — stops one script fanning out over devices. */
  perIpPerDay: 10,
  /** Requests a single requester may hold in `pending` at once. */
  maxPending: 3,
  windowSeconds: 24 * 60 * 60,
} as const;

export const libraryContentRequestStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "published",
]);
export type LibraryContentRequestStatus = z.infer<typeof libraryContentRequestStatusSchema>;

/**
 * Accepts a 10-digit Indian mobile, `91XXXXXXXXXX`, or an already-E.164 number.
 *
 * Guests type what is on their phone, not what the database wants. Rejecting
 * "9876543210" from the one audience this feature exists for would be perverse,
 * so the shape is permissive here and normalised to E.164 on write.
 */
export const contactPhoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .refine((v) => {
    const d = v.replace(/\D/g, "");
    const shapeOk = v.startsWith("+")
      ? /^\+[1-9]\d{6,14}$/.test(v.replace(/\s/g, ""))
      : d.length === 10 || (d.length === 12 && d.startsWith("91"));
    // The phone columns are varchar(15). A 15-digit E.164 number is 16
    // characters with the "+", so a shape check alone would let a value
    // through that the INSERT then rejects with a raw 22001 — a 500 where the
    // caller should have got a field error.
    return shapeOk && contactPhoneToE164(v).length <= 15;
  }, "Enter a 10-digit mobile number, or the full number with country code.");

/** Normalise a validated contact phone to E.164. India-default, like the join flow. */
export function contactPhoneToE164(raw: string): string {
  const trimmed = raw.replace(/\s/g, "");
  if (trimmed.startsWith("+")) return trimmed;
  const d = trimmed.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return `+91${d}`;
}

/* ── v3 §17.11.5 Granth admin writes ───────────────────────────────────── */

/** Latitude/longitude within real bounds — a typo'd 751.85 is not a place. */
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

export const granthLibraryWriteSchema = z
  .object({
    name_en: z.string().min(1).max(200),
    name_hi: z.string().max(200).nullable().optional(),
    address_en: z.string().min(1).max(500),
    address_hi: z.string().max(500).nullable().optional(),
    /** Same representation centres use — a cities.id, never a name string. */
    city_id: z.string().uuid(),
    contact_name: z.string().max(120).nullable().optional(),
    contact_phone: contactPhoneSchema.nullable().optional(),
    has_whatsapp: z.boolean().optional(),
    timings_en: z.string().max(300).nullable().optional(),
    timings_hi: z.string().max(300).nullable().optional(),
    lat: latitude.nullable().optional(),
    lng: longitude.nullable().optional(),
    note_en: z.string().max(1000).nullable().optional(),
    note_hi: z.string().max(1000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    // Half a coordinate is not a location. One without the other would send
    // the maps hand-off to a point on the equator or the prime meridian.
    const hasLat = v.lat != null;
    const hasLng = v.lng != null;
    if (hasLat !== hasLng) {
      ctx.addIssue({
        code: "custom",
        message: "Give both latitude and longitude, or neither.",
        path: [hasLat ? "lng" : "lat"],
      });
    }
    // WhatsApp needs a number to address, and one with a country code:
    // wa.me without one deep-links to whatever country the reader is in.
    if (v.has_whatsapp && !v.contact_phone) {
      ctx.addIssue({
        code: "custom",
        message: "Add a contact phone before turning WhatsApp on.",
        path: ["contact_phone"],
      });
    }
  });
export type GranthLibraryWrite = z.infer<typeof granthLibraryWriteSchema>;

export const granthEntryWriteSchema = z.object({
  title_en: z.string().min(1).max(200),
  title_hi: z.string().max(200).nullable().optional(),
  author_en: z.string().max(200).nullable().optional(),
  author_hi: z.string().max(200).nullable().optional(),
  /** Free text — granths run to Prakrit, Sanskrit and Gujarati. */
  language: z.string().max(80).nullable().optional(),
  description_en: z.string().max(4000).nullable().optional(),
  description_hi: z.string().max(4000).nullable().optional(),
  /** "Read online" — the library item carrying the PDF / text / link. */
  linked_item_id: z.string().uuid().nullable().optional(),
});
export type GranthEntryWrite = z.infer<typeof granthEntryWriteSchema>;

/** Which library holds this granth, and on what terms. */
export const granthAvailabilityWriteSchema = z.object({
  library_id: z.string().uuid(),
  /** e.g. "reference only, not for issue" — what stops a wasted trip. */
  note: z.string().max(300).nullable().optional(),
});
export type GranthAvailabilityWrite = z.infer<typeof granthAvailabilityWriteSchema>;

/** Ordered id array — the same shape the library section/item reorders take. */
export const granthReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});
export type GranthReorder = z.infer<typeof granthReorderSchema>;

/**
 * POST /v1/library/requests body.
 *
 * `requester_name` / `requester_phone` are optional HERE and mandatory for
 * guests: a signed-in caller has both on their profile and the server fills
 * them in, so requiring them in the schema would force every client to echo
 * the user's own phone number back over the wire. The route enforces the guest
 * rule (§17.10.2) once it knows whether there is a session.
 */
export const libraryContentRequestCreateSchema = z
  .object({
    section_id: z.string().uuid().nullable().optional(),
    suggested_section: z.string().trim().min(1).max(200).nullable().optional(),
    title: z.string().trim().min(1).max(200),
    details: z.string().trim().min(20).max(2000),
    reference_url: httpUrl(500).nullable().optional(),
    requester_name: z.string().trim().min(1).max(200).optional(),
    requester_phone: contactPhoneSchema.optional(),
    /** Pre-login device identifier — the same id the client sends to auth verify. */
    requester_device_id: z.string().trim().min(1).max(128).optional(),
  })
  .superRefine((v, ctx) => {
    // Exactly one targeting path: a picked section OR a free-text suggestion.
    // Both would leave the admin guessing which the requester meant.
    const hasSection = v.section_id != null;
    const hasSuggestion = v.suggested_section != null && v.suggested_section !== "";
    if (hasSection === hasSuggestion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["section_id"],
        message: hasSection
          ? "Pick a section or describe a new one — not both."
          : "Pick a section, or describe the one you want it filed under.",
      });
    }
  });
export type LibraryContentRequestCreate = z.infer<typeof libraryContentRequestCreateSchema>;

/** Row shape returned by GET /v1/library/requests/mine. */
export const libraryContentRequestSchema = z.object({
  id: z.string().uuid(),
  section_id: z.string().uuid().nullable(),
  section_name_en: z.string().nullable(),
  section_name_hi: z.string().nullable(),
  suggested_section: z.string().nullable(),
  title: z.string(),
  details: z.string(),
  reference_url: z.string().nullable(),
  status: libraryContentRequestStatusSchema,
  admin_note: z.string().nullable(),
  linked_item_id: z.string().uuid().nullable(),
  created_at: z.string(),
  actioned_at: z.string().nullable(),
});
export type LibraryContentRequestDto = z.infer<typeof libraryContentRequestSchema>;

/** @deprecated Use LibrarySectionDto / library tree — kept as alias during rebuild. */
export type PublicLibraryItem = LibraryItemDto;

export const galleryItemSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  age_group: z.string(),
  niyam_title_en: z.string(),
  niyam_title_hi: z.string(),
  niyam_type: z.string(),
  featured_gallery: z.boolean(),
  featured_home: z.boolean().optional(),
  /** @deprecated Wire alias of featured_gallery for older clients. */
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
  centre_id: z.string().uuid().nullable().optional(),
  centre_name: z.string().nullable(),
  batch_name: z.string().nullable(),
  msv_status: z.string(),
  status: studentStatusSchema,
  total_points: z.number(),
  tier: z.string(),
  photo_url: z.string().nullable().optional(),
});
export type ChildRow = z.infer<typeof childRowSchema>;

export const attendanceRowSchema = z.object({
  id: z.string(),
  session_date: z.string(),
  status: attendanceStatusSchema.or(z.string()),
  topic: z.string().nullable(),
  batch_name: z.string().nullable(),
  revision: z.number().int().positive().optional(),
  client_op_id: ulidSchema.nullable().optional(),
});
export type AttendanceRow = z.infer<typeof attendanceRowSchema>;

/** AT5 — percentage comes from SQL only; clients never recompute from items. */
export const studentAttendancePayloadSchema = z.object({
  items: z.array(attendanceRowSchema),
  attendance_rate: z.number().nullable().optional(),
  attendance_percent: z.number().nullable().optional(),
});
export type StudentAttendancePayload = z.infer<typeof studentAttendancePayloadSchema>;

export const absenceNotificationRowSchema = z.object({
  id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string().nullable(),
  resolved_at: z.string().nullable().optional(),
});
export type AbsenceNotificationRow = z.infer<typeof absenceNotificationRowSchema>;

export const studentAbsencesPayloadSchema = z.object({
  items: z.array(absenceNotificationRowSchema),
});
export type StudentAbsencesPayload = z.infer<typeof studentAbsencesPayloadSchema>;

export const createSessionBodySchema = z.object({
  batch_id: z.string().uuid(),
  /** API field name kept as session_date; persists as sessions.scheduled_date. */
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  topic: z.string().max(200).optional(),
  gps_required: z.boolean().optional(),
  unscheduled: z.boolean().optional(),
});
export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

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
  /**
   * H4 — the next tier up and the distance to it, or null at Tirthankar.
   *
   * Served rather than derived because the thresholds are CONFIGURATION
   * (AT23): a client-side copy of the ladder would be wrong the first time
   * anyone edited it, and silently so.
   */
  next_tier: z.string().nullable().optional(),
  points_to_next: z.number().nullable().optional(),
  transactions: z.array(punyaTransactionSchema),
  /**
   * True when older transactions exist beyond the returned page. Clients must
   * say so rather than presenting a truncated ledger as the whole story — the
   * visible rows will not sum to total_points.
   */
  has_more: z.boolean().optional(),
});
export type PunyaSummary = z.infer<typeof punyaSummarySchema>;

export const niyamSubmissionMediaSchema = z.object({
  id: z.string(),
  url: z.string().nullable(),
  kind: z.string(),
  mime: z.string().nullable().optional(),
  size_bytes: z.number().nullable().optional(),
  ordinal: z.number().optional(),
});
export type NiyamSubmissionMedia = z.infer<typeof niyamSubmissionMediaSchema>;

export const niyamSubmissionRowSchema = z.object({
  id: z.string(),
  niyam_title_en: z.string(),
  niyam_title_hi: z.string(),
  niyam_type: z.string(),
  submission_date: z.string(),
  status: z.string(),
  points_awarded: z.number(),
  /** @deprecated Never written outside the seed — see niyams.ts (H8). Use the gallery. */
  is_featured: z.boolean(),
  notes: z.string().nullable().optional(),
  rejection_reason: z.string().nullable().optional(),
  proof_url: z.string().nullable().optional(),
  media: z.array(niyamSubmissionMediaSchema).optional(),
});
export type NiyamSubmissionRow = z.infer<typeof niyamSubmissionRowSchema>;

export const niyamEarnedBadgeSchema = z.object({
  badge_key: z.string(),
  streak_length: z.number(),
  awarded_at: z.string(),
});
export type NiyamEarnedBadge = z.infer<typeof niyamEarnedBadgeSchema>;

export const niyamCatalogRowSchema = z.object({
  id: z.string(),
  title_en: z.string(),
  /** Null when no Hindi title has been authored (H13) — render `?? title_en`. */
  title_hi: z.string().nullable(),
  description_en: z.string().nullable().optional(),
  description_hi: z.string().nullable().optional(),
  niyam_type: z.string(),
  proof_type: z.string(),
  proof_required: z.boolean().optional(),
  approval_mode: z.string().optional(),
  max_uploads: z.number().optional(),
  /** Authored value. Show `award_points` to a child, never this (H11). */
  points: z.number(),
  /** What will ACTUALLY be awarded, with any punya_configs override applied. */
  award_points: z.number().optional(),
  /** review-mode: nothing is awarded until a Guruji approves. */
  awards_on_approval: z.boolean().optional(),
  scope: z.string().optional(),
  msv_audience: z.string().optional(),
  start_date: z.string().optional(),
  end_date: z.string().nullable().optional(),
  current_period_key: z.string().optional(),
  period_label_en: z.string().optional(),
  period_label_hi: z.string().optional(),
  submitted_this_period: z.boolean().optional(),
  submission_status: z.string().nullable().optional(),
  submission_date: z.string().nullable().optional(),
  period_status_tag_en: z.string().nullable().optional(),
  period_status_tag_hi: z.string().nullable().optional(),
  current_streak: z.number().optional(),
  longest_streak: z.number().optional(),
  earned_badges: z.array(niyamEarnedBadgeSchema).optional(),
});
export type NiyamCatalogRow = z.infer<typeof niyamCatalogRowSchema>;

export const niyamNewBadgeSchema = z.object({
  badge_key: z.string(),
  streak_length: z.number(),
  points_awarded: z.number(),
});
export type NiyamNewBadge = z.infer<typeof niyamNewBadgeSchema>;

/** Display helpers mirrored from api-server niyam-period.ts */
export function niyamPeriodLabel(
  niyamType: string,
  periodKey: string,
  lang: "en" | "hi" = "en",
): string {
  if (niyamType === "daily") {
    return lang === "hi" ? `दिन ${periodKey}` : `Day ${periodKey}`;
  }
  if (niyamType === "weekly") {
    return lang === "hi" ? `सप्ताह ${periodKey}` : `Week ${periodKey}`;
  }
  return lang === "hi" ? `माह ${periodKey}` : `Month ${periodKey}`;
}

export function niyamSubmittedPeriodTag(
  niyamType: string,
  lang: "en" | "hi" = "en",
): string {
  if (niyamType === "daily") {
    return lang === "hi" ? "आज प्रस्तुत" : "Submitted today";
  }
  if (niyamType === "weekly") {
    return lang === "hi" ? "इस सप्ताह प्रस्तुत" : "Submitted this week";
  }
  return lang === "hi" ? "इस माह प्रस्तुत" : "Submitted this month";
}

/** Streak badge ladder (D1) + bilingual labels. Jain term "Niyam" stays untranslated. */
export type NiyamBadgeMilestone = {
  key: string;
  length: number;
  labelEn: string;
  labelHi: string;
};

const NIYAM_BADGE_DAILY: NiyamBadgeMilestone[] = [
  { key: "daily_7", length: 7, labelEn: "7-day streak", labelHi: "7-दिन की लकीर" },
  { key: "daily_14", length: 14, labelEn: "14-day streak", labelHi: "14-दिन की लकीर" },
  { key: "daily_30", length: 30, labelEn: "30-day streak", labelHi: "30-दिन की लकीर" },
  { key: "daily_60", length: 60, labelEn: "60-day streak", labelHi: "60-दिन की लकीर" },
  { key: "daily_100", length: 100, labelEn: "100-day streak", labelHi: "100-दिन की लकीर" },
];

const NIYAM_BADGE_WEEKLY: NiyamBadgeMilestone[] = [
  { key: "weekly_4", length: 4, labelEn: "4-week streak", labelHi: "4-सप्ताह की लकीर" },
];

const NIYAM_BADGE_MONTHLY: NiyamBadgeMilestone[] = [
  { key: "monthly_3", length: 3, labelEn: "3-month streak", labelHi: "3-माह की लकीर" },
];

/** Full ladder by niyam_type — shared by api-server push copy and mobile UI. */
export const NIYAM_BADGE_LADDER = {
  daily: NIYAM_BADGE_DAILY,
  weekly: NIYAM_BADGE_WEEKLY,
  monthly: NIYAM_BADGE_MONTHLY,
} as const;

export function niyamBadgeLadder(niyamType: string): NiyamBadgeMilestone[] {
  if (niyamType === "weekly") return NIYAM_BADGE_WEEKLY;
  if (niyamType === "monthly") return NIYAM_BADGE_MONTHLY;
  return NIYAM_BADGE_DAILY;
}

export function niyamBadgeLabel(key: string, lang: "en" | "hi" = "en"): string {
  for (const m of [...NIYAM_BADGE_DAILY, ...NIYAM_BADGE_WEEKLY, ...NIYAM_BADGE_MONTHLY]) {
    if (m.key === key) return lang === "hi" ? m.labelHi : m.labelEn;
  }
  return key;
}
export const shikshakSessionRowSchema = z.object({
  id: z.string(),
  batch_id: z.string().optional(),
  session_date: z.string(),
  scheduled_date: z.string().optional(),
  status: z.string(),
  topic: z.string().nullable(),
  batch_name: z.string().nullable(),
  centre_name: z.string().nullable(),
  present_count: z.number(),
  total_count: z.number(),
  gps_required: z.boolean().optional(),
  check_in_at: z.string().nullable().optional(),
  check_out_at: z.string().nullable().optional(),
  check_in_distance_m: z.number().nullable().optional(),
  check_out_distance_m: z.number().nullable().optional(),
  gps_flagged: z.boolean().optional(),
  gps_unverified: z.boolean().optional(),
  duration_minutes: z.number().nullable().optional(),
  auto_checked_out: z.boolean().optional(),
  unscheduled: z.boolean().optional(),
  conducted_by: z.string().nullable().optional(),
  conducted_by_name: z.string().nullable().optional(),
  scheduled_start_time: z.string().nullable().optional(),
  scheduled_end_time: z.string().nullable().optional(),
});
export type ShikshakSessionRow = z.infer<typeof shikshakSessionRowSchema>;
