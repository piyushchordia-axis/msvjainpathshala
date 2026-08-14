-- Stable sort key for Team shikshak centre pagination (keyset on order, id).
ALTER TABLE "centres" ADD COLUMN IF NOT EXISTS "order" integer NOT NULL DEFAULT 0;
