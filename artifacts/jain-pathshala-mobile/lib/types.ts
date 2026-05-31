/** Response shapes mirrored from the web artifact's API usage. */

export interface CentreListItem {
  id: string;
  name: string;
  locality: string | null;
  city_name: string | null;
  state_name: string | null;
  batch_count: number;
}

export interface CentreDetail {
  id: string;
  name: string;
  locality: string | null;
  pincode: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  city_name: string | null;
  state_name: string | null;
}

export interface BatchItem {
  id: string;
  name: string;
  age_group: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  capacity: number | null;
  language_preference: string | null;
}

export interface ShivirListItem {
  id: string;
  name: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  location_text: string | null;
  city_name: string | null;
}

export interface ShivirDetail extends ShivirListItem {
  state_name: string | null;
  capacity: number | null;
  contact_info: string | null;
}

export interface NoticeItem {
  id: string;
  title_en: string;
  title_hi: string | null;
  content_en: string | null;
  content_hi: string | null;
  pinned: boolean;
  is_critical: boolean;
  created_at: string;
}

export interface LibraryItem {
  id: string;
  content_type: string;
  title_en: string;
  title_hi: string | null;
  description_en: string | null;
  description_hi: string | null;
  embed_url: string | null;
}

export interface GalleryItem {
  id: string;
  first_name: string;
  age_group: string | null;
  niyam_title_en: string | null;
  niyam_title_hi: string | null;
  niyam_type: string | null;
  is_featured: boolean;
  created_at: string;
}

export interface AnalyticsOverview {
  active_students: number;
  centres: number;
  open_service_requests: number;
  attendance_rate_30d: number;
  punya_awarded_30d: number;
  msv_active: number;
  donations_total_paise_ytd: number;
}

export interface AdminStudent {
  id: string;
  full_name: string;
  student_code: string | null;
  age_group: string | null;
  dob: string | null;
  msv_status: string | null;
  status: string;
}

export interface AdminEnrolment {
  id: string;
  created_at: string;
  decided_at: string | null;
  requested_centre_id: string | null;
  requested_batch_id: string | null;
  status: string;
}

export interface AdminBatch {
  id: string;
  name: string;
  centre_name: string | null;
  age_group: string | null;
  shikshak_name: string | null;
  day_of_week: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string;
}

export interface ListResponse<T> {
  items: T[];
}
