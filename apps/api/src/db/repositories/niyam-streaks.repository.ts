/**
 * NiyamStreaksRepository — small surface for the streak table.
 *
 * Streak math itself lives in `NiyamStreakRecomputeProcessor`; the repo
 * is a thin upsert / read so the processor can stay focused on the
 * date-walk logic.
 */

import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { niyam_streaks } from '../schema';

import type { NiyamStreak } from '../schema';

export interface UpsertStreakInput {
  student_id: string;
  niyam_id: string;
  current_streak: number;
  longest_streak: number;
  last_completion_date: string | null;
  badge_awarded?: boolean;
  badge_kind?: string | null;
}

@Injectable()
export class NiyamStreaksRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async find(studentId: string, niyamId: string): Promise<NiyamStreak | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(niyam_streaks)
      .where(and(eq(niyam_streaks.student_id, studentId), eq(niyam_streaks.niyam_id, niyamId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findAllByStudent(studentId: string): Promise<NiyamStreak[]> {
    return this.drizzle.dbRead
      .select()
      .from(niyam_streaks)
      .where(eq(niyam_streaks.student_id, studentId));
  }

  async upsert(input: UpsertStreakInput): Promise<NiyamStreak> {
    const now = new Date();
    const [row] = await this.drizzle.db
      .insert(niyam_streaks)
      .values({
        student_id: input.student_id,
        niyam_id: input.niyam_id,
        current_streak: input.current_streak,
        longest_streak: input.longest_streak,
        last_completion_date: input.last_completion_date,
        badge_awarded: input.badge_awarded ?? false,
        badge_kind: input.badge_kind ?? null,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: [niyam_streaks.student_id, niyam_streaks.niyam_id],
        set: {
          current_streak: input.current_streak,
          longest_streak: input.longest_streak,
          last_completion_date: input.last_completion_date,
          badge_awarded: input.badge_awarded ?? false,
          badge_kind: input.badge_kind ?? null,
          updated_at: now,
        },
      })
      .returning();
    if (!row) throw new Error('[NiyamStreaks.upsert] no row returned');
    return row;
  }
}
