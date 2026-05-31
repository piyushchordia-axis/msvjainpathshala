/**
 * `attendance.consecutive_check` — daily cron at 22:00 IST.
 *
 * For every active student in every active batch: look at the last 3
 * scheduled, non-cancelled, non-holiday sessions. If all 3 are `absent` (no
 * advance absence notification) → insert a `student_notes` alert + notify
 * parent + sanchalak + city_admin.
 *
 * Debounce: `StudentNotesRepository.hasRecentAlert(needlePrefix, 7d)` skips
 * students we already flagged in the last week.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  AttendanceRepository,
  CentresRepository,
  SanchalakAssignmentsRepository,
  StudentNotesRepository,
  UsersRepository,
} from '../../db/repositories';
import { batches, students as studentsTable } from '../../db/schema';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

interface ResultSummary {
  flagged: number;
  scanned: number;
  notifications_enqueued: number;
}

const RECENT_ALERT_WINDOW_DAYS = 7;
const ALERT_PREFIX = '3 consecutive absences flagged';

@Injectable()
@Processor(QUEUES.ATTENDANCE_CONSECUTIVE_CHECK, { concurrency: 5 })
export class AttendanceConsecutiveCheckProcessor extends BaseProcessor<
  Record<string, never>,
  ResultSummary
> {
  protected readonly checkLogger = new Logger('Worker:attendance.consecutive_check');

  constructor(
    redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly notesRepo: StudentNotesRepository,
    private readonly centresRepo: CentresRepository,
    private readonly sanchalakRepo: SanchalakAssignmentsRepository,
    private readonly usersRepo: UsersRepository,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.ATTENDANCE_CONSECUTIVE_CHECK, redis);
  }

  async handle(_job: Job<Record<string, never>, ResultSummary>): Promise<ResultSummary> {
    const today = new Date().toISOString().slice(0, 10);
    let scanned = 0;
    let flagged = 0;
    let notificationsEnqueued = 0;

    const activeStudents = await this.drizzle.dbRead
      .select({
        id: studentsTable.id,
        parent_user_id: studentsTable.parent_user_id,
        full_name: studentsTable.full_name,
        batch_id: studentsTable.batch_id,
        centre_id: studentsTable.centre_id,
      })
      .from(studentsTable)
      .innerJoin(batches, eq(batches.id, studentsTable.batch_id))
      .where(
        and(
          eq(studentsTable.status, 'active'),
          isNull(studentsTable.deleted_at),
          eq(batches.status, 'active'),
          isNull(batches.deleted_at),
        ),
      );

    for (const s of activeStudents) {
      scanned += 1;
      if (!s.batch_id) continue;

      // Last 3 scheduled, non-cancelled, non-holiday, no-excuse sessions.
      const history = await this.attendanceRepo.previousScheduledSessions(
        s.id,
        s.batch_id,
        s.centre_id,
        today,
        20,
      );
      const consider = history
        .filter((d) => d.status !== 'cancelled' && !d.is_holiday && !d.has_absence_notice)
        .slice(0, 3);
      if (consider.length < 3) continue;
      const allAbsent = consider.every((d) => d.attendance_status === 'absent');
      if (!allAbsent) continue;

      // Debounce: only flag once per week.
      const sinceDate = new Date(Date.now() - RECENT_ALERT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const alreadyFlagged = await this.notesRepo.hasRecentAlert(s.id, ALERT_PREFIX, sinceDate);
      if (alreadyFlagged) continue;

      // We need a real user id for author_user_id (FK). Prefer the first
      // sanchalak for the centre; fall back to the parent_user_id so the
      // note is always durable. The cron is a system actor in spirit, but
      // we don't yet have a synthetic "system" user — TODO Step 14.
      const assignmentsForAuthor = await this.sanchalakRepo
        .listForCentre(s.centre_id)
        .catch(() => [] as Array<{ sanchalak_user_id: string }>);
      const authorUserId = assignmentsForAuthor[0]?.sanchalak_user_id ?? s.parent_user_id;
      await this.notesRepo.insert({
        student_id: s.id,
        author_user_id: authorUserId,
        note: `${ALERT_PREFIX} on ${today}. Last 3 sessions: ${consider
          .map((d) => d.scheduled_date)
          .join(', ')}`,
      });
      flagged += 1;

      const assignments = await this.sanchalakRepo
        .listForCentre(s.centre_id)
        .catch(() => [] as Array<{ sanchalak_user_id: string }>);
      const sanchalakIds = assignments.map((a) => a.sanchalak_user_id);

      // Find the city_admins for this centre.
      const centre = await this.centresRepo.findById(s.centre_id);
      const cityAdmins = centre
        ? await this.usersRepo
            .findByRoleAndCity('city_admin', centre.city_id)
            .catch(() => [] as Array<{ id: string }>)
        : [];

      const recipientIds = [s.parent_user_id, ...sanchalakIds, ...cityAdmins.map((u) => u.id)];
      await this.fanoutQueue
        .add('notice.critical', {
          event: 'notice.critical',
          recipient_user_ids: recipientIds,
          source: { kind: 'student', id: s.id },
          data: {
            title: 'Consecutive absences flagged',
            title_hi: 'लगातार अनुपस्थिति',
            body: `${s.full_name} was absent for 3 consecutive sessions. Please check in with the family.`,
            body_hi: `${s.full_name} 3 लगातार सत्रों से अनुपस्थित हैं। कृपया परिवार से संपर्क करें।`,
          },
          deep_link: `/admin/attendance/students/${s.id}`,
          is_critical: true,
        })
        .catch(() => undefined);
      notificationsEnqueued += recipientIds.length;
    }

    this.logger.log(
      `event=attendance.consecutive_check scanned=${scanned} flagged=${flagged} notifications=${notificationsEnqueued}`,
    );

    return { scanned, flagged, notifications_enqueued: notificationsEnqueued };
  }
}
