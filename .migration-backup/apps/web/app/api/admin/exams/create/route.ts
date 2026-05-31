/**
 * POST /api/admin/exams/create — proxy for POST /v1/admin/exams (city_admin+).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ApiError, authenticatedServerClient } from '@/api/server-client';
import { readAccessToken } from '@/lib/auth-cookies';

const optionSchema = z.object({
  label_en: z.string().min(1).max(500),
  label_hi: z.string().min(1).max(500),
  is_correct: z.boolean(),
  order_index: z.number().int().min(0).max(100),
});

const questionSchema = z.object({
  question_type: z.string().min(1),
  question_en: z.string().min(2).max(2000),
  question_hi: z.string().min(2).max(2000),
  marks: z.number().int().min(1).max(100),
  order_index: z.number().int().min(0).max(1000),
  options: z.array(optionSchema).optional(),
});

const body = z.object({
  title_en: z.string().min(2).max(200),
  title_hi: z.string().min(2).max(200),
  window_start: z.string().datetime(),
  window_end: z.string().datetime(),
  max_attempts: z.number().int().min(1).max(5).optional(),
  pass_mark: z.number().int().min(0),
  completion_points: z.number().int().min(0).max(200).optional(),
  top_score_points: z.number().int().min(0).max(500).optional(),
  show_rank: z.boolean().optional(),
  questions: z.array(questionSchema).min(1).max(200),
});

export async function POST(req: Request): Promise<NextResponse> {
  const token = await readAccessToken();
  if (!token) {
    return NextResponse.json(
      { error: { code: 'ERR_AUTH_TOKEN_INVALID', message: 'Not authenticated' } },
      { status: 401 },
    );
  }
  let parsed: z.infer<typeof body>;
  try {
    parsed = body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: { code: 'ERR_VALIDATION_FAILED', message: (err as Error).message } },
      { status: 422 },
    );
  }
  try {
    const client = await authenticatedServerClient();
    const res = await client.post('/v1/admin/exams', parsed);
    return NextResponse.json({ data: res.data.data }, { status: 201 });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { error: { code: err.code, message: err.message } },
        { status: err.statusCode || 500 },
      );
    }
    return NextResponse.json(
      { error: { code: 'ERR_INTERNAL', message: 'Could not create exam' } },
      { status: 500 },
    );
  }
}
