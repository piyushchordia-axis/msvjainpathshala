-- cities.slug — globally unique public route key (Centre Locator / Team).
-- Backfill from name: lowercase, Devanagari→Roman, non-alphanumerics→hyphens.
-- Collisions: first city (by created_at, id) keeps the base slug; others get
-- -<state_code_lower>. Unresolved collisions fail the migration loudly.

ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "slug" varchar(120);

CREATE OR REPLACE FUNCTION jp_city_slug(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  s text := coalesce(input, '');
  out_text text := '';
  i int := 1;
  ch text;
  digraph text;
  mapped text;
  DEV_MAP jsonb := '{
    "क्ष":"ksh","त्र":"tr","ज्ञ":"gy",
    "अ":"a","आ":"aa","इ":"i","ई":"ee","उ":"u","ऊ":"oo","ऋ":"ri",
    "ए":"e","ऐ":"ai","ओ":"o","औ":"au",
    "क":"k","ख":"kh","ग":"g","घ":"gh","ङ":"ng",
    "च":"ch","छ":"chh","ज":"j","झ":"jh","ञ":"ny",
    "ट":"t","ठ":"th","ड":"d","ढ":"dh","ण":"n",
    "त":"t","थ":"th","द":"d","ध":"dh","न":"n",
    "प":"p","फ":"ph","ब":"b","भ":"bh","म":"m",
    "य":"y","र":"r","ल":"l","व":"v",
    "श":"sh","ष":"sh","स":"s","ह":"h",
    "ा":"a","ि":"i","ी":"ee","ु":"u","ू":"oo","ृ":"ri",
    "े":"e","ै":"ai","ो":"o","ौ":"au",
    "ं":"n","ँ":"n","ः":"h","्":"","़":"","ॐ":"om"
  }'::jsonb;
BEGIN
  WHILE i <= char_length(s) LOOP
    -- Conjuncts are 3 Unicode characters (C + virama + C).
    digraph := substring(s FROM i FOR 3);
    mapped := DEV_MAP ->> digraph;
    IF mapped IS NOT NULL THEN
      out_text := out_text || mapped;
      i := i + 3;
      CONTINUE;
    END IF;
    ch := substring(s FROM i FOR 1);
    mapped := DEV_MAP ->> ch;
    IF mapped IS NOT NULL THEN
      out_text := out_text || mapped;
    ELSE
      out_text := out_text || ch;
    END IF;
    i := i + 1;
  END LOOP;

  out_text := lower(out_text);
  out_text := regexp_replace(out_text, '[^a-z0-9]+', '-', 'g');
  out_text := regexp_replace(out_text, '-+', '-', 'g');
  out_text := trim(both '-' from out_text);
  IF char_length(out_text) > 120 THEN
    out_text := left(out_text, 120);
    out_text := trim(both '-' from out_text);
  END IF;
  RETURN out_text;
END;
$$;

-- Base slug from name (empty → placeholder so NOT NULL can be applied; empty
-- after slugify is treated as a data error at the uniqueness / fail step).
UPDATE "cities" c
SET "slug" = nullif(jp_city_slug(c."name"), '')
WHERE c."slug" IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "cities" WHERE "slug" IS NULL OR "slug" = '') THEN
    RAISE EXCEPTION
      'cities.slug backfill failed: one or more city names produced an empty slug — rename those cities before migrating';
  END IF;
END $$;

-- Resolve base-slug collisions: keep earliest row bare; suffix others with state code.
WITH ranked AS (
  SELECT
    c.id,
    c.slug AS base_slug,
    lower(s.code) AS state_code,
    row_number() OVER (
      PARTITION BY c.slug
      ORDER BY c.created_at ASC, c.id ASC
    ) AS rn
  FROM "cities" c
  INNER JOIN "states" s ON s.id = c.state_id
  WHERE c.slug IS NOT NULL
)
UPDATE "cities" c
SET "slug" = ranked.base_slug || '-' || ranked.state_code
FROM ranked
WHERE c.id = ranked.id
  AND ranked.rn > 1;

-- Still colliding after state suffix → refuse (no silent numeric append).
DO $$
DECLARE
  conflict_slugs text;
BEGIN
  SELECT string_agg(slug, ', ' ORDER BY slug)
  INTO conflict_slugs
  FROM (
    SELECT slug
    FROM "cities"
    GROUP BY slug
    HAVING count(*) > 1
  ) d;

  IF conflict_slugs IS NOT NULL THEN
    RAISE EXCEPTION
      'cities.slug backfill failed: unresolved slug collision(s) after state-code suffix: % — resolve manually (do not append numbers)',
      conflict_slugs;
  END IF;
END $$;

ALTER TABLE "cities" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "cities_slug_uq" ON "cities" ("slug");

DROP FUNCTION IF EXISTS jp_city_slug(text);
