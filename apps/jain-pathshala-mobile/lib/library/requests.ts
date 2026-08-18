/**
 * Library content requests — client for /v1/library/requests (Section 17 v3 §17.10).
 *
 * ONLINE-ONLY, deliberately. These calls do NOT go through the offline MMKV
 * queue: unlike an attendance roster there is no work to lose, and a request
 * that silently sits in a queue the admin never receives is worse than a form
 * that says "you need to be online". §17.4 names this as the one exception to
 * offline-first.
 */
import { apiGet, apiPost } from "@/lib/api";
import { getDeviceId } from "@/lib/device-id";

export type LibraryRequestStatus = "pending" | "accepted" | "rejected" | "published";

export type LibraryContentRequest = {
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
};

export type LibraryRequestDraft = {
  section_id?: string | null;
  suggested_section?: string | null;
  title: string;
  details: string;
  reference_url?: string | null;
  requester_name?: string;
  requester_phone?: string;
};

export {
  OTHER_SECTION,
  isIndianMobile,
  validateLibraryRequest,
  type LibraryRequestFormValues,
} from "./request-validation";

/**
 * Submit a request.
 *
 * The device id is always sent, signed in or not. For a guest it is the only
 * thing tying the row to them; for a member it is what lets a request made
 * moments ago as a guest be recognised as theirs. It is the SAME id the sign-in
 * flow sends, which is what makes the server-side re-key work at all.
 */
export async function submitLibraryRequest(
  draft: LibraryRequestDraft,
): Promise<{ id: string; status: LibraryRequestStatus; created_at: string }> {
  const requester_device_id = await getDeviceId();
  const res = await apiPost<{ request: { id: string; status: LibraryRequestStatus; created_at: string } }>(
    "/v1/library/requests",
    { ...draft, requester_device_id },
  );
  return res.request;
}

/**
 * The caller's own requests.
 *
 * The device id rides in the query string because a GET has no body. After
 * first login the server scopes by account instead, so the re-keyed guest
 * history appears here with no action from the reader — which is the whole
 * point of keeping the device id on the row.
 */
export async function fetchMyLibraryRequests(): Promise<LibraryContentRequest[]> {
  const deviceId = await getDeviceId();
  const res = await apiGet<{ requests: LibraryContentRequest[] }>(
    `/v1/library/requests/mine?device_id=${encodeURIComponent(deviceId)}`,
  );
  return res.requests ?? [];
}
