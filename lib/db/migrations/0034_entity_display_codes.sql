-- Persona / Pathshala human-readable ID standardization.
-- Student codes are city-scoped and permanent (MUM-STU-00042).
-- Pathshala codes are CITY-LOCALITY (MUM-GHK).
-- Staff SHK/SAN are Pathshala-scoped; parents/CAD city-scoped; SAD state-scoped.
-- MSV membership: MSV00001 (global).

ALTER TABLE centres ADD COLUMN IF NOT EXISTS code varchar(16);

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_code varchar(32);

ALTER TABLE students ALTER COLUMN student_code TYPE varchar(32);
ALTER TABLE students ADD COLUMN IF NOT EXISTS msv_code varchar(16);

CREATE TABLE IF NOT EXISTS entity_code_counters (
  series text NOT NULL,
  scope_key text NOT NULL,
  last_no integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series, scope_key)
);

-- Seed Pathshala codes for known centres (idempotent by name match).
UPDATE centres c
SET code = v.code
FROM (VALUES
  ('Ghatkopar Jain Pathshala', 'MUM-GHK'),
  ('Kothrud Jain Pathshala', 'PUN-KOT'),
  ('Maninagar Jain Pathshala', 'AMD-MAN'),
  ('Indore Jain Pathshala', 'IDR-SAP'),
  ('Race Course Centre', 'IDR-RCR'),
  ('Vijay Nagar Pathshala', 'IDR-VIJ'),
  ('Palasia Pathshala', 'IDR-PAL'),
  ('Bhawarkua Pathshala', 'IDR-BHA')
) AS v(name, code)
WHERE c.name = v.name AND c.code IS NULL;

-- Any remaining centres: derive CITY + first 3 letters of locality/name.
UPDATE centres c
SET code = upper(ci.code) || '-' || left(regexp_replace(
  upper(coalesce(nullif(trim(c.locality), ''), c.name)),
  '[^A-Z]', '', 'g'
), 3)
FROM cities ci
WHERE c.city_id = ci.id
  AND c.code IS NULL
  AND c.deleted_at IS NULL;

-- Resolve rare collisions by appending a short hash of id.
UPDATE centres c
SET code = c.code || upper(substr(replace(c.id::text, '-', ''), 1, 2))
WHERE c.id IN (
  SELECT id FROM (
    SELECT id, code, row_number() OVER (PARTITION BY code ORDER BY created_at) AS rn
    FROM centres
    WHERE code IS NOT NULL AND deleted_at IS NULL
  ) d WHERE rn > 1
);

-- Backfill students: {CITY}-STU-{#####} ordered by created_at within city.
UPDATE students s
SET student_code = r.city_code || '-STU-' || lpad(r.rn::text, 5, '0')
FROM (
  SELECT
    s.id,
    upper(coalesce(ci.code, 'XXX')) AS city_code,
    row_number() OVER (
      PARTITION BY upper(coalesce(ci.code, 'XXX'))
      ORDER BY s.created_at ASC, s.id ASC
    ) AS rn
  FROM students s
  LEFT JOIN centres c ON c.id = s.centre_id
  LEFT JOIN cities ci ON ci.id = c.city_id
) r
WHERE s.id = r.id;

-- Parents: {CITY}-PAR-{#####}
WITH ranked AS (
  SELECT
    u.id,
    upper(coalesce(ci.code, st.code, 'XXX')) AS scope_code,
    row_number() OVER (
      PARTITION BY upper(coalesce(ci.code, st.code, 'XXX'))
      ORDER BY u.created_at ASC, u.id ASC
    ) AS rn
  FROM users u
  LEFT JOIN cities ci ON ci.id = u.city_id
  LEFT JOIN states st ON st.id = u.state_id
  WHERE u.role = 'parent' AND u.deleted_at IS NULL
)
UPDATE users u
SET display_code = r.scope_code || '-PAR-' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE u.id = r.id;

-- City admins
WITH ranked AS (
  SELECT
    u.id,
    upper(coalesce(ci.code, 'XXX')) AS city_code,
    row_number() OVER (
      PARTITION BY upper(coalesce(ci.code, 'XXX'))
      ORDER BY u.created_at ASC, u.id ASC
    ) AS rn
  FROM users u
  LEFT JOIN cities ci ON ci.id = u.city_id
  WHERE u.role = 'city_admin' AND u.deleted_at IS NULL
)
UPDATE users u
SET display_code = r.city_code || '-CAD-' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE u.id = r.id;

-- State admins
WITH ranked AS (
  SELECT
    u.id,
    upper(coalesce(st.code, 'XX')) AS state_code,
    row_number() OVER (
      PARTITION BY upper(coalesce(st.code, 'XX'))
      ORDER BY u.created_at ASC, u.id ASC
    ) AS rn
  FROM users u
  LEFT JOIN states st ON st.id = u.state_id
  WHERE u.role = 'state_admin' AND u.deleted_at IS NULL
)
UPDATE users u
SET display_code = r.state_code || '-SAD-' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE u.id = r.id;

-- Shikshak: {PATHSHALA}-SHK-{#####} using default centre or first centre assignment
WITH shikshak_centre AS (
  SELECT DISTINCT ON (u.id)
    u.id AS user_id,
    coalesce(c_def.code, c_asg.code, 'XXX-XXX') AS pathshala_code
  FROM users u
  LEFT JOIN centres c_def ON c_def.id = u.centre_id_default
  LEFT JOIN shikshak_centre_assignments sca
    ON sca.user_id = u.id AND sca.is_active = true
  LEFT JOIN centres c_asg ON c_asg.id = sca.centre_id
  WHERE u.role = 'shikshak' AND u.deleted_at IS NULL
  ORDER BY u.id, sca.created_at ASC NULLS LAST
),
ranked AS (
  SELECT
    user_id,
    pathshala_code,
    row_number() OVER (
      PARTITION BY pathshala_code
      ORDER BY user_id
    ) AS rn
  FROM shikshak_centre
)
UPDATE users u
SET display_code = r.pathshala_code || '-SHK-' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE u.id = r.user_id;

-- Sanchalak: {PATHSHALA}-SAN-{#####}
WITH sanchalak_centre AS (
  SELECT DISTINCT ON (u.id)
    u.id AS user_id,
    coalesce(c_def.code, c_asg.code, 'XXX-XXX') AS pathshala_code
  FROM users u
  LEFT JOIN centres c_def ON c_def.id = u.centre_id_default
  LEFT JOIN sanchalak_centre_assignments sca
    ON sca.user_id = u.id AND sca.is_active = true
  LEFT JOIN centres c_asg ON c_asg.id = sca.centre_id
  WHERE u.role = 'sanchalak' AND u.deleted_at IS NULL
  ORDER BY u.id, sca.created_at ASC NULLS LAST
),
ranked AS (
  SELECT
    user_id,
    pathshala_code,
    row_number() OVER (
      PARTITION BY pathshala_code
      ORDER BY user_id
    ) AS rn
  FROM sanchalak_centre
)
UPDATE users u
SET display_code = r.pathshala_code || '-SAN-' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE u.id = r.user_id;

-- MSV codes for approved students
WITH ranked AS (
  SELECT
    s.id,
    row_number() OVER (ORDER BY s.created_at ASC, s.id ASC) AS rn
  FROM students s
  WHERE s.msv_status = 'approved' AND s.deleted_at IS NULL
)
UPDATE students s
SET msv_code = 'MSV' || lpad(r.rn::text, 5, '0')
FROM ranked r
WHERE s.id = r.id AND s.msv_code IS NULL;

-- Align ID card numbers with new student codes (and MSV code when present).
UPDATE digital_id_cards d
SET card_number = coalesce(s.msv_code, s.student_code)
FROM students s
WHERE d.student_id = s.id;

-- Seed counters from max allocated numbers so future inserts continue the series.
INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT 'STU', upper(split_part(student_code, '-', 1)), max(split_part(student_code, '-', 3)::int)
FROM students
WHERE student_code ~ '^[A-Z]+-STU-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT 'PAR', upper(split_part(display_code, '-', 1)), max(split_part(display_code, '-', 3)::int)
FROM users
WHERE role = 'parent' AND display_code ~ '^[A-Z]+-PAR-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT 'CAD', upper(split_part(display_code, '-', 1)), max(split_part(display_code, '-', 3)::int)
FROM users
WHERE role = 'city_admin' AND display_code ~ '^[A-Z]+-CAD-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT 'SAD', upper(split_part(display_code, '-', 1)), max(split_part(display_code, '-', 3)::int)
FROM users
WHERE role = 'state_admin' AND display_code ~ '^[A-Z]+-SAD-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

-- SHK/SAN: scope is CITY-LOC (two parts before series)
INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT
  'SHK',
  upper(split_part(display_code, '-', 1) || '-' || split_part(display_code, '-', 2)),
  max(split_part(display_code, '-', 4)::int)
FROM users
WHERE role = 'shikshak' AND display_code ~ '^[A-Z]+-[A-Z0-9]+-SHK-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT
  'SAN',
  upper(split_part(display_code, '-', 1) || '-' || split_part(display_code, '-', 2)),
  max(split_part(display_code, '-', 4)::int)
FROM users
WHERE role = 'sanchalak' AND display_code ~ '^[A-Z]+-[A-Z0-9]+-SAN-[0-9]+$'
GROUP BY 1, 2
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

INSERT INTO entity_code_counters (series, scope_key, last_no)
SELECT 'MSV', 'GLOBAL', coalesce(max(substring(msv_code from 4)::int), 0)
FROM students
WHERE msv_code ~ '^MSV[0-9]+$'
ON CONFLICT (series, scope_key) DO UPDATE
  SET last_no = GREATEST(entity_code_counters.last_no, EXCLUDED.last_no);

CREATE UNIQUE INDEX IF NOT EXISTS centres_code_uq ON centres (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_display_code_uq ON users (display_code) WHERE display_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS students_student_code_uq ON students (student_code);
CREATE UNIQUE INDEX IF NOT EXISTS students_msv_code_uq ON students (msv_code) WHERE msv_code IS NOT NULL;
