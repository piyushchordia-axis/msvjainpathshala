/**
 * StudentNotesController — Step 13 (SPEC §5.20 shikshak notes).
 *
 *   POST /v1/admin/students/:studentId/notes   shikshak+ (scope-bound)
 *   GET  /v1/admin/students/:studentId/notes   shikshak+ (scope-bound)
 *
 * Notes are never shown to parent/student.
 */

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { StudentNotesService, type NotesActor } from './student-notes.service';

const createSchema = z.object({
  note: z.string().min(1).max(4000),
});

function toActor(user: CurrentUserPayload | undefined): NotesActor {
  if (!user) {
    throw new AppError({
      code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
      message: 'Not authenticated',
      statusCode: 401,
    });
  }
  const out: NotesActor = { user_id: user.sub, role: user.role };
  if (user.scope.city_id) out.city_id = user.scope.city_id;
  if (user.scope.centre_ids) out.centre_ids = user.scope.centre_ids;
  if (user.scope.batch_ids) out.batch_ids = user.scope.batch_ids;
  return out;
}

@Controller('/v1/admin')
export class StudentNotesController {
  constructor(private readonly service: StudentNotesService) {}

  @Roles('shikshak')
  @Post('/students/:studentId/notes')
  @HttpCode(201)
  async create(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
  ) {
    return this.service.create(toActor(user), studentId, { note: body.note });
  }

  @Roles('shikshak')
  @Get('/students/:studentId/notes')
  async list(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('studentId') studentId: string,
  ) {
    const items = await this.service.listForStudent(toActor(user), studentId);
    return { items };
  }
}
