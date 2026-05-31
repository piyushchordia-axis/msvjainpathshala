/**
 * ExportJobsRepository — async export tracker (SPEC §12.5, §12.6).
 *
 * Lifecycle:
 *   create() with status='pending'
 *   markRunning() / markReady(asset_id) / markFailed(error)
 *
 * `findByRequester(userId)` powers the "your exports" list on the admin
 * panel (no cross-user reads — every requester only sees their own).
 */

import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { export_jobs } from '../schema';

import type { ExportJob, NewExportJob } from '../schema';

@Injectable()
export class ExportJobsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async create(input: NewExportJob): Promise<ExportJob> {
    const [row] = await this.drizzle.db.insert(export_jobs).values(input).returning();
    if (!row) throw new Error('[ExportJobs.create] no row returned');
    return row;
  }

  async findById(id: string): Promise<ExportJob | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(export_jobs)
      .where(eq(export_jobs.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findForRequester(id: string, requesterUserId: string): Promise<ExportJob | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(export_jobs)
      .where(and(eq(export_jobs.id, id), eq(export_jobs.requested_by_user_id, requesterUserId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForRequester(requesterUserId: string, limit = 50): Promise<ExportJob[]> {
    return this.drizzle.dbRead
      .select()
      .from(export_jobs)
      .where(eq(export_jobs.requested_by_user_id, requesterUserId))
      .orderBy(desc(export_jobs.created_at))
      .limit(limit);
  }

  async markRunning(id: string): Promise<void> {
    await this.drizzle.db
      .update(export_jobs)
      .set({ status: 'running', started_at: new Date(), updated_at: new Date() })
      .where(eq(export_jobs.id, id));
  }

  async markReady(id: string, assetId: string): Promise<void> {
    await this.drizzle.db
      .update(export_jobs)
      .set({
        status: 'ready',
        asset_id: assetId,
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(export_jobs.id, id));
  }

  async markFailed(id: string, error: string): Promise<void> {
    await this.drizzle.db
      .update(export_jobs)
      .set({
        status: 'failed',
        error: error.slice(0, 1000),
        completed_at: new Date(),
        updated_at: new Date(),
      })
      .where(eq(export_jobs.id, id));
  }
}
