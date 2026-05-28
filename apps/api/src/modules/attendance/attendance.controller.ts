/**
 * AttendanceController — `/v1/attendance/*`, `/v1/absences/*`,
 * `/v1/sessions/:id/attendance/*`, `/v1/students/:id/attendance`,
 * `/v1/admin/attendance/centres/:id/log`.
 *
 * Step 13.
 */

import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { AttendanceService, type ScopedActor } from './attendance.service';

const markBodySchema = z.object({
  session_id: z.string().uuid(),
  marks: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: z.enum(['present', 'absent', 'late', 'excused']),
        notes: z.string().max(500).optional(),
        client_op_id: z.string().min(8).max(64),
      }),
    )
    .min(1)
    .max(200),
});

const editOneSchema = z.object({
  status: z.enum(['present', 'absent', 'late', 'excused']),
  notes: z.string().max(500).optional(),
});

const absenceNotifySchema = z.object({
  student_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  reason: z.string().min(3).max(500),
});

const monthQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM'),
});

const centreLogQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

function toScopedActor(user: CurrentUserPayload): ScopedActor {
  return {
    user_id: user.sub,
    role: user.role,
    city_id: user.scope.city_id,
    centre_ids: user.scope.centre_ids,
    batch_ids: user.scope.batch_ids,
  };
}

function assertActor(user: CurrentUserPayload | undefined): asserts user is CurrentUserPayload {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
}

@Controller('/v1')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  // ---------------------------------------------------------------------------
  // POST /v1/attendance/mark
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Post('/attendance/mark')
  @HttpCode(200)
  async mark(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(markBodySchema)) body: z.infer<typeof markBodySchema>,
  ) {
    assertActor(user);
    return this.service.mark(toScopedActor(user), {
      session_id: body.session_id,
      marks: body.marks.map((m) => ({
        student_id: m.student_id,
        status: m.status,
        client_op_id: m.client_op_id,
        ...(m.notes !== undefined ? { notes: m.notes } : {}),
      })),
    });
  }

  // ---------------------------------------------------------------------------
  // PATCH /v1/sessions/:id/attendance/:student_id  (same-day single edit)
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Patch('/sessions/:id/attendance/:studentId')
  @HttpCode(200)
  async editOne(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') sessionId: string,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(editOneSchema)) body: z.infer<typeof editOneSchema>,
  ) {
    assertActor(user);
    return this.service.editOne(toScopedActor(user), sessionId, studentId, {
      status: body.status,
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    });
  }

  // ---------------------------------------------------------------------------
  // GET /v1/sessions/:id/roster  (helper for the marking screen)
  // ---------------------------------------------------------------------------

  @Roles('shikshak')
  @Get('/sessions/:id/roster')
  async roster(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') sessionId: string,
  ) {
    assertActor(user);
    return this.service.loadRoster(toScopedActor(user), sessionId);
  }

  // ---------------------------------------------------------------------------
  // POST /v1/absences/notify
  // ---------------------------------------------------------------------------

  @Roles('parent')
  @Post('/absences/notify')
  @HttpCode(201)
  async notifyAbsence(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Body(new ZodValidationPipe(absenceNotifySchema)) body: z.infer<typeof absenceNotifySchema>,
  ) {
    assertActor(user);
    return this.service.notifyAbsence(toScopedActor(user), {
      student_id: body.student_id,
      date: body.date,
      reason: body.reason,
    });
  }

  // ---------------------------------------------------------------------------
  // GET /v1/students/:id/attendance?month=YYYY-MM
  // ---------------------------------------------------------------------------

  @Roles('parent')
  @Get('/students/:id/attendance')
  async studentMonth(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
    @Query(new ZodValidationPipe(monthQuerySchema)) q: z.infer<typeof monthQuerySchema>,
  ) {
    assertActor(user);
    return this.service.monthForStudent(toScopedActor(user), studentId, q.month);
  }

  // ---------------------------------------------------------------------------
  // GET /v1/admin/attendance/centres/:id/log
  // ---------------------------------------------------------------------------

  @Roles('sanchalak')
  @Get('/admin/attendance/centres/:id/log')
  async centreLog(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') centreId: string,
    @Query(new ZodValidationPipe(centreLogQuerySchema)) q: z.infer<typeof centreLogQuerySchema>,
  ) {
    assertActor(user);
    return this.service.logForCentre(toScopedActor(user), centreId, {
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
  }
}
