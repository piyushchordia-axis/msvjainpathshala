-- Guest library: Join Pathshala tile is published again (signed-in clients hide it).

UPDATE "library_sections"
SET
  "is_published" = true,
  "content_version" = "content_version" + 1,
  "updated_at" = now()
WHERE "key" = 'pathshala_join'
  AND "deleted_at" IS NULL;
