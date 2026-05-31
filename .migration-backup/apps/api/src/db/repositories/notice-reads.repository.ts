/**
 * NoticeReadsRepository — per-user read receipts on `notices` (SPEC §5.10).
 *
 * Idempotent UPSERT on (notice_id, user_id): same caller reading twice is a
 * no-op that returns the existing row's `read_at`.
 */

import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { notice_reads } from '../schema';

import type { NewNoticeRead, NoticeRead } from '../schema';

@Injectable()
export class NoticeReadsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async upsert(input: NewNoticeRead): Promise<NoticeRead> {
    const [row] = await this.drizzle.db
      .insert(notice_reads)
      .values(input)
      .onConflictDoNothing({ target: [notice_reads.notice_id, notice_reads.user_id] })
      .returning();
    if (row) return row;
    const existing = await this.drizzle.dbRead
      .select()
      .from(notice_reads)
      .where(
        and(eq(notice_reads.notice_id, input.notice_id), eq(notice_reads.user_id, input.user_id)),
      )
      .limit(1);
    if (!existing[0]) throw new Error('[NoticeReads.upsert] insert raced + re-read empty');
    return existing[0];
  }

  async findForUser(userId: string, noticeIds: string[]): Promise<Set<string>> {
    if (noticeIds.length === 0) return new Set();
    const rows = await this.drizzle.dbRead
      .select({ notice_id: notice_reads.notice_id })
      .from(notice_reads)
      .where(and(eq(notice_reads.user_id, userId), inArray(notice_reads.notice_id, noticeIds)));
    return new Set(rows.map((r) => r.notice_id));
  }

  async countForNotice(noticeId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ c: count() })
      .from(notice_reads)
      .where(eq(notice_reads.notice_id, noticeId));
    return Number(rows[0]?.c ?? 0);
  }
}
