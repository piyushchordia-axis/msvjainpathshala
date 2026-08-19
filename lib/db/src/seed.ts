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
  shikshak_centre_assignments,
  shikshak_batch_assignments,
  students,
  enrolments,
  msv_enrolments,
  sessions,
  attendance,
  absence_notifications,
  sync_operations,
  punya_transactions,
  punya_balances,
  punya_features,
  punya_award_limits,
  punya_configs,
  niyams,
  niyam_submissions,
  niyam_submission_media,
  notices,
  shivir_events,
  shivir_sessions,
  shivir_volunteers,
  shivir_registrations,
  library_sections,
  library_subsections,
  library_items,
  library_access_logs,
  library_content_requests,
  granth_libraries,
  granth_entries,
  granth_availability,
  gallery_items,
  settings,
  courses,
  course_sections,
  course_subsections,
  online_exams,
  exam_questions,
  exam_question_options,
  exam_attempts,
  donation_campaigns,
  donations,
  queue_stats,
  queue_dlq_jobs,
  homework_assignments,
  homework_submissions,
  registration_form_configs,
  registration_form_responses,
  join_form_fields,
  join_settings,
  service_requests,
  service_request_messages,
  student_course_progress,
  progress_reports,
  audit_logs,
  competitions,
  competition_registrations,
  questions,
  quiz_events,
  quiz_event_questions,
  push_quizzes,
  push_quiz_questions,
  enquiries,
  entity_code_counters,
  team_categories,
} from "./schema";
import { tierForPoints } from "./schema/enums";
import {
  PUNYA_FEATURE_CATALOGUE,
  PUNYA_CONFIG_DEFAULTS,
} from "./punya-catalogue";
import { sql, eq } from "drizzle-orm";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seedIndoreNetwork } from "./seed-indore";
import { seedLibraryContent } from "./seed-library-content";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

/** Mirror of api-server niyam-period helper for seed inserts. */
function periodKey(niyamType: string, ymd: string): string {
  if (niyamType === "daily") return ymd;
  if (niyamType === "monthly") return ymd.slice(0, 7);
  const [y, m, d] = ymd.split("-").map(Number);
  const tmp = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  // Hard guard: this script truncates all domain tables. Never allow it to run
  // against a production database, even if a prod DATABASE_URL is in the shell.
  if (process.env.NODE_ENV === "production") {
    console.error(
      "Refusing to seed: NODE_ENV=production. This script TRUNCATEs all domain tables and would irreversibly wipe production data.",
    );
    process.exit(1);
  }
  if (process.env.ALLOW_SEED !== "1") {
    console.error(
      "Refusing to seed: destructive seed disabled. Set ALLOW_SEED=1 to explicitly opt in.",
    );
    process.exit(1);
  }

  console.log("Seeding database…");

  // Clear domain tables (order does not matter with CASCADE).
  await db.execute(sql`
    truncate table
      audit_logs,
      enquiries, notifications, device_push_tokens,
      shivir_attendance_scans, shivir_sessions, shivir_registrations, shivir_volunteers,
      competition_registrations, competitions,
      push_quiz_attempts, push_quiz_questions, push_quizzes,
      quiz_attempts, quiz_event_questions, quiz_events, questions,
      homework_submissions, homework_assignments,
      registration_form_responses, registration_form_configs,
      join_student_registrations, join_shikshak_registrations, join_sanchalak_registrations,
      join_form_fields, join_settings,
      service_request_messages, service_requests,
      progress_reports, student_course_progress, course_certificates,
      course_template_subsections, course_template_sections, course_templates,
      queue_dlq_jobs, queue_stats, donations, donation_campaigns,
      exam_answers, exam_attempts, exam_question_options, exam_questions, online_exams,
      course_subsections, course_sections, courses,
      granth_availability, granth_entries, granth_libraries, library_content_requests,
      library_access_logs,
      gallery_items, library_items, library_subsections, library_sections, shivir_events, notices,
      niyam_streaks, niyam_submission_media, niyam_submissions, niyams,
      punya_balances, punya_transactions, punya_configs, punya_features, punya_award_limits,
      attendance, sessions, absence_notifications, sync_operations,
      digital_id_cards, msv_enrolments, enrolments, students,
      shikshak_batch_assignments, shikshak_centre_assignments, sanchalak_centre_assignments,
      centre_holidays, batches, centres, entity_code_counters,
      notice_reads, settings,
      team_members, team_categories,
      otp_codes, device_sessions, users,
      cities, states
    restart identity cascade
  `);

  /* ---------------- Punya feature catalogue (AT21) ---------------- */
  // Derived from the canonical catalogue so the seed and the migrations
  // cannot drift again. The seed TRUNCATEs punya_features above, so anything
  // a migration inserted but this list omits is silently destroyed -- that is
  // how `attendance_streak` disappeared from every seeded database while the
  // admin UI went on offering to edit it (H8). See punya-catalogue.ts.
  await db.insert(punya_features).values([...PUNYA_FEATURE_CATALOGUE]);

  await db.insert(punya_configs).values([...PUNYA_CONFIG_DEFAULTS]);

  await db.insert(punya_award_limits).values([
    { role: "shikshak", max_points_per_award: 10, max_points_per_day: 50, is_active: true },
    { role: "sanchalak", max_points_per_award: 25, max_points_per_day: 150, is_active: true },
    { role: "city_admin", max_points_per_award: 100, max_points_per_day: 500, is_active: true },
    { role: "state_admin", max_points_per_award: 250, max_points_per_day: 1000, is_active: true },
    { role: "super_admin", max_points_per_award: 500, max_points_per_day: null, is_active: true },
  ]);

  /* ---------------- Geography ---------------- */
  const [maharashtra] = await db
    .insert(states)
    .values({ name: "Maharashtra", code: "MH" })
    .returning();
  const [gujarat] = await db.insert(states).values({ name: "Gujarat", code: "GJ" }).returning();
  const [madhyaPradesh] = await db
    .insert(states)
    .values({ name: "Madhya Pradesh", code: "MP" })
    .returning();

  const [mumbai] = await db
    .insert(cities)
    .values({ state_id: maharashtra.id, name: "Mumbai", code: "MUM", slug: "mumbai" })
    .returning();
  const [pune] = await db
    .insert(cities)
    .values({ state_id: maharashtra.id, name: "Pune", code: "PUN", slug: "pune" })
    .returning();
  const [ahmedabad] = await db
    .insert(cities)
    .values({ state_id: gujarat.id, name: "Ahmedabad", code: "AMD", slug: "ahmedabad" })
    .returning();
  const [indore] = await db
    .insert(cities)
    .values({ state_id: madhyaPradesh.id, name: "Indore", code: "IDR", slug: "indore" })
    .returning();

  /* ---------------- Team categories (public directory) ---------------- */
  await db.insert(team_categories).values([
    {
      key: "core_team",
      name_en: "Core Team",
      name_hi: "मुख्य टीम",
      order: 1,
      display_style: "grid",
      group_by: "none",
      is_lazy_loaded: false,
      is_published: true,
    },
    {
      key: "sanchalak",
      name_en: "Sanchalak",
      name_hi: "संचालक",
      order: 2,
      display_style: "grid",
      group_by: "none",
      is_lazy_loaded: false,
      is_published: true,
    },
    {
      key: "shikshak",
      name_en: "Gurujis & Didis",
      name_hi: "गुरुजी एवं दीदी",
      order: 3,
      display_style: "grid",
      group_by: "centre",
      is_lazy_loaded: true,
      is_published: true,
    },
  ]);

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
      display_code: "MH-SAD-00001",
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
      display_code: "MUM-CAD-00001",
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
      display_code: "MUM-GHK-SAN-00001",
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
      display_code: "MUM-GHK-SHK-00001",
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
      display_code: "MUM-PAR-00001",
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

  /* ---------------- Indore personas (Madhya Pradesh) ---------------- */
  const [indoreStateAdmin] = await db
    .insert(users)
    .values({
      phone: "+919800000011",
      role: "state_admin",
      full_name: "MP State Admin (Indore)",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      display_code: "MP-SAD-00001",
    })
    .returning();

  const [indoreCityAdmin] = await db
    .insert(users)
    .values({
      phone: "+919800000012",
      role: "city_admin",
      full_name: "Indore City Admin",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      city_id: indore.id,
      display_code: "IDR-CAD-00001",
    })
    .returning();

  const [indoreSanchalak] = await db
    .insert(users)
    .values({
      phone: "+919800000013",
      role: "sanchalak",
      full_name: "Indore Sanchalak",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      city_id: indore.id,
      display_code: "IDR-SAP-SAN-00001",
    })
    .returning();

  const [indoreShikshak] = await db
    .insert(users)
    .values({
      phone: "+919800000014",
      role: "shikshak",
      full_name: "Indore Shikshak",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      city_id: indore.id,
      display_code: "IDR-SAP-SHK-00001",
    })
    .returning();

  const [indoreParent] = await db
    .insert(users)
    .values({
      phone: "+919800000015",
      role: "parent",
      full_name: "Indore Parent",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      city_id: indore.id,
      gallery_visibility_opt_in: true,
      display_code: "IDR-PAR-00001",
    })
    .returning();

  const [indoreStudentUser] = await db
    .insert(users)
    .values({
      phone: "+919800000016",
      role: "student",
      full_name: "Reyansh Jain",
      preferred_language: "hi",
      state_id: madhyaPradesh.id,
      city_id: indore.id,
    })
    .returning();

  /* ---------------- Centres ---------------- */
  const [centreA] = await db
    .insert(centres)
    .values({
      state_id: maharashtra.id,
      city_id: mumbai.id,
      code: "MUM-GHK",
      name: "Ghatkopar Jain Pathshala",
      locality: "Ghatkopar East",
      pincode: "400077",
      contact_phone: "+912200000001",
      contact_email: "ghatkopar@example.org",
      lat: "19.0861000",
      lng: "72.9081000",
      gps_radius_meters: 250,
      status: "active",
    })
    .returning();

  const [centreB] = await db
    .insert(centres)
    .values({
      state_id: maharashtra.id,
      city_id: pune.id,
      code: "PUN-KOT",
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
      code: "AMD-MAN",
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
      age_groups: ["bal"],
      day_of_week: [7],
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
      age_groups: ["kishor"],
      day_of_week: [7],
      start_time: "10:30:00",
      end_time: "12:00:00",
      capacity: 30,
      language_preference: "en",
      status: "active",
    })
    .returning();

  // Same centre as batchA1/A2 but deliberately NOT in Pathshala Shikshak's
  // batch assignments — homework tests need an out-of-batch sibling to prove
  // batch-scoped reads (FIX #1). Unique name so tests do not confuse it with
  // Indore Tarun batches that share the generic "Sunday Afternoon" label.
  const [batchA3] = await db
    .insert(batches)
    .values({
      centre_id: centreA.id,
      name: "Tarun Batch - Unassigned Scope Fixture",
      age_groups: ["tarun"],
      day_of_week: [7],
      start_time: "14:00:00",
      end_time: "15:30:00",
      capacity: 20,
      language_preference: "hi",
      status: "active",
    })
    .returning();
  void batchA3; // referenced only as the unassigned sibling fixture

  const [batchB1] = await db
    .insert(batches)
    .values({
      centre_id: centreB.id,
      name: "Tarun Batch - Saturday Evening",
      age_groups: ["tarun"],
      day_of_week: [6],
      start_time: "17:00:00",
      end_time: "18:30:00",
      capacity: 20,
      language_preference: "en",
      status: "active",
    })
    .returning();

  /* ---------------- Assignments (Mumbai) ---------------- */
  await db.insert(sanchalak_centre_assignments).values([
    { user_id: sanchalak.id, centre_id: centreA.id },
  ]);
  await db.insert(shikshak_centre_assignments).values([
    { user_id: shikshak.id, centre_id: centreA.id },
  ]);
  await db.insert(shikshak_batch_assignments).values([
    { user_id: shikshak.id, batch_id: batchA1.id, is_primary: true },
    { user_id: shikshak.id, batch_id: batchA2.id, is_primary: true },
  ]);

  /* ---------------- Indore network (5 centres + staffing + students) ---------------- */
  const indoreNet = await seedIndoreNetwork({
    stateId: madhyaPradesh.id,
    cityId: indore.id,
    assignedBy: indoreCityAdmin.id,
    personas: {
      sanchalak: indoreSanchalak,
      shikshak: indoreShikshak,
      parent: indoreParent,
      studentUser: indoreStudentUser,
    },
  });
  const centreIndore = indoreNet.demo.centre0;
  const batchIndore1 = indoreNet.demo.batchBal0;
  const batchIndore2 = indoreNet.demo.batchKishor0;

  /* ---------------- Students ---------------- */
  const studentSeeds = [
    {
      full_name: "Aarav Shah",
      code: "MUM-STU-00001",
      age_group: "bal" as const,
      centre_id: centreA.id,
      batch_id: batchA1.id,
      msv_status: "approved" as const,
      msv_code: "MSV00001",
      user_id: studentUser.id,
      parent_id: parent.id,
      dob: "2016-04-12",
    },
    {
      full_name: "Diya Mehta",
      code: "MUM-STU-00002",
      age_group: "bal" as const,
      centre_id: centreA.id,
      batch_id: batchA1.id,
      msv_status: "none" as const,
      parent_id: parent.id,
      dob: "2015-09-03",
    },
    {
      full_name: "Kabir Jain",
      code: "MUM-STU-00003",
      age_group: "kishor" as const,
      centre_id: centreA.id,
      batch_id: batchA2.id,
      msv_status: "applied" as const,
      parent_id: parent.id,
      dob: "2012-01-22",
    },
    {
      full_name: "Anaya Doshi",
      code: "PUN-STU-00001",
      age_group: "tarun" as const,
      centre_id: centreB.id,
      batch_id: batchB1.id,
      msv_status: "approved" as const,
      msv_code: "MSV00002",
      dob: "2009-11-30",
    },
    {
      full_name: "Vivaan Sanghvi",
      code: "MUM-STU-00004",
      age_group: "kishor" as const,
      centre_id: centreA.id,
      batch_id: batchA2.id,
      msv_status: "none" as const,
      dob: "2011-06-18",
    },
  ];

  const mumbaiStudents = await db
    .insert(students)
    .values(
      studentSeeds.map((s) => ({
        full_name: s.full_name,
        student_code: s.code,
        age_group: s.age_group,
        centre_id: s.centre_id,
        batch_id: s.batch_id,
        msv_status: s.msv_status,
        msv_code: s.msv_code ?? null,
        user_id: s.user_id ?? null,
        parent_id: s.parent_id ?? null,
        dob: s.dob,
        status: "active" as const,
      })),
    )
    .returning();

  // Preserve prior index assumptions for Mumbai rows (0–4), then append Indore.
  const indoreReyansh = indoreNet.students.find((s) => s.student_code === "IDR-STU-00001")!;
  const indoreMyra = indoreNet.students.find((s) => s.student_code === "IDR-STU-00002")!;
  const indoreArjun = indoreNet.students.find((s) => s.student_code === "IDR-STU-00003")!;
  const insertedStudents = [
    ...mumbaiStudents,
    indoreReyansh,
    indoreMyra,
    indoreArjun,
  ] as typeof mumbaiStudents;

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

  // MSV enrolments MUST stay consistent with students.msv_status: every student
  // whose msv_status is "applied"/"approved" needs a matching latest msv_enrolments
  // row (the student record mirrors the latest decision — see routes/v1/msv.ts).
  // Aarav (idx 0) and Anaya (idx 3) are both seeded approved; Kabir (idx 2) applied.
  // Omitting Anaya's row previously desynced id-cards/competitions/admin lists.
  await db.insert(msv_enrolments).values([
    {
      student_id: insertedStudents[0].id,
      status: "approved",
      decided_by: superAdmin.id,
      decided_at: daysAgo(40),
    },
    {
      student_id: insertedStudents[3].id,
      status: "approved",
      decided_by: superAdmin.id,
      decided_at: daysAgo(35),
    },
    { student_id: insertedStudents[2].id, status: "applied" },
    {
      student_id: insertedStudents[5].id,
      status: "approved",
      decided_by: indoreStateAdmin.id,
      decided_at: daysAgo(20),
    },
    { student_id: insertedStudents[7].id, status: "applied" },
    ...indoreNet.students
      .filter(
        (s) =>
          (s.msv_status === "approved" || s.msv_status === "applied") &&
          s.student_code !== "IDR-STU-00001" &&
          s.student_code !== "IDR-STU-00003",
      )
      .map((s) =>
        s.msv_status === "approved"
          ? {
              student_id: s.id,
              status: "approved" as const,
              decided_by: indoreCityAdmin.id,
              decided_at: daysAgo(15),
            }
          : { student_id: s.id, status: "applied" as const },
      ),
  ]);

  /* ---------------- Sessions + Attendance ---------------- */
  const indoreAttendanceSample = (batchId: string, limit = 4) =>
    indoreNet.students.filter((s) => s.batch_id === batchId).slice(0, limit).map((s) => s.id);

  const batchStudents: Record<string, string[]> = {
    [batchA1.id]: [insertedStudents[0].id, insertedStudents[1].id],
    [batchA2.id]: [insertedStudents[2].id, insertedStudents[4].id],
    [batchB1.id]: [insertedStudents[3].id],
    [batchIndore1.id]: indoreAttendanceSample(batchIndore1.id, 6),
    [batchIndore2.id]: indoreAttendanceSample(batchIndore2.id, 6),
  };

  // Sample sessions for remaining Indore centre-0 tarun + one batch at each other centre.
  for (const [ci, key] of [
    [0, "tarun"],
    [1, "bal"],
    [2, "kishor"],
    [3, "tarun"],
    [4, "bal"],
  ] as const) {
    const b = indoreNet.batchGrid[ci]![key];
    batchStudents[b.id] = indoreAttendanceSample(b.id, 4);
  }

  const sessionBatches: Array<{ batch: { id: string }; teacherId: string }> = [
    { batch: batchA1, teacherId: shikshak.id },
    { batch: batchA2, teacherId: shikshak.id },
    { batch: batchB1, teacherId: shikshak.id },
    { batch: batchIndore1, teacherId: indoreShikshak.id },
    { batch: batchIndore2, teacherId: indoreShikshak.id },
    { batch: indoreNet.batchGrid[0]!.tarun, teacherId: indoreNet.shikshaks[1]!.id },
    { batch: indoreNet.batchGrid[1]!.bal, teacherId: indoreNet.shikshaks[1]!.id },
    { batch: indoreNet.batchGrid[2]!.kishor, teacherId: indoreNet.shikshaks[3]!.id },
    { batch: indoreNet.batchGrid[3]!.tarun, teacherId: indoreNet.shikshaks[5]!.id },
    { batch: indoreNet.batchGrid[4]!.bal, teacherId: indoreNet.shikshaks[6]!.id },
  ];

  for (const { batch, teacherId } of sessionBatches) {
    for (let w = 1; w <= 4; w++) {
      const [session] = await db
        .insert(sessions)
        .values({
          batch_id: batch.id,
          scheduled_date: isoDate(daysAgo(w * 7)),
          status: "completed",
          topic: `Week ${5 - w} — Navkar Mantra & stavan`,
          conducted_by: teacherId,
        })
        .returning();

      const ids = batchStudents[batch.id] ?? [];
      for (const studentId of ids) {
        const roll = Math.random();
        const status = roll < 0.75 ? "present" : roll < 0.85 ? "late" : roll < 0.95 ? "excused" : "absent";
        await db.insert(attendance).values({
          session_id: session.id,
          student_id: studentId,
          session_date: session.scheduled_date,
          status,
          marked_by: teacherId,
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
        proof_type: "any",
        proof_required: false,
        approval_mode: "auto",
        max_uploads: 3,
        points: 10,
      },
      {
        title_en: "Chauvihar (no food after sunset)",
        title_hi: "चौविहार (सूर्यास्त के बाद नहीं)",
        niyam_type: "daily",
        proof_type: "photo",
        proof_required: true,
        approval_mode: "review",
        max_uploads: 2,
        points: 15,
      },
      {
        title_en: "Samayik (weekly)",
        title_hi: "सामायिक (साप्ताहिक)",
        niyam_type: "weekly",
        proof_type: "any",
        proof_required: false,
        approval_mode: "auto",
        max_uploads: 5,
        points: 25,
      },
      {
        title_en: "Monthly Pratikraman",
        title_hi: "मासिक प्रतिक्रमण",
        description_en: "Complete monthly pratikraman with optional audio/video proof.",
        description_hi: "मासिक प्रतिक्रमण पूरा करें।",
        niyam_type: "monthly",
        proof_type: "audio",
        proof_required: true,
        approval_mode: "review",
        max_uploads: 1,
        points: 40,
      },
    ])
    .returning();

  /* ---------------- Niyam submissions + Punya + Gallery ---------------- */
  const punyaByStudent: Record<string, number> = {};

  for (const student of insertedStudents) {
    for (let d = 0; d < 6; d++) {
      // Prefer daily auto niyam for streak-friendly seed history.
      const niyam = insertedNiyams[0];
      const submissionDate = isoDate(daysAgo(d));
      const [submission] = await db
        .insert(niyam_submissions)
        .values({
          niyam_id: niyam.id,
          student_id: student.id,
          submission_date: submissionDate,
          period_key: periodKey(niyam.niyam_type, submissionDate),
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

      // Feature approved students' first submission in the public gallery
      // (unfeatured — city_admin+ must curate onto the wall / home carousel).
      if (submission.is_featured) {
        let cityId: string | null = null;
        if (student.centre_id) {
          const [centreRow] = await db
            .select({ city_id: centres.city_id })
            .from(centres)
            .where(eq(centres.id, student.centre_id))
            .limit(1);
          cityId = centreRow?.city_id ?? null;
        }
        await db.insert(gallery_items).values({
          student_id: student.id,
          niyam_id: niyam.id,
          submission_id: submission.id,
          city_id: cityId,
          featured_gallery: false,
          featured_home: false,
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

  // Pending review submissions with proof media.
  const pendingProof1 = "http://localhost:8080/uploads/niyam-proof/seed-sample1.jpg";
  const pendingProof2 = "http://localhost:8080/uploads/niyam-proof/seed-sample2.jpg";
  const pendingRows = await db
    .insert(niyam_submissions)
    .values([
      {
        niyam_id: insertedNiyams[1].id,
        student_id: insertedStudents[0].id,
        submission_date: isoDate(daysAgo(0)),
        period_key: periodKey(insertedNiyams[1].niyam_type, isoDate(daysAgo(0))),
        status: "pending",
        points_awarded: 0,
        proof_url: pendingProof1,
        notes: "Completed chauvihar today.",
        submitted_by: parent.id,
      },
      {
        niyam_id: insertedNiyams[3].id,
        student_id: insertedStudents[1].id,
        submission_date: isoDate(daysAgo(1)),
        period_key: periodKey(insertedNiyams[3].niyam_type, isoDate(daysAgo(1))),
        status: "pending",
        points_awarded: 0,
        proof_url: pendingProof2,
        submitted_by: parent.id,
      },
    ])
    .returning();

  await db.insert(niyam_submission_media).values([
    {
      submission_id: pendingRows[0]!.id,
      url: pendingProof1,
      kind: "photo",
      mime: "image/jpeg",
      ordinal: 0,
    },
    {
      submission_id: pendingRows[1]!.id,
      url: pendingProof2,
      kind: "photo",
      mime: "image/jpeg",
      ordinal: 0,
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
  const seededShivirs = await db
    .insert(shivir_events)
    .values([
      {
        name_en: "Summer Sanskar Shivir 2026",
        name_hi: "ग्रीष्म संस्कार शिविर 2026",
        description_en: "A 5-day residential shivir focused on Jain values and meditation.",
        description_hi: "जैन मूल्यों और ध्यान पर केंद्रित 5-दिवसीय आवासीय शिविर।",
        state_id: maharashtra.id,
        city_id: mumbai.id,
        start_date: isoDate(daysFromNow(20)),
        end_date: isoDate(daysFromNow(24)),
        location_text: "Ghatkopar Upashray, Mumbai",
        capacity: 120,
        contact_info: "Call +91 98000 00004 for registration.",
        attendance_mode: "in_out" as const,
        is_published: true,
      },
      {
        name_en: "Pune Youth Shibir",
        name_hi: "पुणे युवा शिबिर",
        description_en: "Weekend shibir for tarun and yuva age groups.",
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
        name_en: "Past Diwali Shivir 2025",
        description_en: "Archived event (should not appear in upcoming list).",
        state_id: gujarat.id,
        city_id: ahmedabad.id,
        start_date: isoDate(daysAgo(120)),
        end_date: isoDate(daysAgo(118)),
        location_text: "Maninagar, Ahmedabad",
        is_published: true,
      },
      // Draft + MSV-only, so the admin "Draft" label and the guest msv_only
      // filter both have something to be true about.
      {
        name_en: "MSV Sadhak Retreat (draft)",
        name_hi: "एमएसवी साधक शिविर (प्रारूप)",
        description_en: "MSV-only retreat, unpublished — used to exercise draft and MSV gating.",
        state_id: maharashtra.id,
        city_id: mumbai.id,
        start_date: isoDate(daysFromNow(60)),
        end_date: isoDate(daysFromNow(62)),
        location_text: "Ghatkopar Upashray, Mumbai",
        capacity: 2,
        msv_only: true,
        is_published: false,
      },
    ])
    .returning({ id: shivir_events.id, name_en: shivir_events.name_en });

  const summerShivir = seededShivirs[0]!;

  /**
   * Sessions, one volunteer and a few registrations.
   *
   * None of this existed before: shivir_registrations and shivir_volunteers had
   * no writers anywhere in the repo, so the "registered volunteer" arm of the
   * scan authorization had never once had a row to match and the dashboard's
   * Registered figure was structurally zero.
   */
  const seededShivirSessions = await db
    .insert(shivir_sessions)
    .values([
      {
        shivir_id: summerShivir.id,
        title: "Day 1 — Arrival and Mangalacharan",
        day_number: 1,
        session_date: isoDate(daysFromNow(20)),
        start_time: "09:00",
        end_time: "17:00",
        attendance_mode: "in_out" as const,
      },
      {
        shivir_id: summerShivir.id,
        title: "Day 2 — Samayik and Swadhyay",
        day_number: 2,
        session_date: isoDate(daysFromNow(21)),
        start_time: "09:00",
        end_time: "17:00",
        attendance_mode: "in_out" as const,
      },
    ])
    .returning({ id: shivir_sessions.id });

  await db.insert(shivir_volunteers).values([
    {
      shivir_id: summerShivir.id,
      user_id: shikshak.id,
      role_label: "Gate scanning",
      assigned_by: sanchalak.id,
    },
    {
      shivir_id: summerShivir.id,
      user_id: sanchalak.id,
      role_label: "Coordinator",
      assigned_by: cityAdmin.id,
    },
  ]);

  await db.insert(shivir_registrations).values(
    insertedStudents.slice(0, 3).map((s) => ({
      shivir_id: summerShivir.id,
      student_id: s.id,
      registered_by_user_id: parent.id,
    })),
  );

  void seededShivirSessions;

  /* ---------------- Library (Section → SubSection → Item) ---------------- */
  await seedLibraryContent(db);

  /* ---------------- Courses (CU1) ---------------- */
  const [curriculumStd] = await db
    .insert(courses)
    .values({
      city_id: mumbai.id,
      name_en: "Foundation Jain Studies 2025-26",
      name_hi: "आधारभूत जैन अध्ययन 2025-26",
      kind: "standard",
      academic_year: "2025-26",
      status: "active",
      punya_points: 0,
    })
    .returning();

  const [sec1] = await db
    .insert(course_sections)
    .values({
      course_id: curriculumStd.id,
      title_en: "Core Values",
      title_hi: "मूल मूल्य",
      order_index: 1,
      punya_points: 20,
    })
    .returning();

  await db.insert(course_subsections).values([
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

  await db.insert(courses).values({
    city_id: pune.id,
    name_en: "MSV Advanced Curriculum",
    kind: "msv",
    academic_year: "2025-26",
    status: "draft",
    punya_points: 0,
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
      payment_status: "captured" as const,
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
      payment_status: "captured" as const,
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
      payment_status: "captured" as const,
      payment_captured_at: daysAgo(1),
      eighty_g_eligible: true,
    },
  ]);

  /* ---------------- Queue stats (dev) ----------------
     Names must be real QUEUE_NAMES members (@jp/shared/constants) — the old
     seed invented SPEC-era queues ('notifications.fanout', 'punya.award')
     that do not exist, so the admin Queues page opened on a dead DLQ. */
  await db.insert(queue_stats).values([
    {
      queue_name: "notifications.parent",
      waiting: 3,
      active: 1,
      completed_24h: 128,
      failed: 2,
    },
    {
      queue_name: "punya.reconcile",
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
      queue_name: "notifications.parent",
      job_id: "nf-2025-001",
      payload: { event: "enrolment.approved", user_id: parent.id },
      error_message: "FCM token expired",
      failed_at: daysAgo(2),
    },
    {
      queue_name: "punya.reconcile",
      job_id: "pa-2025-007",
      payload: { student_id: studentRows[0]?.id, points: 10 },
      error_message: "Duplicate idempotency key",
      failed_at: daysAgo(1),
    },
  ]);

  /* ---------------- Settings ---------------- */
  await db.insert(settings).values([
    {
      key: "gallery_carousel_interval_ms",
      value: "2000",
      updated_at: new Date(),
    },
  ]);

  /* ---------------- Homework (Wave 2) ---------------- */
  const [homeworkA1] = await db
    .insert(homework_assignments)
    .values({
      batch_id: batchA1.id,
      title: "Learn the Navkar Mantra",
      description: "Memorise and recite the Navkar Mantra; upload a short video.",
      due_date: "2026-06-30",
      is_msv: false,
      created_by: shikshak.id,
    })
    .returning();
  await db.insert(homework_submissions).values([
    {
      assignment_id: homeworkA1.id,
      student_id: insertedStudents[0].id,
      status: "starred" as const,
      submission_url: "https://example.com/aarav-navkar.mp4",
      feedback_note: "Beautifully recited!",
      marked_by: shikshak.id,
      marked_at: new Date(),
      late: false,
    },
    {
      assignment_id: homeworkA1.id,
      student_id: insertedStudents[1].id,
      status: "pending" as const,
    },
  ]);

  /* ---------------- Registration forms (Wave 2) ---------------- */
  const [studentRegConfig] = await db
    .insert(registration_form_configs)
    .values({
      city_id: null,
      form_kind: "student",
      title_en: "Student Registration",
      title_hi: "विद्यार्थी पंजीकरण",
      is_active: true,
      version_no: 1,
      fields: [
        {
          key: "age_group",
          label_en: "Age Group",
          label_hi: "आयु वर्ग",
          type: "select",
          required: true,
          options: [
            { value: "bal", label_en: "Bal 5-8 years", label_hi: "बाल 5-8 वर्ष" },
            { value: "kishor", label_en: "Kishor 9-12 years", label_hi: "किशोर 9-12 वर्ष" },
            { value: "tarun", label_en: "Tarun 13-16 years", label_hi: "तरुण 13-16 वर्ष" },
            { value: "yuva", label_en: "Yuva 17-21 years", label_hi: "युवा 17-21 वर्ष" },
          ],
        },
        { key: "parent_phone", label_en: "Parent Phone", label_hi: "अभिभावक फ़ोन", type: "tel", required: false },
      ],
      published_at: new Date(),
      published_by: superAdmin.id,
    })
    .returning();
  await db.insert(registration_form_responses).values([
    {
      form_config_id: studentRegConfig.id,
      full_name: "Riya Mehta",
      phone: "+919812345678",
      status: "submitted",
      responses: { full_name: "Riya Mehta", age_group: "bal", parent_phone: "+919812345678" },
    },
  ]);

  /* ---------------- Join / gan onboarding (pre-login) ---------------- */
  const joinKinds = ["student", "shikshak", "sanchalak"] as const;
  await db.insert(join_settings).values([
    ...joinKinds.map((kind) => ({
      kind,
      key: "registration_open",
      value: "yes",
      label: "Registration open",
    })),
    // Payment is only ever collected for the student MSV journey — Pathshala
    // enrolment and staff seva are free, so the staff kinds get no payment rows.
    { kind: "student" as const, key: "payment_amount", value: "501", label: "Payment amount (INR)" },
    { kind: "student" as const, key: "payment_upi_id", value: "msv@upi", label: "UPI ID" },
    { kind: "student" as const, key: "payment_name", value: "Megh Sanskar Vatika", label: "Payee name" },
    { kind: "student" as const, key: "payment_qr_image", value: "", label: "Payment QR image URL" },
  ]);

  type JoinFieldSeed = {
    kind: (typeof joinKinds)[number];
    field_key: string;
    label_hi: string;
    label_en: string;
    field_type: string;
    options?: string[] | null;
    is_required: boolean;
    display_order: number;
    placeholder_hi?: string;
    placeholder_en?: string;
  };

  const studentFields: JoinFieldSeed[] = [
    { kind: "student", field_key: "name", label_hi: "नाम", label_en: "Name", field_type: "text", is_required: true, display_order: 1 },
    { kind: "student", field_key: "father_name", label_hi: "पिता का नाम", label_en: "Father's name", field_type: "text", is_required: true, display_order: 2 },
    {
      kind: "student",
      field_key: "parent_mobile",
      label_hi: "अभिभावक मोबाइल",
      label_en: "Parent mobile",
      field_type: "text",
      is_required: true,
      display_order: 3,
      placeholder_hi: "10 अंक",
      placeholder_en: "10 digits",
    },
    {
      kind: "student",
      field_key: "mobile",
      label_hi: "विद्यार्थी मोबाइल (वैकल्पिक)",
      label_en: "Student mobile (optional)",
      field_type: "text",
      is_required: false,
      display_order: 4,
      placeholder_hi: "10 अंक",
      placeholder_en: "10 digits",
    },
    { kind: "student", field_key: "sex", label_hi: "लिंग", label_en: "Gender", field_type: "dropdown", options: ["Male", "Female"], is_required: true, display_order: 5 },
    { kind: "student", field_key: "date_of_birth", label_hi: "जन्म तिथि", label_en: "Date of birth", field_type: "date", is_required: true, display_order: 6 },
    { kind: "student", field_key: "education", label_hi: "शिक्षा", label_en: "Education", field_type: "text", is_required: false, display_order: 7 },
    { kind: "student", field_key: "email", label_hi: "ईमेल", label_en: "Email", field_type: "text", is_required: false, display_order: 8 },
    { kind: "student", field_key: "address", label_hi: "पता", label_en: "Address", field_type: "textarea", is_required: true, display_order: 9 },
    { kind: "student", field_key: "sang_name", label_hi: "संग नाम", label_en: "Sang name", field_type: "text", is_required: false, display_order: 10 },
    { kind: "student", field_key: "pathshala_nearby", label_hi: "नज़दीकी पाठशाला", label_en: "Nearby Pathshala", field_type: "text", is_required: false, display_order: 11 },
    { kind: "student", field_key: "attended_last_season", label_hi: "पिछले सीज़न में भाग लिया?", label_en: "Attended last season?", field_type: "yesno", is_required: false, display_order: 12 },
    { kind: "student", field_key: "family_members", label_hi: "परिवार के सदस्य", label_en: "Family members", field_type: "number", is_required: false, display_order: 13 },
    { kind: "student", field_key: "will_attend", label_hi: "उपस्थित रहेंगे?", label_en: "Will attend?", field_type: "yesno", is_required: false, display_order: 14 },
    { kind: "student", field_key: "special_note", label_hi: "विशेष नोट", label_en: "Special note", field_type: "textarea", is_required: false, display_order: 15 },
    { kind: "student", field_key: "photo", label_hi: "फ़ोटो", label_en: "Photo", field_type: "photo", is_required: true, display_order: 16 },
  ];

  const staffFieldDefs: Omit<JoinFieldSeed, "kind">[] = [
    { field_key: "name", label_hi: "नाम", label_en: "Name", field_type: "text", is_required: true, display_order: 1 },
    { field_key: "s_o", label_hi: "पुत्र / पुत्री", label_en: "S/O or D/O", field_type: "text", is_required: false, display_order: 2 },
    { field_key: "date_of_birth", label_hi: "जन्म तिथि", label_en: "Date of birth", field_type: "date", is_required: true, display_order: 3 },
    { field_key: "whatsapp_contact", label_hi: "WhatsApp नंबर", label_en: "WhatsApp number", field_type: "text", is_required: true, display_order: 4, placeholder_hi: "10 अंक", placeholder_en: "10 digits" },
    { field_key: "school_qualification", label_hi: "शैक्षणिक योग्यता", label_en: "School qualification", field_type: "text", is_required: false, display_order: 5 },
    { field_key: "religious_education", label_hi: "धार्मिक शिक्षा", label_en: "Religious education", field_type: "text", is_required: false, display_order: 6 },
    { field_key: "years_at_pathshala", label_hi: "पाठशाला में वर्ष", label_en: "Years at Pathshala", field_type: "number", is_required: false, display_order: 7 },
    { field_key: "current_pathshala", label_hi: "वर्तमान पाठशाला", label_en: "Current Pathshala", field_type: "text", is_required: false, display_order: 8 },
    { field_key: "pathshala_name", label_hi: "पाठशाला का नाम", label_en: "Pathshala name", field_type: "text", is_required: false, display_order: 9 },
    { field_key: "pathshala_timing", label_hi: "पाठशाला समय", label_en: "Pathshala timing", field_type: "text", is_required: false, display_order: 10 },
    { field_key: "address", label_hi: "पता", label_en: "Address", field_type: "textarea", is_required: false, display_order: 11 },
    { field_key: "vision", label_hi: "दृष्टि / संकल्प", label_en: "Vision", field_type: "textarea", is_required: false, display_order: 12 },
    { field_key: "photo", label_hi: "फ़ोटो", label_en: "Photo", field_type: "photo", is_required: true, display_order: 13 },
  ];

  // A shikshak's gender is inferred from the गुरुजी / दीदी role choice on the
  // form; a sanchalak's role is hardcoded 'संचालक' and carries no such signal,
  // so that kind gets an explicit field slotted in after date_of_birth.
  const sanchalakGenderField: Omit<JoinFieldSeed, "kind"> = {
    field_key: "sex",
    label_hi: "लिंग",
    label_en: "Gender",
    field_type: "dropdown",
    options: ["Male", "Female"],
    is_required: true,
    display_order: 4,
  };

  await db.insert(join_form_fields).values([
    ...studentFields,
    ...staffFieldDefs.map((f) => ({ ...f, kind: "shikshak" as const })),
    ...staffFieldDefs.map((f) => ({
      ...f,
      kind: "sanchalak" as const,
      display_order: f.display_order >= 4 ? f.display_order + 1 : f.display_order,
    })),
    { ...sanchalakGenderField, kind: "sanchalak" as const },
  ]);

  /* ---------------- Service requests (Wave 2) ---------------- */
  const [serviceReq1] = await db
    .insert(service_requests)
    .values({
      parent_user_id: parent.id,
      student_id: insertedStudents[0].id,
      category: "attendance",
      subject: "Attendance discrepancy this week",
      description: "Aarav attended on Sunday but is marked absent. Please check.",
      status: "in_review",
      assigned_to: superAdmin.id,
      centre_id: centreA.id,
      city_id: mumbai.id,
      last_response_at: new Date(),
    })
    .returning();
  await db.insert(service_request_messages).values([
    { request_id: serviceReq1.id, author_user_id: parent.id, message: "Aarav attended on Sunday but is shown absent." },
    { request_id: serviceReq1.id, author_user_id: superAdmin.id, message: "Thanks for flagging — we are reviewing the attendance records." },
  ]);

  /* ---------------- Student progress + report (Wave 2) ---------------- */
  const [firstCurriculumItem] = await db.select({ id: course_subsections.id }).from(course_subsections).limit(1);
  if (firstCurriculumItem) {
    await db.insert(student_course_progress).values([
      {
        student_id: insertedStudents[0].id,
        subsection_id: firstCurriculumItem.id,
        status: "completed" as const,
        note: "Strong understanding demonstrated.",
        updated_by: shikshak.id,
        updated_by_role: "shikshak",
        completed_at: new Date(),
      },
    ]);
  }
  await db.insert(progress_reports).values([
    {
      student_id: insertedStudents[0].id,
      period_kind: "monthly",
      period_label: "2025-12",
      shikshak_comment: "Consistent progress this month.",
      released_to_parent: true,
      released_at: new Date(),
      snapshot: { items: [] },
    },
  ]);

  /* ---------------- Audit logs (Wave 2) ---------------- */
  await db.insert(audit_logs).values([
    { actor_user_id: superAdmin.id, actor_role: "super_admin", action: "config_change", entity_kind: "settings", summary: "Updated default OTP" },
    { actor_user_id: superAdmin.id, actor_role: "super_admin", action: "approve", entity_kind: "enrolment", summary: "Approved a pending enrolment" },
    { actor_user_id: cityAdmin.id, actor_role: "city_admin", action: "update", entity_kind: "student", summary: "Edited a student profile" },
  ]);

  /* ---------------- Competitions (Wave 3) ---------------- */
  const compNow = Date.now();
  const [comp1] = await db
    .insert(competitions)
    .values({
      city_id: mumbai.id,
      name_en: "Tattvarth Sutra Recitation",
      name_hi: "तत्त्वार्थ सूत्र पाठ",
      description_en: "Recite assigned sutras with correct pronunciation.",
      category: "recitation",
      eligible_age_groups: ["bal", "kishor"],
      registration_window_start: new Date(compNow - 24 * 60 * 60 * 1000),
      registration_window_end: new Date(compNow + 7 * 24 * 60 * 60 * 1000),
      event_date: new Date(compNow + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      winner_points: 100,
      participant_points: 25,
      max_participants: 50,
      status: "open" as const,
      created_by: superAdmin.id,
    })
    .returning();
  await db.insert(competition_registrations).values([
    { competition_id: comp1.id, student_id: insertedStudents[0].id },
    { competition_id: comp1.id, student_id: insertedStudents[1].id },
  ]);

  /* ---------------- Quizzes (Wave 3) ---------------- */
  const seededQuizQuestions = await db
    .insert(questions)
    .values([
      {
        scope: "national" as const,
        question_en: "Which is a core Jain principle?",
        question_hi: "कौन सा एक मूल जैन सिद्धांत है?",
        options: [{ text_en: "Ahimsa", text_hi: "अहिंसा" }, { text_en: "Himsa", text_hi: "हिंसा" }],
        correct_indices: [0],
        topic: "Principles",
        age_groups: ["bal", "kishor"],
        created_by: superAdmin.id,
      },
      {
        scope: "city" as const,
        city_id: mumbai.id,
        question_en: "Pick the two great vows (mahavrata).",
        options: [{ text_en: "Satya" }, { text_en: "Asteya" }, { text_en: "Greed" }],
        correct_indices: [0, 1],
        topic: "Vows",
        age_groups: ["kishor"],
        created_by: superAdmin.id,
      },
    ])
    .returning();
  const [seededQuizEvent] = await db
    .insert(quiz_events)
    .values({
      scope: "city" as const,
      city_id: mumbai.id,
      title_en: "Mumbai Weekly Quiz",
      title_hi: "मुंबई साप्ताहिक प्रश्नोत्तरी",
      start_at: new Date(Date.now() - 60 * 60 * 1000),
      end_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      participation_points: 5,
      win_points: 10,
      age_groups: ["bal", "kishor"],
      created_by: superAdmin.id,
    })
    .returning();
  await db.insert(quiz_event_questions).values(
    seededQuizQuestions.map((q, i) => ({ quiz_event_id: seededQuizEvent.id, question_id: q.id, order_index: i })),
  );
  const [seededPushQuiz] = await db
    .insert(push_quizzes)
    .values({
      batch_id: batchA1.id,
      shikshak_user_id: shikshak.id,
      expires_at: new Date(Date.now() + 30 * 60 * 1000),
      completion_points: 5,
    })
    .returning();
  await db.insert(push_quiz_questions).values([
    {
      push_quiz_id: seededPushQuiz.id,
      question_en: "Is honesty (Satya) a Jain vow?",
      options: [{ text_en: "Yes" }, { text_en: "No" }],
      correct_indices: [0],
      order_index: 0,
    },
  ]);

  /* ---------------- Enquiries (Wave 3 public inbox) ---------------- */
  await db.insert(enquiries).values([
    { kind: "enquire", name: "Riya Sharma", phone: "+919812345678", city: "Mumbai", message: "I would like to enrol my 8-year-old son in the nearest centre.", status: "new" },
    { kind: "enquire", name: "Neha Jain", phone: "+919811122233", city: "Indore", message: "Looking for Bal batch timings at Indore Jain Pathshala.", status: "new" },
  ]);

  /* ---------------- Entity code counters (continue series after seed) ---------------- */
  await db.insert(entity_code_counters).values([
    { series: "STU", scope_key: "MUM", last_no: 4 },
    { series: "STU", scope_key: "PUN", last_no: 1 },
    { series: "STU", scope_key: "IDR", last_no: Math.max(0, indoreNet.students.length) },
    { series: "PAR", scope_key: "MUM", last_no: 1 },
    { series: "PAR", scope_key: "IDR", last_no: 1 },
    { series: "CAD", scope_key: "MUM", last_no: 1 },
    { series: "CAD", scope_key: "IDR", last_no: 1 },
    { series: "SAD", scope_key: "MH", last_no: 1 },
    { series: "SAD", scope_key: "MP", last_no: 1 },
    { series: "SHK", scope_key: "MUM-GHK", last_no: 1 },
    { series: "SHK", scope_key: "IDR-SAP", last_no: 1 },
    { series: "SAN", scope_key: "MUM-GHK", last_no: 1 },
    { series: "SAN", scope_key: "IDR-SAP", last_no: 1 },
    { series: "MSV", scope_key: "GLOBAL", last_no: 2 + indoreNet.students.filter((s) => s.msv_status === "approved").length },
  ]);

  // Point staff default centre at their Pathshala (codes already minted).
  await db.update(users).set({ centre_id_default: centreA.id }).where(eq(users.id, sanchalak.id));
  await db.update(users).set({ centre_id_default: centreA.id }).where(eq(users.id, shikshak.id));
  await db.update(users).set({ centre_id_default: centreIndore.id }).where(eq(users.id, indoreSanchalak.id));
  await db.update(users).set({ centre_id_default: centreIndore.id }).where(eq(users.id, indoreShikshak.id));

  // Team cards draw illustrated Jain-person placeholders when photo_url is empty.
  await db.execute(sql`
    UPDATE users
    SET photo_url = NULL
    WHERE role IN ('super_admin', 'state_admin', 'city_admin', 'sanchalak', 'shikshak')
      AND photo_url LIKE '%picsum.photos%'
  `);

  console.log("Seed complete.");
  console.log("\nLogin phones (OTP: set OTP_ENABLED=false + DEFAULT_OTP, or use live SMS):");
  console.log("  --- Mumbai / national ---");
  console.log("  super_admin : +919800000001");
  console.log("  state_admin : +919800000002  (Maharashtra)");
  console.log("  city_admin  : +919800000003  (Mumbai)");
  console.log("  sanchalak   : +919800000004");
  console.log("  shikshak    : +919800000005");
  console.log("  parent      : +919800000006");
  console.log("  student     : +919800000007");
  console.log("  --- Indore (Madhya Pradesh) ---");
  console.log("  state_admin : +919800000011");
  console.log("  city_admin  : +919800000012");
  console.log(`  centres     : ${indoreNet.centres.length}  | batches: ${indoreNet.batches.length}  | students: ${indoreNet.students.length}`);
  console.log("  sanchalak   : +919800000013  (+ multi-centre sanchalaks +919800002020…)");
  console.log("  shikshak    : +919800000014  (+ shikshaks +919800002030…)");
  console.log("  parent      : +919800000015  (3 children)  | more parents +919800002040…");
  console.log("  student     : +919800000016  (Reyansh Jain / IDR-STU-00001)");
  for (const [i, c] of indoreNet.centres.entries()) {
    const n = indoreNet.students.filter((s) => s.centre_id === c.id).length;
    console.log(`    centre[${i}] ${c.name} — ${n} students`);
  }

  /* ---------------- Digital ID cards (PNG + QR) ---------------- */
  // Rendered via api-server helpers (qrcode/sharp + same HMAC as /v1/id-cards).
  const apiServerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/api-server");
  const uploadsDir = path.join(apiServerRoot, "uploads");
  console.log("\nGenerating digital ID cards…");
  const idCardGen = spawnSync(
    "pnpm",
    ["exec", "tsx", "./scripts/generate-id-cards-for-seed.ts"],
    {
      cwd: apiServerRoot,
      shell: true,
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL,
        JP_AUTH_SECRET: process.env.JP_AUTH_SECRET ?? "jp-dev-secret-do-not-use-in-production",
        UPLOADS_DIR: process.env.UPLOADS_DIR ?? uploadsDir,
        PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? "http://localhost:8080",
        NODE_ENV: process.env.NODE_ENV ?? "development",
      },
    },
  );
  if (idCardGen.status !== 0) {
    throw new Error("Digital ID card generation failed (see output above).");
  }
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
