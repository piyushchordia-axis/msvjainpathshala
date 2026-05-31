/**
 * Re-export every DTO schema and inferred type.
 *
 * Per-domain files are kept small and focused; bigger DTO surfaces (e.g.
 * attendance bulk-mark, donations 80G toggle) live in the relevant file.
 * Add new schemas to the file that matches their domain — don't create a
 * mega-file here.
 */

export * from './common.js';
export * from './auth.js';
export * from './users.js';
export * from './centres.js';
export * from './batches.js';
export * from './students.js';
export * from './attendance.js';
export * from './niyams.js';
export * from './gallery.js';
export * from './homework.js';
export * from './notices.js';
export * from './shivirs.js';
export * from './competitions.js';
export * from './curriculum.js';
export * from './exams.js';
export * from './quizzes.js';
export * from './services.js';
export * from './library.js';
export * from './donations.js';
export * from './notifications.js';
export * from './sync.js';
export * from './media.js';
