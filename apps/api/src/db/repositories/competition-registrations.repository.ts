/**
 * CompetitionRegistrationsRepository — per-student registrations
 * (SPEC §5.12). Unique on (competition_id, student_id) so double-tap is a
 * no-op returning the existing row.
 */

import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { competition_registrations } from '../schema';

import type { CompetitionRegistration, NewCompetitionRegistration } from '../schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

@Injectable()
export class CompetitionRegistrationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async findById(id: string): Promise<CompetitionRegistration | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(competition_registrations)
      .where(eq(competition_registrations.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findForStudent(
    competitionId: string,
    studentId: string,
  ): Promise<CompetitionRegistration | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(competition_registrations)
      .where(
        and(
          eq(competition_registrations.competition_id, competitionId),
          eq(competition_registrations.student_id, studentId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async insert(input: NewCompetitionRegistration, tx?: Tx): Promise<CompetitionRegistration> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .insert(competition_registrations)
      .values(input)
      .onConflictDoNothing({
        target: [competition_registrations.competition_id, competition_registrations.student_id],
      })
      .returning();
    if (row) return row;
    const existing = await runner
      .select()
      .from(competition_registrations)
      .where(
        and(
          eq(competition_registrations.competition_id, input.competition_id),
          eq(competition_registrations.student_id, input.student_id),
        ),
      )
      .limit(1);
    if (!existing[0])
      throw new Error('[CompetitionRegistrations.insert] insert raced + re-read empty');
    return existing[0];
  }

  async listByCompetition(competitionId: string): Promise<CompetitionRegistration[]> {
    return this.drizzle.dbRead
      .select()
      .from(competition_registrations)
      .where(eq(competition_registrations.competition_id, competitionId))
      .orderBy(competition_registrations.registered_at);
  }

  async countByCompetition(competitionId: string): Promise<number> {
    const rows = await this.drizzle.dbRead
      .select({ c: count() })
      .from(competition_registrations)
      .where(eq(competition_registrations.competition_id, competitionId));
    return Number(rows[0]?.c ?? 0);
  }

  /**
   * Record a result for a registered student — sets rank + Punya txn id.
   * Idempotent on the registration row: re-grading the same row updates
   * the rank and result_note. The Punya award itself is idempotent on the
   * `idempotency_key='competition:{competition_id}:{student_id}'` key set
   * by the service.
   */
  async setResult(
    id: string,
    opts: {
      rank: number | null;
      note: string | null;
      punya_transaction_id: string | null;
    },
    tx?: Tx,
  ): Promise<CompetitionRegistration | null> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner
      .update(competition_registrations)
      .set({
        result_rank: opts.rank,
        result_note: opts.note,
        punya_transaction_id: opts.punya_transaction_id,
        updated_at: new Date(),
      })
      .where(eq(competition_registrations.id, id))
      .returning();
    return row ?? null;
  }

  async listByStudent(studentId: string, limit = 20): Promise<CompetitionRegistration[]> {
    return this.drizzle.dbRead
      .select()
      .from(competition_registrations)
      .where(eq(competition_registrations.student_id, studentId))
      .orderBy(desc(competition_registrations.registered_at))
      .limit(limit);
  }

  async listByIds(ids: string[]): Promise<CompetitionRegistration[]> {
    if (ids.length === 0) return [];
    return this.drizzle.dbRead
      .select()
      .from(competition_registrations)
      .where(inArray(competition_registrations.id, ids));
  }
}
