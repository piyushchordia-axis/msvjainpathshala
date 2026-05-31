/**
 * SanchalakAssignmentsRepository — link table between sanchalak users and
 * the centres they administer (`sanchalak_centre_assignments`).
 *
 * Schema-side partial unique on `(sanchalak_user_id, centre_id) WHERE
 * revoked_at IS NULL` (0002_indexes.sql) prevents double-live links.
 *
 * `list*` methods return only the LIVE rows (revoked_at IS NULL); the
 * historical rows stay on disk for audit.
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { sanchalak_centre_assignments } from '../schema';

import type { SanchalakCentreAssignment } from '../schema';

@Injectable()
export class SanchalakAssignmentsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Active centre ids for a sanchalak (used to populate ScopeContext). */
  async listCentreIdsForSanchalak(sanchalakUserId: string): Promise<string[]> {
    const rows = await this.drizzle.dbRead
      .select({ centre_id: sanchalak_centre_assignments.centre_id })
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.sanchalak_user_id, sanchalakUserId),
          isNull(sanchalak_centre_assignments.revoked_at),
        ),
      );
    return rows.map((r) => r.centre_id);
  }

  async listForCentre(centreId: string): Promise<SanchalakCentreAssignment[]> {
    return this.drizzle.dbRead
      .select()
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.centre_id, centreId),
          isNull(sanchalak_centre_assignments.revoked_at),
        ),
      );
  }

  async assign(centreId: string, sanchalakUserId: string): Promise<SanchalakCentreAssignment> {
    const [row] = await this.drizzle.db
      .insert(sanchalak_centre_assignments)
      .values({
        centre_id: centreId,
        sanchalak_user_id: sanchalakUserId,
        assigned_at: new Date(),
      })
      .returning();
    if (!row) throw new Error('[SanchalakAssignments.assign] insert returned no row');
    return row;
  }

  async revoke(centreId: string, sanchalakUserId: string): Promise<void> {
    await this.drizzle.db
      .update(sanchalak_centre_assignments)
      .set({ revoked_at: new Date(), updated_at: new Date() })
      .where(
        and(
          eq(sanchalak_centre_assignments.centre_id, centreId),
          eq(sanchalak_centre_assignments.sanchalak_user_id, sanchalakUserId),
          isNull(sanchalak_centre_assignments.revoked_at),
        ),
      );
  }
}
