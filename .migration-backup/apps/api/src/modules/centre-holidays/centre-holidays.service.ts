/**
 * CentreHolidaysService — manage per-centre closure dates.
 *
 *   • list with optional [from, to] window (defaults to next 90 days)
 *   • create + enqueue a `notifications.fanout` job that downstream workers
 *     (Step 7) consume to push the announcement to centre members. The
 *     queue name is the SPEC §9.1 canonical `notifications.fanout`; the
 *     job payload carries `kind='centre_holiday_announced'` so the worker
 *     dispatches the right template.
 *   • delete (no announcement; this is an admin correction action)
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, QUEUES, type Role } from '@jp/shared';

import { RedisService } from '../../core/redis/redis.service';
import { CentreHolidaysRepository } from '../../db/repositories';
import { AuditService } from '../audit/audit.service';

import type { CentreHoliday } from '../../db/schema';

export interface HolidayActor {
  user_id: string;
  role: Role;
}

@Injectable()
export class CentreHolidaysService {
  private readonly logger = new Logger(CentreHolidaysService.name);
  private readonly fanoutQueue: Queue;

  constructor(
    private readonly repo: CentreHolidaysRepository,
    private readonly audit: AuditService,
    redis: RedisService,
  ) {
    this.fanoutQueue = new Queue(QUEUES.NOTIFICATIONS_FANOUT, {
      connection: redis.bullmqClient,
    });
  }

  async list(
    centreId: string,
    opts: { from?: string; to?: string } = {},
  ): Promise<CentreHoliday[]> {
    return this.repo.listForCentre(centreId, opts);
  }

  async create(
    actor: HolidayActor,
    centreId: string,
    input: { name: string; start_date: string; end_date: string },
  ): Promise<CentreHoliday> {
    if (input.start_date > input.end_date) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'end_date must be on or after start_date',
        statusCode: 422,
        details: [
          { path: 'end_date', meta: { start_date: input.start_date, end_date: input.end_date } },
        ],
      });
    }
    const row = await this.repo.create({
      centre_id: centreId,
      name: input.name,
      start_date: input.start_date,
      end_date: input.end_date,
      created_by_user_id: actor.user_id,
    });
    await this.enqueueAnnouncement(row);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre_holiday.created',
      entity_kind: 'centre_holiday',
      entity_id: row.id,
      after: {
        centre_id: centreId,
        name: row.name,
        start_date: row.start_date,
        end_date: row.end_date,
      },
    });
    return row;
  }

  async delete(actor: HolidayActor, centreId: string, holidayId: string): Promise<void> {
    const row = await this.repo.findById(holidayId);
    if (!row || row.centre_id !== centreId) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Holiday not found for this centre',
        statusCode: 404,
      });
    }
    await this.repo.delete(holidayId);
    await this.audit.emit({
      actor_user_id: actor.user_id,
      actor_role: actor.role,
      action: 'centre_holiday.deleted',
      entity_kind: 'centre_holiday',
      entity_id: holidayId,
      before: { centre_id: row.centre_id, name: row.name },
    });
  }

  // ----- internal --------------------------------------------------------

  private async enqueueAnnouncement(row: CentreHoliday): Promise<void> {
    try {
      await this.fanoutQueue.add(
        'centre_holiday_announced',
        {
          // Step 12 fanout shape — recipient resolution happens in the worker.
          event: 'centre_holiday_announced',
          scope: { kind: 'centre', id: row.centre_id },
          source: { kind: 'centre_holiday', id: row.id },
          data: {
            name: row.name,
            start_date: row.start_date,
            end_date: row.end_date,
          },
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
      );
    } catch (err) {
      // Don't fail the request if the queue is down — the holiday is still
      // persisted; the notification can be re-issued later by an admin tool.
      this.logger.warn(
        `enqueue centre_holiday_announced failed (${(err as Error).message}); holiday saved but notification deferred`,
      );
    }
  }
}
