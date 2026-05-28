/**
 * PhoneOtpAttemptsRepository — durable audit record of OTP send/verify
 * activity per phone.
 *
 * The hot path (request rate limiting, hash compare) uses Redis; this
 * table is the forensic / lockout backstop. One row per OTP issuance.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { phone_otp_attempts } from '../schema';

import type { NewPhoneOtpAttempt, PhoneOtpAttempt } from '../schema';

@Injectable()
export class PhoneOtpAttemptsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insertForPhone(input: NewPhoneOtpAttempt): Promise<PhoneOtpAttempt> {
    const [row] = await this.drizzle.db.insert(phone_otp_attempts).values(input).returning();
    if (!row) throw new Error('[PhoneOtpAttempts.insertForPhone] insert returned no row');
    return row;
  }

  /**
   * The active record for a phone is the most-recent row that hasn't
   * expired, hasn't succeeded, and isn't locked. Returns null if no such
   * row exists (caller should treat as "no OTP outstanding").
   */
  async findActiveByPhone(phone: string): Promise<PhoneOtpAttempt | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(phone_otp_attempts)
      .where(
        and(
          eq(phone_otp_attempts.phone, phone),
          isNull(phone_otp_attempts.succeeded_at),
          gt(phone_otp_attempts.expires_at, sql`now()`),
        ),
      )
      .orderBy(desc(phone_otp_attempts.created_at))
      .limit(1);
    return rows[0] ?? null;
  }

  async incrementAttempts(id: string): Promise<PhoneOtpAttempt> {
    const [row] = await this.drizzle.db
      .update(phone_otp_attempts)
      .set({
        attempts_count: sql`${phone_otp_attempts.attempts_count} + 1`,
        last_attempt_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(phone_otp_attempts.id, id))
      .returning();
    if (!row) throw new Error('[PhoneOtpAttempts.incrementAttempts] row not found');
    return row;
  }

  async markSucceeded(id: string): Promise<void> {
    await this.drizzle.db
      .update(phone_otp_attempts)
      .set({ succeeded_at: new Date(), updated_at: new Date() })
      .where(eq(phone_otp_attempts.id, id));
  }

  async markLocked(id: string, lockedUntil: Date): Promise<void> {
    await this.drizzle.db
      .update(phone_otp_attempts)
      .set({ locked_until: lockedUntil, updated_at: new Date() })
      .where(eq(phone_otp_attempts.id, id));
  }
}
