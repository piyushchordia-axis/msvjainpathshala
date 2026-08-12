/** Admin DTO mirrors for `/v1/admin/library` draft/published tree. */

export type LibrarySectionType = "item_list" | "deeplink" | "panchang";

export interface LibraryDraftPublishedNames {
  name_en: string;
  name_hi: string | null;
  name_gu: string | null;
  order_index: number;
}

export interface LibrarySectionDraft extends LibraryDraftPublishedNames {
  icon_url: string | null;
  type: LibrarySectionType;
  deeplink_target: string | null;
  requires_login: boolean;
}

export interface LibraryAdminItem {
  id: string;
  section_id: string;
  subsection_id: string | null;
  item_code: string;
  is_published: boolean;
  content_version: number;
  draft: {
    title_en: string;
    title_hi: string | null;
    title_gu: string | null;
    order_index: number;
    audio_url: string | null;
    audio_size_bytes: number | null;
    audio_duration_sec: number | null;
    youtube_url: string | null;
    text_content_en: string | null;
    text_content_hi: string | null;
    text_content_gu: string | null;
  };
  published: {
    title_en: string;
    title_hi: string | null;
    title_gu: string | null;
    order_index: number;
    audio_url: string | null;
    audio_size_bytes: number | null;
    audio_duration_sec: number | null;
    youtube_url: string | null;
    text_content_en: string | null;
    text_content_hi: string | null;
    text_content_gu: string | null;
  };
}

export interface LibraryAdminSubsection {
  id: string;
  section_id: string;
  is_published: boolean;
  content_version: number;
  draft: LibraryDraftPublishedNames;
  published: LibraryDraftPublishedNames;
  items: LibraryAdminItem[];
}

export interface LibraryAdminSection {
  id: string;
  key: string;
  is_published: boolean;
  content_version: number;
  draft: LibrarySectionDraft;
  published: Omit<LibrarySectionDraft, never>;
  subsections: LibraryAdminSubsection[];
  items: LibraryAdminItem[];
}

export interface LibraryAdminTree {
  sections: LibraryAdminSection[];
  can_edit?: boolean;
}

export interface LibraryMediaOrphan {
  key: string;
  url: string;
  size_bytes: number;
  uploaded_at: string;
}

export interface LibraryMediaUsage {
  total_bytes: number;
  file_count: number;
  orphans: LibraryMediaOrphan[];
}

export function canPublishLibrary(role: string | undefined | null): boolean {
  return role === "super_admin";
}

export function flattenLibraryItems(sections: LibraryAdminSection[]): Array<
  LibraryAdminItem & { section_name: string; subsection_name: string | null }
> {
  const out: Array<LibraryAdminItem & { section_name: string; subsection_name: string | null }> =
    [];
  for (const s of sections) {
    for (const item of s.items) {
      out.push({ ...item, section_name: s.draft.name_en, subsection_name: null });
    }
    for (const sub of s.subsections) {
      for (const item of sub.items) {
        out.push({
          ...item,
          section_name: s.draft.name_en,
          subsection_name: sub.draft.name_en,
        });
      }
    }
  }
  return out;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
