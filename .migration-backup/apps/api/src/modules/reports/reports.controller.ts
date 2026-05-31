/**
 * ReportsController — Step 22.
 *
 *   GET   /v1/reports/me                              parent — released reports
 *
 *   POST  /v1/admin/reports/release/:id               sanchalak+ — release one report
 *   POST  /v1/admin/exports/students/:id              city_admin, sanchalak (own)
 *   POST  /v1/admin/exports/centres/:id/all-students  city_admin
 *   GET   /v1/admin/exports/:id                       requester polls
 */

import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { ProgressReportsRepository } from '../../db/repositories/progress-reports.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';

import { ReportsService } from './reports.service';

const generateReportSchema = z.object({
  period_kind: z.enum(['monthly', 'termly']),
  period_label: z.string().min(1),
});

@Controller('/v1')
export class ReportsController {
  constructor(
    private readonly service: ReportsService,
    private readonly reportsRepo: ProgressReportsRepository,
    private readonly studentsRepo: StudentsRepository,
  ) {}

  // ===========================================================================
  // PDF generate / download (synchronous pdfkit)
  // ===========================================================================

  @Roles('sanchalak')
  @Post('/admin/reports/generate/:studentId')
  @HttpCode(200)
  async generate(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('studentId') studentId: string,
    @Body(new ZodValidationPipe(generateReportSchema))
    body: z.infer<typeof generateReportSchema>,
  ) {
    this.requireUserId(user);
    return this.service.generateNow(studentId, body.period_kind, body.period_label);
  }

  @Roles('parent')
  @Get('/reports/:id/download')
  async download(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    const userId = this.requireUserId(user);
    const report = await this.reportsRepo.findById(id);
    if (!report) {
      throw new AppError({
        code: ERROR_CODES.ERR_REPORT_NOT_FOUND,
        message: 'Progress report not found',
        statusCode: 404,
      });
    }
    const role = user?.role as Role;
    const isAdmin = ['sanchalak', 'city_admin', 'state_admin', 'super_admin'].includes(role);
    if (!isAdmin) {
      // Parent: report must be released AND belong to one of their children.
      const student = await this.studentsRepo.findById(report.student_id);
      if (!report.released_to_parent || !student || student.parent_user_id !== userId) {
        throw new AppError({
          code: ERROR_CODES.ERR_RBAC_OUT_OF_SCOPE,
          message: 'This report is not available to you',
          statusCode: 403,
        });
      }
    }
    return this.service.getReportDownloadUrl(id);
  }

  // ===========================================================================
  // Parent
  // ===========================================================================

  @Roles('parent')
  @Get('/reports/me')
  async myReports(@CurrentUser() user: CurrentUserPayload | undefined) {
    const userId = this.requireUserId(user);
    const items = await this.service.listForParent(userId);
    return { items };
  }

  // ===========================================================================
  // Admin
  // ===========================================================================

  @Roles('sanchalak')
  @Post('/admin/reports/release/:id')
  @HttpCode(200)
  async release(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    this.requireUserId(user);
    const existing = await this.reportsRepo.findById(id);
    if (!existing) {
      throw new AppError({
        code: ERROR_CODES.ERR_REPORT_NOT_FOUND,
        message: 'Progress report not found',
        statusCode: 404,
      });
    }
    return this.reportsRepo.release(id);
  }

  @Roles('sanchalak')
  @Post('/admin/exports/students/:id')
  @HttpCode(202)
  async exportStudent(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') studentId: string,
  ) {
    const actor = this.requireActor(user);
    return this.service.enqueueStudentExport(actor, studentId);
  }

  @Roles('city_admin')
  @Post('/admin/exports/centres/:id/all-students')
  @HttpCode(202)
  async exportCentre(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @Param('id') centreId: string,
  ) {
    const actor = this.requireActor(user);
    return this.service.enqueueCentreBulkExport(actor, centreId);
  }

  @Roles('sanchalak')
  @Get('/admin/exports/:id')
  async getExport(@CurrentUser() user: CurrentUserPayload | undefined, @Param('id') id: string) {
    const actor = this.requireActor(user);
    return this.service.getExportJob(actor, id);
  }

  // ---------------------------------------------------------------------

  private requireUserId(user: CurrentUserPayload | undefined): string {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return user.sub;
  }

  private requireActor(user: CurrentUserPayload | undefined): { user_id: string; role: Role } {
    if (!user) {
      throw new AppError({
        code: ERROR_CODES.ERR_AUTH_TOKEN_INVALID,
        message: 'Not authenticated',
        statusCode: 401,
      });
    }
    return { user_id: user.sub, role: user.role };
  }
}
