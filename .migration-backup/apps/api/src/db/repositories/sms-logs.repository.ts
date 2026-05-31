/**
 * SmsLogsRepository — durable log of every SMS sent (OTP and notice fan-out).
 *
 * - `insert` is called by the SMS delivery worker after every provider
 *   round-trip — success and failure rows both written so the monthly
 *   spend cap can subtract failures too (some providers bill on accept,
 *   not on delivery).
 * - `currentMonthSpendInr` aggregates `cost_paise` for rows sent in the
 *   current calendar month — used by the SMS worker to enforce
 *   `SMS_MONTHLY_CAP_INR`.
 */

import { Injectable } from '@nestjs/common';
import { and, gte, lt, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { sms_logs } from '../schema';

import type { NewSmsLog, SmsLog } from '../schema';

@Injectable()
export class SmsLogsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewSmsLog): Promise<SmsLog> {
    const [row] = await this.drizzle.db.insert(sms_logs).values(input).returning();
    if (!row) throw new Error('[SmsLogsRepository.insert] INSERT…RETURNING produced no row');
    return row;
  }

  /**
   * Sum of `cost_paise` for SMSes sent in [monthStart, monthEnd), expressed
   * in INR (rupees). Failed-status rows count toward spend too.
   */
  async currentMonthSpendInr(now: Date = new Date()): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const rows = await this.drizzle.dbRead
      .select({
        // COALESCE so an empty month returns 0, not null.
        total_paise: sql<number>`coalesce(sum(${sms_logs.cost_paise}), 0)::int`,
      })
      .from(sms_logs)
      .where(and(gte(sms_logs.sent_at, monthStart), lt(sms_logs.sent_at, monthEnd)));
    const paise = rows[0]?.total_paise ?? 0;
    return Math.floor(paise / 100);
  }
}
