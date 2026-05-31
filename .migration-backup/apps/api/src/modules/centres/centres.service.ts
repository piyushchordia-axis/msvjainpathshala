/**
 * CentresService — scoped reads + writes + deactivate guard.
 *
 *   • super_admin → sees / mutates all
 *   • state_admin → scoped to centres in their state
 *   • city_admin  → scoped to centres in their city
 *   • sanchalak   → scoped to their assigned centres only
 *   • shikshak    → derives from `shikshak_batch_assignments` → centre_ids
 *
 * Caching (Step 6 prompt + SPEC §17.2):
 *   list   — `cache:centres:list:{cityId|all}` TTL 5 min
 *   detail — `cache:centres:detail:{id}`        TTL 15 min
 * Writes invalidate the list key AND the affected detail key.
 *
 * Deactivate guard — centre cannot be deactivated while it owns at least
 * one active batch. Service returns `ERR_BATCH_OVER_CAPACITY`-shaped 409
 * (`ERR_CONFLICT_STATE_TRANSITION` is the closest existing code).
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import {
  BatchesRepository,
  CentresRepository,
  SanchalakAssignmentsRepository,
  ShikshakAssignmentsRepository,
} from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import type { Centre, NewCentre } from '../../db/schema';

const LIST_TTL = 300;
const DETAIL_TTL = 900;
const listKey = (suffix: string) => `cache:centres:list:${suffix}`;
const detailKey = (id: string) => `cache:centres:detail:${id}`;

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  state_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class CentresService {
  constructor(
    private readonly repo: CentresRepository,
    private readonly batches: BatchesRepository,
    private readonly sanchalakAssignments: SanchalakAssignmentsRepository,
    private readonly shikshakAssignments: ShikshakAssignmentsRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  // ----- Reads ------------------------------------------------------------

  /**
   * Scoped list. The actor's role dictates which centres are visible. The
   * cache key encodes the scope so two roles never share cached results.
   */
  async listForActor(actor: ScopedActor): Promise<Centre[]> {
    const scopeKey = this.cacheScopeKey(actor);
    const cached = await this.redis.cacheClient.get(listKey(scopeKey));
    if (cached) {
      try {
        return JSON.parse(cached) as Centre[];
      } catch {
        // fall through to DB
      }
    }

    let rows: Centre[];
    switch (actor.role) {
      case 'super_admin':
        rows = await this.repo.listAll();
        break;
      case 'state_admin':
      case 'city_admin':
        rows = actor.city_id ? await this.repo.listByCity(actor.city_id) : [];
        break;
      case 'sanchalak': {
        const centreIds =
          actor.centre_ids ??
          (await this.sanchalakAssignments.listCentreIdsForSanchalak(actor.user_id));
        rows = await this.repo.listByIds(centreIds);
        break;
      }
      case 'shikshak': {
        // Derive centres from batch assignments — shikshaks have batch_ids
        // primarily; centre membership is a join.
        const batchIds =
          actor.batch_ids ??
          (await this.shikshakAssignments.listBatchIdsForShikshak(actor.user_id));
        const batches = await Promise.all(batchIds.map((id) => this.batches.findById(id)));
        const centreIds = Array.from(
          new Set(
            batches.filter((b): b is NonNullable<typeof b> => b !== null).map((b) => b.centre_id),
          ),
        );
        rows = await this.repo.listByIds(centreIds);
        break;
      }
      default:
        rows = [];
        break;
    }

    await this.redis.cacheClient.set(listKey(scopeKey), JSON.stringify(rows), 'EX', LIST_TTL);
    return rows;
  }

  async getById(centreId: string): Promise<Centre> {
    const cached = await this.redis.cacheClient.get(detailKey(centreId));
    if (cached) {
      try {
        return JSON.parse(cached) as Centre;
      } catch {
        // fall through
      }
    }
    const row = await this.repo.findById(centreId);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Centre not found',
        statusCode: 404,
      });
    }
    await this.redis.cacheClient.set(detailKey(centreId), JSON.stringify(row), 'EX', DETAIL_TTL);
    return row;
  }

  // ----- Writes -----------------------------------------------------------

  async create(actor: ScopedActor, input: NewCentre): Promise<Centre> {
    this.assertGpsBounds(input);
    const row = await this.repo.create(input);
    await this.invalidateAllListCaches();
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre.created',
      entity_kind: 'centre',
      entity_id: row.id,
      after: { city_id: row.city_id, name: row.name },
    });
    return row;
  }

  async update(actor: ScopedActor, centreId: string, patch: Partial<NewCentre>): Promise<Centre> {
    if (patch.lat !== undefined || patch.lng !== undefined || patch.gps_radius_m !== undefined) {
      this.assertGpsBounds(patch as NewCentre);
    }
    const before = await this.getById(centreId);
    const row = await this.repo.update(centreId, patch);
    await this.redis.cacheClient.del(detailKey(centreId));
    await this.invalidateAllListCaches();
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre.updated',
      entity_kind: 'centre',
      entity_id: centreId,
      before: { name: before.name, status: before.status },
      after: patch as Record<string, unknown>,
    });
    return row;
  }

  /**
   * Deactivate guard: a centre with active batches cannot transition to
   * inactive. Service-layer 409 — service code checks count, not the FK.
   */
  async deactivate(actor: ScopedActor, centreId: string): Promise<void> {
    await this.getById(centreId); // 404-if-missing
    const activeBatches = await this.repo.countActiveBatches(centreId);
    if (activeBatches > 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: `Centre has ${activeBatches} active batch(es); deactivate them first`,
        statusCode: 409,
        details: [{ path: 'batches', meta: { active_count: activeBatches } }],
      });
    }
    await this.repo.setStatus(centreId, 'inactive');
    await this.redis.cacheClient.del(detailKey(centreId));
    await this.invalidateAllListCaches();
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre.deactivated',
      entity_kind: 'centre',
      entity_id: centreId,
    });
  }

  // ----- Sanchalak assignments -------------------------------------------

  async assignSanchalak(actor: ScopedActor, centreId: string, userId: string): Promise<void> {
    await this.getById(centreId); // 404-if-missing
    await this.sanchalakAssignments.assign(centreId, userId);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre.sanchalak.assigned',
      entity_kind: 'centre',
      entity_id: centreId,
      after: { sanchalak_user_id: userId },
    });
  }

  async revokeSanchalak(actor: ScopedActor, centreId: string, userId: string): Promise<void> {
    await this.sanchalakAssignments.revoke(centreId, userId);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre.sanchalak.revoked',
      entity_kind: 'centre',
      entity_id: centreId,
      after: { sanchalak_user_id: userId },
    });
  }

  // ----- helpers ----------------------------------------------------------

  private cacheScopeKey(actor: ScopedActor): string {
    switch (actor.role) {
      case 'super_admin':
        return 'all';
      case 'state_admin':
        return `state:${actor.state_id ?? 'none'}`;
      case 'city_admin':
        return `city:${actor.city_id ?? 'none'}`;
      case 'sanchalak':
        return `sanchalak:${actor.user_id}`;
      case 'shikshak':
        return `shikshak:${actor.user_id}`;
      default:
        return `actor:${actor.user_id}`;
    }
  }

  private async invalidateAllListCaches(): Promise<void> {
    // Cache keys are role-scoped; with a small number of scopes (super,
    // sanchalak:*, shikshak:*, city:*, state:*) the simplest correct
    // approach is to SCAN the namespace and delete matches.
    const stream = this.redis.cacheClient.scanStream({ match: 'cache:centres:list:*', count: 100 });
    for await (const keys of stream as unknown as AsyncIterable<string[]>) {
      if (keys.length > 0) await this.redis.cacheClient.del(...keys);
    }
  }

  private assertGpsBounds(input: Partial<NewCentre>): void {
    const lat = input.lat;
    const lng = input.lng;
    const r = input.gps_radius_m;
    if (lat !== undefined && lat !== null) {
      const n = Number(lat);
      if (Number.isNaN(n) || n < -90 || n > 90) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'lat must be between -90 and 90',
          statusCode: 422,
          details: [{ path: 'lat', meta: { value: lat } }],
        });
      }
    }
    if (lng !== undefined && lng !== null) {
      const n = Number(lng);
      if (Number.isNaN(n) || n < -180 || n > 180) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'lng must be between -180 and 180',
          statusCode: 422,
          details: [{ path: 'lng', meta: { value: lng } }],
        });
      }
    }
    if (r !== undefined && (r < 10 || r > 5000)) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'gps_radius_m must be between 10 and 5000',
        statusCode: 422,
        details: [{ path: 'gps_radius_m', meta: { value: r } }],
      });
    }
  }
}
