/**
 * Cached library items (audio, embedded video, PDF refs). Full schema
 * lands in Step 16 (Library).
 *
 * Per CLAUDE.md Q7: library `video_embed` items hold a YouTube/Vimeo URL —
 * we never store the video itself, just the embed_url and the thumbnail.
 */

import { CacheStore } from './_cache-base';

export interface LibraryItemSnapshot {
  id: string;
  title_en: string;
  title_hi: string;
  type: 'audio' | 'video_embed' | 'pdf';
  embed_url?: string;
  asset_id?: string;
  thumbnail_url?: string;
}

export const libraryCache = new CacheStore<LibraryItemSnapshot>('jp.cache.library');
