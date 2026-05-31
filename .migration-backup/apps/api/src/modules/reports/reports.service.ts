/**
 * ReportsService — Step 22 (SPEC §5.20, §12.4, §12.5, §12.6).
 *
 *   1. enqueueMonthlyForAllActive() — invoked by the
 *      notifications.monthly_reports cron (1st of month 02:00 IST).
 *      Iterates ACTIVE students only (Q11: deactivated students excluded)
 *      and enqueues one `report.generation` job per student.
 *   2. enqueueStudentExport / enqueueCentreBulkExport — caller-initiated
 *      from POST /v1/admin/exports/* endpoints. Persists an export_jobs
 *      row first so the polling endpoint has something to return.
 *   3. snapshotFor(studentId, periodLabel) — builds the JSONB payload
 *      stored under progress_reports.snapshot. Pure data-aggregation; the
 *      Handlebars template consumes this shape directly.
 */

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { AppError, ERROR_CODES, type Role } from '@jp/shared';

import { DrizzleService } from '../../core/database/drizzle.service';
import { PdfService } from '../../core/pdf/pdf.service';
import { progressReportPdfFromSnapshot } from '../../core/pdf/report-snapshot.mapper';
import { StorageService } from '../../core/storage/storage.service';
import { CentresRepository } from '../../db/repositories/centres.repository';
import { ExportJobsRepository } from '../../db/repositories/export-jobs.repository';
import { ProgressReportsRepository } from '../../db/repositories/progress-reports.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { QUEUES } from '../../queues/queues.constants';

import type { ExportJob, ProgressReport, Student } from '../../db/schema';

export interface ReportSnapshot {
  student: {
    id: string;
    full_name: string;
    student_code: string;
    age_group: string;
    centre_id: string;
    batch_id: string | null;
  };
  period: { kind: 'monthly' | 'termly'; label: string; from: string; to: string };
  attendance: { present: number; total: number; rate_pct: number };
  punya: { points_awarded: number; reversals: number };
  highlights: string[];
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly studentsRepo: StudentsRepository,
    private readonly reportsRepo: ProgressReportsRepository,
    private readonly exports: ExportJobsRepository,
    private readonly centresRepo: CentresRepository,
    private readonly pdf: PdfService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUES.REPORT_GENERATION) private readonly reportQ: Queue,
    @InjectQueue(QUEUES.EXPORT_STUDENT_PDF) private readonly studentExportQ: Queue,
    @InjectQueue(QUEUES.EXPORT_BULK_ZIP) private readonly bulkExportQ: Queue,
  ) {}

  // ===========================================================================
  // Synchronous, on-demand PDF generation (pdfkit)
  // ===========================================================================

  /**
   * Generate (or regenerate) a progress-report PDF right now and return a
   * signed download URL alongside the persisted row. Q11: snapshotFor throws
   * for inactive students.
   */
  async generateNow(
    studentId: string,
    periodKind: 'monthly' | 'termly',
    periodLabel: string,
  ): Promise<{ report: ProgressReport; url: string }> {
    const snapshot = await this.snapshotFor(studentId, periodKind, periodLabel);
    const report = await this.upsertReport(studentId, periodKind, periodLabel, snapshot);
    const centre = await this.centresRepo.findById(snapshot.student.centre_id);
    const pdf = await this.pdf.renderProgressReport(
      progressReportPdfFromSnapshot(snapshot, centre?.name ?? '—', report.shikshak_comment),
    );
    const key = `reports/${studentId}/${periodKind}-${periodLabel}.pdf`;
    await this.storage.adapter.putObject('exports', key, {
      body: pdf,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="report-${snapshot.student.student_code}-${periodLabel}.pdf"`,
      cacheControl: 'private,max-age=0,no-cache',
    });
    const url = await this.storage.signedReadUrl('exports', key);
    return { report, url };
  }

  /** Resolve a signed download URL for an already-generated report. */
  async getReportDownloadUrl(reportId: string): Promise<{ report: ProgressReport; url: string }> {
    const report = await this.reportsRepo.findById(reportId);
    if (!report) {
      throw new AppError({
        code: ERROR_CODES.ERR_REPORT_NOT_FOUND,
        message: 'Progress report not found',
        statusCode: 404,
      });
    }
    const key = `reports/${report.student_id}/${report.period_kind}-${report.period_label}.pdf`;
    const url = await this.storage.signedReadUrl('exports', key);
    return { report, url };
  }

  // ===========================================================================
  // Monthly cron entry
  // ===========================================================================

  /**
   * Cron entry: enqueue one `report.generation` job per ACTIVE student.
   * Q11 — deactivated students are excluded. Returns the number enqueued.
   */
  async enqueueMonthlyForAllActive(
    periodLabel?: string,
  ): Promise<{ enqueued: number; period_label: string }> {
    const label = periodLabel ?? this.previousMonthLabel(new Date());
    const rows = (await this.drizzle.dbRead.execute(sql`
      SELECT id FROM students
       WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY id
    `)) as unknown as Array<{ id: string }>;
    let enqueued = 0;
    for (const r of rows) {
      await this.reportQ.add(
        'report.monthly',
        { student_id: r.id, period_kind: 'monthly', period_label: label },
        {
          // Job id ties one job per (student, period) so re-runs are no-ops.
          jobId: `monthly:${r.id}:${label}`,
        },
      );
      enqueued++;
    }
    this.logger.log(`enqueued ${enqueued} monthly report jobs for period=${label}`);
    return { enqueued, period_label: label };
  }

  // ===========================================================================
  // Per-job snapshot builder
  // ===========================================================================

  async snapshotFor(
    studentId: string,
    periodKind: 'monthly' | 'termly',
    periodLabel: string,
  ): Promise<ReportSnapshot> {
    const student: Student | null = await this.studentsRepo.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    if (student.status !== 'active' || student.deleted_at) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_INACTIVE,
        message: 'Student is inactive — no report will be generated (Q11)',
        statusCode: 422,
      });
    }
    const { from, to } = this.bounds(periodKind, periodLabel);
    const fromDate = from.toISOString().slice(0, 10);
    const toDate = to.toISOString().slice(0, 10);

    // Attendance — count present/absent across the bounds. Raw SQL keeps the
    // Drizzle date-column type narrow without yet another conditional cast.
    const attRows = (await this.drizzle.dbRead.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE a.status = 'present')::int AS present,
        COUNT(*)::int AS total
      FROM attendance a
      JOIN sessions s ON s.id = a.session_id
      WHERE a.student_id = ${studentId}
        AND s.scheduled_date BETWEEN ${fromDate}::date AND ${toDate}::date
    `)) as unknown as Array<{ present: number; total: number }>;
    const att = attRows[0] ?? { present: 0, total: 0 };
    const rate = att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : 0;

    // Punya
    const punRows = (await this.drizzle.dbRead.execute(sql`
      SELECT
        COALESCE(SUM(points), 0)::int AS awarded,
        COUNT(*) FILTER (WHERE reversal_of IS NOT NULL)::int AS reversals
      FROM punya_transactions
      WHERE student_id = ${studentId}
        AND awarded_at BETWEEN ${from.toISOString()}::timestamptz AND ${to.toISOString()}::timestamptz
        AND reversal_of IS NULL
    `)) as unknown as Array<{ awarded: number; reversals: number }>;
    const pun = punRows[0] ?? { awarded: 0, reversals: 0 };

    const highlights: string[] = [];
    if (rate >= 95) highlights.push('Exemplary attendance — 95% or higher.');
    if (pun.awarded >= 200) highlights.push('Earned 200+ Punya points this period.');

    return {
      student: {
        id: student.id,
        full_name: student.full_name,
        student_code: student.student_code,
        age_group: student.age_group,
        centre_id: student.centre_id,
        batch_id: student.batch_id,
      },
      period: {
        kind: periodKind,
        label: periodLabel,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      attendance: { present: att.present, total: att.total, rate_pct: rate },
      punya: { points_awarded: pun.awarded, reversals: pun.reversals },
      highlights,
    };
  }

  async upsertReport(
    studentId: string,
    periodKind: 'monthly' | 'termly',
    periodLabel: string,
    snapshot: ReportSnapshot,
  ): Promise<ProgressReport> {
    return this.reportsRepo.upsert({
      student_id: studentId,
      period_kind: periodKind,
      period_label: periodLabel,
      generated_at: new Date(),
      pdf_asset_id: null,
      shikshak_comment: null,
      released_to_parent: false,
      released_at: null,
      snapshot: snapshot as unknown as Record<string, unknown>,
    });
  }

  async setReportAsset(id: string, assetId: string): Promise<void> {
    await this.reportsRepo.setAsset(id, assetId);
  }

  async listForParent(parentUserId: string): Promise<ProgressReport[]> {
    const kids = await this.studentsRepo.findByParent(parentUserId);
    const out: ProgressReport[] = [];
    for (const k of kids) {
      const reports = await this.reportsRepo.listForStudent(k.id);
      // Parents only see released reports.
      out.push(...reports.filter((r) => r.released_to_parent));
    }
    return out;
  }

  // ===========================================================================
  // Exports — admin
  // ===========================================================================

  async enqueueStudentExport(
    actor: { user_id: string; role: Role },
    studentId: string,
  ): Promise<ExportJob> {
    this.assertExportRole(actor.role);
    const student = await this.studentsRepo.findById(studentId);
    if (!student) {
      throw new AppError({
        code: ERROR_CODES.ERR_RESOURCE_NOT_FOUND,
        message: 'Student not found',
        statusCode: 404,
      });
    }
    const job = await this.exports.create({
      requested_by_user_id: actor.user_id,
      kind: 'student_pdf',
      scope_entity_kind: 'student',
      scope_entity_id: studentId,
      status: 'pending',
      asset_id: null,
      error: null,
      started_at: null,
      completed_at: null,
    });
    await this.studentExportQ.add('export.student.pdf', {
      export_job_id: job.id,
      student_id: studentId,
      requested_by_user_id: actor.user_id,
    });
    return job;
  }

  async enqueueCentreBulkExport(
    actor: { user_id: string; role: Role },
    centreId: string,
  ): Promise<ExportJob> {
    this.assertExportRole(actor.role);
    const job = await this.exports.create({
      requested_by_user_id: actor.user_id,
      kind: 'centre_bulk_zip',
      scope_entity_kind: 'centre',
      scope_entity_id: centreId,
      status: 'pending',
      asset_id: null,
      error: null,
      started_at: null,
      completed_at: null,
    });
    await this.bulkExportQ.add('export.centre.zip', {
      export_job_id: job.id,
      centre_id: centreId,
      requested_by_user_id: actor.user_id,
    });
    return job;
  }

  async getExportJob(actor: { user_id: string; role: Role }, id: string): Promise<ExportJob> {
    const job = await this.exports.findForRequester(id, actor.user_id);
    if (!job) {
      throw new AppError({
        code: ERROR_CODES.ERR_EXPORT_NOT_FOUND,
        message: 'Export job not found',
        statusCode: 404,
      });
    }
    return job;
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  private assertExportRole(role: Role): void {
    const allowed: Role[] = ['sanchalak', 'city_admin', 'state_admin', 'super_admin'];
    if (!allowed.includes(role)) {
      throw new AppError({
        code: ERROR_CODES.ERR_RBAC_FORBIDDEN,
        message: 'Only sanchalak+ can request exports',
        statusCode: 403,
      });
    }
  }

  private previousMonthLabel(now: Date): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  private bounds(periodKind: 'monthly' | 'termly', periodLabel: string): { from: Date; to: Date } {
    if (periodKind === 'monthly') {
      const [yy, mm] = periodLabel.split('-').map(Number);
      if (!yy || !mm) throw new Error(`Invalid monthly label: ${periodLabel}`);
      const from = new Date(Date.UTC(yy, mm - 1, 1, 0, 0, 0));
      const to = new Date(Date.UTC(yy, mm, 0, 23, 59, 59));
      return { from, to };
    }
    // termly — coarse default: the calendar half-year matching the label
    const now = new Date();
    const from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), 5, 30));
    return { from, to };
  }
}
