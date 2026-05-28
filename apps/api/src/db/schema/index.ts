/**
 * Schema barrel — every Drizzle table + every pgEnum exported under one roof.
 *
 * `drizzle.config.ts` points at this file, so drizzle-kit discovers every
 * table by walking these re-exports. Application code imports from here too:
 *
 *   import { users, batches, punya_transactions } from '@/db/schema';
 *
 * Files are listed in dependency order so a reader can follow the FK
 * graph top-down.
 */

export * from './enums';

// Identity + reference data
export * from './geography';
export * from './identity';
export * from './media';

// Org structure
export * from './centres';
export * from './students';
export * from './form_configs';

// Operations
export * from './attendance';
export * from './punya';
export * from './niyams';
export * from './gallery';
export * from './homework';
export * from './notices';
export * from './shivirs';
export * from './competitions';
export * from './curriculum';
export * from './exams';
export * from './quizzes';
export * from './services';
export * from './library';
export * from './donations';
export * from './notifications';

// Platform-wide settings + cross-cutting
export * from './platform';
export * from './audit';
export * from './student_notes';
export * from './system_config';
