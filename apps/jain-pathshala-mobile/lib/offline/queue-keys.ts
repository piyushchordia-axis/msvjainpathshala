/** Exact MMKV / AsyncStorage queue keys from CLAUDE.md Offline sync. */
export const QUEUE_KEYS = {
  checkin: "jp.queue.checkin",
  attendance: "jp.queue.attendance",
  checkout: "jp.queue.checkout",
  shivir_scans: "jp.queue.shivir_scans",
  /** Canonical — never jp.queue.niyam_uploads */
  niyam_submissions: "jp.queue.niyam_submissions",
  homework_submissions: "jp.queue.homework_submissions",
  course_progress: "jp.queue.course_progress",
  course_certification: "jp.queue.course_certification",
  acknowledgements: "jp.queue.acknowledgements",
} as const;

export type QueueKey = (typeof QUEUE_KEYS)[keyof typeof QUEUE_KEYS];

/** Causal drain order. */
export const DRAIN_ORDER: QueueKey[] = [
  QUEUE_KEYS.checkin,
  QUEUE_KEYS.attendance,
  QUEUE_KEYS.checkout,
  QUEUE_KEYS.shivir_scans,
  QUEUE_KEYS.niyam_submissions,
  QUEUE_KEYS.homework_submissions,
  QUEUE_KEYS.course_progress,
  QUEUE_KEYS.course_certification,
  QUEUE_KEYS.acknowledgements,
];

/** Map queue → sync batch op_type */
export const QUEUE_OP_TYPE: Record<QueueKey, string> = {
  [QUEUE_KEYS.checkin]: "checkin",
  [QUEUE_KEYS.attendance]: "attendance",
  [QUEUE_KEYS.checkout]: "checkout",
  [QUEUE_KEYS.shivir_scans]: "shivir_scan",
  [QUEUE_KEYS.niyam_submissions]: "niyam_submission",
  [QUEUE_KEYS.homework_submissions]: "homework_submission",
  [QUEUE_KEYS.course_progress]: "course_progress",
  [QUEUE_KEYS.course_certification]: "course_certification",
  [QUEUE_KEYS.acknowledgements]: "acknowledgement",
};
