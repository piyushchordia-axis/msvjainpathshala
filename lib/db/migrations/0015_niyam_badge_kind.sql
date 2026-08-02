-- Follow-up: notification kind for parent alert when a niyam streak badge is earned.
-- (0008 was already used by attendance; next free tag is 0015.)

--> statement-breakpoint

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'niyam_badge';
