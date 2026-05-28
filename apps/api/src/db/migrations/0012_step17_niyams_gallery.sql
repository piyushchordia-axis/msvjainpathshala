-- Step 17 — Niyams Module + Gallery
--
-- Three deltas:
--   1. Add GIN index on niyams.audience_filters so the audience JSONB
--      lookups (age_group, batch, centre) used by listActiveForCaller stay
--      sargable as the table grows.
--   2. Add a partial index on niyam_submissions for the streak processor's
--      ASC walk by (student_id, niyam_id, submission_date) — the existing
--      index in 0001 is (niyam_id, student_id, submission_date) which is
--      the wrong column order for our access pattern.
--   3. Add gallery_items partial visibility index for the public read path
--      (removed=false AND deleted_at IS NULL AND city_id=$1 ORDER BY
--      is_featured DESC, created_at DESC).
--
-- All blocks are idempotent.

-- ===== 1. niyams.audience_filters GIN =====================================
CREATE INDEX IF NOT EXISTS "idx_niyams_audience_filters_gin"
  ON "niyams" USING GIN ("audience_filters" jsonb_path_ops);

-- ===== 2. niyam_submissions student walk index ============================
-- For the streak processor: WHERE student_id=? AND niyam_id=? AND status='auto_approved'
-- ORDER BY submission_date ASC
CREATE INDEX IF NOT EXISTS "idx_niyam_submissions_student_niyam_date"
  ON "niyam_submissions" ("student_id", "niyam_id", "submission_date")
  WHERE "status" = 'auto_approved';

-- ===== 3. gallery_items public read path ==================================
-- Predicate matches GalleryItemsRepository.listPublic: removed=false,
-- deleted_at IS NULL.
CREATE INDEX IF NOT EXISTS "idx_gallery_items_public_city_feat"
  ON "gallery_items" ("city_id", "is_featured", "created_at" DESC)
  WHERE "removed" = false AND "deleted_at" IS NULL;
