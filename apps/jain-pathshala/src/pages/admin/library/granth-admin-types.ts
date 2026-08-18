/** Admin DTO mirrors for `/v1/admin/library/granth` (v3 §17.11.5). */

export interface GranthLibraryFields {
  name_en: string;
  name_hi: string | null;
  address_en: string;
  address_hi: string | null;
  city_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  has_whatsapp: boolean;
  timings_en: string | null;
  timings_hi: string | null;
  lat: number | null;
  lng: number | null;
  note_en: string | null;
  note_hi: string | null;
  order_index: number;
}

export interface GranthAdminLibrary {
  id: string;
  is_published: boolean;
  content_version: number;
  /** Resolved from the DRAFT city — the one the editor is showing. */
  city_name: string | null;
  draft: GranthLibraryFields;
  published: GranthLibraryFields;
}

export interface GranthEntryFields {
  title_en: string;
  title_hi: string | null;
  author_en: string | null;
  author_hi: string | null;
  language: string | null;
  description_en: string | null;
  description_hi: string | null;
  linked_item_id: string | null;
  order_index: number;
}

export interface GranthAdminEntry {
  id: string;
  is_published: boolean;
  content_version: number;
  draft: GranthEntryFields;
  published: GranthEntryFields;
}

export interface GranthAdminAvailability {
  library_id: string;
  note: string | null;
  library_name_en: string;
  city_id: string;
  is_published: boolean;
}

export interface GranthAdminCity {
  id: string;
  name: string;
}

export interface GranthLibraryItemOption {
  id: string;
  item_code: string;
  title_en: string;
  title_hi: string | null;
  is_published: boolean;
}
