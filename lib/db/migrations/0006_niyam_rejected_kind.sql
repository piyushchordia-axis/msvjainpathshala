-- N2a: notification kind for parent alert when a niyam submission is rejected.

--> statement-breakpoint

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'niyam_rejected';
