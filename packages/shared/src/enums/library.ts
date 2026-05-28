/**
 * `library_content_type_enum`, `library_access_tier_enum` (SPEC §5.1).
 *
 * Video embeds (CLAUDE.md Q7): videos are stored as YouTube/Vimeo URLs in
 * `embed_url`, not uploaded media. `library_content_type_enum` value `'video'`
 * paired with `embed_url` is the only valid video shape.
 */

export const LIBRARY_CONTENT_TYPES = ['pdf', 'video', 'audio', 'image'] as const;
export type LibraryContentType = (typeof LIBRARY_CONTENT_TYPES)[number];

export const LIBRARY_ACCESS_TIERS = ['public', 'student', 'msv', 'shikshak'] as const;
export type LibraryAccessTier = (typeof LIBRARY_ACCESS_TIERS)[number];
