-- Library: guest courses, hide Join Pathshala tile, split Stavan subsections.

UPDATE "library_sections"
SET
  "requires_login" = false,
  "draft_requires_login" = false,
  "content_version" = "content_version" + 1,
  "updated_at" = now()
WHERE "key" = 'courses'
  AND "deleted_at" IS NULL;--> statement-breakpoint

UPDATE "library_sections"
SET
  "is_published" = false,
  "content_version" = "content_version" + 1,
  "updated_at" = now()
WHERE "key" = 'pathshala_join'
  AND "deleted_at" IS NULL;--> statement-breakpoint

DO $$
DECLARE
  sid uuid;
  daily_id uuid;
  bhak_id uuid;
  ist_id uuid;
BEGIN
  SELECT id INTO sid
  FROM library_sections
  WHERE key = 'stavan_bhakti' AND deleted_at IS NULL
  LIMIT 1;
  IF sid IS NULL THEN
    RETURN;
  END IF;

  UPDATE library_subsections
  SET order_index = 2, draft_order_index = 2, updated_at = now()
  WHERE section_id = sid
    AND name_en = 'Daily stavans'
    AND deleted_at IS NULL
    AND order_index <> 2;

  SELECT id INTO daily_id
  FROM library_subsections
  WHERE section_id = sid AND name_en = 'Daily stavans' AND deleted_at IS NULL
  LIMIT 1;

  SELECT id INTO bhak_id
  FROM library_subsections
  WHERE section_id = sid AND name_en = 'Bhaktamar Stotra' AND deleted_at IS NULL
  LIMIT 1;
  IF bhak_id IS NULL THEN
    INSERT INTO library_subsections (
      section_id, name_en, name_hi, name_gu, order_index,
      draft_name_en, draft_name_hi, draft_name_gu, draft_order_index,
      is_published, content_version
    ) VALUES (
      sid, 'Bhaktamar Stotra', 'भक्तामर स्तोत्र', 'ભક્તામર સ્તોત્ર', 0,
      'Bhaktamar Stotra', 'भक्तामर स्तोत्र', 'ભક્તામર સ્તોત્ર', 0,
      true, 1
    )
    RETURNING id INTO bhak_id;
  ELSE
    UPDATE library_subsections
    SET order_index = 0, draft_order_index = 0, updated_at = now()
    WHERE id = bhak_id AND order_index <> 0;
  END IF;

  SELECT id INTO ist_id
  FROM library_subsections
  WHERE section_id = sid AND name_en = 'Istavan' AND deleted_at IS NULL
  LIMIT 1;
  IF ist_id IS NULL THEN
    INSERT INTO library_subsections (
      section_id, name_en, name_hi, name_gu, order_index,
      draft_name_en, draft_name_hi, draft_name_gu, draft_order_index,
      is_published, content_version
    ) VALUES (
      sid, 'Istavan', 'इस्तवन', 'ઇસ્તવન', 1,
      'Istavan', 'इस्तवन', 'ઇસ્તવન', 1,
      true, 1
    )
    RETURNING id INTO ist_id;
  ELSE
    UPDATE library_subsections
    SET order_index = 1, draft_order_index = 1, updated_at = now()
    WHERE id = ist_id AND order_index <> 1;
  END IF;

  UPDATE library_items
  SET subsection_id = bhak_id, updated_at = now()
  WHERE section_id = sid
    AND item_code = 'bhaktamar-stotra'
    AND deleted_at IS NULL
    AND bhak_id IS NOT NULL;

  UPDATE library_items
  SET subsection_id = ist_id, updated_at = now()
  WHERE section_id = sid
    AND deleted_at IS NULL
    AND ist_id IS NOT NULL
    AND item_code NOT IN ('navkar-intro', 'stavan-vol-1', 'bhaktamar-stotra');

  UPDATE library_sections
  SET content_version = content_version + 1, updated_at = now()
  WHERE id = sid;
END $$;
