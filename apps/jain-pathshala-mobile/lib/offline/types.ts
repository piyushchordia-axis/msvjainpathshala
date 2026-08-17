export type SyncUiState =
  | "queued"
  | "syncing"
  | "synced"
  | "duplicate"
  | "conflict"
  | "failed";

export type AttendanceMarkStatus = "present" | "absent" | "late" | "excused";

export type PendingCheckInOp = {
  submission_op_id: string;
  batch_id: string;
  session_date: string;
  /** Null when Guruji starts without a location fix (AT32.2). */
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  client_timestamp: string;
};

export type PendingAttendanceOp = {
  submission_op_id: string;
  batch_id: string;
  session_date: string;
  marks: Array<{
    student_id: string;
    status: AttendanceMarkStatus;
    notes?: string;
    client_op_id: string;
  }>;
  marked_at: string;
  client_timestamp: string;
};

export type PendingCheckOutOp = {
  submission_op_id: string;
  batch_id: string;
  session_date: string;
  /** Null when Guruji ends without a location fix (AT32.2). */
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  client_timestamp: string;
};

export type PendingShivirScanOp = {
  submission_op_id: string;
  shivir_session_id: string;
  qr_payload: string;
  /**
   * Required in practice: the server rejects a scan without a signature as
   * ERR_VALIDATION_FAILED, which is terminal — so an unsigned queued scan would
   * be permanently lost rather than retried.
   */
  qr_signature: string;
  /** Defaults to "present" server-side; carried so an offline scan keeps its intent. */
  scan_kind?: "present" | "check_in" | "check_out";
  scanned_at: string;
  client_timestamp: string;
};

/** One proof file, matching the online submit route's media[] wire shape. */
export type PendingProofMedia = {
  url: string;
  /** Wire placeholder — the server derives the real kind from upload_objects. */
  kind: "photo" | "video" | "audio";
  mime?: string;
  size_bytes?: number;
};

export type PendingNiyamSubmissionOp = {
  submission_op_id: string;
  niyam_id: string;
  student_id: string;
  /** @deprecated single-proof wire form — prefer `media`. Sent as media[0]. */
  proof_asset_id?: string;
  /**
   * Every proof the niyam allows (up to max_uploads). A single proof_asset_id
   * could not represent a multi-proof submission, so offline submissions would
   * have silently dropped files the parent recorded.
   */
  media?: PendingProofMedia[];
  notes?: string;
  client_timestamp: string;
};

export type PendingHomeworkSubmissionOp = {
  submission_op_id: string;
  assignment_id: string;
  student_id: string;
  /** Optional back-compat — prefer resolving from assignment_id + student_id. */
  submission_id?: string;
  proof_asset_id?: string;
  client_timestamp: string;
};

export type CourseProgressStatus = "not_started" | "in_progress" | "completed";

export type PendingCourseProgressOp = {
  submission_op_id: string;
  node_kind: "section" | "subsection";
  node_id: string;
  marks: Array<{
    student_id: string;
    status: CourseProgressStatus;
    note?: string;
    client_op_id: string;
  }>;
  marked_at: string;
  client_timestamp: string;
};

export type PendingCourseCertificationOp = {
  submission_op_id: string;
  node_kind: "section" | "subsection";
  node_id: string;
  student_id: string;
  certification_note?: string;
  client_op_id: string;
  certified_at: string;
  client_timestamp: string;
};

export type PendingAcknowledgementOp = {
  submission_op_id: string;
  kind: string;
  entity_id: string;
  client_timestamp: string;
};

export type PendingOpPayload =
  | PendingCheckInOp
  | PendingAttendanceOp
  | PendingCheckOutOp
  | PendingShivirScanOp
  | PendingNiyamSubmissionOp
  | PendingHomeworkSubmissionOp
  | PendingCourseProgressOp
  | PendingCourseCertificationOp
  | PendingAcknowledgementOp;

export type QueuedOp<T extends PendingOpPayload = PendingOpPayload> = {
  submission_op_id: string;
  payload: T;
  state: SyncUiState;
  attempts: number;
  next_attempt_at: number; // epoch ms
  last_error?: { code: string; message: string };
  created_at: string;
};
