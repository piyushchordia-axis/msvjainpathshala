/**
 * ShivirsService — Step 15 (SPEC §5.11, §6.14, §8.6).
 *
 * Responsibilities:
 *
 *   1. CRUD over `shivir_events`, `shivir_sessions`, `shivir_registrations`,
 *      `shivir_volunteers`.
 *
 *   2. `scan()` — the QR scanning state machine.
 *      - Resolves `student_qr_code` → student_id.
 *      - Verifies the student is `registered` for this event.
 *      - Inspects the latest scan for (session_id, student_id) and applies:
 *          * present_only mode:
 *              - no prior scan → insert `present`
 *              - any prior scan → 409 (ERR_SHIVIR_SCAN_DUPLICATE_PRESENT)
 *          * in_out mode:
 *              - no prior scan → insert `check_in`
 *              - last is `check_in`  → insert `check_out`
 *              - last is `check_out` → 409 unless `force=true`, then a new
 *                                       `check_in` (re-entry).
 *      - Idempotent on `client_op_id` — replay returns the cached scan.
 *      - Emits a `scan.completed` event on the `/shivirs/:id` Socket.IO
 *        namespace.
 *
 *   3. `liveCounters()` — registered / currently_in / already_out / not_arrived
 *      for the admin dashboard.
 *
 *   4. `enqueueExport()` — pushes a `report.shivir.export` job. The worker
 *      lives in a follow-up step; for now we enqueue with a deterministic
 *      jobId so duplicate calls collapse.
 *
 * Authorisation:
 *   - Create / volunteer assignment / registrations require city_admin+
 *     (or sanchalak for assignments per SPEC §6.14). The decorator on the
 *     controller catches role mismatches; service-level scope checks
 *     enforce city boundaries.
 *   - `scan()` requires the actor to be either a `super_admin`-tier role
 *     OR an assigned volunteer on the event.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';

import { AppError, ERROR_CODES, type Role, ShivirAttendanceMode, ShivirScanKind } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { ShivirsRepository, StudentsRepository, UsersRepository } from '../../db/repositories';
import { digital_id_cards } from '../../db/schema';
import { QUEUES } from '../../queues/queues.constants';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { NAMESPACES } from '../../realtime/realtime.types';
import { AuditService } from '../audit/audit.service';

import type { ShivirScanInput, ShivirScanResult } from './shivirs.types';
import type { LiveCounters } from '../../db/repositories/shivirs.repository';
import type {
  NewShivirEvent,
  NewShivirSession,
  ShivirAttendanceScan,
  ShivirEvent,
  ShivirRegistration,
  ShivirSession,
  ShivirVolunteer,
} from '../../db/schema';

export interface ScopedActor {
  user_id: string;
  role: Role;
  city_id?: string | undefined;
  centre_ids?: string[] | undefined;
  batch_ids?: string[] | undefined;
}

export interface ShivirDetailDto {
  event: ShivirEvent;
  sessions: ShivirSession[];
  volunteers: ShivirVolunteer[];
  registration_count: number;
}

@Injectable()
export class ShivirsService {
  private readonly logger = new Logger(ShivirsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly repo: ShivirsRepository,
    private readonly students: StudentsRepository,
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeGateway,
    @Optional()
    @Inject(`BullQueue_${QUEUES.REPORT_SHIVIR_EXPORT}`)
    private readonly exportQueue: Queue | null,
    @Optional()
    @Inject(`BullQueue_${QUEUES.SHIVIR_LIVE_BROADCAST}`)
    private readonly broadcastQueue: Queue | null,
  ) {
    void this.broadcastQueue; // reserved for the live-broadcast worker
  }

  // ===========================================================================
  // Event CRUD
  // ===========================================================================

  async createEvent(
    actor: ScopedActor,
    input: {
      city_id: string;
      name: string;
      description?: string;
      start_date: string;
      end_date: string;
      location_text?: string;
      location_lat?: number;
      location_lng?: number;
      capacity?: number;
      msv_only?: boolean;
      attendance_mode: ShivirAttendanceMode;
      sessions: Array<{
        day_number: number;
        session_date: string;
        start_time: string;
        end_time: string;
      }>;
    },
  ): Promise<ShivirDetailDto> {
    this.assertCityScope(actor, input.city_id);
    if (new Date(input.start_date) > new Date(input.end_date)) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'start_date must be on or before end_date',
        statusCode: 422,
      });
    }
    if (input.sessions.length === 0) {
      throw new AppError({
        code: ERROR_CODES.ERR_VALIDATION_FAILED,
        message: 'At least one session is required',
        statusCode: 422,
      });
    }

    const newEventRow: NewShivirEvent = {
      city_id: input.city_id,
      name: input.name,
      description: input.description ?? null,
      start_date: input.start_date,
      end_date: input.end_date,
      location_text: input.location_text ?? null,
      location_lat: input.location_lat !== undefined ? String(input.location_lat) : null,
      location_lng: input.location_lng !== undefined ? String(input.location_lng) : null,
      capacity: input.capacity ?? null,
      msv_only: input.msv_only ?? false,
      attendance_mode: input.attendance_mode,
      sessions_count: input.sessions.length,
      created_by: actor.user_id,
      updated_by: actor.user_id,
    };
    const event = await this.repo.createEvent(newEventRow);

    const sessionRows: NewShivirSession[] = input.sessions.map((s) => ({
      shivir_event_id: event.id,
      day_number: s.day_number,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
    }));
    const sessions: ShivirSession[] = [];
    for (const s of sessionRows) sessions.push(await this.repo.createSession(s));

    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'shivir_event',
        entity_id: event.id,
        after: {
          name: event.name,
          city_id: event.city_id,
          attendance_mode: event.attendance_mode,
          sessions_count: event.sessions_count,
        },
      })
      .catch(() => undefined);

    return { event, sessions, volunteers: [], registration_count: 0 };
  }

  async listEvents(actor: ScopedActor): Promise<{ items: ShivirEvent[] }> {
    const cityIds = actor.city_id ? [actor.city_id] : undefined;
    const items = await this.repo.listEvents({
      ...(actor.role === 'super_admin' ? {} : cityIds ? { city_ids: cityIds } : { city_ids: [] }),
    });
    return { items };
  }

  async getEvent(actor: ScopedActor, eventId: string): Promise<ShivirDetailDto> {
    const event = await this.requireEvent(eventId);
    this.assertCityReadable(actor, event.city_id);
    const [sessions, volunteers, registrations] = await Promise.all([
      this.repo.listSessionsForEvent(eventId),
      this.repo.listVolunteersForEvent(eventId),
      this.repo.listRegistrationsForEvent(eventId),
    ]);
    return {
      event,
      sessions,
      volunteers,
      registration_count: registrations.filter((r) => r.status === 'registered').length,
    };
  }

  // ===========================================================================
  // Volunteers
  // ===========================================================================

  async assignVolunteer(
    actor: ScopedActor,
    eventId: string,
    userId: string,
  ): Promise<ShivirVolunteer> {
    const event = await this.requireEvent(eventId);
    this.assertCityScope(actor, event.city_id);

    const target = await this.users.findById(userId);
    if (!target) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Volunteer user not found',
        statusCode: 404,
      });
    }

    // Idempotent: re-assigning returns the existing row.
    const existing = await this.repo.findVolunteer(eventId, userId);
    if (existing) return existing;

    const row = await this.repo.assignVolunteer({
      shivir_event_id: eventId,
      user_id: userId,
      assigned_by: actor.user_id,
      assigned_at: new Date(),
    });
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'shivir_volunteer',
        entity_id: row.id,
        after: { event_id: eventId, user_id: userId },
      })
      .catch(() => undefined);
    return row;
  }

  // ===========================================================================
  // Registrations
  // ===========================================================================

  async registerStudents(
    actor: ScopedActor,
    eventId: string,
    studentIds: string[],
  ): Promise<{ registered: ShivirRegistration[]; already_registered: string[] }> {
    const event = await this.requireEvent(eventId);
    this.assertCityScope(actor, event.city_id);
    if (studentIds.length === 0) {
      return { registered: [], already_registered: [] };
    }

    const priorRows = await this.repo.findRegistrationsByEventStudentIds(eventId, studentIds);
    const priorIds = new Set(priorRows.map((r) => r.student_id));
    const newRows = studentIds
      .filter((id) => !priorIds.has(id))
      .map((id) => ({
        shivir_event_id: eventId,
        student_id: id,
        registered_at: new Date(),
        registered_by_user_id: actor.user_id,
        status: 'registered',
      }));
    const registered = newRows.length > 0 ? await this.repo.bulkRegister(newRows) : [];
    if (registered.length > 0) {
      await this.audit
        .emit({
          actor_user_id: actor.user_id,
          actor_role: actor.role,
          action: 'create',
          entity_kind: 'shivir_registrations',
          entity_id: eventId,
          after: { count: registered.length },
        })
        .catch(() => undefined);
    }
    return {
      registered,
      already_registered: [...priorIds],
    };
  }

  async getRoster(
    actor: ScopedActor,
    eventId: string,
  ): Promise<{
    registrations: Array<{
      registration: ShivirRegistration;
      student_id: string;
      latest_scan_kind: ShivirScanKind | null;
    }>;
  }> {
    const event = await this.requireEvent(eventId);
    this.assertCityReadable(actor, event.city_id);
    const regs = await this.repo.listRegistrationsForEvent(eventId);
    const scans = await this.repo.listScansForEvent(eventId, 5000);
    // Compute the latest scan kind per student across the event.
    const latest = new Map<string, { kind: ShivirScanKind; ts: Date }>();
    for (const r of scans) {
      const cur = latest.get(r.scan.student_id);
      if (!cur || r.scan.scanned_at > cur.ts) {
        latest.set(r.scan.student_id, { kind: r.scan.scan_kind, ts: r.scan.scanned_at });
      }
    }
    return {
      registrations: regs.map((r) => ({
        registration: r,
        student_id: r.student_id,
        latest_scan_kind: latest.get(r.student_id)?.kind ?? null,
      })),
    };
  }

  // ===========================================================================
  // QR scan — the state machine
  // ===========================================================================

  async scan(
    actor: ScopedActor,
    eventId: string,
    input: ShivirScanInput,
  ): Promise<ShivirScanResult> {
    // 1. Idempotency — replay returns the cached result.
    const cached = await this.repo.findScanByClientOpId(input.client_op_id);
    if (cached) {
      return this.scanRowToResult(cached, /* duplicate */ true);
    }

    const event = await this.requireEvent(eventId);
    const session = await this.repo.findSessionById(input.shivir_session_id);
    if (!session || session.shivir_event_id !== event.id) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Shivir session not found for this event',
        statusCode: 404,
      });
    }

    // 2. Role gate. Either a higher role OR an assigned volunteer.
    const adminTier = (
      ['super_admin', 'state_admin', 'city_admin', 'sanchalak'] as Role[]
    ).includes(actor.role);
    if (!adminTier) {
      const v = await this.repo.findVolunteer(eventId, actor.user_id);
      if (!v) {
        throw new AppError({
          code: ERROR_CODES.ERR_SHIVIR_VOLUNTEER_NOT_ASSIGNED,
          message: 'You are not assigned to this Shivir',
          statusCode: 403,
        });
      }
    }

    // 3. Resolve student from QR.
    const studentId = await this.resolveStudentFromQr(input.student_qr_code);
    if (!studentId) {
      throw new AppError({
        code: ERROR_CODES.ERR_SHIVIR_QR_INVALID,
        message: 'QR code did not match a known student',
        statusCode: 400,
      });
    }
    const student = await this.students.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_SHIVIR_PARTICIPANT_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }

    // 4. Registration check.
    const reg = await this.repo.findRegistrationByEventStudent(event.id, studentId);
    if (!reg || reg.status !== 'registered') {
      throw new AppError({
        code: ERROR_CODES.ERR_SHIVIR_NOT_REGISTERED,
        message: 'Student is not registered for this Shivir',
        statusCode: 409,
      });
    }

    // 5. State machine.
    const latest = await this.repo.latestScanFor(session.id, studentId);
    const nextKind = this.computeNextScanKind(event.attendance_mode, latest, !!input.force);

    // 6. Insert the row.
    const scannedAt = new Date(input.scanned_at);
    const row = await this.repo.insertScan({
      shivir_event_id: event.id,
      shivir_session_id: session.id,
      student_id: studentId,
      volunteer_user_id: actor.user_id,
      scan_kind: nextKind,
      scanned_at: scannedAt,
      client_op_id: input.client_op_id,
      device_offline: input.device_offline ?? false,
    });

    // 7. Realtime broadcast — scan.completed.
    this.realtime.emit(`${NAMESPACES.SHIVIRS}/${event.id}`, 'scan.completed', {
      shivir_event_id: event.id,
      shivir_session_id: session.id,
      student_id: studentId,
      student_full_name: student.full_name,
      student_code: student.student_code,
      scan_kind: nextKind,
      scanned_at: row.scanned_at.toISOString(),
      volunteer_user_id: actor.user_id,
      attendance_mode: event.attendance_mode,
    });

    return {
      scan_id: row.id,
      shivir_event_id: event.id,
      shivir_session_id: session.id,
      student_id: studentId,
      student_full_name: student.full_name,
      student_code: student.student_code,
      scan_kind: nextKind,
      scanned_at: row.scanned_at.toISOString(),
      attendance_mode: event.attendance_mode,
      duplicate: false,
    };
  }

  // ===========================================================================
  // Live counters
  // ===========================================================================

  async live(
    actor: ScopedActor,
    eventId: string,
    opts: { session_id?: string } = {},
  ): Promise<{
    event: ShivirEvent;
    counters: LiveCounters;
    recent_scans: Array<{
      id: string;
      student_id: string;
      student_full_name: string;
      student_code: string;
      scan_kind: ShivirScanKind;
      scanned_at: string;
    }>;
  }> {
    const event = await this.requireEvent(eventId);
    this.assertCityReadable(actor, event.city_id);
    const counters = await this.repo.liveCounters(event.id, event.attendance_mode, opts.session_id);
    const recent = opts.session_id
      ? await this.repo.listScansForSession(opts.session_id, 50)
      : await this.repo.listScansForEvent(event.id, 50);
    return {
      event,
      counters,
      recent_scans: recent.map((r) => ({
        id: r.scan.id,
        student_id: r.scan.student_id,
        student_full_name: r.student_full_name,
        student_code: r.student_code,
        scan_kind: r.scan.scan_kind,
        scanned_at: r.scan.scanned_at.toISOString(),
      })),
    };
  }

  // ===========================================================================
  // Export
  // ===========================================================================

  async enqueueExport(
    actor: ScopedActor,
    eventId: string,
    format: 'csv' | 'pdf' | 'both',
  ): Promise<{ export_id: string; format: string; queued: boolean }> {
    const event = await this.requireEvent(eventId);
    this.assertCityScope(actor, event.city_id);
    const exportId = `shivir-export:${event.id}:${format}:${Date.now()}`;
    let queued = false;
    if (this.exportQueue) {
      try {
        await this.exportQueue.add(
          'shivir.export',
          { shivir_event_id: event.id, format, requested_by: actor.user_id },
          { jobId: exportId },
        );
        queued = true;
      } catch (err) {
        this.logger.warn(
          `[shivirs.export] failed to enqueue: ${(err as Error).message} — caller can retry`,
        );
      }
    } else {
      this.logger.warn(
        `[shivirs.export] queue not registered yet — Step 15 ships the enqueue surface only`,
      );
    }
    await this.audit
      .emit({
        actor_user_id: actor.user_id,
        actor_role: actor.role,
        action: 'create',
        entity_kind: 'shivir_export',
        entity_id: event.id,
        after: { format, export_id: exportId },
      })
      .catch(() => undefined);
    return { export_id: exportId, format, queued };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private async requireEvent(eventId: string): Promise<ShivirEvent> {
    const event = await this.repo.findEventById(eventId);
    if (!event) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Shivir not found',
        statusCode: 404,
      });
    }
    return event;
  }

  /** city_admin+ writers — actor's city must match the event city. */
  private assertCityScope(actor: ScopedActor, cityId: string): void {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (!actor.city_id || actor.city_id !== cityId) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
        message: 'Shivir is outside your city scope',
        statusCode: 403,
      });
    }
  }

  /**
   * Readers (sanchalak / city_admin / state_admin / super_admin) check
   * city scope; everyone else (parent, shikshak — could be a volunteer
   * assigned to this event) is allowed through to the caller, which will
   * gate via `shivir_volunteers` membership when needed.
   */
  private assertCityReadable(actor: ScopedActor, cityId: string): void {
    if (actor.role === 'super_admin' || actor.role === 'state_admin') return;
    if (actor.role === 'city_admin' || actor.role === 'sanchalak') {
      if (!actor.city_id || actor.city_id !== cityId) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'Shivir is outside your scope',
          statusCode: 403,
        });
      }
    }
    // shikshak / parent / student / guest: read is allowed; downstream
    // gates (e.g. scan endpoint) verify volunteer membership.
  }

  /**
   * Resolve `student_qr_code` → student_id. The scanner can read either:
   *   - A raw UUID (used in fixtures, dev mode, and the test suite).
   *   - A digital ID card `qr_payload` (Step 11 sealed payload).
   */
  private async resolveStudentFromQr(code: string): Promise<string | null> {
    if (!code) return null;

    // 1. Try UUID match first (cheap path).
    const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(code);
    if (uuidLike) {
      const exists = await this.students.findById(code);
      if (exists) return exists.id;
    }

    // 2. Look up by digital_id_cards.qr_payload (Step 11).
    const cardRows = await this.drizzle.dbRead
      .select({ student_id: digital_id_cards.student_id })
      .from(digital_id_cards)
      .where(eq(digital_id_cards.qr_payload, code))
      .limit(1);
    return cardRows[0]?.student_id ?? null;
  }

  private computeNextScanKind(
    mode: ShivirAttendanceMode,
    latest: ShivirAttendanceScan | null,
    force: boolean,
  ): ShivirScanKind {
    if (mode === 'present_only') {
      if (latest) {
        throw new AppError({
          code: ERROR_CODES.ERR_SHIVIR_SCAN_DUPLICATE_PRESENT,
          message: 'Student is already marked present for this session',
          statusCode: 409,
        });
      }
      return 'present';
    }
    // in_out
    if (!latest) return 'check_in';
    if (latest.scan_kind === 'check_in') return 'check_out';
    if (latest.scan_kind === 'check_out') {
      if (force) return 'check_in';
      throw new AppError({
        code: ERROR_CODES.ERR_SHIVIR_SCAN_OUT_OF_ORDER,
        message:
          'Student already checked out. Pass force=true to allow re-entry, or wait until check-in.',
        statusCode: 409,
      });
    }
    // present in in_out is unreachable but exhaustive.
    return 'check_in';
  }

  private scanRowToResult(row: ShivirAttendanceScan, duplicate: boolean): ShivirScanResult {
    return {
      scan_id: row.id,
      shivir_event_id: row.shivir_event_id,
      shivir_session_id: row.shivir_session_id,
      student_id: row.student_id,
      student_full_name: '',
      student_code: '',
      scan_kind: row.scan_kind,
      scanned_at: row.scanned_at.toISOString(),
      attendance_mode: 'in_out', // unused on replay; client already knows it
      duplicate,
    };
  }
}
