-- Notification kind for join registration submitted / approved.
-- Separate file: ALTER TYPE ... ADD VALUE is kept away from the DDL above so a
-- retry of 0071 never re-runs it (matches 0015 / 0045).
ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'join';
