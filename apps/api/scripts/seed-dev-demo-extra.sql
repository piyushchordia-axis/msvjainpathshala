-- =============================================================================
-- Jain Pathshala — EXTRA dev demo seed (idempotent, dev only).
--
-- Builds on top of `seed-dev-demo.sql`. That seed created admins, sanchalaks,
-- shikshaks, parents, students, enrolments, punya, niyams + submissions,
-- gallery items, MSV enrolments and notices — but left ~20 UI-backing tables
-- empty. This script fills those so every persona sees real data:
--
--   • shikshak_batch_assignments  (CRITICAL — gives shikshaks their JWT scope)
--   • sessions + attendance       (~10 sessions/batch, attendance per student)
--   • library_items (+ media_assets)
--   • notifications               (a few per parent, some unread)
--   • curricula + sections + items + student_curriculum_progress
--   • homework_assignments        (per batch)
--   • competitions + competition_registrations (with result ranks)
--   • online_exams
--   • donation_campaigns + donations (some 80G-eligible, captured)
--   • niyam_streaks               (for students with niyam submissions)
--   • push_quizzes, shivir_events, service_requests
--   • digital_id_cards, progress_reports
--
-- It ALSO (re)creates the six analytics materialised views the admin
-- dashboard reads from (mv_centre_engagement, mv_punya_distribution,
-- mv_msv_pipeline, mv_attendance_trends, mv_niyam_completion,
-- mv_donations_summary) — these are not produced by the Drizzle migration,
-- so the /v1/admin/analytics/overview endpoint 500s without them — then
-- refreshes them so the overview returns non-zero KPIs.
--
-- Guard: if `sessions` already has rows we skip the data block (re-run safe).
-- The materialised views are always (re)created CONCURRENTLY-friendly so a
-- fresh DB and a re-run both end up consistent.
--
-- Run:  psql "postgres://sumit@localhost:5432/jainpathshala" -f apps/api/scripts/seed-dev-demo-extra.sql
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
DECLARE
  v_city_id        uuid;
  v_state_id       uuid;
  v_super_id       uuid;
  v_city_admin_id  uuid;
  v_centre_ids     uuid[];
  v_centre_id      uuid;
  v_batch_id       uuid;
  v_batch_centre   uuid;
  v_batch_shik     uuid;
  v_batch_age      age_group_enum;
  v_start_t        time;
  v_end_t          time;
  v_session_id     uuid;
  v_student_id     uuid;
  v_parent_id      uuid;
  v_asset_id       uuid;
  v_curr_id        uuid;
  v_sec_id         uuid;
  v_item_id        uuid;
  v_curr_ids       uuid[] := ARRAY[]::uuid[];
  v_item_ids       uuid[] := ARRAY[]::uuid[];
  v_comp_id        uuid;
  v_camp_id        uuid;
  v_niyam_id       uuid;
  i                int;
  j                int;
  k                int;
  d                int;
  v_day            date;
  v_sess_status    session_status_enum;
  v_att_status     attendance_status_enum;
  v_rank           int;
  v_seq            int := 0;
  v_count          int;
  v_lib_type       library_content_type_enum;
  v_lib_tier       library_access_tier_enum;
  v_media_kind     media_kind_enum;
  v_fy             text;
BEGIN
  -- ---- Guard --------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM sessions LIMIT 1) THEN
    RAISE NOTICE '[extra-seed] sessions already present — skipping data block.';
    RETURN;
  END IF;

  SELECT id INTO v_city_id FROM cities WHERE name = 'Ahmedabad' LIMIT 1;
  IF v_city_id IS NULL THEN
    RAISE EXCEPTION '[extra-seed] base seed missing — run seed-dev-demo.sql first.';
  END IF;
  SELECT state_id INTO v_state_id FROM cities WHERE id = v_city_id;
  SELECT id INTO v_super_id      FROM users WHERE phone = '+919000000001';
  SELECT id INTO v_city_admin_id FROM users WHERE phone = '+919000000003';

  SELECT array_agg(id ORDER BY name) INTO v_centre_ids
    FROM centres WHERE city_id = v_city_id AND deleted_at IS NULL;

  v_fy := CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
            THEN EXTRACT(YEAR FROM CURRENT_DATE)::int || '-' || (EXTRACT(YEAR FROM CURRENT_DATE)::int + 1)
            ELSE (EXTRACT(YEAR FROM CURRENT_DATE)::int - 1) || '-' || EXTRACT(YEAR FROM CURRENT_DATE)::int
          END;

  -- =========================================================================
  -- 1. shikshak_batch_assignments  (CRITICAL: gives shikshaks their scope)
  -- =========================================================================
  INSERT INTO shikshak_batch_assignments (shikshak_user_id, batch_id, role_in_batch, assigned_at)
  SELECT b.shikshak_id, b.id, 'primary', now()
    FROM batches b
    JOIN centres c ON c.id = b.centre_id
   WHERE c.city_id = v_city_id AND b.deleted_at IS NULL AND b.shikshak_id IS NOT NULL;

  -- =========================================================================
  -- 2. sessions + attendance  (~10 sessions per batch over last ~30 days)
  -- =========================================================================
  FOR v_batch_id, v_batch_centre, v_batch_shik, v_batch_age, v_start_t, v_end_t IN
      SELECT b.id, b.centre_id, b.shikshak_id, b.age_group, b.start_time, b.end_time
        FROM batches b JOIN centres c ON c.id = b.centre_id
       WHERE c.city_id = v_city_id AND b.deleted_at IS NULL
       ORDER BY b.centre_id, b.name LOOP

    FOR k IN 0..9 LOOP
      -- one session roughly every 3 days going back from today
      v_day := CURRENT_DATE - (k * 3);
      -- future-proofing: k=0 today is completed; nothing scheduled in future here.
      v_sess_status := CASE WHEN k = 0 THEN 'scheduled' ELSE 'completed' END::session_status_enum;

      INSERT INTO sessions (batch_id, scheduled_date, scheduled_start_time, scheduled_end_time,
                            status, shikshak_user_id, check_in_at, check_out_at, duration_minutes)
      VALUES (v_batch_id, v_day, v_start_t, v_end_t, v_sess_status, v_batch_shik,
              CASE WHEN v_sess_status = 'completed' THEN (v_day + v_start_t)::timestamptz END,
              CASE WHEN v_sess_status = 'completed' THEN (v_day + v_end_t)::timestamptz END,
              CASE WHEN v_sess_status = 'completed'
                   THEN EXTRACT(EPOCH FROM (v_end_t - v_start_t))::int / 60 END)
      RETURNING id INTO v_session_id;

      -- attendance only for completed sessions
      IF v_sess_status = 'completed' THEN
        FOR v_student_id IN
            SELECT id FROM students
             WHERE batch_id = v_batch_id AND status = 'active' AND deleted_at IS NULL LOOP
          v_seq := v_seq + 1;
          v_att_status := CASE
                            WHEN v_seq % 10 = 0 THEN 'absent'
                            WHEN v_seq % 10 = 1 THEN 'late'
                            WHEN v_seq % 23 = 0 THEN 'excused'
                            ELSE 'present' END::attendance_status_enum;
          INSERT INTO attendance (session_id, student_id, status, marked_at, marked_by, notes)
          VALUES (v_session_id, v_student_id, v_att_status,
                  (v_day + v_end_t)::timestamptz, v_batch_shik,
                  CASE WHEN v_att_status = 'excused' THEN 'Informed in advance' END)
          ON CONFLICT (session_id, student_id) DO NOTHING;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- 3. media_assets + library_items  (~15 items: pdf/video/audio/image)
  -- =========================================================================
  FOR i IN 1..15 LOOP
    v_lib_type := (ARRAY['pdf','video','audio','image','pdf'])[1 + (i % 5)]::library_content_type_enum;
    v_lib_tier := (ARRAY['public','student','msv','shikshak'])[1 + (i % 4)]::library_access_tier_enum;

    IF v_lib_type = 'video' THEN
      -- embed-only, no media asset (Q7)
      INSERT INTO library_items (content_type, title_en, title_hi, description_en, description_hi,
                                 embed_url, tags, age_groups, languages, access_tier, msv_only,
                                 uploaded_by_user_id, city_id)
      VALUES ('video',
              format('Jain story video %s', i), format('जैन कथा वीडियो %s', i),
              'Animated Jain story for children.', 'बच्चों के लिए जैन कथा।',
              'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              ARRAY['story','video']::text[],
              ARRAY['bal','kishor']::age_group_enum[],
              ARRAY['en','hi']::language_enum[],
              v_lib_tier, (v_lib_tier = 'msv'), v_super_id, v_city_id);
    ELSE
      v_media_kind := CASE v_lib_type
                        WHEN 'pdf'   THEN 'library_pdf'
                        WHEN 'audio' THEN 'library_audio'
                        ELSE 'library_image' END::media_kind_enum;
      INSERT INTO media_assets (kind, owner_user_id, s3_bucket, s3_key, mime_type, size_bytes,
                                checksum_sha256, status, exif_stripped, processed_at)
      VALUES (v_media_kind, v_super_id, 'jp-dev-media-private',
              format('library/demo-%s.%s', i,
                     CASE v_lib_type WHEN 'pdf' THEN 'pdf' WHEN 'audio' THEN 'mp3' ELSE 'jpg' END),
              CASE v_lib_type WHEN 'pdf' THEN 'application/pdf'
                              WHEN 'audio' THEN 'audio/mpeg' ELSE 'image/jpeg' END,
              512000 + i * 1024, md5('library-' || i::text), 'ready', true, now())
      RETURNING id INTO v_asset_id;

      INSERT INTO library_items (content_type, title_en, title_hi, description_en, description_hi,
                                 asset_id, tags, age_groups, languages, access_tier, msv_only,
                                 uploaded_by_user_id, city_id)
      VALUES (v_lib_type,
              format('%s resource %s',
                     initcap(v_lib_type::text), i),
              format('%s संसाधन %s', v_lib_type::text, i),
              'Educational library material.', 'शैक्षिक पुस्तकालय सामग्री।',
              v_asset_id,
              ARRAY['library', v_lib_type::text]::text[],
              ARRAY['bal','kishor','tarun','yuva']::age_group_enum[],
              ARRAY['en','hi']::language_enum[],
              v_lib_tier, (v_lib_tier = 'msv'), v_super_id, v_city_id);
    END IF;
  END LOOP;

  -- =========================================================================
  -- 4. notifications  (2-3 per parent, some unread)
  -- =========================================================================
  FOR v_parent_id IN SELECT id FROM users WHERE role = 'parent' LOOP
    v_seq := v_seq + 1;
    INSERT INTO notifications (user_id, kind, title_en, title_hi, body_en, body_hi,
                               is_read, channel, status, source_entity_kind)
    VALUES
      (v_parent_id, 'attendance_marked',
       'Attendance marked', 'उपस्थिति दर्ज',
       'Your child''s attendance was marked for today''s class.',
       'आज की कक्षा के लिए आपके बच्चे की उपस्थिति दर्ज की गई।',
       (v_seq % 3 <> 0), 'in_app', 'delivered', 'attendance'),
      (v_parent_id, 'niyam_reminder',
       'Niyam reminder', 'नियम स्मरण',
       'Don''t forget to submit today''s niyam proof.',
       'आज के नियम का प्रमाण भेजना न भूलें।',
       (v_seq % 2 = 0), 'push', 'sent', 'niyam'),
      (v_parent_id, 'notice_published',
       'New notice', 'नई सूचना',
       'A new notice was published for your centre.',
       'आपके केंद्र के लिए एक नई सूचना प्रकाशित की गई।',
       false, 'in_app', 'delivered', 'notice');
  END LOOP;

  -- =========================================================================
  -- 5. curricula + sections + items + student_curriculum_progress
  -- =========================================================================
  FOR i IN 1..3 LOOP
    INSERT INTO curricula (city_id, kind, name, academic_year, status, created_by, updated_by)
    VALUES (v_city_id,
            CASE WHEN i = 3 THEN 'msv' ELSE 'standard' END,
            (ARRAY['Foundation Jain studies','Intermediate Jain studies','MSV advanced curriculum'])[i],
            v_fy, 'active', v_super_id, v_super_id)
    RETURNING id INTO v_curr_id;
    v_curr_ids := array_append(v_curr_ids, v_curr_id);

    FOR j IN 1..3 LOOP
      INSERT INTO curriculum_sections (curriculum_id, title_en, title_hi, order_index)
      VALUES (v_curr_id,
              format('Section %s', j), format('खंड %s', j), j)
      RETURNING id INTO v_sec_id;

      FOR k IN 1..3 LOOP
        INSERT INTO curriculum_items (section_id, title_en, title_hi,
                                      description_en, description_hi, order_index)
        VALUES (v_sec_id,
                format('Topic %s.%s', j, k), format('विषय %s.%s', j, k),
                'Learn and recite.', 'सीखें और उच्चारण करें।', k)
        RETURNING id INTO v_item_id;
        v_item_ids := array_append(v_item_ids, v_item_id);
      END LOOP;
    END LOOP;
  END LOOP;

  -- progress rows for a sample of ~60 active students against the items
  v_seq := 0;
  FOR v_student_id IN
      SELECT id FROM students WHERE status = 'active' AND deleted_at IS NULL ORDER BY student_code LIMIT 60 LOOP
    v_seq := v_seq + 1;
    -- give each sampled student progress on 5 items
    FOR k IN 1..5 LOOP
      v_item_id := v_item_ids[1 + ((v_seq * 5 + k) % array_length(v_item_ids, 1))];
      INSERT INTO student_curriculum_progress (student_id, curriculum_item_id, level, updated_by_user_id, note)
      VALUES (v_student_id, v_item_id,
              (ARRAY['not_started','in_progress','completed','mastered'])[1 + ((v_seq + k) % 4)]::curriculum_level_enum,
              v_super_id, NULL)
      ON CONFLICT (student_id, curriculum_item_id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- 6. homework_assignments  (1-2 per batch)
  -- =========================================================================
  FOR v_batch_id IN
      SELECT b.id FROM batches b JOIN centres c ON c.id = b.centre_id
       WHERE c.city_id = v_city_id AND b.deleted_at IS NULL AND b.shikshak_id IS NOT NULL LOOP
    SELECT shikshak_id INTO v_batch_shik FROM batches WHERE id = v_batch_id;
    INSERT INTO homework_assignments (batch_id, title, description, due_date, created_by_user_id, is_msv)
    VALUES
      (v_batch_id, 'Recite Navkar mantra',
       'Practice and recite the Navkar mantra five times, then write its meaning.',
       CURRENT_DATE + 5, v_batch_shik, false),
      (v_batch_id, 'Draw a Tirthankar',
       'Draw any Tirthankar and label the symbols.',
       CURRENT_DATE + 10, v_batch_shik, false);
  END LOOP;

  -- =========================================================================
  -- 7. competitions + registrations (with result ranks)
  -- =========================================================================
  FOR i IN 1..4 LOOP
    INSERT INTO competitions (city_id, name_en, name_hi, description_en, description_hi, category,
                              eligible_age_groups, msv_only, registration_window_start,
                              registration_window_end, event_date, winner_points, participant_points,
                              max_participants, status, results_published_at, created_by, updated_by)
    VALUES (v_city_id,
            (ARRAY['Stuti recitation','Jain quiz','Painting contest','Essay writing'])[i],
            (ARRAY['स्तुति पाठ','जैन प्रश्नोत्तरी','चित्रकला प्रतियोगिता','निबंध लेखन'])[i],
            'City-level competition for Pathshala students.',
            'पाठशाला विद्यार्थियों के लिए नगर-स्तरीय प्रतियोगिता।',
            (ARRAY['recitation','quiz','art','writing'])[i],
            ARRAY['bal','kishor','tarun','yuva']::age_group_enum[],
            false,
            now() - interval '40 day',
            now() - interval '20 day',
            CURRENT_DATE - (i * 7),
            50, 10, 100,
            CASE WHEN i <= 2 THEN 'results_published' ELSE 'closed' END,
            CASE WHEN i <= 2 THEN now() - (i * 7) * interval '1 day' END,
            v_super_id, v_super_id)
    RETURNING id INTO v_comp_id;

    -- register ~12 students per competition; first 3 get ranks for published ones
    v_rank := 0;
    FOR v_student_id IN
        SELECT id FROM students WHERE status = 'active' AND deleted_at IS NULL
         ORDER BY student_code OFFSET (i * 12) LIMIT 12 LOOP
      v_rank := v_rank + 1;
      INSERT INTO competition_registrations (competition_id, student_id, registered_at,
                                             result_rank, result_note)
      VALUES (v_comp_id, v_student_id, now() - interval '25 day',
              CASE WHEN i <= 2 AND v_rank <= 3 THEN v_rank END,
              CASE WHEN i <= 2 AND v_rank <= 3 THEN format('Rank %s', v_rank) END)
      ON CONFLICT (competition_id, student_id) DO NOTHING;
    END LOOP;
  END LOOP;

  -- =========================================================================
  -- 8. online_exams  (~3)
  -- =========================================================================
  FOR i IN 1..3 LOOP
    INSERT INTO online_exams (city_id, title_en, title_hi, description_en, description_hi,
                              target_audience, window_start, window_end, max_attempts,
                              total_marks, pass_mark, completion_points, top_score_points,
                              results_released, show_rank, created_by, updated_by)
    VALUES (v_city_id,
            format('Quarterly Jain studies exam %s', i),
            format('त्रैमासिक जैन अध्ययन परीक्षा %s', i),
            'Online assessment covering recent curriculum.',
            'हाल के पाठ्यक्रम पर ऑनलाइन मूल्यांकन।',
            jsonb_build_object('age_groups', ARRAY['kishor','tarun','yuva']),
            now() - (i * 5) * interval '1 day',
            now() + (10 - i * 3) * interval '1 day',
            1, 50, 20, 20, 30,
            (i = 1), (i = 1),
            v_super_id, v_super_id);
  END LOOP;

  -- =========================================================================
  -- 9. donation_campaigns + donations
  -- =========================================================================
  INSERT INTO donation_campaigns (city_id, name, description, target_amount_paise,
                                   raised_amount_paise, starts_at, ends_at, is_public,
                                   progress_bar_visible)
  VALUES (v_city_id, 'Pathshala building fund',
          'Help us build a new Pathshala hall in Ahmedabad.',
          5000000000, 0, now() - interval '30 day', now() + interval '60 day', true, true)
  RETURNING id INTO v_camp_id;

  INSERT INTO donation_campaigns (city_id, name, description, target_amount_paise,
                                   raised_amount_paise, starts_at, ends_at, is_public,
                                   progress_bar_visible)
  VALUES (v_city_id, 'Annual shivir sponsorship',
          'Sponsor a child''s attendance at the annual shivir.',
          2000000000, 0, now() - interval '15 day', now() + interval '45 day', true, false);

  -- ~22 donations, mostly captured, mix of campaign-linked + general, some 80G
  FOR i IN 1..22 LOOP
    INSERT INTO donations (donor_user_id, donor_name, donor_phone, donor_email, donor_pan,
                           amount_paise, currency, purpose, campaign_id, frequency,
                           razorpay_order_id, razorpay_payment_id, status, payment_captured_at,
                           eighty_g_eligible, receipt_number, financial_year, notes)
    VALUES (
      CASE WHEN i % 3 = 0 THEN v_city_admin_id END,
      format('Donor %s', i),
      '+9198' || lpad((10000000 + i)::text, 8, '0'),
      format('donor%s@example.com', i),
      CASE WHEN i % 2 = 0 THEN 'ABCDE' || lpad(i::text, 4, '0') || 'F' END,
      (50000 + (i * 25000))::bigint,
      'INR',
      (ARRAY['general','shivir','scholarship','infrastructure'])[1 + (i % 4)]::donation_purpose_enum,
      CASE WHEN i % 2 = 0 THEN v_camp_id END,
      CASE WHEN i % 7 = 0 THEN 'recurring' ELSE 'one_time' END::donation_frequency_enum,
      'order_demo_' || lpad(i::text, 5, '0'),
      'pay_demo_' || lpad(i::text, 5, '0'),
      CASE WHEN i % 11 = 0 THEN 'failed' ELSE 'captured' END::payment_status_enum,
      CASE WHEN i % 11 <> 0 THEN now() - (i % 30) * interval '1 day' END,
      (i % 2 = 0),
      CASE WHEN i % 11 <> 0 THEN 'RCPT-' || v_fy || '-' || lpad(i::text, 5, '0') END,
      v_fy,
      NULL);
  END LOOP;

  -- keep campaign raised totals roughly in sync with captured donations
  UPDATE donation_campaigns dc
     SET raised_amount_paise = COALESCE((
           SELECT sum(d.amount_paise) FROM donations d
            WHERE d.campaign_id = dc.id AND d.status = 'captured'), 0)
   WHERE dc.city_id = v_city_id;

  -- =========================================================================
  -- 10. niyam_streaks  (for students who have niyam submissions)
  -- =========================================================================
  INSERT INTO niyam_streaks (student_id, niyam_id, current_streak, longest_streak,
                             last_completion_date, badge_awarded, badge_kind)
  SELECT ns.student_id, ns.niyam_id,
         (3 + (row_number() OVER (ORDER BY ns.student_id) % 12))::int AS cur,
         (7 + (row_number() OVER (ORDER BY ns.student_id) % 20))::int AS longest,
         CURRENT_DATE - (row_number() OVER (ORDER BY ns.student_id) % 5)::int,
         (row_number() OVER (ORDER BY ns.student_id) % 4 = 0),
         CASE WHEN (row_number() OVER (ORDER BY ns.student_id) % 4 = 0) THEN 'streak_7' END
    FROM (
      SELECT DISTINCT student_id, niyam_id FROM niyam_submissions
    ) ns
  ON CONFLICT (student_id, niyam_id) DO NOTHING;

  -- =========================================================================
  -- 11. push_quizzes  (a few, recent)
  -- =========================================================================
  FOR v_batch_id, v_batch_shik IN
      SELECT b.id, b.shikshak_id FROM batches b JOIN centres c ON c.id = b.centre_id
       WHERE c.city_id = v_city_id AND b.deleted_at IS NULL AND b.shikshak_id IS NOT NULL
       ORDER BY b.name LIMIT 5 LOOP
    INSERT INTO push_quizzes (batch_id, shikshak_user_id, started_at, expires_at, completion_points)
    VALUES (v_batch_id, v_batch_shik, now() - interval '2 day',
            now() - interval '2 day' + interval '20 minute', 5);
  END LOOP;

  -- =========================================================================
  -- 12. shivir_events  (a couple)
  -- =========================================================================
  INSERT INTO shivir_events (city_id, name, description, start_date, end_date, location_text,
                             capacity, msv_only, attendance_mode, sessions_count, created_by, updated_by)
  VALUES
    (v_city_id, 'Paryushan shivir 2026',
     'Eight-day Paryushan study and reflection shivir.',
     CURRENT_DATE + 20, CURRENT_DATE + 27, 'MSV Hall, Ahmedabad',
     200, false, 'in_out', 8, v_super_id, v_super_id),
    (v_city_id, 'Bal sanskar shivir',
     'Weekend values camp for younger students.',
     CURRENT_DATE + 5, CURRENT_DATE + 6, 'Centre 1, Ahmedabad',
     80, false, 'present_only', 2, v_super_id, v_super_id);

  -- =========================================================================
  -- 13. service_requests  (a handful, mixed status)
  -- =========================================================================
  v_seq := 0;
  FOR v_parent_id, v_student_id, v_centre_id IN
      SELECT s.parent_user_id, s.id, s.centre_id FROM students s
       WHERE s.status = 'active' AND s.deleted_at IS NULL ORDER BY s.student_code LIMIT 8 LOOP
    v_seq := v_seq + 1;
    INSERT INTO service_requests (parent_user_id, student_id, category, description, status,
                                  assigned_to_user_id, centre_id, city_id, last_response_at, resolved_at)
    VALUES (v_parent_id, v_student_id,
            (ARRAY['attendance_query','transfer_request','general','fee_query'])[1 + (v_seq % 4)],
            'Parent needs assistance regarding their child''s enrolment.',
            (ARRAY['submitted','in_review','resolved'])[1 + (v_seq % 3)]::service_request_status_enum,
            CASE WHEN v_seq % 3 <> 0 THEN v_city_admin_id END,
            v_centre_id, v_city_id,
            CASE WHEN v_seq % 3 <> 0 THEN now() - (v_seq % 5) * interval '1 day' END,
            CASE WHEN v_seq % 3 = 2 THEN now() - (v_seq % 3) * interval '1 day' END);
  END LOOP;

  -- =========================================================================
  -- 14. digital_id_cards  (for a sample of active students)
  -- =========================================================================
  v_seq := 0;
  FOR v_student_id IN
      SELECT id FROM students WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY student_code LIMIT 40 LOOP
    v_seq := v_seq + 1;
    INSERT INTO digital_id_cards (student_id, card_number, qr_payload, qr_payload_signature,
                                  svg_payload, msv_badge, version_no, generated_at)
    VALUES (v_student_id,
            'JP-ID-' || lpad(v_seq::text, 6, '0'),
            'jpid:' || v_student_id::text,
            md5('sig-' || v_student_id::text),
            '<svg/>',
            EXISTS (SELECT 1 FROM students s2 WHERE s2.id = v_student_id AND s2.msv_status = 'approved'),
            1, now())
    ON CONFLICT (student_id) DO NOTHING;
  END LOOP;

  -- =========================================================================
  -- 15. progress_reports  (for a sample of active students)
  -- =========================================================================
  v_seq := 0;
  FOR v_student_id IN
      SELECT id FROM students WHERE status = 'active' AND deleted_at IS NULL
       ORDER BY student_code LIMIT 30 LOOP
    v_seq := v_seq + 1;
    INSERT INTO progress_reports (student_id, period_kind, period_label, generated_at,
                                  shikshak_comment, released_to_parent, released_at, snapshot)
    VALUES (v_student_id, 'monthly',
            to_char(CURRENT_DATE - interval '1 month', 'YYYY-MM'),
            now() - interval '3 day',
            'Steady progress this month. Keep practising the niyams.',
            (v_seq % 2 = 0),
            CASE WHEN v_seq % 2 = 0 THEN now() - interval '2 day' END,
            jsonb_build_object(
              'attendance_rate', 85,
              'punya_points', (v_seq * 37) % 6000,
              'niyams_completed', v_seq % 10,
              'homework_completion', 70 + (v_seq % 30)))
    ON CONFLICT (student_id, period_kind, period_label) DO NOTHING;
  END LOOP;

  RAISE NOTICE '[extra-seed] data block complete.';
END
$$;

-- =============================================================================
-- Analytics materialised views (read by /v1/admin/analytics/overview).
-- These are NOT created by the Drizzle migration, so we (re)create them here.
-- Each carries the UNIQUE index required for REFRESH ... CONCURRENTLY.
-- =============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_centre_engagement  CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_punya_distribution CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_msv_pipeline        CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_attendance_trends   CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_niyam_completion    CASCADE;
DROP MATERIALIZED VIEW IF EXISTS mv_donations_summary   CASCADE;

-- mv_centre_engagement (centre_id, academic_month, rates, punya, active_students)
CREATE MATERIALIZED VIEW mv_centre_engagement AS
WITH months AS (
  SELECT to_char(d, 'YYYY-MM') AS academic_month, d::date AS month_start
    FROM generate_series(date_trunc('month', now()) - interval '5 month',
                         date_trunc('month', now()), interval '1 month') d
),
centres_x_months AS (
  SELECT c.id AS centre_id, c.city_id, m.academic_month, m.month_start
    FROM centres c CROSS JOIN months m
   WHERE c.deleted_at IS NULL
),
att AS (
  SELECT s.centre_id, to_char(se.scheduled_date, 'YYYY-MM') AS academic_month,
         count(*) FILTER (WHERE a.status = 'present')::numeric AS present_marks,
         count(*)::numeric AS total_marks
    FROM attendance a
    JOIN sessions se ON se.id = a.session_id
    JOIN students s ON s.id = a.student_id
   GROUP BY 1, 2
),
punya AS (
  SELECT pt.centre_id, to_char(pt.awarded_at, 'YYYY-MM') AS academic_month,
         sum(pt.points)::int AS total_punya
    FROM punya_transactions pt
   WHERE pt.centre_id IS NOT NULL
   GROUP BY 1, 2
),
actives AS (
  SELECT centre_id, count(*)::int AS active_students
    FROM students WHERE status = 'active' AND deleted_at IS NULL GROUP BY 1
)
SELECT cm.centre_id,
       cm.academic_month,
       COALESCE(CASE WHEN att.total_marks > 0
                     THEN round(att.present_marks / att.total_marks * 100, 1) ELSE 0 END, 0)::numeric AS attendance_rate,
       0::numeric AS homework_completion_rate,
       0::numeric AS niyam_completion_rate,
       COALESCE(punya.total_punya, 0)::int AS total_punya_awarded,
       COALESCE(actives.active_students, 0)::int AS active_students
  FROM centres_x_months cm
  LEFT JOIN att     ON att.centre_id = cm.centre_id     AND att.academic_month = cm.academic_month
  LEFT JOIN punya   ON punya.centre_id = cm.centre_id   AND punya.academic_month = cm.academic_month
  LEFT JOIN actives ON actives.centre_id = cm.centre_id;
CREATE UNIQUE INDEX mv_centre_engagement_pk ON mv_centre_engagement (centre_id, academic_month);

-- mv_punya_distribution (city_id, tier, student_count)
CREATE MATERIALIZED VIEW mv_punya_distribution AS
SELECT s.id AS city_id, pb.current_tier AS tier, count(*)::int AS student_count
  FROM cities s
  JOIN centres c ON c.city_id = s.id AND c.deleted_at IS NULL
  JOIN students st ON st.centre_id = c.id AND st.status = 'active' AND st.deleted_at IS NULL
  JOIN punya_balances pb ON pb.student_id = st.id
 GROUP BY s.id, pb.current_tier;
CREATE UNIQUE INDEX mv_punya_distribution_pk ON mv_punya_distribution (city_id, tier);

-- mv_msv_pipeline (city_id, msv_status, student_count, last_decision_at)
CREATE MATERIALIZED VIEW mv_msv_pipeline AS
SELECT c.city_id, me.status AS msv_status, count(*)::int AS student_count,
       max(me.decided_at) AS last_decision_at
  FROM msv_enrolments me
  JOIN students st ON st.id = me.student_id AND st.deleted_at IS NULL
  JOIN centres c ON c.id = st.centre_id
 GROUP BY c.city_id, me.status;
CREATE UNIQUE INDEX mv_msv_pipeline_pk ON mv_msv_pipeline (city_id, msv_status);

-- mv_attendance_trends (city_id, day, present_count, total_marks, attendance_rate)
CREATE MATERIALIZED VIEW mv_attendance_trends AS
SELECT c.city_id,
       se.scheduled_date AS day,
       count(*) FILTER (WHERE a.status = 'present')::int AS present_count,
       count(*)::int AS total_marks,
       CASE WHEN count(*) > 0
            THEN round(count(*) FILTER (WHERE a.status = 'present')::numeric / count(*) * 100, 1)
            ELSE 0 END::numeric AS attendance_rate
  FROM attendance a
  JOIN sessions se ON se.id = a.session_id
  JOIN batches b ON b.id = se.batch_id
  JOIN centres c ON c.id = b.centre_id
 GROUP BY c.city_id, se.scheduled_date;
CREATE UNIQUE INDEX mv_attendance_trends_pk ON mv_attendance_trends (city_id, day);

-- mv_niyam_completion (city_id, niyam_id, approved_count, rejected_count, submission_count)
CREATE MATERIALIZED VIEW mv_niyam_completion AS
SELECT n.city_id, n.id AS niyam_id,
       count(*) FILTER (WHERE sub.status = 'auto_approved')::int AS approved_count,
       count(*) FILTER (WHERE sub.status = 'rejected')::int AS rejected_count,
       count(*)::int AS submission_count
  FROM niyams n
  JOIN niyam_submissions sub ON sub.niyam_id = n.id
 WHERE n.city_id IS NOT NULL
 GROUP BY n.city_id, n.id;
CREATE UNIQUE INDEX mv_niyam_completion_pk ON mv_niyam_completion (city_id, niyam_id);

-- mv_donations_summary (financial_year, city_id, donation_count, total_paise, eighty_g_count)
CREATE MATERIALIZED VIEW mv_donations_summary AS
SELECT COALESCE(d.financial_year, 'unknown') AS financial_year,
       COALESCE(dc.city_id, (SELECT id FROM cities ORDER BY name LIMIT 1)) AS city_id,
       count(*)::int AS donation_count,
       sum(d.amount_paise)::bigint AS total_paise,
       count(*) FILTER (WHERE d.eighty_g_eligible)::int AS eighty_g_count
  FROM donations d
  LEFT JOIN donation_campaigns dc ON dc.id = d.campaign_id
 WHERE d.status = 'captured' AND d.deleted_at IS NULL
 GROUP BY 1, 2;
CREATE UNIQUE INDEX mv_donations_summary_pk ON mv_donations_summary (financial_year, city_id);

-- grant read to the runtime DB roles if they exist (best-effort, dev only)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'audit_writer') THEN
    GRANT SELECT ON mv_centre_engagement, mv_punya_distribution, mv_msv_pipeline,
                    mv_attendance_trends, mv_niyam_completion, mv_donations_summary
      TO audit_writer;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[extra-seed] grant skipped: %', SQLERRM;
END
$$;
