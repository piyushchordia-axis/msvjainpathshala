/**
 * CompetitionsService — Step 18 (SPEC §5.12, §6.15).
 *
 * Lifecycle:
 *   draft → open → closed → results_published
 *
 *   - create() — city_admin+ only.
 *   - register() — parent / student-view. Validates window, eligibility,
 *     max_participants (when set), and unique (competition_id, student_id).
 *   - recordResults() — admin enters rank per student. Does NOT publish; the
 *     rank lives on the registration row until publishResults flips status.
 *   - publishResults() — separate step: awards Punya per position (1 = winner_points,
 *     other ranks → participant_points), fires `competition.result` push to each
 *     affected parent, and flips status='results_published'.
 *
 * Punya idempotency: `competition:{competition_id}:{student_id}`. Re-publishing
 * the same set of results is a safe no-op.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import {
  CentresRepository,
  CompetitionRegistrationsRepository,
  CompetitionsRepository,
  MsvEnrolmentsRepository,
  StudentsRepository,
} from '../../db/repositories';
import { QUEUES } from '../../queues/queues.constants';
import { AuditService } from '../audit/audit.service';
import { PunyaService } from '../punya/punya.service';

import {
  type CompetitionRegistrationWithStudent,
  type CreateCompetitionInput,
  type PublishResultsResult,
  type RecordResultsInput,
  type RecordResultsResult,
  type RegisterCompetitionInput,
} from './competitions.types';

import type { Competition, CompetitionRegistration, Student } from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

@Injectable()
export class CompetitionsService {
  private readonly logger = new Logger(CompetitionsService.name);

  constructor(
    private readonly competitions: CompetitionsRepository,
    private readonly registrations: CompetitionRegistrationsRepository,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly msvEnrolments: MsvEnrolmentsRepository,
    private readonly punya: PunyaService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {}

  // ===========================================================================
  // Admin — create
  // ===========================================================================

  async create(actor: ScopedActor, input: CreateCompetitionInput): Promise<Competition> {
    this.assertCanCreate(actor);
    if (!actor.city_id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'city_admin scope required',
        statusCode: 403,
      });
    }
    if (!input.name_en?.trim() || !input.name_hi?.trim()) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_BILINGUAL_REQUIRED,
        message: 'Both name_en and name_hi are required',
        statusCode: 422,
      });
    }
    const row = await this.competitions.insert({
      city_id: actor.city_id,
      name_en: input.name_en.trim(),
      name_hi: input.name_hi.trim(),
      description_en: input.description_en ?? null,
      description_hi: input.description_hi ?? null,
      category: input.category ?? null,
      eligible_age_groups: input.eligible_age_groups ?? null,
      msv_only: input.msv_only ?? false,
      registration_window_start: input.registration_window_start
        ? new Date(input.registration_window_start)
        : null,
      registration_window_end: input.registration_window_end
        ? new Date(input.registration_window_end)
        : null,
      event_date: input.event_date ?? null,
      winner_points: input.winner_points ?? 50,
      participant_points: input.participant_points ?? 10,
      max_participants: input.max_participants ?? null,
      status: input.status ?? 'draft',
      created_by: actor.user_id,
      updated_by: actor.user_id,
    });
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'competition',
        entity_id: row.id,
        after: {
          name_en: row.name_en,
          status: row.status,
          winner_points: row.winner_points,
          participant_points: row.participant_points,
        },
      })
      .catch(() => undefined);
    return row;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

  async register(
    actor: ScopedActor,
    competitionId: string,
    input: RegisterCompetitionInput,
  ): Promise<CompetitionRegistration> {
    if (actor.role !== 'parent') {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only parents can register a student (use student-view for 13+)',
        statusCode: 403,
      });
    }
    const competition = await this.competitions.findById(competitionId);
    if (!competition) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_NOT_FOUND,
        message: 'Competition not found',
        statusCode: 404,
      });
    }
    if (competition.status === 'draft') {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_REGISTRATION_CLOSED,
        message: 'Competition is not open yet',
        statusCode: 409,
      });
    }
    if (competition.status === 'closed' || competition.status === 'results_published') {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_REGISTRATION_CLOSED,
        message: 'Registration is closed',
        statusCode: 409,
      });
    }
    if (!this.competitions.isWindowOpen(competition, new Date())) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_REGISTRATION_CLOSED,
        message: 'Registration window has closed',
        statusCode: 409,
      });
    }

    const student = await this.requireStudent(input.student_id);
    await this.assertParentReachStudent(actor, student);

    // Eligibility: age group + msv_only.
    if (
      competition.eligible_age_groups &&
      competition.eligible_age_groups.length > 0 &&
      !competition.eligible_age_groups.includes(student.age_group)
    ) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_NOT_ELIGIBLE,
        message: `Age group ${student.age_group} not eligible`,
        statusCode: 409,
      });
    }
    if (competition.msv_only) {
      const msv = await this.msvEnrolments.findActiveByStudent(student.id);
      if (!msv || msv.status !== 'approved') {
        throw new AppError({
          code: ERROR_CODES.ERR_COMPETITION_NOT_ELIGIBLE,
          message: 'MSV-only competition — student is not an approved MSV member',
          statusCode: 409,
        });
      }
    }

    // Pre-flight: already registered?
    const existing = await this.registrations.findForStudent(competition.id, student.id);
    if (existing) return existing;

    // Capacity check (when set).
    if (competition.max_participants != null) {
      const count = await this.registrations.countByCompetition(competition.id);
      if (count >= competition.max_participants) {
        throw new AppError({
          code: ERROR_CODES.ERR_COMPETITION_FULL,
          message: 'Competition has reached its capacity',
          statusCode: 409,
        });
      }
    }

    const row = await this.registrations.insert({
      competition_id: competition.id,
      student_id: student.id,
      registered_at: new Date(),
    });

    await this.fanoutQueue
      .add('competition.registered', {
        event: 'competition.registered',
        recipient_user_ids: [student.parent_user_id],
        source: { kind: 'competition_registration', id: row.id },
        data: {
          full_name: student.full_name,
          competition_name: competition.name_en,
          competition_name_hi: competition.name_hi,
        },
        deep_link: `/competitions/${competition.id}`,
      })
      .catch(() => undefined);

    return row;
  }

  // ===========================================================================
  // Admin — record results (no Punya yet)
  // ===========================================================================

  async recordResults(
    actor: ScopedActor,
    competitionId: string,
    input: RecordResultsInput,
  ): Promise<RecordResultsResult> {
    this.assertCanCreate(actor);
    const competition = await this.competitions.findById(competitionId);
    if (!competition) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_NOT_FOUND,
        message: 'Competition not found',
        statusCode: 404,
      });
    }
    if (competition.status === 'results_published') {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_RESULTS_ALREADY_PUBLISHED,
        message: 'Cannot edit results after publish',
        statusCode: 409,
      });
    }
    let recorded = 0;
    for (const entry of input.results) {
      const reg = await this.registrations.findForStudent(competition.id, entry.student_id);
      if (!reg) {
        throw new AppError({
          code: ERROR_CODES.ERR_VALIDATION_FAILED,
          message: `Student ${entry.student_id} is not registered`,
          statusCode: 422,
        });
      }
      await this.registrations.setResult(reg.id, {
        rank: entry.rank,
        note: entry.note ?? null,
        // Punya not awarded yet — publish step does that.
        punya_transaction_id: reg.punya_transaction_id,
      });
      recorded += 1;
    }
    // Flip status='closed' so registrations stop.
    if (competition.status !== 'closed') {
      const updated = await this.competitions.update(competition.id, { status: 'closed' });
      await this.audit
        .emit({
          actor_user_id: actor.user_id,
          actor_role: actor.role,
          action: 'update',
          entity_kind: 'competition',
          entity_id: competition.id,
          before: { status: competition.status },
          after: { status: 'closed', results_entered: recorded },
        })
        .catch(() => undefined);
      return { recorded, competition: updated ?? competition };
    }
    return { recorded, competition };
  }

  // ===========================================================================
  // Admin — publish results (the Punya step)
  // ===========================================================================

  async publishResults(actor: ScopedActor, competitionId: string): Promise<PublishResultsResult> {
    this.assertCanCreate(actor);
    const competition = await this.competitions.findById(competitionId);
    if (!competition) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_NOT_FOUND,
        message: 'Competition not found',
        statusCode: 404,
      });
    }
    if (competition.status === 'results_published') {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_RESULTS_ALREADY_PUBLISHED,
        message: 'Results have already been published',
        statusCode: 409,
      });
    }
    const regs = await this.registrations.listByCompetition(competition.id);
    const withRanks = regs.filter((r) => r.result_rank != null);
    if (withRanks.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_COMPETITION_RESULTS_NOT_ENTERED,
        message: 'No ranked results to publish — call /results first',
        statusCode: 422,
      });
    }
    let awards = 0;
    let winnersNotified = 0;
    for (const reg of withRanks) {
      const points =
        reg.result_rank === 1 || reg.result_rank === 2 || reg.result_rank === 3
          ? competition.winner_points
          : competition.participant_points;
      if (points <= 0) {
        continue;
      }
      const student = await this.students.findById(reg.student_id);
      if (!student) continue;
      const award = await this.punya.award({
        student_id: student.id,
        feature_key: reg.result_rank === 1 ? 'competition_winner' : 'competition_participant',
        points,
        reason: `Competition: ${competition.name_en} — position ${reg.result_rank}`,
        awarded_by_user_id: actor.user_id,
        source_entity_kind: 'competition',
        source_entity_id: competition.id,
        is_msv_track: competition.msv_only,
        idempotency_key: `competition:${competition.id}:${student.id}`,
      });
      await this.registrations.setResult(reg.id, {
        rank: reg.result_rank,
        note: reg.result_note,
        punya_transaction_id: award.transaction.id,
      });
      awards += 1;
      await this.fanoutQueue
        .add('competition.result', {
          event: 'competition.result',
          recipient_user_ids: [student.parent_user_id],
          source: { kind: 'competition', id: competition.id },
          data: {
            full_name: student.full_name,
            competition_name: competition.name_en,
            competition_name_hi: competition.name_hi,
            position: this.ordinalLabel(reg.result_rank),
            points,
          },
          deep_link: `/competitions/${competition.id}`,
        })
        .catch(() => undefined);
      winnersNotified += 1;
    }

    const now = new Date();
    const updated = await this.competitions.update(competition.id, {
      status: 'results_published',
      results_published_at: now,
      updated_by: actor.user_id,
    });

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'approve',
        entity_kind: 'competition',
        entity_id: competition.id,
        before: { status: competition.status },
        after: { status: 'results_published', awards },
      })
      .catch(() => undefined);

    return {
      competition: updated ?? competition,
      punya_awards: awards,
      winners_notified: winnersNotified,
    };
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  async listForCaller(actor: ScopedActor, studentId?: string): Promise<Competition[]> {
    let cityId: string | null = null;
    let ageGroup: 'bal' | 'kishor' | 'tarun' | 'yuva' | null = null;
    let msvEnrolled = false;
    if (actor.role === 'parent') {
      const kids = studentId
        ? [await this.students.findById(studentId)].filter((s): s is Student => s != null)
        : await this.students.findByParent(actor.user_id);
      const active = kids.find((s) => s.status === 'active');
      if (!active) return [];
      if (studentId) await this.assertParentReachStudent(actor, active);
      const c = await this.centres.findById(active.centre_id);
      cityId = c?.city_id ?? null;
      ageGroup = active.age_group;
      const msv = await this.msvEnrolments.findActiveByStudent(active.id);
      msvEnrolled = !!msv && msv.status === 'approved';
    } else {
      cityId = actor.city_id ?? null;
      // Admins see all age groups; we use the first allowed group for the
      // eligibility predicate. To list every competition without an age
      // filter we hit the admin path.
      ageGroup = 'bal';
    }
    if (!cityId) return [];
    return this.competitions.listForCaller({
      city_id: cityId,
      age_group: ageGroup ?? 'bal',
      msv_enrolled: msvEnrolled,
      now: new Date(),
    });
  }

  async listForAdmin(
    actor: ScopedActor,
    opts: { status?: 'draft' | 'open' | 'closed' | 'results_published' } = {},
  ): Promise<Competition[]> {
    this.assertCanCreate(actor);
    if (!actor.city_id) return [];
    return this.competitions.listForAdmin({
      city_id: actor.city_id,
      ...(opts.status ? { status: opts.status } : {}),
    });
  }

  async listRegistrations(
    actor: ScopedActor,
    competitionId: string,
  ): Promise<CompetitionRegistrationWithStudent[]> {
    this.assertCanCreate(actor);
    const regs = await this.registrations.listByCompetition(competitionId);
    if (regs.length === 0) return [];
    const out: CompetitionRegistrationWithStudent[] = [];
    for (const r of regs) {
      const s = await this.students.findById(r.student_id);
      if (!s) continue;
      out.push({
        registration: r,
        student_full_name: s.full_name,
        student_code: s.student_code,
        age_group: s.age_group,
      });
    }
    return out;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

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

  private async assertParentReachStudent(actor: ScopedActor, student: Student): Promise<void> {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'parent' && student.parent_user_id === actor.user_id) return;
    throw new AppError({
      code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
      message: 'Student is not yours',
      statusCode: 403,
    });
  }

  private assertCanCreate(actor: ScopedActor): void {
    const allowed: Role[] = ['super_admin', 'state_admin', 'city_admin'];
    if (!allowed.includes(actor.role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only city_admin+ can manage competitions',
        statusCode: 403,
      });
    }
  }

  private ordinalLabel(rank: number | null): string {
    if (rank === 1) return '1st';
    if (rank === 2) return '2nd';
    if (rank === 3) return '3rd';
    if (rank == null) return '—';
    return `${rank}th`;
  }
}
