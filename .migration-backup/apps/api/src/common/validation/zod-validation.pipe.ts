/**
 * `ZodValidationPipe` — validate body / query / params against a Zod schema
 * from `@jp/shared`.
 *
 * Usage in a controller method:
 *
 *   @Post('/centres')
 *   create(
 *     @Body(new ZodValidationPipe(centreCreateSchema)) dto: CentreCreateDto,
 *   ) { ... }
 *
 * Throwing a `ZodError` lets `AllExceptionsFilter` shape the 422 response with
 * `error.code = ERR_VALIDATION_FAILED` and per-field details — so each
 * controller stays single-purpose and the envelope stays consistent.
 *
 * For the global path (every request), individual modules opt-in by attaching
 * the pipe at the route level. We deliberately do NOT register it globally
 * because not every endpoint has a matching schema (`/healthz`, etc.).
 */

import { Injectable, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';

import type { ZodSchema } from 'zod';

@Injectable()
export class ZodValidationPipe<TSchema extends ZodSchema = ZodSchema> implements PipeTransform<
  unknown,
  ReturnType<TSchema['parse']>
> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): ReturnType<TSchema['parse']> {
    // Throw — the global filter converts ZodError to a 422 envelope.
    return this.schema.parse(value);
  }
}
