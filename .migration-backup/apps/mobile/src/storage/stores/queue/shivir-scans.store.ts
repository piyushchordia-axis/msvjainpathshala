/**
 * Pending Shivir QR scans. Volunteer scans a participant's badge → op
 * enqueued here → sync engine batches them to /v1/shivirs/:id/scans
 * (lands in the Shivir step).
 */

import { QueueStore } from './_queue-base';

export interface ShivirScanOpPayload {
  shivir_id: string;
  scanned_code: string;
  scanned_at: string;
  scanner_user_id: string;
  gps?: { lat: number; lng: number; accuracy_m: number } | null;
}

export const shivirScansQueue = new QueueStore<ShivirScanOpPayload>('jp.queue.shivir_scans');
