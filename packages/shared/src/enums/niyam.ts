/**
 * Niyam-related enums (SPEC §5.1):
 *   - `niyam_type_enum`     daily | weekly | monthly
 *   - `proof_type_enum`     photo | video | either
 *   - `niyam_submission_status_enum`  auto_approved | rejected
 *
 * Rejection rule (CLAUDE.md Q5 / SPEC §8.4): a submission may be rejected only
 * within `NIYAM_REVERSAL_WINDOW_DAYS` days of submission. After that the API
 * returns `ERR_NIYAM_REVERSAL_WINDOW_EXPIRED`. The constant lives in
 * `constants/limits.ts`.
 */

export const NIYAM_TYPES = ['daily', 'weekly', 'monthly'] as const;
export type NiyamType = (typeof NIYAM_TYPES)[number];

export const PROOF_TYPES = ['photo', 'video', 'either'] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export const NIYAM_SUBMISSION_STATUSES = ['auto_approved', 'rejected'] as const;
export type NiyamSubmissionStatus = (typeof NIYAM_SUBMISSION_STATUSES)[number];
