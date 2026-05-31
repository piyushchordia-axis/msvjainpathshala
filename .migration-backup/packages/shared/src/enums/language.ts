/**
 * `language_enum` (SPEC §5.1). Bilingual fields (`*_en` / `*_hi`) are required
 * for all user-facing content (SPEC §6.27).
 */
export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';
