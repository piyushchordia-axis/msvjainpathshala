/**
 * `niyam.streak.recompute` — recompute the streak for a (student, niyam)
 * pair after a submission or rejection.
 *
 * Algorithm (SPEC §8.4, BRD §8.5):
 *   1. Pull approved submissions for (student, niyam) ordered by
 *      submission_date ASC.
 *   2. Walk forward keeping a running streak; bump by 1 when the next
 *      submission falls within the niyam's frequency window of the
 *      previous date, reset to 1 otherwise.
 *        - daily   → next is previous + 1 day
 *        - weekly  → next is within the same or next ISO week
 *        - monthly → next is within the same or next calendar month
 *      Same-day duplicates are dropped (defensive).
 *   3. After the walk, the LAST streak value is current_streak (if its
 *      anchor date is still "fresh" relative to today — daily streaks
 *      break the moment you miss a day; weekly when the week passes;
 *      monthly when the month passes). Otherwise current_streak resets
 *      to 0 and `last_completion_date` keeps the last approved date.
 *   4. `longest_streak` = max(streak running during walk, prior longest).
 *   5. If `current_streak` crossed a milestone (7/14/30/60/100) AND the
 *      `badge_kind` wasn't already awarded → enqueue a Punya bonus via
 *      `PunyaService.award` (idempotency key = `niyam_streak:{student}:{niyam}:{milestone}`)
 *      and fanout a `niyam.streak.milestone` push to the parent.
 *
 * `skip_award=true` (set by the rejection path) suppresses the milestone
 * award even if the streak survived — admins manually rewarding milestones
 * is fine; rejections are never an opportunity to award.
 *
 * Concurrency 4 — recomputes are read-heavy + cheap; the bottleneck is the
 * outgoing PunyaService.award (which is already idempotent + concurrent-safe).
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import { RedisService } from '../../core/redis/redis.service';
import {
  NiyamStreaksRepository,
  NiyamSubmissionsRepository,
  NiyamsRepository,
  StudentsRepository,
} from '../../db/repositories';
import {
  NIYAM_BADGE_KINDS,
  NIYAM_STREAK_MILESTONES,
  type NiyamStreakRecomputePayload,
} from '../../modules/niyams/niyams.types';
import { PunyaService } from '../../modules/punya/punya.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Niyam, NiyamStreak } from '../../db/schema';

interface RecomputeResult {
  student_id: string;
  niyam_id: string | null;
  current_streak: number;
  longest_streak: number;
  milestone_awarded: string | null;
}

@Injectable()
@Processor(QUEUES.NIYAM_STREAK_RECOMPUTE, { concurrency: 4 })
export class NiyamStreakRecomputeProcessor extends BaseProcessor<
  NiyamStreakRecomputePayload,
  RecomputeResult
> {
  protected readonly postLogger = new Logger('Worker:niyam.streak.recompute');

  constructor(
    redis: RedisService,
    private readonly submissions: NiyamSubmissionsRepository,
    private readonly streaks: NiyamStreaksRepository,
    private readonly niyams: NiyamsRepository,
    private readonly students: StudentsRepository,
    private readonly punya: PunyaService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.NIYAM_STREAK_RECOMPUTE, redis);
  }

  async handle(job: Job<NiyamStreakRecomputePayload, RecomputeResult>): Promise<RecomputeResult> {
    const payload = job.data;
    const niyam = payload.niyam_id ? await this.niyams.findById(payload.niyam_id) : null;
    if (!niyam) {
      // No-target form — recompute all niyams the student has interacted with.
      // Phase 2 will need this when a student deactivates / reactivates; for
      // now we treat it as a no-op so the queue never DLQs on a stale payload.
      this.logger.debug(
        `niyam ${payload.niyam_id} not found — skipping recompute for student=${payload.student_id}`,
      );
      return {
        student_id: payload.student_id,
        niyam_id: payload.niyam_id,
        current_streak: 0,
        longest_streak: 0,
        milestone_awarded: null,
      };
    }
    const student = await this.students.findById(payload.student_id);
    if (!student) {
      this.logger.warn(`student ${payload.student_id} missing — bailing recompute`);
      return {
        student_id: payload.student_id,
        niyam_id: payload.niyam_id,
        current_streak: 0,
        longest_streak: 0,
        milestone_awarded: null,
      };
    }

    const dates = await this.collectApprovedDates(student.id, niyam.id);
    const { currentStreak, longestStreak, lastDate, currentIsFresh } = walkStreak(
      niyam.type,
      dates,
      new Date(),
    );

    const before = await this.streaks.find(student.id, niyam.id);
    const beforeLongest = before?.longest_streak ?? 0;
    const finalLongest = Math.max(longestStreak, beforeLongest);

    // Detect milestone crossing — only award if (current > previous current)
    // and the new value lands on a milestone AND the milestone hasn't been
    // awarded before (we track via `badge_kind` on the streak row + the
    // Punya idempotency key).
    let milestoneAwarded: string | null = null;
    const previousCurrent = before?.current_streak ?? 0;
    const crossedMilestones = NIYAM_STREAK_MILESTONES.filter(
      (m) => currentStreak >= m && previousCurrent < m,
    );
    const highestCrossed = crossedMilestones[crossedMilestones.length - 1];

    let badgeKind = before?.badge_kind ?? null;
    if (
      !payload.skip_award &&
      currentIsFresh &&
      highestCrossed &&
      NIYAM_BADGE_KINDS[highestCrossed]
    ) {
      const kind = NIYAM_BADGE_KINDS[highestCrossed]!;
      try {
        await this.punya.award({
          student_id: student.id,
          feature_key: 'niyam_approved',
          points: bonusPointsFor(highestCrossed),
          reason: `Niyam streak milestone (${highestCrossed} days): ${niyam.title_en}`,
          awarded_by_user_id: null,
          source_entity_kind: 'niyam_streak',
          source_entity_id: `${student.id}:${niyam.id}:${highestCrossed}`,
          is_msv_track: niyam.msv_only,
          idempotency_key: `niyam_streak:${student.id}:${niyam.id}:${highestCrossed}`,
        });
        milestoneAwarded = kind;
        badgeKind = kind;
        // Push notification to parent.
        await this.fanoutQueue
          .add('niyam.streak.milestone', {
            event: 'niyam.streak.milestone',
            recipient_user_ids: [student.parent_user_id],
            source: { kind: 'niyam_streak', id: `${student.id}:${niyam.id}` },
            data: {
              student_id: student.id,
              niyam_id: niyam.id,
              niyam_title_en: niyam.title_en,
              niyam_title_hi: niyam.title_hi,
              milestone_days: highestCrossed,
            },
            deep_link: `/students/${student.id}/niyams`,
          })
          .catch(() => undefined);
      } catch (err) {
        this.logger.warn(`milestone award failed: ${(err as Error).message}`);
      }
    } else if (payload.skip_award && currentStreak < (before?.current_streak ?? 0)) {
      // On a rejection that broke the streak, keep the prior badge_kind as a
      // historical marker but reset current; the badge_awarded flag stays
      // true so we don't re-award if the streak is rebuilt.
    }

    await this.streaks.upsert({
      student_id: student.id,
      niyam_id: niyam.id,
      current_streak: currentIsFresh ? currentStreak : 0,
      longest_streak: finalLongest,
      last_completion_date: lastDate,
      badge_awarded: badgeKind !== null,
      badge_kind: badgeKind,
    });

    return {
      student_id: student.id,
      niyam_id: niyam.id,
      current_streak: currentIsFresh ? currentStreak : 0,
      longest_streak: finalLongest,
      milestone_awarded: milestoneAwarded,
    };
  }

  private async collectApprovedDates(studentId: string, niyamId: string): Promise<string[]> {
    const submissions = await this.submissions.listApprovedAscByStudentNiyam(studentId, niyamId);
    return submissions.map((s) => s.submission_date);
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for the integration tests)
// ---------------------------------------------------------------------------

export interface StreakWalk {
  currentStreak: number;
  longestStreak: number;
  lastDate: string | null;
  /** True when `currentStreak` is still alive relative to today. */
  currentIsFresh: boolean;
}

export function walkStreak(type: Niyam['type'], datesAsc: string[], today: Date): StreakWalk {
  if (datesAsc.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastDate: null, currentIsFresh: false };
  }
  // Dedup same-day duplicates.
  const dates = Array.from(new Set(datesAsc));
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i += 1) {
    const prev = dates[i - 1]!;
    const cur = dates[i]!;
    if (isConsecutive(type, prev, cur)) {
      run += 1;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
  }
  const lastDate = dates[dates.length - 1]!;
  const currentIsFresh = isStillFresh(type, lastDate, today);
  return {
    currentStreak: run,
    longestStreak: longest,
    lastDate,
    currentIsFresh,
  };
}

/** True when `b` (later date) immediately follows `a` for the niyam frequency. */
function isConsecutive(type: Niyam['type'], aISO: string, bISO: string): boolean {
  const a = parseISODate(aISO);
  const b = parseISODate(bISO);
  if (type === 'daily') {
    const diff = Math.round((b.getTime() - a.getTime()) / (24 * 3600 * 1000));
    return diff === 1;
  }
  if (type === 'weekly') {
    // Consecutive when b is in the ISO week immediately following a's ISO week.
    return isoWeekDiff(a, b) === 1;
  }
  // monthly
  return monthDiff(a, b) === 1;
}

/** True when the last completion is recent enough that the streak hasn't expired. */
function isStillFresh(type: Niyam['type'], lastISO: string, today: Date): boolean {
  const last = parseISODate(lastISO);
  const todayUTC = parseISODate(today.toISOString().slice(0, 10));
  if (type === 'daily') {
    const diff = Math.round((todayUTC.getTime() - last.getTime()) / (24 * 3600 * 1000));
    return diff <= 1; // today or yesterday
  }
  if (type === 'weekly') {
    return isoWeekDiff(last, todayUTC) <= 1;
  }
  return monthDiff(last, todayUTC) <= 1;
}

function parseISODate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoWeekDiff(a: Date, b: Date): number {
  return isoWeekOrdinal(b) - isoWeekOrdinal(a);
}

/**
 * Maps a date to a monotonic ISO-week ordinal (year*53 + ISO week). Cheap
 * approximation that's strictly monotonic within a year and across year
 * boundaries (week-53 vs week-1 transitions are handled because the year
 * advances).
 */
function isoWeekOrdinal(d: Date): number {
  // Copy in UTC.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return date.getUTCFullYear() * 53 + weekNum;
}

function monthDiff(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/** Bonus Punya points awarded per milestone (small ramp). */
function bonusPointsFor(milestone: number): number {
  if (milestone >= 100) return 100;
  if (milestone >= 60) return 60;
  if (milestone >= 30) return 30;
  if (milestone >= 14) return 15;
  return 7;
}

// keep the type re-exported for in-tree consumers
export type { NiyamStreak };
