/**
 * Seed script — populates the dev database with a realistic Megh Sanskar Vatika
 * network: geography, all admin personas, centres, batches, students, enrolments,
 * sessions + attendance, punya, niyams + submissions, notices, shivirs, library,
 * and gallery entries.
 *
 * Run with: pnpm --filter @workspace/db run seed
 *
 * Idempotent: truncates all domain tables (CASCADE) before re-inserting.
 */
import { db, pool } from "./index";
import {
  states,
  cities,
  users,
  centres,
  batches,
  sanchalak_centre_assignments,
  shikshak_batch_assignments,
  students,
  enrolments,
  msv_enrolments,
  sessions,
  attendance,
  punya_transactions,
  punya_balances,
  niyams,
  niyam_submissions,
  notices,
  shivir_events,
  library_items,
  gallery_items,
  settings,
  curricula,
  curriculum_sections,
  curriculum_items,
  online_exams,
  exam_questions,
  exam_question_options,
  exam_attempts,
  donation_campaigns,
  donations,
  queue_stats,
  queue_dlq_jobs,
} from "./schema";
import { tierForPoints } from "./schema/enums";
import { sql } from "drizzle-orm";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function main(): Promise<void> {
  console.log("Seeding database…");

  // Clear domain tables (order does not matter with CASCADE).
  await db.execute(sql`
    truncate table
      queue_dlq_jobs, queue_stats, donations, donation_campaigns,
      exam_answers, exam_attempts, exam_question_options, exam_questions, online_exams,
      curriculum_items, curriculum_sections, curricula,
      gallery_items, library_items, shivir_events, notices,
      niyam_streaks, niyam_submissions, niyams,
      punya_balances, punya_transactions, punya_configs, punya_features,
      session_cancellations, attendance, sessions,
      digital_id_cards, msv_enrolments, enrolments, students,
      shikshak_batch_assignments, sanchalak_centre_assignments,
      centre_holidays, batches, centres,
      notice_reads, library_access_logs, settings,
      otp_codes, device_sessions, users,
      cities, states
    restart identity cascade
  `);

  /* ---------------- Geography ---------------- */
  const [maharashtra] = await db
    .insert(states)
    .values({ name: "Maharashtra", code: "MH" })
    .returning();
  const [gujarat] = await db.insert(states).values({ name: "Gujarat", code: "GJ" }).returning();

  const [mumbai] = await db
    .insert(cities)
    .values({ state_id: maharashtra.id, name: "Mumbai", code: "MUM" })
    .returning();
  const [pune] = await db
    .insert(cities)
    .values({ state_id: maharashtra.id, name: "Pune", code: "PUN" })
    .returning();
  const [ahmedabad] = await db
    .insert(cities)
    .values({ state_id: gujarat.id, name: "Ahmedabad", code: "AMD" })
    .returning();

  /* ---------------- Users (personas) ---------------- */
  const [superAdmin] = await db
    .insert(users)
    .values({
      phone: "+919800000001",
      role: "super_admin",
      full_name: "Super Admin",
      preferred_language: "en",
    })
    .returning();

  const [stateAdmin] = await db
    .insert(users)
    .values({
      phone: "+919800000002",
      role: "state_admin",
      full_name: "Maharashtra State Admin",
      preferred_language: "en",
      state_id: maharashtra.id,
    })
    .returning();

  const [cityAdmin] = await db
    .insert(users)
    .values({
      phone: "+919800000003",
      role: "city_admin",
      full_name: "Mumbai City Admin",
      preferred_language: "en",
      state_id: maharashtra.id,
      city_id: mumbai.id,
    })
    .returning();

  const [sanchalak] = await db
    .insert(users)
    .values({
      phone: "+919800000004",
      role: "sanchalak",
      full_name: "Centre Sanchalak",
      preferred_language: "hi",
      state_id: maharashtra.id,
      city_id: mumbai.id,
    })
    .returning();

  const [shikshak] = await db
    .insert(users)
    .values({
      phone: "+919800000005",
      role: "shikshak",
      full_name: "Pathshala Shikshak",
      preferred_language: "hi",
      state_id: maharashtra.id,
      city_id: mumbai.id,
    })
    .returning();

  const [parent] = await db
    .insert(users)
    .values({
      phone: "+919800000006",
      role: "parent",
      full_name: "Student Parent",
      preferred_language: "hi",
      state_id: maharashtra.id,
      city_id: mumbai.id,
      gallery_visibility_opt_in: true,
    })
    .returning();

  const [studentUser] = await db
    .insert(users)
    .values({
      phone: "+919800000007",
      role: "student",
      full_name: "Aarav Shah",
      preferred_language: "hi",
      state_id: maharashtra.id,
      city_id: mumbai.id,
    })
    .returning();

  /* ---------------- Centres ---------------- */
  const [centreA] = await db
    .insert(centres)
    .values({
      state_id: maharashtra.id,
      city_id: mumbai.id,
      name: "Ghatkopar Jain Pathshala",
      locality: "Ghatkopar East",
      pincode: "400077",
      contact_phone: "+912200000001",
      contact_email: "ghatkopar@example.org",
      lat: "19.0861000",
      lng: "72.9081000",
      gps_radius_m: 200,
      status: "active",
    })
    .returning();

  const [centreB] = await db
    .insert(centres)
    .values({
      state_id: maharashtra.id,
      city_id: pune.id,
      name: "Kothrud Jain Pathshala",
      locality: "Kothrud",
      pincode: "411038",
      contact_phone: "+912000000002",
      contact_email: "kothrud@example.org",
      status: "active",
    })
    .returning();

  const [centreC] = await db
    .insert(centres)
    .values({
      state_id: gujarat.id,
      city_id: ahmedabad.id,
      name: "Maninagar Jain Pathshala",
      locality: "Maninagar",
      pincode: "380008",
      contact_phone: "+917900000003",
      contact_email: "maninagar@example.org",
      status: "active",
    })
    .returning();

  /* ---------------- Batches ---------------- */
  const [batchA1] = await db
    .insert(batches)
    .values({
      centre_id: centreA.id,
      name: "Bal Batch - Sunday Morning",
      age_group: "bal",
      shikshak_id: shikshak.id,
      day_of_week: [0],
      start_time: "09:00:00",
      end_time: "10:30:00",
      capacity: 25,
      language_preference: "hi",
      status: "active",
    })
    .returning();

  const [batchA2] = await db
    .insert(batches)
    .values({
      centre_id: centreA.id,
      name: "Kishor Batch - Sunday Morning",
      age_group: "kishor",
      shikshak_id: shikshak.id,
      day_of_week: [0],
      start_time: "10:30:00",
      end_time: "12:00:00",
      capacity: 30,
      language_preference: "en",
      status: "active",
    })
    .returning();

  const [batchB1] = await db
    .insert(batches)
    .values({
      centre_id: centreB.id,
      name: "Tarun Batch - Saturday Evening",
      age_group: "tarun",
      day_of_week: [6],
      start_time: "17:00:00",
      end_time: "18:30:00",
      capacity: 20,
      language_preference: "en",
      status: "active",
    })
    .returning();

  /* ---------------- Assignments ---------------- */
  await db.insert(sanchalak_centre_assignments).values({
    user_id: sanchalak.id,
    centre_id: centreA.id,
  });
  await db.insert(shikshak_batch_assignments).values([
    { user_id: shikshak.id, batch_id: batchA1.id },
    { user_id: shikshak.id, batch_id: batchA2.id },
  ]);

  /* ---------------- Students ---------------- */
  const studentSeeds = [
    {
      full_name: "Aarav Shah",
      code: "JP0001",
      age_group: "bal" as const,
      centre_id: centreA.id,
      batch_id: batchA1.id,
      msv_status: "approved" as const,
      user_id: studentUser.id,
      parent_id: parent.id,
      dob: "2016-04-12",
    },
    {
      full_name: "Diya Mehta",
      code: "JP0002",
      age_group: "bal" as const,
      centre_id: centreA.id,
      batch_id: batchA1.id,
      msv_status: "none" as const,
      parent_id: parent.id,
      dob: "2015-09-03",
    },
    {
      full_name: "Kabir Jain",
      code: "JP0003",
      age_group: "kishor" as const,
      centre_id: centreA.id,
      batch_id: batchA2.id,
      msv_status: "applied" as const,
      dob: "2012-01-22",
    },
    {
      full_name: "Anaya Doshi",
      code: "JP0004",
      age_group: "tarun" as const,
      centre_id: centreB.id,
      batch_id: batchB1.id,
      msv_status: "approved" as const,
      dob: "2009-11-30",
    },
    {
      full_name: "Vivaan Sanghvi",
      code: "JP0005",
      age_group: "kishor" as const,
      centre_id: centreA.id,
      batch_id: batchA2.id,
      msv_status: "none" as const,
      dob: "2011-06-18",
    },
  ];

  const insertedStudents = await db
    .insert(students)
    .values(
      studentSeeds.map((s) => ({
        full_name: s.full_name,
        student_code: s.code,
        age_group: s.age_group,
        centre_id: s.centre_id,
        batch_id: s.batch_id,
        msv_status: s.msv_status,
        user_id: s.user_id ?? null,
        parent_id: s.parent_id ?? null,
        dob: s.dob,
        status: "active" as const,
      })),
    )
    .returning();

  /* ---------------- Enrolments ---------------- */
  await db.insert(enrolments).values([
    {
      student_id: insertedStudents[2].id,
      requested_centre_id: centreA.id,
      requested_batch_id: batchA2.id,
      status: "pending",
    },
    {
      student_id: insertedStudents[4].id,
      requested_centre_id: centreA.id,
      requested_batch_id: batchA2.id,
      status: "approved",
      decided_by: sanchalak.id,
      decided_at: daysAgo(10),
    },
    {
      student_id: insertedStudents[3].id,
      requested_centre_id: centreB.id,
      requested_batch_id: batchB1.id,
      status: "waitlisted",
      decided_by: superAdmin.id,
      decided_at: daysAgo(5),
    },
  ]);

  await db.insert(msv_enrolments).values([
    {
      student_id: insertedStudents[0].id,
      status: "approved",
      decided_by: superAdmin.id,
      decided_at: daysAgo(40),
    },
    { student_id: insertedStudents[2].id, status: "applied" },
  ]);

  /* ---------------- Sessions + Attendance ---------------- */
  const batchStudents: Record<string, string[]> = {
    [batchA1.id]: [insertedStudents[0].id, insertedStudents[1].id],
    [batchA2.id]: [insertedStudents[2].id, insertedStudents[4].id],
    [batchB1.id]: [insertedStudents[3].id],
  };

  for (const batch of [batchA1, batchA2, batchB1]) {
    for (let w = 1; w <= 4; w++) {
      const [session] = await db
        .insert(sessions)
        .values({
          batch_id: batch.id,
          session_date: isoDate(daysAgo(w * 7)),
          status: "completed",
          topic: `Week ${5 - w} — Navkar Mantra & stavan`,
          conducted_by: shikshak.id,
        })
        .returning();

      const ids = batchStudents[batch.id] ?? [];
      for (const studentId of ids) {
        const roll = Math.random();
        const status = roll < 0.75 ? "present" : roll < 0.85 ? "late" : roll < 0.95 ? "excused" : "absent";
        await db.insert(attendance).values({
          session_id: session.id,
          student_id: studentId,
          status,
          marked_by: shikshak.id,
        });
      }
    }
  }

  /* ---------------- Niyams ---------------- */
  const insertedNiyams = await db
    .insert(niyams)
    .values([
      {
        title_en: "Navkar Mantra (9 times)",
        title_hi: "नवकार मंत्र (9 बार)",
        description_en: "Recite the Navkar Mantra nine times.",
        description_hi: "नवकार मंत्र नौ बार बोलें।",
        niyam_type: "daily",
        proof_type: "either",
        points: 10,
      },
      {
        title_en: "Chauvihar (no food after sunset)",
        title_hi: "चौविहार (सूर्यास्त के बाद नहीं)",
        niyam_type: "daily",
        proof_type: "photo",
        points: 15,
      },
      {
        title_en: "Samayik (weekly)",
        title_hi: "सामायिक (साप्ताहिक)",
        niyam_type: "weekly",
        proof_type: "either",
        points: 25,
      },
    ])
    .returning();

  /* ---------------- Niyam submissions + Punya + Gallery ---------------- */
  const punyaByStudent: Record<string, number> = {};

  for (const student of insertedStudents) {
    for (let d = 0; d < 6; d++) {
      const niyam = insertedNiyams[d % insertedNiyams.length];
      const [submission] = await db
        .insert(niyam_submissions)
        .values({
          niyam_id: niyam.id,
          student_id: student.id,
          submission_date: isoDate(daysAgo(d)),
          status: "auto_approved",
          points_awarded: niyam.points,
          is_featured: d === 0 && student.msv_status === "approved",
        })
        .returning();

      await db.insert(punya_transactions).values({
        student_id: student.id,
        feature_key: "niyam_submission",
        points: niyam.points,
        note: `Niyam: ${niyam.title_en}`,
        awarded_by: shikshak.id,
      });
      punyaByStudent[student.id] = (punyaByStudent[student.id] ?? 0) + niyam.points;

      // Feature approved students' first submission in the public gallery.
      if (submission.is_featured) {
        await db.insert(gallery_items).values({
          student_id: student.id,
          niyam_id: niyam.id,
          submission_id: submission.id,
          is_featured: true,
          is_public: true,
        });
      }
    }
  }

  // Punya balances.
  for (const [studentId, total] of Object.entries(punyaByStudent)) {
    await db.insert(punya_balances).values({
      student_id: studentId,
      total_points: total,
      tier: tierForPoints(total),
    });
  }

  // A few pending niyam submissions with proof, awaiting shikshak review.
  await db.insert(niyam_submissions).values([
    {
      niyam_id: insertedNiyams[1].id,
      student_id: insertedStudents[0].id,
      submission_date: isoDate(daysAgo(0)),
      status: "pending",
      points_awarded: 0,
      proof_url: "https://example.org/proof/sample1.jpg",
      notes: "Completed chauvihar today.",
      submitted_by: parent.id,
    },
    {
      niyam_id: insertedNiyams[2].id,
      student_id: insertedStudents[1].id,
      submission_date: isoDate(daysAgo(1)),
      status: "pending",
      points_awarded: 0,
      proof_url: "https://example.org/proof/sample2.jpg",
      submitted_by: parent.id,
    },
  ]);

  /* ---------------- Notices ---------------- */
  await db.insert(notices).values([
    {
      title_en: "Paryushan Parva Schedule Announced",
      title_hi: "पर्युषण पर्व कार्यक्रम घोषित",
      content_en: "The Paryushan Parva schedule for all centres is now available.",
      content_hi: "सभी केंद्रों के लिए पर्युषण पर्व कार्यक्रम अब उपलब्ध है।",
      audience: "national",
      is_public: true,
      pinned: true,
      is_critical: false,
      published_at: daysAgo(2),
      created_by: superAdmin.id,
    },
    {
      title_en: "New Library Material Added",
      title_hi: "नई पुस्तकालय सामग्री जोड़ी गई",
      content_en: "Audio stavans and PDF study guides have been added to the library.",
      content_hi: "ऑडियो स्तवन और पीडीएफ अध्ययन गाइड पुस्तकालय में जोड़े गए हैं।",
      audience: "national",
      is_public: true,
      pinned: false,
      published_at: daysAgo(6),
      created_by: superAdmin.id,
    },
    {
      title_en: "Centre Maintenance Notice",
      title_hi: "केंद्र रखरखाव सूचना",
      content_en: "Ghatkopar centre will be closed next Sunday for maintenance.",
      audience: "centre",
      centre_id: centreA.id,
      is_public: false,
      pinned: false,
      published_at: daysAgo(1),
      created_by: sanchalak.id,
    },
  ]);

  /* ---------------- Shivirs ---------------- */
  await db.insert(shivir_events).values([
    {
      name: "Summer Sanskar Shivir 2026",
      description: "A 5-day residential shivir focused on Jain values and meditation.",
      state_id: maharashtra.id,
      city_id: mumbai.id,
      start_date: isoDate(daysFromNow(20)),
      end_date: isoDate(daysFromNow(24)),
      location_text: "Ghatkopar Upashray, Mumbai",
      capacity: 120,
      contact_info: "Call +91 98000 00004 for registration.",
      is_published: true,
    },
    {
      name: "Pune Youth Shibir",
      description: "Weekend shibir for tarun and yuva age groups.",
      state_id: maharashtra.id,
      city_id: pune.id,
      start_date: isoDate(daysFromNow(40)),
      end_date: isoDate(daysFromNow(41)),
      location_text: "Kothrud Hall, Pune",
      capacity: 60,
      contact_info: "Email kothrud@example.org",
      is_published: true,
    },
    {
      name: "Past Diwali Shivir 2025",
      description: "Archived event (should not appear in upcoming list).",
      state_id: gujarat.id,
      city_id: ahmedabad.id,
      start_date: isoDate(daysAgo(120)),
      end_date: isoDate(daysAgo(118)),
      location_text: "Maninagar, Ahmedabad",
      is_published: true,
    },
  ]);

  /* ---------------- Library ---------------- */
  await db.insert(library_items).values([
    {
      content_type: "video",
      title_en: "Introduction to Navkar Mantra",
      title_hi: "नवकार मंत्र का परिचय",
      description_en: "A short video explaining the meaning of the Navkar Mantra.",
      description_hi: "नवकार मंत्र का अर्थ समझाने वाला एक लघु वीडियो।",
      embed_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
      access_tier: "public",
      is_published: true,
    },
    {
      content_type: "audio",
      title_en: "Stavan Collection Vol. 1",
      title_hi: "स्तवन संग्रह भाग 1",
      description_en: "Devotional stavans for daily listening.",
      embed_url: "https://example.org/audio/stavan-1.mp3",
      access_tier: "public",
      is_published: true,
    },
    {
      content_type: "pdf",
      title_en: "Jain Values Study Guide",
      title_hi: "जैन मूल्य अध्ययन गाइड",
      description_en: "Study guide for kishor and tarun students.",
      embed_url: "https://example.org/pdf/values-guide.pdf",
      access_tier: "student",
      is_published: true,
    },
  ]);

  /* ---------------- Curriculum ---------------- */
  const [curriculumStd] = await db
    .insert(curricula)
    .values({
      city_id: mumbai.id,
      name: "Foundation Jain Studies 2025-26",
      kind: "standard",
      academic_year: "2025-26",
      status: "active",
    })
    .returning();

  const [sec1] = await db
    .insert(curriculum_sections)
    .values({
      curriculum_id: curriculumStd.id,
      title_en: "Core Values",
      title_hi: "मूल मूल्य",
      order_index: 1,
    })
    .returning();

  await db.insert(curriculum_items).values([
    {
      section_id: sec1.id,
      title_en: "Ahimsa in daily life",
      title_hi: "दैनिक जीवन में अहिंसा",
      order_index: 1,
    },
    {
      section_id: sec1.id,
      title_en: "Satya and honesty",
      title_hi: "सत्य और ईमानदारी",
      order_index: 2,
    },
  ]);

  await db.insert(curricula).values({
    city_id: pune.id,
    name: "MSV Advanced Curriculum",
    kind: "msv",
    academic_year: "2025-26",
    status: "active",
  });

  /* ---------------- Exams ---------------- */
  const [exam1] = await db
    .insert(online_exams)
    .values({
      city_id: mumbai.id,
      title_en: "Term 1 Assessment",
      title_hi: "टर्म 1 मूल्यांकन",
      description_en: "Online assessment covering recent curriculum.",
      window_start: daysAgo(2),
      window_end: daysFromNow(5),
      exam_otp: "482910",
      total_marks: 50,
      pass_mark: 25,
      results_released: false,
    })
    .returning();

  // Questions (two single-choice, 25 marks each) + options.
  const [q1] = await db
    .insert(exam_questions)
    .values({
      exam_id: exam1.id,
      question_en: "How many times is the Navkar Mantra recited in the standard practice?",
      question_hi: "नवकार मंत्र मानक अभ्यास में कितनी बार बोला जाता है?",
      question_type: "single_choice",
      marks: 25,
      order_index: 0,
    })
    .returning();
  await db.insert(exam_question_options).values([
    { question_id: q1.id, option_en: "3 times", is_correct: false, order_index: 0 },
    { question_id: q1.id, option_en: "9 times", is_correct: true, order_index: 1 },
    { question_id: q1.id, option_en: "12 times", is_correct: false, order_index: 2 },
  ]);

  const [q2] = await db
    .insert(exam_questions)
    .values({
      exam_id: exam1.id,
      question_en: "Chauvihar means abstaining from food and water after which time?",
      question_hi: "चौविहार का अर्थ किस समय के बाद भोजन और जल का त्याग है?",
      question_type: "single_choice",
      marks: 25,
      order_index: 1,
    })
    .returning();
  await db.insert(exam_question_options).values([
    { question_id: q2.id, option_en: "Noon", is_correct: false, order_index: 0 },
    { question_id: q2.id, option_en: "Sunset", is_correct: true, order_index: 1 },
    { question_id: q2.id, option_en: "Midnight", is_correct: false, order_index: 2 },
  ]);

  const studentRows = await db.select({ id: students.id }).from(students).limit(2);
  if (studentRows[0]) {
    await db.insert(exam_attempts).values({
      exam_id: exam1.id,
      student_id: studentRows[0].id,
      started_at: daysAgo(1),
      submitted_at: daysAgo(1),
      score: 42,
      auto_score: 42,
      status: "submitted",
    });
  }

  /* ---------------- Donations ---------------- */
  const [campaign] = await db
    .insert(donation_campaigns)
    .values({
      city_id: mumbai.id,
      name: "Ghatkopar Centre Renovation",
      description: "Help upgrade classrooms and library space.",
      target_amount_paise: 500_000_00,
      raised_amount_paise: 125_000_00,
      is_public: true,
    })
    .returning();

  await db.insert(donations).values([
    {
      donor_name: "Rajesh Shah",
      donor_phone: "+919876543210",
      amount_paise: 50_000_00,
      purpose: "infrastructure",
      campaign_id: campaign.id,
      frequency: "one_time",
      status: "captured",
      payment_captured_at: daysAgo(10),
      eighty_g_eligible: true,
      receipt_number: "RCP-2025-001",
      financial_year: "2025-26",
    },
    {
      donor_name: "Priya Mehta",
      donor_phone: "+919812345678",
      amount_paise: 25_000_00,
      purpose: "general",
      frequency: "one_time",
      status: "captured",
      payment_captured_at: daysAgo(3),
      eighty_g_eligible: false,
      receipt_number: "RCP-2025-002",
      financial_year: "2025-26",
    },
    {
      donor_name: "Anonymous Donor",
      amount_paise: 10_000_00,
      purpose: "scholarship",
      campaign_id: campaign.id,
      frequency: "one_time",
      status: "captured",
      payment_captured_at: daysAgo(1),
      eighty_g_eligible: true,
    },
  ]);

  /* ---------------- Queue stats (dev) ---------------- */
  await db.insert(queue_stats).values([
    {
      queue_name: "notifications.fanout",
      waiting: 3,
      active: 1,
      completed_24h: 128,
      failed: 2,
    },
    {
      queue_name: "punya.award",
      waiting: 0,
      active: 0,
      completed_24h: 45,
      failed: 1,
    },
    {
      queue_name: "report.generation",
      waiting: 1,
      active: 0,
      completed_24h: 12,
      failed: 0,
    },
  ]);

  await db.insert(queue_dlq_jobs).values([
    {
      queue_name: "notifications.fanout",
      job_id: "nf-2025-001",
      payload: { event: "enrolment.approved", user_id: parent.id },
      error_message: "FCM token expired",
      failed_at: daysAgo(2),
    },
    {
      queue_name: "punya.award",
      job_id: "pa-2025-007",
      payload: { student_id: studentRows[0]?.id, points: 10 },
      error_message: "Duplicate idempotency key",
      failed_at: daysAgo(1),
    },
  ]);

  /* ---------------- Settings ---------------- */
  await db.insert(settings).values({
    key: "default_otp_code",
    value: "123456",
    updated_at: new Date(),
  });

  console.log("Seed complete.");
  console.log("\nLogin phones (OTP code: 123456 for all users via settings):");
  console.log("  super_admin : +919800000001");
  console.log("  state_admin : +919800000002");
  console.log("  city_admin  : +919800000003");
  console.log("  sanchalak   : +919800000004");
  console.log("  shikshak    : +919800000005");
  console.log("  parent      : +919800000006");
  console.log("  student     : +919800000007");
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await pool.end();
    process.exit(1);
  });
