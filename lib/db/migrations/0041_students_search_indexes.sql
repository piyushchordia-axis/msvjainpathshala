-- Covering indexes for GET /v1/admin/students search + keyset pagination.
--
-- List order is (full_name ASC, id ASC) with deleted_at IS NULL. The composite
-- btree supports the keyset walk under centre/batch scope filters.
--
-- Search uses ILIKE '%q%' on full_name OR student_code. Leading-wildcard ILIKE
-- cannot use a btree; pg_trgm GIN makes substring match indexable. student_code
-- already has a unique btree (exact / prefix); the trgm index is for names.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_students_name_id_alive
  ON students (full_name ASC, id ASC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_full_name_trgm
  ON students USING gin (full_name gin_trgm_ops)
  WHERE deleted_at IS NULL;
