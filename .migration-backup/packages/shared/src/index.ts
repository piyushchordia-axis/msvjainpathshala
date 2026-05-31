/**
 * `@jp/shared` — single source of truth for cross-app types, validators, and
 * domain constants.
 *
 *   - enums/      — TypeScript const arrays mirroring SPEC §5.1 PostgreSQL enums
 *   - schemas/    — Zod schemas + inferred DTO types (one file per domain)
 *   - errors/     — error code enum, envelope shape, AppError
 *   - types/      — Result, Paginated, ApiEnvelope, CursorPaginated, ScopeContext,
 *                   IdempotencyKey
 *   - constants/  — TTLs, limits, queue names (SPEC §9.1)
 *
 * All re-exports are flat — `import { Role, otpVerifySchema, QUEUES,
 * AppError } from '@jp/shared'` is the recommended import style.
 */

export * from './enums/index.js';
export * from './schemas/index.js';
export * from './errors/index.js';
export * from './types/index.js';
export * from './constants/index.js';
