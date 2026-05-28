/** `notice_audience_enum` (SPEC §5.1). */
export const NOTICE_AUDIENCES = ['batch', 'centre', 'city', 'state', 'national', 'msv'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];
