/**
 * Pending niyam submissions (text or media). Lands in Step 15 (Niyams);
 * Step 8 only declares the queue + payload shape.
 */

import { QueueStore } from './_queue-base';

export interface NiyamSubmissionOpPayload {
  niyam_id: string;
  student_id: string;
  for_date: string;
  note?: string;
  proof_asset_id?: string;
}

export const niyamSubmissionsQueue = new QueueStore<NiyamSubmissionOpPayload>(
  'jp.queue.niyam_submissions',
);
