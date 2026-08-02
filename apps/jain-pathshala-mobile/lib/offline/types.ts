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
  lat: number;
  lng: number;
  accuracy_m: number;
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
  lat: number;
  lng: number;
  accuracy_m: number;
  client_timestamp: string;
};

export type PendingShivirScanOp = {
  submission_op_id: string;
  shivir_session_id: string;
  qr_payload: string;
  qr_signature?: string;
  scanned_at: string;
  client_timestamp: string;
};

export type PendingNiyamSubmissionOp = {
  submission_op_id: string;
  niyam_id: string;
  student_id: string;
  proof_asset_id?: string;
  client_timestamp: string;
};

export type PendingHomeworkSubmissionOp = {
  submission_op_id: string;
  assignment_id?: string;
  submission_id?: string;
  student_id?: string;
  payload?: Record<string, unknown>;
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
