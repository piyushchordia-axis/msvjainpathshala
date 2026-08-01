/**
 * Shared MSV/audience + geography predicate for niyam catalog and submit.
 * Catalog filtering alone is not enough — submit must re-check the same rules.
 */

export type NiyamAudienceFields = {
  msv_audience: string;
  scope: string;
  state_id: string | null;
  city_id: string | null;
};

export type StudentAudienceCtx = {
  msv_status: string;
  city_id: string | null;
  state_id: string | null;
};

export function studentCanAccessNiyam(
  niyam: NiyamAudienceFields,
  student: StudentAudienceCtx,
): boolean {
  if (niyam.msv_audience === "msv" && student.msv_status !== "approved") return false;
  if (niyam.msv_audience === "non_msv" && student.msv_status === "approved") return false;
  if (niyam.scope === "national") return true;
  if (niyam.scope === "state") return !!niyam.state_id && niyam.state_id === student.state_id;
  if (niyam.scope === "city") return !!niyam.city_id && niyam.city_id === student.city_id;
  return false;
}
