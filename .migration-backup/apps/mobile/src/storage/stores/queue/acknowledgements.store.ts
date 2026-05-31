/**
 * Pending notice acknowledgements. When a parent / sanchalak / shikshak
 * dismisses a critical notice we record it locally and sync later.
 */

import { QueueStore } from './_queue-base';

export interface AcknowledgementOpPayload {
  notice_id: string;
  acknowledged_at: string;
  ack_user_id: string;
}

export const acknowledgementsQueue = new QueueStore<AcknowledgementOpPayload>(
  'jp.queue.acknowledgements',
);
