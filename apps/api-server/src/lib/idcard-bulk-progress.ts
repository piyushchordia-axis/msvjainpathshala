/**
 * In-memory progress for bulk ID-card generation batches (PERF #12).
 * Honest limitation: process-local — multi-instance deploys need Redis/DB.
 * Poll via GET /v1/id-cards/generate-all/:batchId/progress using row counts
 * when possible; this map supplies totals + failure tallies from workers.
 */
export type IdCardBulkBatch = {
  batch_id: string;
  total_students: number;
  job_count: number;
  only_missing: boolean;
  started_at: string;
  /** Student ids in this bulk run (for completed-card row-count progress). */
  student_ids: string[];
  jobs_completed: number;
  jobs_failed: number;
  students_generated: number;
  students_skipped: number;
  students_failed: number;
};

const batches = new Map<string, IdCardBulkBatch>();

export function registerIdCardBulkBatch(batch: IdCardBulkBatch): void {
  batches.set(batch.batch_id, batch);
}

export function getIdCardBulkBatch(batchId: string): IdCardBulkBatch | undefined {
  return batches.get(batchId);
}

export function bumpIdCardBulkJob(
  batchId: string,
  delta: {
    generated?: number;
    skipped?: number;
    failed?: number;
    jobFailed?: boolean;
  },
): void {
  const b = batches.get(batchId);
  if (!b) return;
  b.students_generated += delta.generated ?? 0;
  b.students_skipped += delta.skipped ?? 0;
  b.students_failed += delta.failed ?? 0;
  if (delta.jobFailed) b.jobs_failed += 1;
  else b.jobs_completed += 1;
}
