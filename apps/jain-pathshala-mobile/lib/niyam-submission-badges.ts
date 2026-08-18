/**
 * Which badge a submitted-niyam row shows.
 *
 * The row used to carry BOTH a status pill and a points pill. For an approved
 * submission those say the same thing twice — points only exist because it was
 * approved — and approved is the common case, so a whole list of history was
 * two coloured pills per row saying one fact. One badge per row is enough.
 *
 * Pure, so it can be tested: the mobile test bundler cannot parse react-native.
 */

export type SubmissionBadge =
  | { kind: "points"; points: number }
  | { kind: "status"; status: string };

/** Statuses that mean the submission was accepted. */
const APPROVED = new Set(["approved", "accepted", "auto_approved", "featured"]);

export function isApprovedStatus(status: string): boolean {
  return APPROVED.has(status.trim().toLowerCase());
}

/**
 * At most one badge.
 *
 * Approved with points → the points, because that is the part a child cares
 * about and it already implies approval. Anything else → the status, because
 * pending and rejected are exactly the rows a parent is scanning for. Approved
 * but with no points recorded still shows the status: silence would read as
 * "not yet looked at".
 */
export function submissionBadge(row: {
  status: string;
  points_awarded?: number | null;
}): SubmissionBadge {
  const approved = isApprovedStatus(row.status);
  if (approved && row.points_awarded != null) {
    return { kind: "points", points: row.points_awarded };
  }
  return { kind: "status", status: row.status };
}
