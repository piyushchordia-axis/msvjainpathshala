/**
 * IdCardsRepository — `digital_id_cards` (SPEC §5.5).
 *
 * One row per student (unique index on student_id). `upsert` bumps
 * `version_no` and stamps `last_regenerated_at` on conflict so a regenerate
 * always produces a fresh, monotonically-versioned card.
 */

import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { digital_id_cards } from '../schema';

import type { DigitalIdCard, NewDigitalIdCard } from '../schema';

@Injectable()
export class IdCardsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findByStudent(studentId: string): Promise<DigitalIdCard | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(digital_id_cards)
      .where(eq(digital_id_cards.student_id, studentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async upsert(input: NewDigitalIdCard): Promise<DigitalIdCard> {
    const [row] = await this.drizzle.db
      .insert(digital_id_cards)
      .values(input)
      .onConflictDoUpdate({
        target: digital_id_cards.student_id,
        set: {
          card_number: input.card_number,
          qr_payload: input.qr_payload,
          qr_payload_signature: input.qr_payload_signature,
          msv_badge: input.msv_badge ?? false,
          version_no: sql`${digital_id_cards.version_no} + 1`,
          generated_at: input.generated_at,
          last_regenerated_at: new Date(),
          updated_at: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('[IdCards.upsert] no row returned');
    return row;
  }
}
