/**
 * Indore city network seed — 5 centres, batches, many↔many staffing, and
 * 15–20 students per centre with single- and multi-child parent households.
 */
import { db } from "./index";
import {
  users,
  centres,
  batches,
  sanchalak_centre_assignments,
  shikshak_centre_assignments,
  shikshak_batch_assignments,
  students,
} from "./schema";
import type { AgeGroup } from "./schema/enums";

const FIRST_NAMES = [
  "Aarav", "Vihaan", "Aditya", "Kabir", "Reyansh", "Arjun", "Vivaan", "Shaurya", "Ishaan", "Atharv",
  "Anaya", "Diya", "Myra", "Kiara", "Aadhya", "Saanvi", "Pari", "Navya", "Riya", "Ira",
  "Yash", "Om", "Rudra", "Krish", "Dev", "Neil", "Rian", "Veer", "Ayaan", "Samar",
];
const SURNAMES = [
  "Jain", "Shah", "Mehta", "Porwal", "Sethi", "Doshi", "Sanghvi", "Chopra", "Bhandari", "Kothari",
  "Gulecha", "Bothra", "Surana", "Lodha", "Singhavi",
];
const PARENT_FIRST = [
  "Rajesh", "Sunita", "Amit", "Pooja", "Vikram", "Neha", "Suresh", "Kavita", "Manish", "Priya",
  "Anil", "Seema", "Rakesh", "Meena", "Deepak", "Shalini", "Nitin", "Anita", "Sanjay", "Ritu",
  "Yogesh", "Swati", "Prakash", "Nidhi", "Hemant", "Alka", "Gaurav", "Preeti", "Ashok", "Jyoti",
];

type CentreDef = {
  name: string;
  locality: string;
  pincode: string;
  phone: string;
  email: string;
  lat: string;
  lng: string;
};

const CENTRE_DEFS: (CentreDef & { code: string })[] = [
  {
    name: "Indore Jain Pathshala",
    code: "IDR-SAP",
    locality: "Sapna Sangeeta",
    pincode: "452001",
    phone: "+917300000004",
    email: "sapna@indore.jp.example.org",
    lat: "22.7196000",
    lng: "75.8577000",
  },
  {
    name: "Race Course Centre",
    code: "IDR-RCR",
    locality: "Race Course Road",
    pincode: "452003",
    phone: "+917300000005",
    email: "racecourse@indore.jp.example.org",
    lat: "22.7245000",
    lng: "75.8692000",
  },
  {
    name: "Vijay Nagar Pathshala",
    code: "IDR-VIJ",
    locality: "Vijay Nagar",
    pincode: "452010",
    phone: "+917300000006",
    email: "vijaynagar@indore.jp.example.org",
    lat: "22.7533000",
    lng: "75.8937000",
  },
  {
    name: "Palasia Pathshala",
    code: "IDR-PAL",
    locality: "New Palasia",
    pincode: "452001",
    phone: "+917300000007",
    email: "palasia@indore.jp.example.org",
    lat: "22.7249000",
    lng: "75.8838000",
  },
  {
    name: "Bhawarkua Pathshala",
    code: "IDR-BHA",
    locality: "Bhawarkua",
    pincode: "452001",
    phone: "+917300000008",
    email: "bhawarkua@indore.jp.example.org",
    lat: "22.6942000",
    lng: "75.8671000",
  },
];

const BATCH_SPECS: Array<{
  key: "bal" | "kishor" | "tarun";
  name: string;
  age_groups: AgeGroup[];
  start: string;
  end: string;
  capacity: number;
}> = [
  { key: "bal", name: "Bal Batch - Sunday Morning", age_groups: ["bal"], start: "09:00:00", end: "10:30:00", capacity: 30 },
  { key: "kishor", name: "Kishor Batch - Sunday Morning", age_groups: ["kishor"], start: "10:30:00", end: "12:00:00", capacity: 28 },
  { key: "tarun", name: "Tarun Batch - Sunday Afternoon", age_groups: ["tarun"], start: "12:30:00", end: "14:00:00", capacity: 24 },
];

function phone(n: number): string {
  return `+9198${String(n).padStart(8, "0")}`;
}

function pickName(i: number, pool: string[]): string {
  return pool[i % pool.length]!;
}

function dobForAgeGroup(ageGroup: AgeGroup, salt: number): string {
  // Rough mid-band DOBs so age_group stays consistent with AGE_GROUP_META.
  const year =
    ageGroup === "bal" ? 2017 - (salt % 3) : ageGroup === "kishor" ? 2013 - (salt % 3) : 2009 - (salt % 3);
  const month = String((salt % 12) + 1).padStart(2, "0");
  const day = String((salt % 27) + 1).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type IndoreSeedResult = {
  centres: Array<{ id: string; name: string }>;
  /** Flat list of all Indore batches. */
  batches: Array<{ id: string; centre_id: string; name: string; age_groups: AgeGroup[] }>;
  /** batches[centreIndex][bal|kishor|tarun] */
  batchGrid: Array<Record<"bal" | "kishor" | "tarun", { id: string; centre_id: string; name: string }>>;
  sanchalaks: Array<{ id: string; phone: string; full_name: string }>;
  shikshaks: Array<{ id: string; phone: string; full_name: string }>;
  parents: Array<{ id: string; phone: string; full_name: string }>;
  students: Array<{
    id: string;
    student_code: string;
    full_name: string;
    centre_id: string;
    batch_id: string | null;
    parent_id: string | null;
    msv_status: string;
  }>;
  /** Convenience aliases matching earlier seed personas. */
  demo: {
    sanchalak: { id: string; phone: string };
    shikshak: { id: string; phone: string };
    parent: { id: string; phone: string };
    studentUser: { id: string; phone: string };
    centre0: { id: string; name: string };
    batchBal0: { id: string };
    batchKishor0: { id: string };
  };
};

export async function seedIndoreNetwork(opts: {
  stateId: string;
  cityId: string;
  /** Existing login personas (kept for OTP docs / demos). */
  personas: {
    sanchalak: { id: string; phone: string; full_name: string };
    shikshak: { id: string; phone: string; full_name: string };
    parent: { id: string; phone: string; full_name: string };
    studentUser: { id: string; phone: string; full_name: string };
  };
  assignedBy: string;
}): Promise<IndoreSeedResult> {
  const { stateId, cityId, personas, assignedBy } = opts;

  /* ---- Centres (5) ---- */
  const centreRows = await db
    .insert(centres)
    .values(
      CENTRE_DEFS.map((c) => ({
        state_id: stateId,
        city_id: cityId,
        code: c.code,
        name: c.name,
        locality: c.locality,
        pincode: c.pincode,
        contact_phone: c.phone,
        contact_email: c.email,
        lat: c.lat,
        lng: c.lng,
        gps_radius_meters: 250,
        status: "active" as const,
      })),
    )
    .returning({ id: centres.id, name: centres.name });

  /* ---- Batches: 3 per centre (bal / kishor / tarun) ---- */
  const batchValues = centreRows.flatMap((centre) =>
    BATCH_SPECS.map((b) => ({
      centre_id: centre.id,
      name: b.name,
      age_groups: b.age_groups,
      day_of_week: [7],
      start_time: b.start,
      end_time: b.end,
      capacity: b.capacity,
      language_preference: "hi" as const,
      status: "active" as const,
    })),
  );
  const batchRows = await db
    .insert(batches)
    .values(batchValues)
    .returning({
      id: batches.id,
      centre_id: batches.centre_id,
      name: batches.name,
      age_groups: batches.age_groups,
    });

  const batchGrid = centreRows.map((centre) => {
    const mine = batchRows.filter((b) => b.centre_id === centre.id);
    const byKey = (key: "bal" | "kishor" | "tarun") => {
      const spec = BATCH_SPECS.find((s) => s.key === key)!;
      const row = mine.find((b) => b.name === spec.name)!;
      return { id: row.id, centre_id: row.centre_id, name: row.name };
    };
    return { bal: byKey("bal"), kishor: byKey("kishor"), tarun: byKey("tarun") };
  });

  /* ---- Extra sanchalaks (4) + keep persona as #0 ---- */
  const extraSanch = await db
    .insert(users)
    .values(
      [0, 1, 2, 3].map((i) => ({
        phone: phone(20020 + i), // +919800002020 …
        role: "sanchalak" as const,
        full_name: `Indore Sanchalak ${i + 2}`,
        preferred_language: "hi" as const,
        state_id: stateId,
        city_id: cityId,
        is_active: true,
      })),
    )
    .returning({ id: users.id, phone: users.phone, full_name: users.full_name });

  const sanchalaks = [
    { id: personas.sanchalak.id, phone: personas.sanchalak.phone, full_name: personas.sanchalak.full_name },
    ...extraSanch,
  ];

  /* ---- Extra shikshaks (7) + persona #0 ---- */
  const extraShik = await db
    .insert(users)
    .values(
      [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        phone: phone(20030 + i), // +919800002030 …
        role: "shikshak" as const,
        full_name: `Indore Shikshak ${i + 2}`,
        preferred_language: "hi" as const,
        gender: i % 2 === 0 ? ("male" as const) : ("female" as const),
        state_id: stateId,
        city_id: cityId,
        is_active: true,
      })),
    )
    .returning({ id: users.id, phone: users.phone, full_name: users.full_name });

  const shikshaks = [
    { id: personas.shikshak.id, phone: personas.shikshak.phone, full_name: personas.shikshak.full_name },
    ...extraShik,
  ];

  /*
   * Sanchalak ↔ centre (many↔many):
   *  S0 → C0,C1
   *  S1 → C1,C2
   *  S2 → C2
   *  S3 → C3,C4
   *  S4 → C0,C3,C4
   * Every centre has ≥1 sanchalak; several span multiple centres.
   */
  const sanchLinks: Array<[number, number]> = [
    [0, 0], [0, 1],
    [1, 1], [1, 2],
    [2, 2],
    [3, 3], [3, 4],
    [4, 0], [4, 3], [4, 4],
  ];
  await db.insert(sanchalak_centre_assignments).values(
    sanchLinks.map(([si, ci]) => ({
      user_id: sanchalaks[si]!.id,
      centre_id: centreRows[ci]!.id,
      assigned_by: assignedBy,
    })),
  );

  /*
   * Shikshak ↔ centre + batch (many↔many), one primary per batch:
   *  Sh0 → C0 bal(p), C0 kishor(p)
   *  Sh1 → C0 tarun(p), C1 bal(p)          (cross-centre)
   *  Sh2 → C1 kishor(p), C1 tarun(p)
   *  Sh3 → C2 bal(p), C2 kishor(p), C2 tarun(p)
   *  Sh4 → C2 (tag only), C3 bal(p)        (centre tag + primary elsewhere)
   *  Sh5 → C3 kishor(p), C3 tarun(p)
   *  Sh6 → C4 bal(p), C4 kishor(p)
   *  Sh7 → C4 tarun(p), C0 (secondary on C0 tarun — not primary)
   */
  const shikCentreLinks: Array<[number, number]> = [
    [0, 0],
    [1, 0], [1, 1],
    [2, 1],
    [3, 2],
    [4, 2], [4, 3],
    [5, 3],
    [6, 4],
    [7, 4], [7, 0],
  ];
  await db.insert(shikshak_centre_assignments).values(
    shikCentreLinks.map(([si, ci]) => ({
      user_id: shikshaks[si]!.id,
      centre_id: centreRows[ci]!.id,
      assigned_by: assignedBy,
    })),
  );

  const shikBatchLinks: Array<{ si: number; ci: number; key: "bal" | "kishor" | "tarun"; primary: boolean }> = [
    { si: 0, ci: 0, key: "bal", primary: true },
    { si: 0, ci: 0, key: "kishor", primary: true },
    { si: 1, ci: 0, key: "tarun", primary: true },
    { si: 1, ci: 1, key: "bal", primary: true },
    { si: 2, ci: 1, key: "kishor", primary: true },
    { si: 2, ci: 1, key: "tarun", primary: true },
    { si: 3, ci: 2, key: "bal", primary: true },
    { si: 3, ci: 2, key: "kishor", primary: true },
    { si: 3, ci: 2, key: "tarun", primary: true },
    { si: 4, ci: 3, key: "bal", primary: true },
    { si: 5, ci: 3, key: "kishor", primary: true },
    { si: 5, ci: 3, key: "tarun", primary: true },
    { si: 6, ci: 4, key: "bal", primary: true },
    { si: 6, ci: 4, key: "kishor", primary: true },
    { si: 7, ci: 4, key: "tarun", primary: true },
    // Secondary (non-primary) multi-batch: Sh7 also helps on C0 tarun
    { si: 7, ci: 0, key: "tarun", primary: false },
    // Secondary: Sh4 helps on C2 kishor
    { si: 4, ci: 2, key: "kishor", primary: false },
  ];
  await db.insert(shikshak_batch_assignments).values(
    shikBatchLinks.map((l) => ({
      user_id: shikshaks[l.si]!.id,
      batch_id: batchGrid[l.ci]![l.key].id,
      is_primary: l.primary,
      assigned_by: assignedBy,
    })),
  );

  /* ---- Parents + students (18 per centre; mix of 1 / 2 / 3 child households) ---- */
  const parentCursor = { n: 0 };
  const allHouseholds: Array<{ centreIndex: number; parentIndex: number | "demo"; childCount: number }> = [];

  // Centre 0 — demo parent with 3 children + other households → 18 total
  allHouseholds.push({ centreIndex: 0, parentIndex: "demo", childCount: 3 });
  for (let i = 0; i < 5; i++) allHouseholds.push({ centreIndex: 0, parentIndex: parentCursor.n++, childCount: 1 });
  for (let i = 0; i < 3; i++) allHouseholds.push({ centreIndex: 0, parentIndex: parentCursor.n++, childCount: 2 });
  allHouseholds.push({ centreIndex: 0, parentIndex: parentCursor.n++, childCount: 3 });
  allHouseholds.push({ centreIndex: 0, parentIndex: parentCursor.n++, childCount: 1 });

  // Centres 1–4: 6 singles + 4 doubles + 1 triple + 1 single = 18 children each
  for (let ci = 1; ci < 5; ci++) {
    for (let i = 0; i < 6; i++) allHouseholds.push({ centreIndex: ci, parentIndex: parentCursor.n++, childCount: 1 });
    for (let i = 0; i < 4; i++) allHouseholds.push({ centreIndex: ci, parentIndex: parentCursor.n++, childCount: 2 });
    allHouseholds.push({ centreIndex: ci, parentIndex: parentCursor.n++, childCount: 3 });
    allHouseholds.push({ centreIndex: ci, parentIndex: parentCursor.n++, childCount: 1 });
  }

  const parentCount = parentCursor.n;
  const parentRows = await db
    .insert(users)
    .values(
      Array.from({ length: parentCount }, (_, i) => ({
        phone: phone(20040 + i), // +919800002040 …
        role: "parent" as const,
        full_name: `${pickName(i, PARENT_FIRST)} ${pickName(i * 3, SURNAMES)}`,
        preferred_language: "hi" as const,
        state_id: stateId,
        city_id: cityId,
        gallery_visibility_opt_in: i % 3 !== 0,
        is_active: true,
        centre_id_default: centreRows[i % centreRows.length]!.id,
      })),
    )
    .returning({ id: users.id, phone: users.phone, full_name: users.full_name });

  const parents = [
    { id: personas.parent.id, phone: personas.parent.phone, full_name: personas.parent.full_name },
    ...parentRows,
  ];

  const ageCycle: AgeGroup[] = ["bal", "kishor", "tarun"];
  const studentValues: Array<{
    full_name: string;
    student_code: string;
    age_group: AgeGroup;
    centre_id: string;
    batch_id: string;
    msv_status: "none" | "applied" | "approved";
    msv_code: string | null;
    user_id: string | null;
    parent_id: string;
    dob: string;
    gender: "male" | "female";
    blood_group: string | null;
    guardian_relation: string;
  }> = [];

  let studentSeq = 1; // IDR-STU-00001+
  let childSalt = 0;
  let msvSeq = 3; // MSV00001/2 used by Mumbai seed

  // Demo household names (stable for docs / ID card demos)
  const demoChildNames = ["Reyansh Jain", "Myra Sethi", "Arjun Porwal"];

  for (const h of allHouseholds) {
    const parentId =
      h.parentIndex === "demo" ? personas.parent.id : parentRows[h.parentIndex as number]!.id;
    const centre = centreRows[h.centreIndex]!;
    const grid = batchGrid[h.centreIndex]!;

    for (let c = 0; c < h.childCount; c++) {
      const age_group = ageCycle[childSalt % 3]!;
      const batch = grid[age_group === "bal" ? "bal" : age_group === "kishor" ? "kishor" : "tarun"];
      const isDemoFirst =
        h.parentIndex === "demo" && h.centreIndex === 0 && c < demoChildNames.length;
      const full_name = isDemoFirst
        ? demoChildNames[c]!
        : `${pickName(childSalt, FIRST_NAMES)} ${pickName(childSalt * 2 + h.centreIndex, SURNAMES)}`;
      const code = `IDR-STU-${String(studentSeq).padStart(5, "0")}`;
      studentSeq += 1;

      let msv_status: "none" | "applied" | "approved" = "none";
      let msv_code: string | null = null;
      if (isDemoFirst && c === 0) {
        msv_status = "approved";
        msv_code = `MSV${String(msvSeq).padStart(5, "0")}`;
        msvSeq += 1;
      } else if (isDemoFirst && c === 2) msv_status = "applied";
      else if (childSalt % 11 === 0) {
        msv_status = "approved";
        msv_code = `MSV${String(msvSeq).padStart(5, "0")}`;
        msvSeq += 1;
      } else if (childSalt % 7 === 0) msv_status = "applied";

      studentValues.push({
        full_name,
        student_code: code,
        age_group,
        msv_code,
        centre_id: centre.id,
        batch_id: batch.id,
        msv_status,
        user_id: isDemoFirst && c === 0 ? personas.studentUser.id : null,
        parent_id: parentId,
        dob: isDemoFirst
          ? c === 0
            ? "2016-08-21"
            : c === 1
              ? "2015-12-05"
              : "2012-03-14"
          : dobForAgeGroup(age_group, childSalt),
        gender: childSalt % 2 === 0 ? "male" : "female",
        blood_group: ["A+", "B+", "O+", "AB+", "A-", "B-", null, "O-"][childSalt % 8] ?? null,
        guardian_relation: childSalt % 5 === 0 ? "mother" : childSalt % 7 === 0 ? "guardian" : "father",
      });
      childSalt += 1;
    }
  }

  const insertedStudents = await db
    .insert(students)
    .values(
      studentValues.map((s) => ({
        full_name: s.full_name,
        student_code: s.student_code,
        age_group: s.age_group,
        centre_id: s.centre_id,
        batch_id: s.batch_id,
        msv_status: s.msv_status,
        msv_code: s.msv_code,
        user_id: s.user_id,
        parent_id: s.parent_id,
        dob: s.dob,
        gender: s.gender,
        blood_group: s.blood_group,
        guardian_relation: s.guardian_relation,
        status: "active" as const,
      })),
    )
    .returning({
      id: students.id,
      student_code: students.student_code,
      full_name: students.full_name,
      centre_id: students.centre_id,
      batch_id: students.batch_id,
      parent_id: students.parent_id,
      msv_status: students.msv_status,
    });

  return {
    centres: centreRows,
    batches: batchRows.map((b) => ({
      id: b.id,
      centre_id: b.centre_id,
      name: b.name,
      age_groups: b.age_groups as AgeGroup[],
    })),
    batchGrid,
    sanchalaks,
    shikshaks,
    parents,
    students: insertedStudents.map((s) => ({
      id: s.id,
      student_code: s.student_code!,
      full_name: s.full_name,
      centre_id: s.centre_id!,
      batch_id: s.batch_id,
      parent_id: s.parent_id,
      msv_status: s.msv_status,
    })),
    demo: {
      sanchalak: { id: personas.sanchalak.id, phone: personas.sanchalak.phone },
      shikshak: { id: personas.shikshak.id, phone: personas.shikshak.phone },
      parent: { id: personas.parent.id, phone: personas.parent.phone },
      studentUser: { id: personas.studentUser.id, phone: personas.studentUser.phone },
      centre0: centreRows[0]!,
      batchBal0: batchGrid[0]!.bal,
      batchKishor0: batchGrid[0]!.kishor,
    },
  };
}
