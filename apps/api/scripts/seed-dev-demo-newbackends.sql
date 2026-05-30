-- =============================================================================
-- EXTRA SEED v2 — new-backend data (idempotent, dev only).
--
-- Adds rows for backends wired up after the original extra seed was written:
--   • questions                  (approved bank → quiz-event picker)
--   • quiz_events (+ quiz_event_questions)  (scheduled quizzes admin)
--   • student_notes              (shikshak working notes)
--   • registration_form_configs  (form-builder: a published parent form)
--
-- Self-contained DO block, guarded on `questions` so re-runs are no-ops.
-- References entities created by seed-dev-demo.sql (city Ahmedabad, the
-- super_admin, a shikshak and active students) — looked up by role, so it
-- works regardless of the exact seeded names.
--
-- Run on its own:  pnpm --filter @jp/api db:seed:demo:newbackends
-- (or as part of the full chain: pnpm db:seed:full)
-- =============================================================================

DO $$
DECLARE
  v_city        uuid;
  v_super       uuid;
  v_shikshak    uuid;
  v_q1          uuid;
  v_q2          uuid;
  v_q3          uuid;
  v_event       uuid;
  v_has_q       int;
  v_student     uuid;
BEGIN
  SELECT COUNT(*) INTO v_has_q FROM questions;
  IF v_has_q > 0 THEN
    RAISE NOTICE 'extra seed v2: % questions already exist — skipping (re-run safe)', v_has_q;
    RETURN;
  END IF;

  SELECT id INTO v_city FROM cities WHERE name = 'Ahmedabad' LIMIT 1;
  SELECT id INTO v_super FROM users WHERE role = 'super_admin' ORDER BY created_at LIMIT 1;
  SELECT id INTO v_shikshak FROM users WHERE role = 'shikshak' AND full_name = 'Rajesh Shah' LIMIT 1;
  IF v_shikshak IS NULL THEN
    SELECT id INTO v_shikshak FROM users WHERE role = 'shikshak' ORDER BY created_at LIMIT 1;
  END IF;

  -- ===========================================================================
  -- Question bank — approved manual questions (city scope = Ahmedabad)
  -- ===========================================================================
  RAISE NOTICE 'extra seed v2: inserting question bank…';
  INSERT INTO questions (scope, city_id, question_en, question_hi, options, correct_indices,
                         difficulty, age_groups, topic, source, is_ai_generated, ai_review_status,
                         reviewed, reviewed_by)
  VALUES
    ('national', NULL,
     'How many Tirthankaras are there in Jainism?',
     'जैन धर्म में कितने तीर्थंकर हैं?',
     '[{"id":"a","text_en":"12","text_hi":"१२"},{"id":"b","text_en":"24","text_hi":"२४"},{"id":"c","text_en":"36","text_hi":"३६"},{"id":"d","text_en":"48","text_hi":"४८"}]'::jsonb,
     ARRAY[1], 'easy', ARRAY['bal','kishor']::age_group_enum[], 'Tirthankaras', 'manual', false, 'approved',
     'approved', v_super),
    ('national', NULL,
     'What is the first vow (vrata) of Jainism?',
     'जैन धर्म का पहला व्रत क्या है?',
     '[{"id":"a","text_en":"Satya","text_hi":"सत्य"},{"id":"b","text_en":"Ahimsa","text_hi":"अहिंसा"},{"id":"c","text_en":"Asteya","text_hi":"अस्तेय"},{"id":"d","text_en":"Aparigraha","text_hi":"अपरिग्रह"}]'::jsonb,
     ARRAY[1], 'easy', ARRAY['bal','kishor','tarun']::age_group_enum[], 'Vows', 'manual', false, 'approved',
     'approved', v_super),
    ('city', v_city,
     'Which festival marks the end of Paryushan?',
     'पर्युषण के अंत में कौन सा पर्व आता है?',
     '[{"id":"a","text_en":"Diwali","text_hi":"दिवाली"},{"id":"b","text_en":"Samvatsari","text_hi":"संवत्सरी"},{"id":"c","text_en":"Holi","text_hi":"होली"},{"id":"d","text_en":"Mahavir Jayanti","text_hi":"महावीर जयंती"}]'::jsonb,
     ARRAY[1], 'medium', ARRAY['kishor','tarun','yuva']::age_group_enum[], 'Festivals', 'manual', false, 'approved',
     'approved', v_super)
  ;

  SELECT id INTO v_q1 FROM questions WHERE topic = 'Tirthankaras' LIMIT 1;
  SELECT id INTO v_q2 FROM questions WHERE topic = 'Vows' LIMIT 1;
  SELECT id INTO v_q3 FROM questions WHERE topic = 'Festivals' LIMIT 1;

  -- ===========================================================================
  -- Scheduled quiz event (city scope) + its question links
  -- ===========================================================================
  RAISE NOTICE 'extra seed v2: inserting scheduled quiz event…';
  INSERT INTO quiz_events (scope, city_id, title_en, title_hi, start_at, end_at,
                           participation_points, win_points, target_age_groups,
                           created_by, updated_by)
  VALUES ('city', v_city,
          'Paryushan Knowledge Quiz', 'पर्युषण ज्ञान प्रश्नोत्तरी',
          now() + interval '2 days', now() + interval '2 days' + interval '30 minutes',
          10, 50, ARRAY['kishor','tarun']::age_group_enum[], v_super, v_super)
  RETURNING id INTO v_event;

  INSERT INTO quiz_event_questions (quiz_event_id, question_id, order_index)
  VALUES (v_event, v_q1, 0), (v_event, v_q2, 1), (v_event, v_q3, 2);

  -- ===========================================================================
  -- Student notes — a couple of shikshak working notes
  -- ===========================================================================
  RAISE NOTICE 'extra seed v2: inserting student notes…';
  FOR v_student IN
    SELECT id FROM students WHERE status = 'active' ORDER BY enrolled_at LIMIT 3
  LOOP
    INSERT INTO student_notes (student_id, author_user_id, note)
    VALUES
      (v_student, v_shikshak, 'Participates actively in class. Strong on sutras.'),
      (v_student, v_shikshak, 'Encourage more regular niyam submissions.');
  END LOOP;

  -- ===========================================================================
  -- Form builder — a published custom parent registration form
  -- ===========================================================================
  RAISE NOTICE 'extra seed v2: inserting form config…';
  INSERT INTO registration_form_configs (city_id, form_kind, is_active, version_no,
                                         custom_fields, published_at, published_by,
                                         created_by, updated_by)
  VALUES (NULL, 'parent', true, 1,
          '[{"key":"blood_group","label_en":"Blood group","label_hi":"रक्त समूह","type":"select","required":false,"options":["A+","A-","B+","B-","O+","O-","AB+","AB-"]},{"key":"emergency_contact","label_en":"Emergency contact","label_hi":"आपातकालीन संपर्क","type":"phone","required":true}]'::jsonb,
          now(), v_super, v_super, v_super);

  RAISE NOTICE 'extra seed v2: done.';
END $$;
