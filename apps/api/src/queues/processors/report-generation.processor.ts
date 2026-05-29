/**
 * `report.generation` worker — SPEC §5.20, §12.4, §12.5.
 *
 * Per-job flow:
 *   1. Load the student (skip if inactive — Q11).
 *   2. Build the snapshot via ReportsService.snapshotFor().
 *   3. UPSERT a progress_reports row.
 *   4. Render apps/api/src/templates/progress-report-monthly.hbs.
 *   5. PDF via puppeteer; fallback to HTML bytes.
 *   6. Upload to jp-{env}-exports/reports/{student}/{period}.pdf.
 *   7. Persist media_assets row + back-fill progress_reports.pdf_asset_id.
 *   8. Best-effort notify the parent (notifications.fanout 'report.ready').
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import Handlebars from 'handlebars';

import { RedisService } from '../../core/redis/redis.service';
import { StorageService } from '../../core/storage/storage.service';
import { MediaAssetsRepository } from '../../db/repositories';
import { StudentsRepository } from '../../db/repositories/students.repository';
import { ReportsService, type ReportSnapshot } from '../../modules/reports/reports.service';
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
  via: 'puppeteer' | 'fallback';
  bytes: number;
}

const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'progress-report-monthly.hbs');
let compiledTpl: Handlebars.TemplateDelegate<ReportSnapshot> | null = null;
function template(): Handlebars.TemplateDelegate<ReportSnapshot> {
  if (!compiledTpl) {
    const src = readFileSync(TEMPLATE_PATH, 'utf8');
    compiledTpl = Handlebars.compile<ReportSnapshot>(src, { noEscape: false });
  }
  return compiledTpl;
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
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
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
      // Q11 — never generate a report for an inactive student.
      this.localLogger.log(`skip inactive student=${student_id}`);
      return {
        student_id,
        report_id: '',
        asset_id: null,
        via: 'fallback',
        bytes: 0,
      };
    }

    const snapshot = await this.reports.snapshotFor(student_id, period_kind, period_label);
    const report = await this.reports.upsertReport(student_id, period_kind, period_label, snapshot);

    const html = template()(snapshot);
    const rendered = await this.htmlToPdf(html);

    const objectKey = `reports/${student_id}/${period_label}.pdf`;
    await this.storage.adapter.putObject('exports', objectKey, {
      body: rendered.bytes,
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
        size_bytes: rendered.bytes.length,
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
      via: rendered.via,
      bytes: rendered.bytes.length,
    };
  }

  // ---------------------------------------------------------------------

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
    } catch (err) {
      this.localLogger.warn(`puppeteer pdf failed: ${(err as Error).message}`);
      return { bytes: Buffer.from(html, 'utf8'), via: 'fallback' };
    }
  }
}
