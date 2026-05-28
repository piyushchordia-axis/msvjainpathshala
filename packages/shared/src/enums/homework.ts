/** `homework_status_enum` (SPEC §5.1). */
export const HOMEWORK_STATUSES = ['pending', 'starred', 'approved', 'late'] as const;
export type HomeworkStatus = (typeof HOMEWORK_STATUSES)[number];
