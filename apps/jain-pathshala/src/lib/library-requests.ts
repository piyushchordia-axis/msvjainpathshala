/**
 * Library content requests — client for /v1/library/requests (Section 17 v3 §17.10).
 *
 * Online-only by design (§17.4): there is no queue behind these calls. The form
 * shows an explanatory state when the browser is offline rather than accepting
 * a submission it cannot deliver.
 */
import { apiGet, apiPost } from '@/lib/api-client';
import { getDeviceId } from '@/lib/device-id';

export type LibraryRequestStatus = 'pending' | 'accepted' | 'rejected' | 'published';

export interface LibraryContentRequest {
  id: string;
  section_id: string | null;
  section_name_en: string | null;
  section_name_hi: string | null;
  suggested_section: string | null;
  title: string;
  details: string;
  reference_url: string | null;
  status: LibraryRequestStatus;
  admin_note: string | null;
  linked_item_id: string | null;
  created_at: string;
  actioned_at: string | null;
}

export interface LibraryRequestDraft {
  section_id?: string | null;
  suggested_section?: string | null;
  title: string;
  details: string;
  reference_url?: string | null;
  requester_name?: string;
  requester_phone?: string;
}

/**
 * The device id goes up signed in or not: for a guest it is the only handle on
 * the row, and it is the SAME id the sign-in flow sends, which is what lets the
 * server re-key a guest's requests to their account at first login.
 */
export async function submitLibraryRequest(
  draft: LibraryRequestDraft,
): Promise<{ id: string; status: LibraryRequestStatus; created_at: string }> {
  const res = await apiPost<{
    request: { id: string; status: LibraryRequestStatus; created_at: string };
  }>('/v1/library/requests', { ...draft, requester_device_id: getDeviceId() });
  return res.request;
}

/** The caller's own requests — by account when signed in, else by device. */
export async function fetchMyLibraryRequests(): Promise<LibraryContentRequest[]> {
  const res = await apiGet<{ requests: LibraryContentRequest[] }>(
    `/v1/library/requests/mine?device_id=${encodeURIComponent(getDeviceId())}`,
  );
  return res.requests ?? [];
}
