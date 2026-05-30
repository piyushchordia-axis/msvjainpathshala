-- =============================================================================
-- Jain Pathshala — rich DEV demo seed (idempotent-ish, dev only).
--
-- Builds on top of the lightweight `pnpm db:seed:dev` (1 state, 1 city,
-- 3 centres, 12 batches). Adds a realistic population so the admin panel
-- and mobile app have something to show:
--
--   • admins        super_admin / state_admin / city_admin
--   • 3 sanchalaks  (one per centre)
--   • 12 shikshaks  (one per batch — alternating Guruji / Didi)
--   • 150 parents   (+9190100xxxxx)
--   • ~250 students (1–2 per parent), spread across centres/batches
--   • enrolments    (mostly approved, some pending / waitlisted)
--   • punya         balances + a few transactions per student
--   • 5 niyams      + ~120 submissions + gallery items (opted-in parents)
--   • notices       a handful, city + centre scope
--   • MSV           a few applications (pending + approved)
--
-- Guard: if the sentinel super_admin (+919000000001) already exists we skip
-- the whole script, so re-running is safe.
--
-- Run:  psql "$DATABASE_URL" -f apps/api/scripts/seed-dev-demo.sql
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_city_id        uuid;
  v_state_id       uuid;
  v_super_id       uuid;
  v_centre_ids     uuid[];
  v_centre_id      uuid;
  v_batch_ids      uuid[];
  v_batch_id       uuid;
  v_sanchalak_id   uuid;
  v_shikshak_id    uuid;
  v_parent_id      uuid;
  v_student_id     uuid;
  v_asset_id       uuid;
  v_niyam_id       uuid;
  v_txn_id         uuid;
  v_sub_id         uuid;
  v_niyam_ids      uuid[] := ARRAY[]::uuid[];
  v_parent_ids     uuid[] := ARRAY[]::uuid[];
  v_shikshak_ids   uuid[] := ARRAY[]::uuid[];
  i                int;
  j                int;
  v_age_group      age_group_enum;
  v_dob            date;
  v_pts            int;
  v_tier           tier_enum;
  v_status         enrolment_status_enum;
  v_msv            msv_status_enum;
  v_kids           int;
  v_seq            int := 0;
BEGIN
  -- ---- Guard --------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM users WHERE phone = '+919000000001') THEN
    RAISE NOTICE '[demo-seed] sentinel exists — skipping (already seeded).';
    RETURN;
  END IF;

  SELECT id INTO v_city_id FROM cities WHERE name = 'Ahmedabad' LIMIT 1;
  SELECT state_id INTO v_state_id FROM cities WHERE id = v_city_id;
  IF v_city_id IS NULL THEN
    RAISE EXCEPTION '[demo-seed] base seed missing — run `pnpm db:seed:dev` first.';
  END IF;

  SELECT array_agg(id ORDER BY name) INTO v_centre_ids FROM centres WHERE city_id = v_city_id AND deleted_at IS NULL;

  -- ---- Admins -------------------------------------------------------------
  INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id, is_active)
  VALUES ('+919000000001', 'super_admin', 'Super Admin', 'male', 'en', v_state_id, v_city_id, true)
  RETURNING id INTO v_super_id;

  INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id, is_active)
  VALUES ('+919000000002', 'state_admin', 'Gujarat State Admin', 'male', 'en', v_state_id, v_city_id, true);

  INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id, is_active)
  VALUES ('+919000000003', 'city_admin', 'Ahmedabad City Admin', 'female', 'en', v_state_id, v_city_id, true);

  -- ---- Sanchalaks (one per centre) ----------------------------------------
  i := 0;
  FOREACH v_centre_id IN ARRAY v_centre_ids LOOP
    i := i + 1;
    INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id, centre_id_default, is_active)
    VALUES ('+91900100' || lpad(i::text, 4, '0'), 'sanchalak', format('Sanchalak %s', i),
            CASE WHEN i % 2 = 0 THEN 'female' ELSE 'male' END::gender_enum, 'en', v_state_id, v_city_id, v_centre_id, true)
    RETURNING id INTO v_sanchalak_id;

    INSERT INTO sanchalak_centre_assignments (sanchalak_user_id, centre_id, assigned_at)
    VALUES (v_sanchalak_id, v_centre_id, now())
    ON CONFLICT DO NOTHING;
  END LOOP;

  -- ---- Shikshaks (one per batch) ------------------------------------------
  i := 0;
  FOR v_batch_id, v_centre_id IN SELECT b.id, b.centre_id FROM batches b
      JOIN centres c ON c.id = b.centre_id WHERE c.city_id = v_city_id AND b.deleted_at IS NULL ORDER BY b.centre_id, b.name LOOP
    i := i + 1;
    INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id, centre_id_default, is_active)
    VALUES ('+91900200' || lpad(i::text, 4, '0'), 'shikshak',
            CASE WHEN i % 2 = 0 THEN format('Didi %s', i) ELSE format('Guruji %s', i) END,
            CASE WHEN i % 2 = 0 THEN 'female' ELSE 'male' END::gender_enum, 'en', v_state_id, v_city_id, v_centre_id, true)
    RETURNING id INTO v_shikshak_id;
    v_shikshak_ids := array_append(v_shikshak_ids, v_shikshak_id);

    -- Assign this shikshak to the batch.
    UPDATE batches SET shikshak_id = v_shikshak_id WHERE id = v_batch_id;
  END LOOP;

  -- ---- Niyams (city-wide) -------------------------------------------------
  FOR i IN 1..5 LOOP
    INSERT INTO niyams (title_en, title_hi, description_en, description_hi, type, start_date,
                        audience_kind, proof_type, points_value, created_by_user_id, city_id, msv_only)
    VALUES (
      (ARRAY['Samayik daily','Navkar 108 times','No green vegetables','Pratikraman','Daan seva'])[i],
      (ARRAY['सामायिक','नवकार १०८ बार','हरी सब्ज़ी त्याग','प्रतिक्रमण','दान सेवा'])[i],
      'Complete the niyam and submit a photo as proof.',
      'नियम पूर्ण करें और प्रमाण के रूप में फ़ोटो भेजें।',
      (ARRAY['daily','daily','weekly','weekly','monthly'])[i]::niyam_type_enum,
      CURRENT_DATE - 30,
      'all',
      'photo',
      (ARRAY[10,15,20,25,30])[i],
      v_super_id, v_city_id, false)
    RETURNING id INTO v_niyam_id;
    v_niyam_ids := array_append(v_niyam_ids, v_niyam_id);
  END LOOP;

  -- ---- Parents + Students + downstream ------------------------------------
  FOR i IN 1..150 LOOP
    INSERT INTO users (phone, role, full_name, gender, preferred_language, state_id, city_id,
                       gallery_visibility_opt_in, is_active)
    VALUES ('+91901' || lpad(i::text, 7, '0'), 'parent', format('Parent %s', i),
            CASE WHEN i % 2 = 0 THEN 'female' ELSE 'male' END::gender_enum, 'en', v_state_id, v_city_id,
            (i % 3 <> 0), true)   -- ~2/3 opt in to gallery
    RETURNING id INTO v_parent_id;
    v_parent_ids := array_append(v_parent_ids, v_parent_id);

    v_kids := 1 + (i % 2);  -- 1 or 2 kids
    FOR j IN 1..v_kids LOOP
      v_seq := v_seq + 1;
      -- Pick a centre + batch deterministically.
      v_centre_id := v_centre_ids[1 + (v_seq % array_length(v_centre_ids, 1))];
      SELECT id, age_group INTO v_batch_id, v_age_group FROM batches
        WHERE centre_id = v_centre_id AND deleted_at IS NULL ORDER BY name OFFSET (v_seq % 4) LIMIT 1;

      v_dob := CASE v_age_group
                 WHEN 'bal'    THEN CURRENT_DATE - (8*365 + (v_seq % 365))
                 WHEN 'kishor' THEN CURRENT_DATE - (12*365 + (v_seq % 365))
                 WHEN 'tarun'  THEN CURRENT_DATE - (15*365 + (v_seq % 365))
                 ELSE               CURRENT_DATE - (18*365 + (v_seq % 365))
               END;

      v_msv := CASE WHEN v_seq % 11 = 0 THEN 'approved' ELSE 'none' END::msv_status_enum;

      INSERT INTO students (parent_user_id, full_name, father_name, dob, age_group, centre_id, batch_id,
                            student_code, msv_status, status, enrolled_at, created_by)
      VALUES (v_parent_id, format('Student %s', v_seq), format('Parent %s', i), v_dob, v_age_group,
              v_centre_id, v_batch_id, 'STU-DEMO-' || lpad(v_seq::text, 5, '0'), v_msv,
              CASE WHEN v_seq % 23 = 0 THEN 'inactive' ELSE 'active' END::student_status_enum,
              now() - (v_seq % 200) * interval '1 day', v_super_id)
      RETURNING id INTO v_student_id;

      -- Enrolment record (status mix).
      v_status := (ARRAY['approved','approved','approved','pending','waitlisted'])[1 + (v_seq % 5)]::enrolment_status_enum;
      INSERT INTO enrolments (student_id, parent_user_id, requested_centre_id, requested_batch_id, status,
                              reviewer_user_id, decided_at)
      VALUES (v_student_id, v_parent_id, v_centre_id, v_batch_id, v_status,
              CASE WHEN v_status IN ('approved','rejected','waitlisted') THEN v_super_id END,
              CASE WHEN v_status IN ('approved','rejected','waitlisted') THEN now() - (v_seq % 50) * interval '1 day' END);

      -- Punya balance + tier.
      v_pts := (v_seq * 37) % 6000;
      v_tier := CASE
                  WHEN v_pts > 5000 THEN 'tirthankar'
                  WHEN v_pts > 1500 THEN 'shraman'
                  WHEN v_pts > 500  THEN 'sadhak'
                  WHEN v_pts > 100  THEN 'shravak'
                  ELSE 'jigyasu' END::tier_enum;
      INSERT INTO punya_balances (student_id, total_points, msv_points, current_tier, tier_reached_at)
      VALUES (v_student_id, v_pts, CASE WHEN v_msv = 'approved' THEN v_pts / 2 ELSE 0 END, v_tier, now())
      ON CONFLICT (student_id) DO NOTHING;

      -- A couple of punya transactions.
      INSERT INTO punya_transactions (student_id, feature_key, points, reason, awarded_by_user_id,
                                      source_entity_kind, source_entity_id, awarded_at, city_id, centre_id,
                                      batch_id, idempotency_key)
      VALUES (v_student_id, 'attendance_present', 10, 'Attended class', v_super_id,
              'attendance', gen_random_uuid(), now() - (v_seq % 30) * interval '1 day', v_city_id, v_centre_id,
              v_batch_id, format('demo-att-%s', v_student_id));

      -- Niyam submission for ~half the students → with proof asset + gallery.
      IF v_seq % 2 = 0 THEN
        v_niyam_id := v_niyam_ids[1 + (v_seq % 5)];

        INSERT INTO media_assets (kind, owner_user_id, s3_bucket, s3_key, mime_type, size_bytes,
                                  checksum_sha256, status, exif_stripped)
        VALUES ('niyam_proof', v_parent_id, 'jp-dev-media-private',
                format('niyam-proofs/demo-%s.jpg', v_seq), 'image/jpeg', 204800,
                md5(v_student_id::text), 'ready', true)
        RETURNING id INTO v_asset_id;

        INSERT INTO punya_transactions (student_id, feature_key, points, reason, awarded_by_user_id,
                                        source_entity_kind, source_entity_id, awarded_at, city_id, centre_id,
                                        batch_id, idempotency_key)
        VALUES (v_student_id, 'niyam_completion', 15, 'Niyam completed', NULL,
                'niyam_submission', gen_random_uuid(), now() - (v_seq % 20) * interval '1 day', v_city_id,
                v_centre_id, v_batch_id, format('demo-niyam-%s', v_student_id))
        RETURNING id INTO v_txn_id;

        INSERT INTO niyam_submissions (niyam_id, student_id, parent_user_id, proof_asset_id, status,
                                       punya_transaction_id, submitted_at, submission_date)
        VALUES (v_niyam_id, v_student_id, v_parent_id, v_asset_id, 'auto_approved', v_txn_id,
                now() - (v_seq % 20) * interval '1 day', CURRENT_DATE - (v_seq % 20))
        RETURNING id INTO v_sub_id;

        -- Gallery item only if parent opted in.
        IF (i % 3 <> 0) THEN
          INSERT INTO gallery_items (niyam_submission_id, student_id, centre_id, city_id, niyam_id, asset_id,
                                     is_featured, removed)
          VALUES (v_sub_id, v_student_id, v_centre_id, v_city_id, v_niyam_id, v_asset_id,
                  (v_seq % 17 = 0), false);
        END IF;
      END IF;

      -- MSV application for the approved-MSV students.
      IF v_msv = 'approved' THEN
        INSERT INTO msv_enrolments (student_id, status, reviewer_user_id, decided_at, certificate_year, notes)
        VALUES (v_student_id, 'approved', v_super_id, now() - (v_seq % 60) * interval '1 day',
                EXTRACT(YEAR FROM CURRENT_DATE)::int, 'Strong interest');
      ELSIF v_seq % 13 = 0 THEN
        INSERT INTO msv_enrolments (student_id, status, notes)
        VALUES (v_student_id, 'applied', 'Awaiting review');
      END IF;
    END LOOP;
  END LOOP;

  -- ---- Notices ------------------------------------------------------------
  INSERT INTO notices (scope, city_id, msv_only, content_en, content_hi, pinned, published_at, is_public, created_by_user_id)
  VALUES
    ('city', v_city_id, false, 'Paryushan Mahaparv begins next week — special Pathshala timings.',
     'पर्युषण महापर्व अगले सप्ताह से — विशेष पाठशाला समय।', true, now() - interval '2 day', true, v_super_id),
    ('city', v_city_id, false, 'Annual exam schedule published. Check your batch timetable.',
     'वार्षिक परीक्षा कार्यक्रम प्रकाशित। अपना बैच समय देखें।', false, now() - interval '5 day', true, v_super_id);

  INSERT INTO notices (scope, city_id, centre_id, msv_only, content_en, content_hi, pinned, published_at, is_public, created_by_user_id)
  SELECT 'centre', v_city_id, id, false,
         format('%s: parking changes this Sunday.', name),
         format('%s: रविवार को पार्किंग परिवर्तन।', name),
         false, now() - interval '1 day', false, v_super_id
  FROM centres WHERE city_id = v_city_id AND deleted_at IS NULL;

  RAISE NOTICE '[demo-seed] done — % students across % parents.', v_seq, array_length(v_parent_ids,1);
END
$$;
