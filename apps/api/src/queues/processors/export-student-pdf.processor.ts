/**
 * `export.student.pdf` worker — SPEC §12.5.
 *
 * Builds a progress-report PDF via PdfService (pdfkit) and uploads to exports.
 */

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';

import { PdfService } from '../../core/pdf/pdf.service';
import { progressReportPdfFromSnapshot } from '../../core/pdf/report-snapshot.mapper';
import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { CentresRepository, MediaAssetsRepository } from '../../db/repositories';
import { ExportJobsRepository } from '../../db/repositories/export-jobs.repository';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { ReportsService } from '../../modules/reports/reports.service';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface StudentExportPayload {
  export_job_id: string;
  student_id: string;
  requested_by_user_id: string;
}

export interface StudentExportResult {
  export_job_id: string;
  asset_id: string | null;
  s3_key: string;
  bytes: number;
  via: 'pdfkit';
}

@Injectable()
@Processor(QUEUES.EXPORT_STUDENT_PDF, { concurrency: 2 })
export class ExportStudentPdfProcessor extends BaseProcessor<
  StudentExportPayload,
  StudentExportResult
> {
  private readonly localLogger = new Logger('export-student-pdf');

  constructor(
    redis: RedisService,
    private readonly exports: ExportJobsRepository,
    private readonly reports: ReportsService,
    private readonly students: StudentsRepository,
    private readonly centres: CentresRepository,
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
    private readonly pdf: PdfService,
  ) {
    super(QUEUES.EXPORT_STUDENT_PDF, redis);
  }

  async handle(job: Job<StudentExportPayload, StudentExportResult>): Promise<StudentExportResult> {
    const { export_job_id, student_id, requested_by_user_id } = job.data;
    await this.exports.markRunning(export_job_id);

    try {
      const student = await this.students.findById(student_id);
      if (!student) throw new Error(`student ${student_id} not found`);

      const now = new Date();
      const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const periodLabel = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`;
      const snapshot = await this.reports.snapshotFor(student_id, 'monthly', periodLabel);
      const centre = await this.centres.findById(snapshot.student.centre_id);
      const pdfBytes = await this.pdf.renderProgressReport(
        progressReportPdfFromSnapshot(snapshot, centre?.name ?? '—', null),
      );

      const objectKey = `student-exports/${student_id}/${Date.now()}.pdf`;
      await this.storage.adapter.putObject('exports', objectKey, {
        body: pdfBytes,
        contentType: 'application/pdf',
        cacheControl: 'private,max-age=0,no-cache',
      });

      const asset = await this.media.create({
        kind: 'misc',
        owner_user_id: requested_by_user_id,
        s3_bucket: this.storage.adapter.bucketName('exports'),
        s3_key: objectKey,
        mime_type: 'application/pdf',
        size_bytes: pdfBytes.length,
        checksum_sha256: '',
        status: 'ready',
        exif_stripped: true,
        processed_at: new Date(),
      });

      await this.exports.markReady(export_job_id, asset.id);

      return {
        export_job_id,
        asset_id: asset.id,
        s3_key: objectKey,
        bytes: pdfBytes.length,
        via: 'pdfkit',
      };
    } catch (err) {
      await this.exports.markFailed(export_job_id, (err as Error).message);
      throw err;
    }
  }
}
