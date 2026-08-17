/**
 * Bilingual labels for the database enums we render as pills.
 *
 * Several admin/Guruji lists printed the raw column value — `in_progress`,
 * `active`, `pending` — in Latin snake_case beside Devanagari body copy. The
 * mapping already existed, but privately inside today.tsx, so every other screen
 * fell back to the raw value.
 *
 * Unknown values degrade to a humanised form rather than rendering blank.
 */
type Copy = { en: string; hi: string };

const SESSION: Record<string, Copy> = {
  scheduled: { en: "Scheduled", hi: "निर्धारित" },
  in_progress: { en: "In progress", hi: "चल रहा है" },
  completed: { en: "Completed", hi: "पूर्ण" },
  cancelled: { en: "Cancelled", hi: "रद्द" },
};

const RECORD: Record<string, Copy> = {
  active: { en: "Active", hi: "सक्रिय" },
  inactive: { en: "Inactive", hi: "निष्क्रिय" },
  pending: { en: "Pending", hi: "लंबित" },
  approved: { en: "Approved", hi: "स्वीकृत" },
  rejected: { en: "Rejected", hi: "अस्वीकृत" },
  waitlisted: { en: "Waitlisted", hi: "प्रतीक्षा सूची" },
  revoked: { en: "Withdrawn", hi: "वापस लिया गया" },
  applied: { en: "Applied", hi: "आवेदित" },
  submitted: { en: "Submitted", hi: "प्रस्तुत" },
  graded: { en: "Graded", hi: "मूल्यांकित" },
  returned: { en: "Returned", hi: "लौटाया गया" },
  auto_approved: { en: "Auto-approved", hi: "स्वतः स्वीकृत" },
};

/** attendance_status_enum (AT1). */
const ATTENDANCE: Record<string, Copy> = {
  present: { en: "Present", hi: "उपस्थित" },
  absent: { en: "Absent", hi: "अनुपस्थित" },
  late: { en: "Late", hi: "विलंब" },
  excused: { en: "Excused", hi: "अनुमति" },
};

const JOIN_KIND: Record<string, Copy> = {
  student: { en: "Student", hi: "विद्यार्थी" },
  shikshak: { en: "Guruji", hi: "गुरुजी" },
  sanchalak: { en: "Sanchalak", hi: "संचालक" },
};

function humanize(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function lookup(map: Record<string, Copy>, value: string | null | undefined, hi: boolean): string {
  if (!value) return "";
  const entry = map[value];
  return entry ? (hi ? entry.hi : entry.en) : humanize(value);
}

/** Session lifecycle status (sessions.status). */
export const sessionStatusLabel = (v: string | null | undefined, hi: boolean) =>
  lookup(SESSION, v, hi);

/** General record status — students, enrolments, submissions, applications. */
export const recordStatusLabel = (v: string | null | undefined, hi: boolean) =>
  lookup(RECORD, v, hi);

/** Join registration kind. */
export const joinKindLabel = (v: string | null | undefined, hi: boolean) =>
  lookup(JOIN_KIND, v, hi);

/** Attendance mark (AT1) — present / absent / late / excused. */
export const attendanceStatusLabel = (v: string | null | undefined, hi: boolean) =>
  lookup(ATTENDANCE, v, hi);
