/**
 * `export.student.pdf` worker — SPEC §12.5.
 *
 * Per-job:
 *   1. Mark the export_jobs row as running.
 *   2. Build the student snapshot via ReportsService.snapshotFor()
 *      against the previous-month label as a deterministic default.
 *   3. Render apps/api/src/templates/progress-report-monthly.hbs.
 *   4. PDF via puppeteer (fallback to HTML bytes).
 *   5. Upload to jp-{env}-exports/student-exports/{student_id}.pdf.
 *   6. Mark the export_jobs row ready + persist media_assets row.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import Handlebars from 'handlebars';

import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
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
  via: 'puppeteer' | 'fallback';
}

const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'progress-report-monthly.hbs');
let compiled: Handlebars.TemplateDelegate | null = null;
function template(): Handlebars.TemplateDelegate {
  if (!compiled) {
    compiled = Handlebars.compile(readFileSync(TEMPLATE_PATH, 'utf8'), { noEscape: false });
  }
  return compiled;
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
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
  ) {
    super(QUEUES.EXPORT_STUDENT_PDF, redis);
  }

  async handle(job: Job<StudentExportPayload, StudentExportResult>): Promise<StudentExportResult> {
    const { export_job_id, student_id, requested_by_user_id } = job.data;
    await this.exports.markRunning(export_job_id);

    try {
      const student = await this.students.findById(student_id);
      if (!student) throw new Error(`student ${student_id} not found`);

      // Default to the previous calendar month for the snapshot.
      const now = new Date();
      const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const periodLabel = `${lastMonth.getUTCFullYear()}-${String(lastMonth.getUTCMonth() + 1).padStart(2, '0')}`;
      const snapshot = await this.reports.snapshotFor(student_id, 'monthly', periodLabel);

      const html = template()(snapshot);
      const rendered = await this.htmlToPdf(html);

      const objectKey = `student-exports/${student_id}/${Date.now()}.pdf`;
      await this.storage.adapter.putObject('exports', objectKey, {
        body: rendered.bytes,
        contentType: 'application/pdf',
        cacheControl: 'private,max-age=0,no-cache',
      });

      const asset = await this.media.create({
        kind: 'misc',
        owner_user_id: requested_by_user_id,
        s3_bucket: this.storage.adapter.bucketName('exports'),
        s3_key: objectKey,
        mime_type: 'application/pdf',
        size_bytes: rendered.bytes.length,
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
        bytes: rendered.bytes.length,
        via: rendered.via,
      };
    } catch (err) {
      await this.exports.markFailed(export_job_id, (err as Error).message);
      throw err;
    }
  }

  private async htmlToPdf(html: string): Promise<{ bytes: Buffer; via: 'puppeteer' | 'fallback' }> {
    try {
      const mod = (await import('puppeteer').catch(() => null)) as unknown as {
        launch: (opts: unknown) => Promise<unknown>;
        default?: { launch: (opts: unknown) => Promise<unknown> };
      } | null;
      if (!mod) return { bytes: Buffer.from(html, 'utf8'), via: 'fallback' };
      const puppeteer = mod.default ?? mod;
      const browser = (await puppeteer
        .launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
        .catch(() => null)) as null | {
        newPage: () => Promise<{
          setContent: (h: string, o?: { waitUntil?: string }) => Promise<void>;
          pdf: (o: {
            format: string;
            printBackground: boolean;
            margin: Record<string, string>;
          }) => Promise<Buffer | Uint8Array>;
        }>;
        close: () => Promise<void>;
      };
      if (!browser) return { bytes: Buffer.from(html, 'utf8'), via: 'fallback' };
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'load' });
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
        });
        return {
          bytes: Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf as Uint8Array),
          via: 'puppeteer',
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    } catch {
      return { bytes: Buffer.from(html, 'utf8'), via: 'fallback' };
    }
  }
}
