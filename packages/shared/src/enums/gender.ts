/** `gender_enum` (SPEC §5.1). Required for shikshak (drives Guruji vs Didi). */
export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];
