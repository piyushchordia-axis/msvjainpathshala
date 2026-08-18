-- Notification kind for a library content request reaching `published`
-- (Section 17 v3 section 17.10.7).
--
-- Its own kind rather than 'general' so a requester can mute these
-- independently through users.notification_preferences, which prefsAllowKind
-- resolves per kind.
--
-- Separate file: ALTER TYPE ... ADD VALUE is kept away from DDL so a retry of
-- another migration never re-runs it (matches 0015 / 0045 / 0072 / 0074).

ALTER TYPE "notification_kind_enum" ADD VALUE IF NOT EXISTS 'library';
