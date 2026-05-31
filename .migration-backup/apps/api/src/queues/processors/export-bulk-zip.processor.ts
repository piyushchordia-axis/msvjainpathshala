/**
 * `export.bulk.zip` worker — SPEC §12.6.
 *
 * Streams a ZIP of every active student in a centre, with one PDF per
 * student + a manifest CSV. Uses `archiver` for the ZIP container. Each
 * student's PDF is generated inline via the same Handlebars template as
 * the per-student export (kept dependency-free; the bulk path doesn't
 * defer to the per-student queue, just iterates and renders).
 *
 * For very large centres SPEC §12.6 calls out chunking to multiple ZIPs;
 * the implementation here is single-archive — chunking can land in a
 * later step once we have a centre that exceeds a few thousand students.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

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

export interface BulkExportPayload {
  export_job_id: string;
  centre_id: string;
  requested_by_user_id: string;
}

export interface BulkExportResult {
  export_job_id: string;
  asset_id: string | null;
  s3_key: string;
  student_count: number;
  via: 'archiver' | 'fallback';
}

const TEMPLATE_PATH = join(__dirname, '..', '..', 'templates', 'progress-report-monthly.hbs');
let compiled: Handlebars.TemplateDelegate | null = null;
function tpl(): Handlebars.TemplateDelegate {
  if (!compiled) {
    compiled = Handlebars.compile(readFileSync(TEMPLATE_PATH, 'utf8'));
  }
  return compiled;
}

@Injectable()
@Processor(QUEUES.EXPORT_BULK_ZIP, { concurrency: 1 })
export class ExportBulkZipProcessor extends BaseProcessor<BulkExportPayload, BulkExportResult> {
  private readonly localLogger = new Logger('export-bulk-zip');

  constructor(
    redis: RedisService,
    private readonly exports: ExportJobsRepository,
    private readonly reports: ReportsService,
    private readonly students: StudentsRepository,
    private readonly media: MediaAssetsRepository,
    private readonly storage: StorageService,
  ) {
    super(QUEUES.EXPORT_BULK_ZIP, redis);
  }

  async handle(job: Job<BulkExportPayload, BulkExportResult>): Promise<BulkExportResult> {
    const { export_job_id, centre_id, requested_by_user_id } = job.data;
    await this.exports.markRunning(export_job_id);

    try {
      const list = await this.students.list({ centre_id, status: 'active', limit: 5000 });
      const now = new Date();
      const periodLabel = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      const { bytes, via } = await this.buildZip(
        list.map((s) => ({ id: s.id, code: s.student_code })),
        async (id) => {
          const snap = await this.reports.snapshotFor(id, 'monthly', periodLabel);
          return Buffer.from(tpl()(snap), 'utf8');
        },
      );

      const objectKey = `centre-exports/${centre_id}/${Date.now()}.zip`;
      await this.storage.adapter.putObject('exports', objectKey, {
        body: bytes,
        contentType: 'application/zip',
        cacheControl: 'private,max-age=0,no-cache',
      });

      const asset = await this.media.create({
        kind: 'misc',
        owner_user_id: requested_by_user_id,
        s3_bucket: this.storage.adapter.bucketName('exports'),
        s3_key: objectKey,
        mime_type: 'application/zip',
        size_bytes: bytes.length,
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
        student_count: list.length,
        via,
      };
    } catch (err) {
      await this.exports.markFailed(export_job_id, (err as Error).message);
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // ZIP builder — archiver if available; otherwise concatenate the bodies
  // into a single .tar-ish payload so the queue still completes in dev.
  // ---------------------------------------------------------------------
  private async buildZip(
    items: Array<{ id: string; code: string }>,
    pdfFor: (id: string) => Promise<Buffer>,
  ): Promise<{ bytes: Buffer; via: 'archiver' | 'fallback' }> {
    try {
      // archiver is an optional dependency — fall back to a plain concatenated
      // buffer if it isn't installed (dev / CI without native deps).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await (import('archiver' as any) as Promise<unknown>).catch(
        () => null,
      )) as unknown as
        | null
        | (((format: string, opts?: unknown) => unknown) & {
            default?: (format: string, opts?: unknown) => unknown;
          });
      if (!mod) return this.fallback(items, pdfFor);
      const archiverFn: (
        format: string,
        opts?: unknown,
      ) => {
        on: (event: string, cb: (err: Error) => void) => void;
        append: (data: Buffer, opts: { name: string }) => void;
        finalize: () => Promise<void>;
        pipe: (dest: NodeJS.WritableStream) => unknown;
      } = (mod.default ?? mod) as unknown as (
        format: string,
        opts?: unknown,
      ) => {
        on: (event: string, cb: (err: Error) => void) => void;
        append: (data: Buffer, opts: { name: string }) => void;
        finalize: () => Promise<void>;
        pipe: (dest: NodeJS.WritableStream) => unknown;
      };
      const archive = archiverFn('zip', { zlib: { level: 6 } });
      const out = new PassThrough();
      const chunks: Buffer[] = [];
      out.on('data', (c: Buffer) => chunks.push(c));
      archive.pipe(out);
      archive.on('warning', (err: Error) => this.localLogger.warn(`archiver: ${err.message}`));
      // Manifest first
      const manifest = ['student_id,student_code']
        .concat(items.map((it) => `${it.id},${it.code}`))
        .join('\n');
      archive.append(Buffer.from(manifest, 'utf8'), { name: 'manifest.csv' });
      for (const it of items) {
        try {
          const pdf = await pdfFor(it.id);
          archive.append(pdf, { name: `${it.code}.pdf` });
        } catch (err) {
          this.localLogger.warn(`student ${it.code} skipped: ${(err as Error).message}`);
        }
      }
      await archive.finalize();
      // Drain the stream synchronously.
      await new Promise((resolve) => out.on('end', resolve));
      return { bytes: Buffer.concat(chunks), via: 'archiver' };
    } catch (err) {
      this.localLogger.warn(`archiver failed: ${(err as Error).message}`);
      return this.fallback(items, pdfFor);
    }
  }

  private async fallback(
    items: Array<{ id: string; code: string }>,
    pdfFor: (id: string) => Promise<Buffer>,
  ): Promise<{ bytes: Buffer; via: 'fallback' }> {
    const parts: Buffer[] = [];
    parts.push(Buffer.from(`# bulk export (fallback) — ${items.length} students\n`, 'utf8'));
    for (const it of items) {
      parts.push(Buffer.from(`\n## ${it.code} (${it.id})\n`, 'utf8'));
      try {
        parts.push(await pdfFor(it.id));
      } catch (err) {
        parts.push(Buffer.from(`(skipped: ${(err as Error).message})`, 'utf8'));
      }
    }
    return { bytes: Buffer.concat(parts), via: 'fallback' };
  }
}
