/**
 * BatchesService — CRUD + capacity-aware update + timetable derivation +
 * shikshak assignment management.
 *
 * Capacity-reduction guard: PATCH that lowers `capacity` is rejected if the
 * batch currently has more active enrolments than the requested capacity.
 *
 * Timetable derivation: given a batch with `day_of_week int[]` + start/end
 * times, returns the next 8 weeks of session slots as `{ date, start, end,
 * is_holiday, holiday_reason? }` (holiday merge lands when CentreHolidays is
 * imported below).
 */

import { Injectable } from '@nestjs/common';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import {
  BatchesRepository,
  CentreHolidaysRepository,
  ShikshakAssignmentsRepository,
} from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import type { Batch, NewBatch } from '../../db/schema';

const LIST_TTL = 300;
const DETAIL_TTL = 300;
const listKey = (centreId: string) => `cache:batches:list:${centreId}`;
const detailKey = (id: string) => `cache:batches:detail:${id}`;

export interface BatchActor {
  user_id: string;
  role: Role;
}

export interface TimetableSlot {
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM:SS
  end_time: string;
  is_holiday: boolean;
  holiday_name?: string;
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly repo: BatchesRepository,
    private readonly holidays: CentreHolidaysRepository,
    private readonly shikshakAssignments: ShikshakAssignmentsRepository,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
  ) {}

  async listForCentre(centreId: string): Promise<Batch[]> {
    const cached = await this.redis.cacheClient.get(listKey(centreId));
    if (cached) {
      try {
        return JSON.parse(cached) as Batch[];
      } catch {
        // fall through
      }
    }
    const rows = await this.repo.listByCentre(centreId);
    await this.redis.cacheClient.set(listKey(centreId), JSON.stringify(rows), 'EX', LIST_TTL);
    return rows;
  }

  async getById(batchId: string): Promise<Batch> {
    const cached = await this.redis.cacheClient.get(detailKey(batchId));
    if (cached) {
      try {
        return JSON.parse(cached) as Batch;
      } catch {
        // fall through
      }
    }
    const row = await this.repo.findById(batchId);
    if (!row) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }
    await this.redis.cacheClient.set(detailKey(batchId), JSON.stringify(row), 'EX', DETAIL_TTL);
    return row;
  }

  async create(actor: BatchActor, input: NewBatch): Promise<Batch> {
    this.assertScheduleSane(input.day_of_week, input.start_time, input.end_time);
    const row = await this.repo.create(input);
    await this.redis.cacheClient.del(listKey(row.centre_id));
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'batch.created',
      entity_kind: 'batch',
      entity_id: row.id,
      after: { centre_id: row.centre_id, name: row.name, capacity: row.capacity },
    });
    return row;
  }

  async update(actor: BatchActor, batchId: string, patch: Partial<NewBatch>): Promise<Batch> {
    const before = await this.repo.findById(batchId);
    if (!before) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Batch not found',
        statusCode: 404,
      });
    }
    if (
      patch.day_of_week !== undefined ||
      patch.start_time !== undefined ||
      patch.end_time !== undefined
    ) {
      this.assertScheduleSane(
        patch.day_of_week ?? before.day_of_week,
        patch.start_time ?? before.start_time,
        patch.end_time ?? before.end_time,
      );
    }
    if (patch.capacity !== undefined && patch.capacity < before.capacity) {
      const enrolled = await this.repo.countActiveEnrolments(batchId);
      if (enrolled > patch.capacity) {
        throw new AppError({
          code: ERROR_CODES.ERR_BATCH_OVER_CAPACITY,
          message: `Cannot reduce capacity below current active enrolment (${enrolled})`,
          statusCode: 409,
          details: [
            { path: 'capacity', meta: { active_enrolled: enrolled, requested: patch.capacity } },
          ],
        });
      }
    }
    const row = await this.repo.update(batchId, patch);
    await this.redis.cacheClient.del(detailKey(batchId));
    await this.redis.cacheClient.del(listKey(row.centre_id));
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'batch.updated',
      entity_kind: 'batch',
      entity_id: batchId,
      before: { capacity: before.capacity, status: before.status },
      after: patch as Record<string, unknown>,
    });
    return row;
  }

  async deactivate(actor: BatchActor, batchId: string): Promise<void> {
    const before = await this.getById(batchId);
    const enrolled = await this.repo.countActiveEnrolments(batchId);
    if (enrolled > 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: `Batch has ${enrolled} active enrolment(s); transfer or deactivate them first`,
        statusCode: 409,
        details: [{ path: 'enrolments', meta: { active: enrolled } }],
      });
    }
    await this.repo.setStatus(batchId, 'inactive');
    await this.redis.cacheClient.del(detailKey(batchId));
    await this.redis.cacheClient.del(listKey(before.centre_id));
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'batch.deactivated',
      entity_kind: 'batch',
      entity_id: batchId,
    });
  }

  // ----- shikshak assignments --------------------------------------------

  async assignShikshak(actor: BatchActor, batchId: string, userId: string): Promise<void> {
    await this.getById(batchId);
    await this.shikshakAssignments.assign(batchId, userId);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'batch.shikshak.assigned',
      entity_kind: 'batch',
      entity_id: batchId,
      after: { shikshak_user_id: userId },
    });
  }

  async revokeShikshak(actor: BatchActor, batchId: string, userId: string): Promise<void> {
    await this.shikshakAssignments.revoke(batchId, userId);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'batch.shikshak.revoked',
      entity_kind: 'batch',
      entity_id: batchId,
      after: { shikshak_user_id: userId },
    });
  }

  // ----- timetable -------------------------------------------------------

  /**
   * Compute the next `weeks` weeks of session slots derived from the batch's
   * day_of_week + start/end columns, merging centre_holidays that overlap
   * each slot date.
   */
  async timetable(batchId: string, weeks: number = 8): Promise<TimetableSlot[]> {
    const batch = await this.getById(batchId);
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + weeks * 7);

    const holidays = await this.holidays.listForCentre(batch.centre_id, {
      from: startDate.toISOString().slice(0, 10),
      to: endDate.toISOString().slice(0, 10),
    });
    // Build a map of `YYYY-MM-DD → holiday name` for fast lookup.
    const holidayMap = new Map<string, string>();
    for (const h of holidays) {
      const from = new Date(h.start_date);
      const to = new Date(h.end_date);
      for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
        holidayMap.set(d.toISOString().slice(0, 10), h.name);
      }
    }

    // ISO day-of-week: Mon=1 … Sun=7. JavaScript Date#getUTCDay returns
    // Sun=0..Sat=6. Normalise to ISO so it matches the column.
    const slots: TimetableSlot[] = [];
    const meetingDays = new Set(batch.day_of_week);
    for (let d = new Date(startDate); d < endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const jsDay = d.getUTCDay();
      const isoDay = jsDay === 0 ? 7 : jsDay;
      if (meetingDays.has(isoDay)) {
        const ymd = d.toISOString().slice(0, 10);
        const holiday = holidayMap.get(ymd);
        slots.push({
          date: ymd,
          start_time: batch.start_time,
          end_time: batch.end_time,
          is_holiday: holiday !== undefined,
          ...(holiday ? { holiday_name: holiday } : {}),
        });
      }
    }
    return slots;
  }

  // ----- helpers ---------------------------------------------------------

  private assertScheduleSane(days: number[], startTime: string, endTime: string): void {
    if (days.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'day_of_week must include at least one weekday',
        statusCode: 422,
        details: [{ path: 'day_of_week' }],
      });
    }
    for (const d of days) {
      if (d < 1 || d > 7 || !Number.isInteger(d)) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: 'day_of_week values must be integers in 1..7 (Mon..Sun)',
          statusCode: 422,
          details: [{ path: 'day_of_week', meta: { invalid_value: d } }],
        });
      }
    }
    if (startTime >= endTime) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'end_time must be after start_time',
        statusCode: 422,
        details: [{ path: 'end_time', meta: { start_time: startTime, end_time: endTime } }],
      });
    }
  }
}
