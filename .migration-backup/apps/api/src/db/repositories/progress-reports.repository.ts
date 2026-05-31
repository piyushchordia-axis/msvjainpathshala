/**
 * ProgressReportsRepository — `progress_reports` (SPEC §5.20).
 *
 * One row per (student_id, period_kind, period_label) — UPSERT semantics
 * via the unique index when the monthly cron re-runs for an already-
 * generated student.
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { progress_reports } from '../schema';

import type { NewProgressReport, ProgressReport } from '../schema';

@Injectable()
export class ProgressReportsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async upsert(input: NewProgressReport): Promise<ProgressReport> {
    const [row] = await this.drizzle.db
      .insert(progress_reports)
      .values(input)
      .onConflictDoUpdate({
        target: [
          progress_reports.student_id,
          progress_reports.period_kind,
          progress_reports.period_label,
        ],
        set: {
          generated_at: input.generated_at,
          pdf_asset_id: input.pdf_asset_id ?? null,
          shikshak_comment: input.shikshak_comment ?? null,
          snapshot: input.snapshot,
          updated_at: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('[ProgressReports.upsert] no row returned');
    return row;
  }

  async findById(id: string): Promise<ProgressReport | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(progress_reports)
      .where(eq(progress_reports.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByPeriod(
    studentId: string,
    periodKind: 'monthly' | 'termly',
    periodLabel: string,
  ): Promise<ProgressReport | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(progress_reports)
      .where(
        and(
          eq(progress_reports.student_id, studentId),
          eq(progress_reports.period_kind, periodKind),
          eq(progress_reports.period_label, periodLabel),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async listForStudent(studentId: string): Promise<ProgressReport[]> {
    return this.drizzle.dbRead
      .select()
      .from(progress_reports)
      .where(eq(progress_reports.student_id, studentId))
      .orderBy(desc(progress_reports.generated_at))
      .limit(50);
  }

  async setAsset(id: string, assetId: string): Promise<void> {
    await this.drizzle.db
      .update(progress_reports)
      .set({ pdf_asset_id: assetId, updated_at: new Date() })
      .where(eq(progress_reports.id, id));
  }

  async release(id: string): Promise<ProgressReport> {
    const [row] = await this.drizzle.db
      .update(progress_reports)
      .set({ released_to_parent: true, released_at: new Date(), updated_at: new Date() })
      .where(eq(progress_reports.id, id))
      .returning();
    if (!row) throw new Error(`[ProgressReports.release] no row for id=${id}`);
    return row;
  }

  async countByMonth(periodLabel: string): Promise<number> {
    const rows = await this.drizzle.dbRead.execute(sql`
      SELECT COUNT(*)::int AS c
        FROM progress_reports
       WHERE period_kind = 'monthly' AND period_label = ${periodLabel}
    `);
    return (rows as unknown as Array<{ c: number }>)[0]?.c ?? 0;
  }
}
