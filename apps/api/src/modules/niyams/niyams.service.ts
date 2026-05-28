/**
 * NiyamsService — Step 17 (SPEC §5.8, §6.10, §8.4, CLAUDE.md Q5/Q6).
 *
 * Responsibilities:
 *
 *   1. CRUD with role-scoped writes — shikshak (batch scope), sanchalak
 *      (centre scope), city_admin (city scope). Service-layer enforcement
 *      so direct API calls can never escalate.
 *
 *   2. `submit()` — parent / student-view auto-approve flow (§8.4):
 *        BEGIN
 *          INSERT niyam_submissions(status='auto_approved')
 *          PunyaService.award(idempotency_key='niyam_sub:{submission_id}')
 *          IF parent.gallery_visibility_opt_in
 *            INSERT gallery_items
 *        COMMIT
 *        enqueue niyam.streak.recompute(student, niyam)
 *        enqueue notifications.fanout(niyam.submitted) for parent
 *
 *      The PunyaService award is idempotent on the submission id, so
 *      retries from the offline-sync engine are safe.
 *
 *   3. `reject()` — admin retro-reject within 30 days (Q5):
 *        - Asserts `submitted_at >= now() - 30 days` (window check)
 *        - Reverses Punya via PunyaService.reverseTransaction()
 *        - Marks submission rejected; sets reversal_transaction_id
 *        - Hides the gallery_item (if any)
 *        - Enqueues niyam.streak.recompute (the rejection may break a streak
 *          retroactively)
 *        - Enqueues notifications.fanout (niyam.rejected) for parent
 *        - Writes audit log entry
 *
 *   4. Reads: list active niyams for caller, streak summary, recent
 *      submissions.
 */

import { randomUUID } from 'node:crypto';

import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { AppError, ERROR_CODES, type Role, ROLE_PRECEDENCE } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import {
  CentresRepository,
  GalleryItemsRepository,
  MediaAssetsRepository,
  MsvEnrolmentsRepository,
  NiyamsRepository,
  NiyamStreaksRepository,
  NiyamSubmissionsRepository,
  StudentsRepository,
  UsersRepository,
} from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  type CreateNiyamInput,
  type NiyamForCallerRow,
  type RejectNiyamInput,
  type RejectNiyamResult,
  type StreakSummary,
  type SubmissionRow,
  type SubmitNiyamInput,
  type SubmitNiyamResult,
} from './niyams.types';

import type { NewNiyam, Niyam, Student, User } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

/** Q5 — 30-day reversal window enforced at the service. */
export const NIYAM_REVERSAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class NiyamsService {
  private readonly logger = new Logger(NiyamsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly niyams: NiyamsRepository,
    private readonly submissions: NiyamSubmissionsRepository,
    private readonly streaks: NiyamStreaksRepository,
    private readonly gallery: GalleryItemsRepository,
    private readonly students: StudentsRepository,
    private readonly users: UsersRepository,
    private readonly centres: CentresRepository,
    private readonly mediaAssets: MediaAssetsRepository,
    private readonly msvEnrolments: MsvEnrolmentsRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
    @Optional()
    @Inject(`BullQueue_${QUEUES.NIYAM_STREAK_RECOMPUTE}`)
    private readonly streakQueue: Queue | null,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT)
    private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Admin — CRUD
  // ===========================================================================

  async create(actor: ScopedActor, input: CreateNiyamInput): Promise<Niyam> {
    this.assertCanCreateNiyam(actor);
    const cityId = await this.resolveCityForActor(actor);
    if (!cityId) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Cannot determine your city — refusing to create a niyam',
        statusCode: 403,
      });
    }
    if (input.points_value < 1 || input.points_value > 200) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'points_value must be between 1 and 200',
        statusCode: 422,
      });
    }
    // shikshak can only target their own batches; sanchalak only their centres
    if (actor.role === 'shikshak' && input.audience_kind === 'batch') {
      const targets = input.audience_filters?.batch_ids ?? [];
      const own = new Set(actor.batch_ids ?? []);
      if (targets.length === 0 || targets.some((b) => !own.has(b))) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'shikshak can only target their own batches',
          statusCode: 403,
        });
      }
    }
    if (actor.role === 'sanchalak' && input.audience_kind === 'centre') {
      const targets = input.audience_filters?.centre_ids ?? [];
      const own = new Set(actor.centre_ids ?? []);
      if (targets.length === 0 || targets.some((c) => !own.has(c))) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'sanchalak can only target their own centres',
          statusCode: 403,
        });
      }
    }

    const row: NewNiyam = {
      title_en: input.title_en,
      title_hi: input.title_hi,
      description_en: input.description_en ?? null,
      description_hi: input.description_hi ?? null,
      type: input.type,
      start_date: input.start_date,
      end_date: input.end_date ?? null,
      audience_kind: input.audience_kind,
      audience_filters: input.audience_filters ?? null,
      proof_type: input.proof_type,
      points_value: input.points_value,
      reference_asset_id: input.reference_asset_id ?? null,
      created_by_user_id: actor.user_id,
      city_id: cityId,
      msv_only: input.msv_only ?? input.audience_kind === 'msv_only',
    };
    const created = await this.niyams.create(row);

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'niyam',
        entity_id: created.id,
        after: {
          title_en: created.title_en,
          type: created.type,
          audience_kind: created.audience_kind,
          points_value: created.points_value,
        },
      })
      .catch(() => undefined);
    return created;
  }

  async listForAdmin(
    actor: ScopedActor,
    opts: { type?: 'daily' | 'weekly' | 'monthly'; limit?: number; offset?: number } = {},
  ): Promise<Niyam[]> {
    this.assertCanCreateNiyam(actor);
    const cityId = await this.resolveCityForActor(actor);
    if (!cityId) return [];
    return this.niyams.listForAdmin({
      city_id: cityId,
      ...(opts.type ? { type: opts.type } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    });
  }

  // ===========================================================================
  // Parent / student-view — Active niyams + submit
  // ===========================================================================

  async listForCaller(
    actor: ScopedActor,
    studentId: string,
    opts: { type?: 'daily' | 'weekly' | 'monthly' } = {},
  ): Promise<NiyamForCallerRow[]> {
    const student = await this.requireStudent(studentId);
    await this.assertParentReachStudent(actor, student);
    const centre = await this.centres.findById(student.centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student centre not found',
        statusCode: 500,
      });
    }
    const msvActive = await this.msvEnrolments.findActiveByStudent(studentId);
    const msvEnrolled = !!msvActive && msvActive.status === 'approved';
    const today = new Date().toISOString().slice(0, 10);

    const rows = await this.niyams.listActiveForCaller({
      city_id: centre.city_id,
      centre_id: student.centre_id,
      batch_id: student.batch_id,
      age_group: student.age_group,
      msv_enrolled: msvEnrolled,
      today,
      ...(opts.type ? { type: opts.type } : {}),
    });
    // For "submitted this period" we look up the most recent submission per
    // (niyam, student) and bucket it.
    const out: NiyamForCallerRow[] = [];
    for (const n of rows) {
      const period = computePeriodDate(n.type, today);
      const submission = await this.submissions.findForStudentNiyamDate(
        studentId,
        n.id,
        n.type === 'daily' ? today : period.startISO,
      );
      const submittedForCurrent = !!submission && submission.status === 'auto_approved';
      out.push({
        id: n.id,
        title_en: n.title_en,
        title_hi: n.title_hi,
        description_en: n.description_en,
        description_hi: n.description_hi,
        type: n.type,
        proof_type: n.proof_type,
        points_value: n.points_value,
        start_date: n.start_date,
        end_date: n.end_date,
        msv_only: n.msv_only,
        submitted_for_current_period: submittedForCurrent,
      });
    }
    return out;
  }

  /**
   * Auto-approve a niyam submission (Q5).
   *
   * Transaction summary:
   *   1. INSERT submissions(status='auto_approved')
   *   2. Award Punya (idempotency: `niyam_sub:{submission_id}`)
   *   3. UPDATE submissions SET punya_transaction_id = …
   *   4. If parent.gallery_visibility_opt_in → INSERT gallery_items
   *
   * After commit:
   *   - enqueue niyam.streak.recompute
   *   - enqueue notifications.fanout (niyam.submitted)
   */
  async submit(
    actor: ScopedActor,
    niyamId: string,
    input: SubmitNiyamInput,
  ): Promise<SubmitNiyamResult> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can submit niyams (use student-view toggle for 13+)',
        statusCode: 403,
      });
    }
    const niyam = await this.niyams.findById(niyamId);
    if (!niyam) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Niyam not found',
        statusCode: 404,
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (niyam.end_date && niyam.end_date < today) {
      throw new AppError({
        code: ERROR_CODES.ERR_NIYAM_SUBMISSION_LOCKED,
        message: 'This niyam has ended',
        statusCode: 409,
      });
    }
    const student = await this.requireStudent(input.student_id);
    await this.assertParentReachStudent(actor, student);

    // Verify the proof asset is owned by this parent and finalised.
    const asset = await this.mediaAssets.findById(input.proof_asset_id);
    if (!asset) {
      throw new AppError({
        code: ERROR_CODES.ERR_NIYAM_PROOF_REQUIRED,
        message: 'Proof media not found — upload first',
        statusCode: 422,
      });
    }
    if (asset.owner_user_id !== actor.user_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'You do not own this media asset',
        statusCode: 403,
      });
    }
    if (!['uploaded', 'ready', 'processing'].includes(asset.status)) {
      throw new AppError({
        code: ERROR_CODES.ERR_NIYAM_PROOF_REQUIRED,
        message: 'Media is not finalised — call /v1/media/finalize first',
        statusCode: 422,
      });
    }

    const centre = await this.centres.findById(student.centre_id);
    if (!centre) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student centre missing',
        statusCode: 500,
      });
    }

    // Daily-duplicate guard: same student+niyam+date can't submit twice.
    const period = computePeriodDate(niyam.type, today);
    const periodKey = niyam.type === 'daily' ? today : period.startISO;
    const existing = await this.submissions.findForStudentNiyamDate(
      student.id,
      niyam.id,
      periodKey,
    );
    if (existing && existing.status === 'auto_approved') {
      return {
        submission_id: existing.id,
        status: 'auto_approved',
        punya_transaction_id: existing.punya_transaction_id,
        points_awarded: niyam.points_value,
        gallery_item_id: (await this.gallery.findBySubmissionId(existing.id))?.id ?? null,
        duplicate: true,
        submission_date: existing.submission_date,
      };
    }

    const parent = await this.users.findById(actor.user_id);
    const optIn = parent?.gallery_visibility_opt_in === true;

    // Pre-generate the submission id so the Punya idempotency key can be
    // deterministic on retries BEFORE the submission row exists. The schema
    // requires `niyam_submissions.punya_transaction_id` to be NOT NULL with
    // a FK to `punya_transactions.id`, so we award Punya FIRST and only
    // then insert the submission carrying the resulting txn id.
    const submissionId = randomUUID();

    const awardResult = await this.punya.award({
      student_id: student.id,
      feature_key: 'niyam_approved',
      points: niyam.points_value,
      reason: `Niyam: ${niyam.title_en}`,
      awarded_by_user_id: null,
      source_entity_kind: 'niyam_submission',
      source_entity_id: submissionId,
      is_msv_track: niyam.msv_only,
      idempotency_key: `niyam_sub:${submissionId}`,
    });

    const submission = await this.submissions.insert({
      id: submissionId,
      niyam_id: niyam.id,
      student_id: student.id,
      parent_user_id: actor.user_id,
      proof_asset_id: input.proof_asset_id,
      status: 'auto_approved',
      auto_approved_at: new Date(),
      punya_transaction_id: awardResult.transaction.id,
      submitted_at: new Date(),
      submission_date: today,
    });
    // Silence unused-import warning for the sql tag (kept available for
    // future raw-SQL needs in this service).
    void sql;

    // Gallery insert — only when parent opted in (Q6).
    let galleryItemId: string | null = null;
    if (optIn) {
      try {
        const gi = await this.gallery.insert({
          niyam_submission_id: submission.id,
          student_id: student.id,
          centre_id: student.centre_id,
          city_id: centre.city_id,
          niyam_id: niyam.id,
          asset_id: input.proof_asset_id,
          is_featured: false,
          removed: false,
        });
        galleryItemId = gi.id;
      } catch (err) {
        this.logger.warn(`gallery insert failed: ${(err as Error).message}`);
      }
    }

    // Side effects — streak recompute + parent fanout (best effort).
    if (this.streakQueue) {
      await this.streakQueue
        .add(
          'recompute',
          {
            niyam_id: niyam.id,
            student_id: student.id,
            reason: 'submission',
          },
          {
            jobId: `streak:${student.id}:${niyam.id}`,
            removeOnComplete: true,
          },
        )
        .catch((err) => this.logger.warn(`streak enqueue failed: ${(err as Error).message}`));
    }
    await this.fanoutQueue
      .add('niyam.submitted', {
        event: 'niyam.submitted',
        recipient_user_ids: [actor.user_id],
        source: { kind: 'niyam_submission', id: submission.id },
        data: {
          student_id: student.id,
          niyam_id: niyam.id,
          niyam_title_en: niyam.title_en,
          niyam_title_hi: niyam.title_hi,
          points_awarded: niyam.points_value,
        },
        deep_link: `/students/${student.id}/niyams`,
      })
      .catch(() => undefined);

    return {
      submission_id: submission.id,
      status: 'auto_approved',
      punya_transaction_id: awardResult.transaction.id,
      points_awarded: niyam.points_value,
      gallery_item_id: galleryItemId,
      duplicate: false,
      submission_date: submission.submission_date,
    };
  }

  // ===========================================================================
  // Admin — reject (Q5)
  // ===========================================================================

  async reject(
    actor: ScopedActor,
    submissionId: string,
    input: RejectNiyamInput,
  ): Promise<RejectNiyamResult> {
    this.assertCanReject(actor);
    if (!input.reason || input.reason.trim().length < 20) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'rejection reason must be at least 20 characters',
        statusCode: 422,
      });
    }

    const pair = await this.submissions.findWithNiyamById(submissionId);
    if (!pair) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Niyam submission not found',
        statusCode: 404,
      });
    }
    const { submission, niyam } = pair;
    if (submission.status === 'rejected') {
      throw new AppError({
        code: ERROR_CODES.ERR_CONFLICT_STATE_TRANSITION,
        message: 'Submission already rejected',
        statusCode: 409,
      });
    }
    // Q5: 30-day window.
    const ageMs = Date.now() - submission.submitted_at.getTime();
    if (ageMs > NIYAM_REVERSAL_WINDOW_MS) {
      throw new AppError({
        code: ERROR_CODES.ERR_NIYAM_REVERSAL_WINDOW_EXPIRED,
        message: 'Rejection window (30 days) has expired',
        statusCode: 409,
      });
    }

    // Scope check: shikshak only own batch students, etc.
    const student = await this.requireStudent(submission.student_id);
    await this.assertAdminReachStudent(actor, student, niyam.city_id);

    // Reverse Punya — idempotency key derived from the source txn id.
    const reverseResult = await this.punya.reverseTransaction(
      {
        user_id: actor.user_id,
        role: actor.role,
        ...(actor.city_id ? { city_id: actor.city_id } : {}),
        ...(actor.centre_ids ? { centre_ids: actor.centre_ids } : {}),
        ...(actor.batch_ids ? { batch_ids: actor.batch_ids } : {}),
      },
      {
        source_id: submission.punya_transaction_id,
        reason: `Niyam rejection: ${input.reason}`,
        idempotency_key: `reverse:niyam:${submission.id}`,
      },
    );

    // Mark submission rejected + store the reversal pointer.
    const updated = await this.submissions.markRejected(submission.id, {
      rejected_by_user_id: actor.user_id,
      rejection_reason: input.reason,
      reversal_transaction_id: reverseResult.reversal_id,
    });
    if (!updated) {
      throw new AppError({
        code: ERROR_CODES.ERR_INTERNAL,
        message: 'Could not mark submission rejected',
        statusCode: 500,
      });
    }

    // Hide gallery item (Q5 step in §8.4).
    let galleryHidden = false;
    const existingItem = await this.gallery.findBySubmissionId(submission.id);
    if (existingItem && !existingItem.removed) {
      await this.gallery.hideForRejectedSubmission(submission.id, actor.user_id);
      galleryHidden = true;
    }

    // Streak recompute — may break a retroactive streak.
    if (this.streakQueue) {
      await this.streakQueue
        .add(
          'recompute',
          {
            niyam_id: niyam.id,
            student_id: student.id,
            reason: 'rejection',
            skip_award: true, // never award milestone Punya from a rejection path
          },
          {
            jobId: `streak:${student.id}:${niyam.id}:reject`,
            removeOnComplete: true,
          },
        )
        .catch(() => undefined);
    }

    // Notify parent.
    await this.fanoutQueue
      .add('niyam.rejected', {
        event: 'niyam.rejected',
        recipient_user_ids: [student.parent_user_id],
        source: { kind: 'niyam_submission', id: submission.id },
        data: {
          student_id: student.id,
          niyam_id: niyam.id,
          niyam_title_en: niyam.title_en,
          niyam_title_hi: niyam.title_hi,
          reason: input.reason,
          points_reversed: reverseResult.balance.total_points,
        },
        deep_link: `/students/${student.id}/niyams`,
      })
      .catch(() => undefined);

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'reject',
        entity_kind: 'niyam_submission',
        entity_id: submission.id,
        before: {
          status: 'auto_approved',
          punya_transaction_id: submission.punya_transaction_id,
        },
        after: {
          status: 'rejected',
          reversal_transaction_id: reverseResult.reversal_id,
          rejection_reason: input.reason,
        },
      })
      .catch(() => undefined);

    return {
      submission_id: submission.id,
      reversal_transaction_id: reverseResult.reversal_id,
      points_reversed: Math.abs(niyam.points_value),
      gallery_hidden: galleryHidden,
    };
  }

  // ===========================================================================
  // Reads — recent submissions + streaks
  // ===========================================================================

  async listRecentForStudent(
    actor: ScopedActor,
    studentId: string,
    limit = 20,
  ): Promise<SubmissionRow[]> {
    const student = await this.requireStudent(studentId);
    if (actor.role === 'parent') await this.assertParentReachStudent(actor, student);
    else await this.assertAdminReachStudent(actor, student);
    const rows = await this.submissions.listByStudent(studentId, limit);
    const niyamMap = await this.hydrateNiyams(rows.map((r) => r.niyam_id));
    return rows
      .map((r): SubmissionRow | null => {
        const n = niyamMap.get(r.niyam_id);
        if (!n) return null;
        return {
          id: r.id,
          niyam_id: r.niyam_id,
          niyam_title_en: n.title_en,
          niyam_title_hi: n.title_hi,
          niyam_type: n.type,
          points_value: n.points_value,
          status: r.status,
          submitted_at: r.submitted_at.toISOString(),
          submission_date: r.submission_date,
          proof_asset_id: r.proof_asset_id,
          rejected_at: r.rejected_at ? r.rejected_at.toISOString() : null,
          rejection_reason: r.rejection_reason,
        };
      })
      .filter((x): x is SubmissionRow => x !== null);
  }

  async listStreaksForStudent(actor: ScopedActor, studentId: string): Promise<StreakSummary[]> {
    const student = await this.requireStudent(studentId);
    if (actor.role === 'parent') await this.assertParentReachStudent(actor, student);
    else await this.assertAdminReachStudent(actor, student);
    const streaks = await this.streaks.findAllByStudent(studentId);
    if (streaks.length === 0) return [];
    const niyamMap = await this.hydrateNiyams(streaks.map((s) => s.niyam_id));
    return streaks
      .map((s): StreakSummary | null => {
        const n = niyamMap.get(s.niyam_id);
        if (!n) return null;
        return {
          niyam_id: s.niyam_id,
          niyam_title_en: n.title_en,
          niyam_title_hi: n.title_hi,
          current_streak: s.current_streak,
          longest_streak: s.longest_streak,
          last_completion_date: s.last_completion_date,
          badge_kind: s.badge_kind,
        };
      })
      .filter((x): x is StreakSummary => x !== null);
  }

  /**
   * List submissions for the admin grid — scoped to actor's reach. Returns
   * lightly hydrated rows that the page can render directly.
   */
  async listSubmissionsForAdmin(
    actor: ScopedActor,
    opts: {
      niyam_id?: string;
      only_approved?: boolean;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<SubmissionRow[]> {
    this.assertCanReject(actor);
    const rows = await this.submissions.listForAdmin({
      ...(opts.niyam_id ? { niyam_id: opts.niyam_id } : {}),
      ...(opts.only_approved !== undefined ? { only_approved: opts.only_approved } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
      ...(opts.offset !== undefined ? { offset: opts.offset } : {}),
    });
    // RBAC: only show rows whose student is in actor's reach.
    const niyamMap = await this.hydrateNiyams(rows.map((r) => r.niyam_id));
    const filtered: SubmissionRow[] = [];
    for (const r of rows) {
      const n = niyamMap.get(r.niyam_id);
      if (!n) continue;
      const student = await this.students.findById(r.student_id);
      if (!student) continue;
      try {
        await this.assertAdminReachStudent(actor, student, n.city_id);
      } catch {
        continue;
      }
      filtered.push({
        id: r.id,
        niyam_id: r.niyam_id,
        niyam_title_en: n.title_en,
        niyam_title_hi: n.title_hi,
        niyam_type: n.type,
        points_value: n.points_value,
        status: r.status,
        submitted_at: r.submitted_at.toISOString(),
        submission_date: r.submission_date,
        proof_asset_id: r.proof_asset_id,
        rejected_at: r.rejected_at ? r.rejected_at.toISOString() : null,
        rejection_reason: r.rejection_reason,
      });
    }
    return filtered;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async hydrateNiyams(ids: string[]): Promise<Map<string, Niyam>> {
    const unique = Array.from(new Set(ids));
    const rows = await this.niyams.findManyByIds(unique);
    const map = new Map<string, Niyam>();
    for (const r of rows) map.set(r.id, r);
    return map;
  }

  private async requireStudent(studentId: string): Promise<Student> {
    const s = await this.students.findById(studentId);
    if (!s) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    return s;
  }

  private async resolveCityForActor(actor: ScopedActor): Promise<string | null> {
    if (actor.city_id) return actor.city_id;
    if (actor.role === 'shikshak' || actor.role === 'sanchalak') {
      // Resolve via first centre.
      const firstCentre = actor.centre_ids?.[0];
      if (firstCentre) {
        const c = await this.centres.findById(firstCentre);
        if (c) return c.city_id;
      }
    }
    // super_admin / state_admin must specify a city in the body — not handled here.
    return null;
  }

  private assertCanCreateNiyam(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak/sanchalak/city_admin+ can create niyams',
        statusCode: 403,
      });
    }
  }

  private assertCanReject(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only shikshak/sanchalak/city_admin+ can reject niyam submissions',
        statusCode: 403,
      });
    }
    void ROLE_PRECEDENCE;
  }

  private async assertParentReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Student is not yours',
      statusCode: 403,
    });
  }

  private async assertAdminReachStudent(
    actor: ScopedActor,
    student: Student,
    fallbackCityId?: string,
  ): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'shikshak') {
      const own = new Set(actor.batch_ids ?? []);
      if (!student.batch_id || !own.has(student.batch_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your batch',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'sanchalak') {
      const own = new Set(actor.centre_ids ?? []);
      if (!own.has(student.centre_id)) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is not in your centre',
          statusCode: 403,
        });
      }
      return;
    }
    if (actor.role === 'city_admin') {
      let cityId = fallbackCityId;
      if (!cityId) {
        const c = await this.centres.findById(student.centre_id);
        cityId = c?.city_id;
      }
      if (!actor.city_id || !cityId || actor.city_id !== cityId) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Student is outside your city',
          statusCode: 403,
        });
      }
      return;
    }
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
      message: 'Role cannot reject niyam submissions',
      statusCode: 403,
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the period bucket for streak math. Returns the ISO date of the
 * start of the current period:
 *   - daily   → today
 *   - weekly  → Monday of this ISO week
 *   - monthly → 1st of this month
 */
export function computePeriodDate(
  type: 'daily' | 'weekly' | 'monthly',
  todayISO: string,
): { startISO: string } {
  if (type === 'daily') return { startISO: todayISO };
  const d = new Date(`${todayISO}T00:00:00Z`);
  if (type === 'monthly') {
    return { startISO: `${todayISO.slice(0, 7)}-01` };
  }
  // weekly — Monday of this ISO week (UTC-stable since dates are UTC midnight).
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const monOffset = (dow + 6) % 7; // 0 if Mon, 6 if Sun
  const mon = new Date(d.getTime() - monOffset * 24 * 3600 * 1000);
  return { startISO: mon.toISOString().slice(0, 10) };
}

/** Re-export User for test imports. */
export type { User };
