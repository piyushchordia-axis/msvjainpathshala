-- H5 — a review-mode submission approved by a Guruji was silent: only
-- niyam_rejected and niyam_badge were ever sent, so a child learned nothing
-- unless the approval happened to complete a badge.
--
-- Separate file: ALTER TYPE ... ADD VALUE is kept away from other DDL so a
-- retry of this migration cannot half-apply a mixed transaction.
ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'niyam_approved';
