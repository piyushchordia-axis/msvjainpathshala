/**
 * `ai.quiz.generate` worker (SPEC §3.5, Step 21).
 *
 * The worker is the outbound bridge from NestJS to the FastAPI AI
 * service. Each job:
 *
 *   1. Marks `ai_generation_jobs.status='running'`.
 *   2. POSTs to FastAPI `/ai/quiz/generate` with HMAC headers
 *      (X-Signature: hex(HMAC-SHA256(secret, body)), X-Timestamp).
 *   3. FastAPI synchronously posts the drafted questions back to NestJS
 *      `/v1/questions/ai-batch` — that endpoint inserts the questions
 *      and updates the job row to status='ready' with question ids.
 *   4. This worker's job only needs to confirm the FastAPI call returned
 *      success; the questions are already in the DB by the time we
 *      observe the response.
 *
 * On failure: marks status='failed' with the error message and re-
 * throws so BullMQ's retry policy applies. After exhausting retries,
 * BaseProcessor moves the job to the DLQ.
 */

import { createHmac } from 'node:crypto';

import { Processor } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import axios, { type AxiosInstance } from 'axios';

import { AppConfigService } from '../../core/config/app-config.service';
import { RedisService } from '../../core/redis/redis.service';
import { QuestionsRepository } from '../../db/repositories';
import { QUEUES } from '../queues.constants';

import { BaseProcessor } from './base.processor';

import type { Job } from 'bullmq';

export interface AiQuizGeneratePayload {
  job_id: string;
  topic: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva' | null;
  language: 'en' | 'hi';
  count: number;
}

export interface AiQuizGenerateResult {
  job_id: string;
  generated_count: number;
  accepted_count: number;
}

@Injectable()
@Processor(QUEUES.AI_QUIZ_GENERATE, { concurrency: 2 })
export class AiQuizGenerateProcessor extends BaseProcessor<
  AiQuizGeneratePayload,
  AiQuizGenerateResult
> {
  private readonly localLogger = new Logger('ai-quiz-generate');
  private readonly http: AxiosInstance;

  constructor(
    redis: RedisService,
    private readonly cfg: AppConfigService,
    private readonly questions: QuestionsRepository,
  ) {
    super(QUEUES.AI_QUIZ_GENERATE, redis);
    this.http = axios.create({
      baseURL: cfg.aiService.baseUrl,
      timeout: cfg.aiService.timeoutMs,
    });
  }

  async handle(
    job: Job<AiQuizGeneratePayload, AiQuizGenerateResult>,
  ): Promise<AiQuizGenerateResult> {
    const { job_id, topic, age_group, language, count } = job.data;

    await this.questions.updateJob(job_id, { status: 'running' });

    const payload = { job_id, topic, age_group, language, count };
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', this.cfg.aiService.hmacSecret || 'dev-secret')
      .update(body)
      .digest('hex');

    try {
      const res = await this.http.post('/ai/quiz/generate', body, {
        headers: {
          'content-type': 'application/json',
          'x-signature': signature,
          'x-timestamp': String(timestamp),
        },
      });

      const generated = Number(res.data?.generated_count ?? 0);
      const accepted = Number(res.data?.accepted_count ?? generated);

      this.localLogger.log(
        `job=${job_id} generated=${generated} accepted=${accepted} topic="${topic}"`,
      );

      // The FastAPI service has already POSTed to /v1/questions/ai-batch
      // which marks the job 'ready'. Double-confirm via repo for
      // visibility — markJobReady is idempotent.
      const fresh = await this.questions.findJobById(job_id);
      if (fresh?.status !== 'ready') {
        // Edge: callback hasn't landed yet (FastAPI processed inline but
        // the controller hasn't completed). Leave as-is; the callback
        // will set it.
        this.localLogger.warn(`job=${job_id} not yet 'ready' (status=${fresh?.status})`);
      }

      return { job_id, generated_count: generated, accepted_count: accepted };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.questions
        .updateJob(job_id, { status: 'failed', error: message })
        .catch(() => undefined);
      throw err;
    }
  }
}
