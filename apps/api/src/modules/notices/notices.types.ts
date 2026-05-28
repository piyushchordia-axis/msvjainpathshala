/**
 * Notices — DTOs and result envelopes (SPEC §5.10, §6.13).
 */

import type { Notice } from '../../db/schema';
import type { NoticeAudience } from '@jp/shared';

export interface CreateNoticeInput {
  scope: NoticeAudience;
  centre_id?: string | null;
  batch_id?: string | null;
  msv_only?: boolean;
  content_en: string;
  content_hi: string;
  /** JSONB blob — attachments[], a stub the future media uploader will populate. */
  attachments?: Record<string, unknown> | null;
  pinned?: boolean;
  /** ISO datetime; if absent the notice publishes immediately. */
  scheduled_for?: string | null;
  is_public?: boolean;
  is_critical?: boolean;
  send_sms?: boolean;
}

export interface CreateNoticeResult {
  notice: Notice;
  /** Estimated recipient count BEFORE the fanout worker runs. */
  estimated_recipients: number;
  /** SMS cost in paise — only set when send_sms=true. */
  estimated_sms_cost_paise: number | null;
}

export interface NoticeWithRead extends Notice {
  is_read: boolean;
  read_count: number | null;
}

export interface SmsCostEstimate {
  recipients: number;
  segments_en: number;
  segments_hi: number;
  cost_paise: number;
  /** Per-recipient max segment count (the SMS cap budget assumes worst-case Hindi). */
  worst_segments_per_recipient: number;
}
