/** `curriculum_level_enum` (SPEC §5.1) — per-student curriculum progress state. */
export const CURRICULUM_LEVELS = ['not_started', 'in_progress', 'completed', 'mastered'] as const;
export type CurriculumLevel = (typeof CURRICULUM_LEVELS)[number];
