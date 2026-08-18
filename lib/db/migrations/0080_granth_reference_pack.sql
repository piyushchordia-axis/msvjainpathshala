-- Reference Granth pack so the section is visible without a publish round-trip.
--
-- 0074 added the enum; seed inserted an unpublished `key='granth'` row with no
-- items. Readers therefore never saw it. This backfills a published section,
-- two online items, and one physical library with "reference only" holdings
-- when those rows are still missing. Existing admin-authored rows are left
-- alone (NOT EXISTS on item_code / live libraries).

/* ── section ─────────────────────────────────────────────────────────────── */

WITH next_order AS (
  SELECT COALESCE(MAX("order_index") + 1, 0) AS n
    FROM "library_sections"
   WHERE "deleted_at" IS NULL
)
INSERT INTO "library_sections" (
  "key",
  "name_en",
  "name_hi",
  "name_gu",
  "order_index",
  "type",
  "requires_login",
  "draft_name_en",
  "draft_name_hi",
  "draft_name_gu",
  "draft_type",
  "draft_requires_login",
  "draft_order_index",
  "is_published",
  "content_version"
)
SELECT
  'granth',
  'Granth',
  'ग्रंथ',
  'ગ્રંથ',
  next_order.n,
  'granth',
  false,
  'Granth',
  'ग्रंथ',
  'ગ્રંથ',
  'granth',
  false,
  next_order.n,
  true,
  1
FROM next_order
WHERE NOT EXISTS (
  SELECT 1 FROM "library_sections" WHERE "key" = 'granth'
);--> statement-breakpoint

UPDATE "library_sections"
   SET "deleted_at" = NULL,
       "is_published" = true,
       "type" = 'granth',
       "draft_type" = 'granth',
       "requires_login" = false,
       "draft_requires_login" = false,
       "name_en" = COALESCE(NULLIF("name_en", ''), 'Granth'),
       "name_hi" = COALESCE("name_hi", 'ग्रंथ'),
       "name_gu" = COALESCE("name_gu", 'ગ્રંથ'),
       "draft_name_en" = COALESCE(NULLIF("draft_name_en", ''), 'Granth'),
       "draft_name_hi" = COALESCE("draft_name_hi", 'ग्रंथ'),
       "draft_name_gu" = COALESCE("draft_name_gu", 'ગ્રંથ'),
       "updated_at" = now()
 WHERE "key" = 'granth';--> statement-breakpoint

/* ── subsection ──────────────────────────────────────────────────────────── */

INSERT INTO "library_subsections" (
  "section_id",
  "name_en",
  "name_hi",
  "name_gu",
  "order_index",
  "draft_name_en",
  "draft_name_hi",
  "draft_name_gu",
  "draft_order_index",
  "is_published",
  "content_version"
)
SELECT
  s."id",
  'Agama & Shastra',
  'आगम एवं शास्त्र',
  'આગમ અને શાસ્ત્ર',
  0,
  'Agama & Shastra',
  'आगम एवं शास्त्र',
  'આગમ અને શાસ્ત્ર',
  0,
  true,
  1
FROM "library_sections" s
WHERE s."key" = 'granth'
  AND s."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1
      FROM "library_subsections" sub
     WHERE sub."section_id" = s."id"
       AND sub."deleted_at" IS NULL
  );--> statement-breakpoint

/* ── online items ────────────────────────────────────────────────────────── */

INSERT INTO "library_items" (
  "section_id",
  "subsection_id",
  "item_code",
  "title_en",
  "title_hi",
  "title_gu",
  "order_index",
  "text_content_en",
  "text_content_hi",
  "draft_title_en",
  "draft_title_hi",
  "draft_title_gu",
  "draft_order_index",
  "draft_text_content_en",
  "draft_text_content_hi",
  "is_published",
  "content_version"
)
SELECT
  s."id",
  sub."id",
  'tattvartha-sutra',
  'Tattvartha Sutra',
  'तत्त्वार्थ सूत्र',
  'તત્ત્વાર્થ સૂત્ર',
  0,
  '<p>Umasvati''s Tattvartha Sutra is the reference treatise of Jain philosophy — the seven tattvas, the path of samyak darshan, jnana and charitra. This sample is a short public-domain introduction so the Online Granth tab has something to open.</p>',
  '<p>उमास्वाति का तत्त्वार्थ सूत्र जैन दर्शन का संदर्भ ग्रंथ है — सात तत्त्व, सम्यक् दर्शन, ज्ञान और चारित्र का मार्ग। यह नमूना एक संक्षिप्त परिचय है ताकि ऑनलाइन ग्रंथ टैब खुल सके।</p>',
  'Tattvartha Sutra',
  'तत्त्वार्थ सूत्र',
  'તત્ત્વાર્થ સૂત્ર',
  0,
  '<p>Umasvati''s Tattvartha Sutra is the reference treatise of Jain philosophy — the seven tattvas, the path of samyak darshan, jnana and charitra. This sample is a short public-domain introduction so the Online Granth tab has something to open.</p>',
  '<p>उमास्वाति का तत्त्वार्थ सूत्र जैन दर्शन का संदर्भ ग्रंथ है — सात तत्त्व, सम्यक् दर्शन, ज्ञान और चारित्र का मार्ग। यह नमूना एक संक्षिप्त परिचय है ताकि ऑनलाइन ग्रंथ टैब खुल सके।</p>',
  true,
  1
FROM "library_sections" s
JOIN "library_subsections" sub
  ON sub."section_id" = s."id"
 AND sub."deleted_at" IS NULL
WHERE s."key" = 'granth'
  AND s."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "library_items" WHERE "item_code" = 'tattvartha-sutra'
  )
ORDER BY sub."order_index"
LIMIT 1;--> statement-breakpoint

INSERT INTO "library_items" (
  "section_id",
  "subsection_id",
  "item_code",
  "title_en",
  "title_hi",
  "title_gu",
  "order_index",
  "text_content_en",
  "text_content_hi",
  "draft_title_en",
  "draft_title_hi",
  "draft_title_gu",
  "draft_order_index",
  "draft_text_content_en",
  "draft_text_content_hi",
  "is_published",
  "content_version"
)
SELECT
  s."id",
  sub."id",
  'kalpasutra',
  'Kalpasutra',
  'कल्पसूत्र',
  'કલ્પસૂત્ર',
  1,
  '<p>The Kalpasutra records the lives of the Tirthankars, with Bhagwan Mahavir''s life at its centre, and is recited during Paryushan. This sample is a short public-domain introduction for the Online Granth tab.</p>',
  '<p>कल्पसूत्र Tirthankar के जीवन का वर्णन है, जिसके केंद्र में भगवान महावीर हैं, और पर्युषण में इसका पाठ होता है। यह नमूना ऑनलाइन ग्रंथ टैब के लिए एक संक्षिप्त परिचय है।</p>',
  'Kalpasutra',
  'कल्पसूत्र',
  'કલ્પસૂત્ર',
  1,
  '<p>The Kalpasutra records the lives of the Tirthankars, with Bhagwan Mahavir''s life at its centre, and is recited during Paryushan. This sample is a short public-domain introduction for the Online Granth tab.</p>',
  '<p>कल्पसूत्र Tirthankar के जीवन का वर्णन है, जिसके केंद्र में भगवान महावीर हैं, और पर्युषण में इसका पाठ होता है। यह नमूना ऑनलाइन ग्रंथ टैब के लिए एक संक्षिप्त परिचय है।</p>',
  true,
  1
FROM "library_sections" s
JOIN "library_subsections" sub
  ON sub."section_id" = s."id"
 AND sub."deleted_at" IS NULL
WHERE s."key" = 'granth'
  AND s."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "library_items" WHERE "item_code" = 'kalpasutra'
  )
ORDER BY sub."order_index"
LIMIT 1;--> statement-breakpoint

/* ── physical directory ──────────────────────────────────────────────────── */

INSERT INTO "granth_libraries" (
  "name_en",
  "name_hi",
  "address_en",
  "address_hi",
  "city_id",
  "contact_name",
  "contact_phone",
  "has_whatsapp",
  "timings_en",
  "timings_hi",
  "lat",
  "lng",
  "note_en",
  "note_hi",
  "order",
  "draft_name_en",
  "draft_name_hi",
  "draft_address_en",
  "draft_address_hi",
  "draft_city_id",
  "draft_contact_name",
  "draft_contact_phone",
  "draft_has_whatsapp",
  "draft_timings_en",
  "draft_timings_hi",
  "draft_lat",
  "draft_lng",
  "draft_note_en",
  "draft_note_hi",
  "draft_order",
  "is_published",
  "content_version"
)
SELECT
  'MSV Granth Bhandar',
  'एमएसवी ग्रंथ भंडार',
  'Ghatkopar Upashray, Mumbai',
  'घाटकोपर उपाश्रय, मुंबई',
  c."id",
  'Sanchalak',
  '+912225001234',
  true,
  'Daily 8:00–12:00 and 16:00–19:00',
  'प्रतिदिन 8:00–12:00 और 16:00–19:00',
  19.0861000,
  72.9081000,
  'Reference copies may be read on site.',
  'संदर्भ प्रतियाँ स्थल पर पढ़ी जा सकती हैं।',
  0,
  'MSV Granth Bhandar',
  'एमएसवी ग्रंथ भंडार',
  'Ghatkopar Upashray, Mumbai',
  'घाटकोपर उपाश्रय, मुंबई',
  c."id",
  'Sanchalak',
  '+912225001234',
  true,
  'Daily 8:00–12:00 and 16:00–19:00',
  'प्रतिदिन 8:00–12:00 और 16:00–19:00',
  19.0861000,
  72.9081000,
  'Reference copies may be read on site.',
  'संदर्भ प्रतियाँ स्थल पर पढ़ी जा सकती हैं।',
  0,
  true,
  1
FROM (
  SELECT "id"
    FROM "cities"
   ORDER BY CASE WHEN "slug" = 'mumbai' THEN 0 ELSE 1 END, "name"
   LIMIT 1
) c
WHERE NOT EXISTS (
  SELECT 1 FROM "granth_libraries" WHERE "deleted_at" IS NULL
);--> statement-breakpoint

INSERT INTO "granth_entries" (
  "title_en",
  "title_hi",
  "author_en",
  "author_hi",
  "language",
  "description_en",
  "description_hi",
  "linked_item_id",
  "order",
  "draft_title_en",
  "draft_title_hi",
  "draft_author_en",
  "draft_author_hi",
  "draft_language",
  "draft_description_en",
  "draft_description_hi",
  "draft_linked_item_id",
  "draft_order",
  "is_published",
  "content_version"
)
SELECT
  'Tattvartha Sutra',
  'तत्त्वार्थ सूत्र',
  'Umasvati',
  'उमास्वाति',
  'Sanskrit',
  'Foundational Jain treatise on the seven tattvas.',
  'सात तत्त्वों पर जैन दर्शन का मूल ग्रंथ।',
  i."id",
  0,
  'Tattvartha Sutra',
  'तत्त्वार्थ सूत्र',
  'Umasvati',
  'उमास्वाति',
  'Sanskrit',
  'Foundational Jain treatise on the seven tattvas.',
  'सात तत्त्वों पर जैन दर्शन का मूल ग्रंथ।',
  i."id",
  0,
  true,
  1
FROM "library_items" i
WHERE i."item_code" = 'tattvartha-sutra'
  AND i."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "granth_entries" e
     WHERE e."deleted_at" IS NULL
       AND e."title_en" = 'Tattvartha Sutra'
  )
LIMIT 1;--> statement-breakpoint

INSERT INTO "granth_entries" (
  "title_en",
  "title_hi",
  "author_en",
  "author_hi",
  "language",
  "description_en",
  "description_hi",
  "linked_item_id",
  "order",
  "draft_title_en",
  "draft_title_hi",
  "draft_author_en",
  "draft_author_hi",
  "draft_language",
  "draft_description_en",
  "draft_description_hi",
  "draft_linked_item_id",
  "draft_order",
  "is_published",
  "content_version"
)
SELECT
  'Kalpasutra',
  'कल्पसूत्र',
  'Bhadrabahu',
  'भद्रबाहु',
  'Prakrit',
  'Lives of the Tirthankars, recited during Paryushan.',
  'Tirthankar के जीवन, पर्युषण में पाठ।',
  i."id",
  1,
  'Kalpasutra',
  'कल्पसूत्र',
  'Bhadrabahu',
  'भद्रबाहु',
  'Prakrit',
  'Lives of the Tirthankars, recited during Paryushan.',
  'Tirthankar के जीवन, पर्युषण में पाठ।',
  i."id",
  1,
  true,
  1
FROM "library_items" i
WHERE i."item_code" = 'kalpasutra'
  AND i."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "granth_entries" e
     WHERE e."deleted_at" IS NULL
       AND e."title_en" = 'Kalpasutra'
  )
LIMIT 1;--> statement-breakpoint

INSERT INTO "granth_availability" ("granth_id", "library_id", "note")
SELECT e."id", l."id", 'reference only, not for issue'
  FROM "granth_entries" e
  JOIN "granth_libraries" l
    ON l."deleted_at" IS NULL
   AND l."name_en" = 'MSV Granth Bhandar'
 WHERE e."deleted_at" IS NULL
   AND e."title_en" IN ('Tattvartha Sutra', 'Kalpasutra')
   AND NOT EXISTS (
     SELECT 1
       FROM "granth_availability" a
      WHERE a."granth_id" = e."id"
        AND a."library_id" = l."id"
   );
