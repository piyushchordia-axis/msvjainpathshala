/**
 * `report.generation` worker — SPEC §5.20, §12.4, §12.5.
 *
 * Per-job flow:
 *   1. Load the student (skip if inactive — Q11).
 *   2. Build snapshot via ReportsService.snapshotFor().
 *   3. UPSERT progress_reports row.
 *   4. Render PDF via PdfService (pdfkit).
 *   5. Upload + media_assets + parent notification.
 */

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { PdfService } from '../../core/pdf/pdf.service';
import { progressReportPdfFromSnapshot } from '../../core/pdf/report-snapshot.mapper';
import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { CentresRepository, MediaAssetsRepository } from '../../db/repositories';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { ReportsService } from '../../modules/reports/reports.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface ReportGeneratePayload {
  student_id: string;
  period_kind: 'monthly' | 'termly';
  period_label: string;
}

export interface ReportGenerateResult {
  student_id: string;
  report_id: string;
  asset_id: string | null;
  via: 'pdfkit' | 'skipped';
  bytes: number;
}

@Injectable()
@Processor(QUEUES.REPORT_GENERATION, { concurrency: 4 })
export class ReportGenerationProcessor extends BaseProcessor<
  ReportGeneratePayload,
  ReportGenerateResult
> {
  private readonly localLogger = new Logger('report-generation');

  constructor(
    redis: RedisService,
    private readonly reports: ReportsService,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
    @InjectQueue(QUEUES.NOTIFICATIONS_FANOUT) private readonly fanoutQueue: Queue,
  ) {
    super(QUEUES.REPORT_GENERATION, redis);
  }

  async handle(
    job: Job<ReportGeneratePayload, ReportGenerateResult>,
  ): Promise<ReportGenerateResult> {
    const { student_id, period_kind, period_label } = job.data;

    const student = await this.students.findById(student_id);
    if (!student || student.status !== 'active' || student.deleted_at) {
      this.localLogger.log(`skip inactive student=${student_id}`);
      return {
        student_id,
        report_id: '',
        asset_id: null,
        via: 'skipped',
        bytes: 0,
      };
    }

    const snapshot = await this.reports.snapshotFor(student_id, period_kind, period_label);
    const report = await this.reports.upsertReport(student_id, period_kind, period_label, snapshot);
    const centre = await this.centres.findById(snapshot.student.centre_id);
    const pdfBytes = await this.pdf.renderProgressReport(
      progressReportPdfFromSnapshot(snapshot, centre?.name ?? '—', report.shikshak_comment),
    );

    const objectKey = `reports/${student_id}/${period_label}.pdf`;
    await this.storage.adapter.putObject('exports', objectKey, {
      body: pdfBytes,
      contentType: 'application/pdf',
      contentDisposition: `inline; filename="report-${student.student_code}-${period_label}.pdf"`,
      cacheControl: 'private,max-age=0,no-cache',
    });

    const asset = await this.media
      .create({
        kind: 'misc',
        owner_user_id: student.parent_user_id,
        s3_bucket: this.storage.adapter.bucketName('exports'),
        s3_key: objectKey,
        mime_type: 'application/pdf',
        size_bytes: pdfBytes.length,
        checksum_sha256: '',
        status: 'ready',
        exif_stripped: true,
        processed_at: new Date(),
      })
      .catch((err) => {
        this.localLogger.warn(`media insert failed: ${(err as Error).message}`);
        return null;
      });

    if (asset) {
      await this.reports.setReportAsset(report.id, asset.id);
    }

    await this.fanoutQueue
      .add('report.ready', {
        event: 'report.ready',
        recipient_user_ids: [student.parent_user_id],
        source: { kind: 'progress_report', id: report.id },
        data: {
          student_id,
          full_name: student.full_name,
          period_label,
        },
        deep_link: `/reports/${report.id}`,
      })
      .catch((err) => this.localLogger.warn(`fanout failed: ${(err as Error).message}`));

    return {
      student_id,
      report_id: report.id,
      asset_id: asset?.id ?? null,
      via: 'pdfkit',
      bytes: pdfBytes.length,
    };
  }
}
