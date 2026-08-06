-- FIX #9 — dedicated notification kinds (attendance / streak / donation / gallery).
-- ADD VALUE IF NOT EXISTS is safe to re-run; PG 12+ allows this inside a transaction
-- when the new value is not used later in the same transaction.

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'attendance';--> statement-breakpoint

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'attendance_streak';--> statement-breakpoint

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'donation';--> statement-breakpoint

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'gallery';--> statement-breakpoint
