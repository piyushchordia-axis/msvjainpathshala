/**
 * ScopeResolverService — derives the JWT `scope` claim from a user's record
 * and their active role assignments.
 *
 * This is the single source of truth for "what city / centres / batches does
 * this actor reach", used by BOTH the initial OTP-verify mint (AuthService)
 * and refresh rotation (TokenRotationService). Keeping it in one place avoids
 * the two paths drifting — historically the initial mint and the refresh both
 * shipped `scope: {}`, which silently broke every city/centre/batch-scoped
 * read (niyams, notices, …) for non-super_admin actors.
 *
 * Role → scope:
 *   • super_admin / state_admin → {} (role gates national reach; state_admin's
 *     state boundary is enforced at the service layer, not via this claim).
 *   • city_admin                → city_id.
 *   • sanchalak                 → city_id + active centre assignments.
 *   • shikshak                  → city_id + active batch assignments + default centre.
 *   • parent / student / guest  → city_id.
 */

import { Injectable } from '@nestjs/common';

import { type Role, type ScopeContext } from '@jp/shared';

import {
  SanchalakAssignmentsRepository,
  ShikshakAssignmentsRepository,
  UsersRepository,
} from '../../../db/repositories';
import { type User } from '../../../db/schema';

export type ResolvedScope = Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'>;

@Injectable()
export class ScopeResolverService {
  constructor(
    private readonly users: UsersRepository,
    private readonly sanchalakAssignments: SanchalakAssignmentsRepository,
    private readonly shikshakAssignments: ShikshakAssignmentsRepository,
  ) {}

  /** Resolve from an already-loaded user record. */
  async forUser(user: User): Promise<ResolvedScope> {
    const role = user.role as Role;
    if (role === 'super_admin' || role === 'state_admin') return {};

    const scope: ResolvedScope = {};
    if (user.city_id) scope.city_id = user.city_id;

    if (role === 'sanchalak') {
      const centreIds = await this.sanchalakAssignments.listCentreIdsForSanchalak(user.id);
      if (centreIds.length > 0) scope.centre_ids = centreIds;
    } else if (role === 'shikshak') {
      const batchIds = await this.shikshakAssignments.listBatchIdsForShikshak(user.id);
      if (batchIds.length > 0) scope.batch_ids = batchIds;
      if (user.centre_id_default) scope.centre_ids = [user.centre_id_default];
    }
    return scope;
  }

  /** Resolve by user id — loads the record first. Empty scope if unknown. */
  async forUserId(userId: string): Promise<ResolvedScope> {
    const user = await this.users.findById(userId);
    if (!user) return {};
    return this.forUser(user);
  }
}
