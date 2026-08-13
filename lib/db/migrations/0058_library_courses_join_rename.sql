-- Library: rename Join Pathshala + add Courses deeplink section.

UPDATE "library_sections"
SET
  "name_en" = 'Join Pathshala',
  "draft_name_en" = 'Join Pathshala',
  "updated_at" = now()
WHERE "key" = 'pathshala_join'
  AND ("name_en" = 'Join a Pathshala' OR "draft_name_en" = 'Join a Pathshala');--> statement-breakpoint

INSERT INTO "library_sections" (
  "key",
  "name_en",
  "name_hi",
  "name_gu",
  "order_index",
  "type",
  "deeplink_target",
  "requires_login",
  "draft_name_en",
  "draft_name_hi",
  "draft_name_gu",
  "draft_type",
  "draft_deeplink_target",
  "draft_requires_login",
  "draft_order_index",
  "is_published",
  "content_version"
)
SELECT
  'courses',
  'Courses',
  'पाठ्यक्रम',
  'અભ્યાસક્રમ',
  3,
  'deeplink',
  '/courses',
  true,
  'Courses',
  'पाठ्यक्रम',
  'અભ્યાસક્રમ',
  'deeplink',
  '/courses',
  true,
  3,
  true,
  1
WHERE NOT EXISTS (
  SELECT 1 FROM "library_sections" WHERE "key" = 'courses'
);
