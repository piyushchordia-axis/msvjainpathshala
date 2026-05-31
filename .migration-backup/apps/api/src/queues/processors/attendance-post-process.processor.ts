/**
 * `attendance.post_process` — runs after `AttendanceService.mark()` commits.
 *
 * Per-session debounced (same jobId collapses concurrent enqueues). Per-mark
 * fan-out:
 *   1. Recompute the student's attendance streak (excused/holiday/cancelled
 *      sessions count as "skip without breaking"; absent breaks the streak).
 *   2. If today crossed a milestone {7, 14, 30, 60, 100}: enqueue a Punya
 *      bonus via `punya.award` queue (idempotency key prevents duplicates
 *      across replays).
 *   3. Enqueue a `notifications.fanout` job for the parent so they receive
 *      the "attendance marked" push/in-app/email.
 *
 * Concurrency 10 — recomputes are read-heavy + cheap; the bottleneck is the
 * outgoing fanout enqueues, which the fanout worker already batches.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { RedisService } from '../../core/redis/redis.service';
import {
  AttendanceRepository,
  BatchesRepository,
  PunyaTransactionsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { punya_features, students as studentsTable } from '../../db/schema';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { AttendancePostProcessPayload } from '../../modules/attendance/attendance.types';

interface ResultSummary {
  session_id: string;
  streaks_recomputed: number;
  milestones_awarded: number;
  notifications_enqueued: number;
}

const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;

@Injectable()
@Processor(QUEUES.ATTENDANCE_POST_PROCESS, { concurrency: 10 })
export class AttendancePostProcessProcessor extends BaseProcessor<
  AttendancePostProcessPayload,
  ResultSummary
> {
  protected readonly postLogger = new Logger('Worker:attendance.post_process');

  constructor(
    redis: RedisService,
    private readonly drizzle: DrizzleService,
    private readonly attendanceRepo: AttendanceRepository,
    private readonly punyaRepo: PunyaTransactionsRepository,
    private readonly studentsRepo: StudentsRepository,
    private readonly batchesRepo: BatchesRepository,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.ATTENDANCE_POST_PROCESS, redis);
  }

  async handle(job: Job<AttendancePostProcessPayload, ResultSummary>): Promise<ResultSummary> {
    const payload = job.data;
    let streaksRecomputed = 0;
    let milestonesAwarded = 0;
    let notificationsEnqueued = 0;

    const batch = await this.batchesRepo.findById(payload.batch_id);
    if (!batch) {
      this.logger.warn(`batch ${payload.batch_id} not found — skipping`);
      return {
        session_id: payload.session_id,
        streaks_recomputed: 0,
        milestones_awarded: 0,
        notifications_enqueued: 0,
      };
    }

    // Process per-student: streak + milestone + parent fanout.
    for (const mark of payload.marks) {
      const student = await this.studentsRepo.findById(mark.student_id);
      if (!student) continue;

      // 1. Recompute streak.
      const today = new Date().toISOString().slice(0, 10);
      const history = await this.attendanceRepo.previousScheduledSessions(
        mark.student_id,
        payload.batch_id,
        payload.centre_id,
        today,
        100,
      );
      // Walk from most recent backward; current session's mark is the
      // anchor. Streak = consecutive present (counting excused/holiday/
      // cancelled as skip, absent as break).
      let streak = mark.status === 'present' ? 1 : 0;
      for (const day of history) {
        if (day.status === 'cancelled' || day.is_holiday) continue;
        if (day.has_absence_notice) continue; // excused
        if (day.attendance_status === 'present' || day.attendance_status === 'late') {
          streak += 1;
        } else if (day.attendance_status === 'absent') {
          break;
        } else if (day.attendance_status === 'excused') {
          continue;
        } else {
          // No mark recorded for a scheduled session — treat as a break
          // for streak purposes (defensive: rather under-credit than over-).
          break;
        }
      }
      streaksRecomputed += 1;

      // 2. Milestone bonus: pay out only when *today* crossed the threshold.
      // If today's mark made streak == 7 / 14 / 30 / 60 / 100 → award.
      if (
        mark.status === 'present' &&
        STREAK_MILESTONES.includes(streak as 7 | 14 | 30 | 60 | 100)
      ) {
        const featureKey = `attendance_streak_${streak}`;
        const points = await this.resolvePoints(featureKey);
        const idempotencyKey = `attendance_streak:${mark.student_id}:${streak}`;
        await this.punyaRepo
          .insertWithBalanceUpdate({
            student_id: mark.student_id,
            feature_key: featureKey,
            points,
            reason: `${streak}-day attendance streak milestone`,
            awarded_by_user_id: payload.marked_by_user_id,
            source_entity_kind: 'attendance',
            source_entity_id: mark.attendance_id,
            is_msv_track: false,
            awarded_at: new Date(),
            city_id: payload.city_id,
            centre_id: payload.centre_id,
            batch_id: payload.batch_id,
            idempotency_key: idempotencyKey,
          })
          .catch((err) => {
            this.logger.warn(
              `streak milestone insert failed (${idempotencyKey}): ${(err as Error).message}`,
            );
          });
        milestonesAwarded += 1;

        // Streak badge notification.
        await this.fanoutQueue
          .add('streak.badge_earned', {
            event: 'streak.badge_earned',
            recipient_user_ids: [student.parent_user_id],
            source: { kind: 'attendance', id: mark.attendance_id },
            data: {
              badge_label: `${streak}-day attendance streak`,
              badge_label_hi: `${streak}-day attendance streak`,
              full_name: student.full_name,
            },
            deep_link: `/students/${student.id}/punya`,
          })
          .catch(() => undefined);
        notificationsEnqueued += 1;
      }

      // 3. Parent fanout — "Attendance marked".
      await this.fanoutQueue
        .add('attendance.marked', {
          event: 'attendance.marked',
          recipient_user_ids: [student.parent_user_id],
          source: { kind: 'session', id: payload.session_id },
          data: {
            full_name: student.full_name,
            status_label: statusLabelEn(mark.status),
            status_label_hi: statusLabelHi(mark.status),
          },
          deep_link: `/parent/attendance`,
        })
        .catch(() => undefined);
      notificationsEnqueued += 1;
    }

    this.logger.log(
      `event=attendance.post_process session=${payload.session_id} students=${payload.marks.length} streaks=${streaksRecomputed} milestones=${milestonesAwarded} notifications=${notificationsEnqueued}`,
    );

    return {
      session_id: payload.session_id,
      streaks_recomputed: streaksRecomputed,
      milestones_awarded: milestonesAwarded,
      notifications_enqueued: notificationsEnqueued,
    };
  }

  private async resolvePoints(featureKey: string): Promise<number> {
    const [row] = await this.drizzle.dbRead
      .select({ pts: punya_features.default_points })
      .from(punya_features)
      .where(eq(punya_features.key, featureKey))
      .limit(1);
    return row?.pts ?? 20;
  }

  protected static readonly __keep = { studentsTable };
}

function statusLabelEn(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusLabelHi(s: string): string {
  switch (s) {
    case 'present':
      return 'उपस्थित';
    case 'absent':
      return 'अनुपस्थित';
    case 'late':
      return 'देर से';
    case 'excused':
      return 'क्षमादान';
    default:
      return 'अपडेट';
  }
}
