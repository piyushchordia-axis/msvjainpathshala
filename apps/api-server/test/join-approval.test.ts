/**
 * Join approval matrix + provisioning.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import {
  pool,
  db,
  cities,
  centres,
  users,
  students,
  digital_id_cards,
  notifications,
  join_settings,
  join_student_registrations,
  shikshak_centre_assignments,
  sanchalak_centre_assignments,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, auth } from "./helpers";
import { registerIdCardJobs } from "../src/jobs/idcard-jobs";

afterAll(async () => {
  await pool.end();
});

async function ensureStudentOpen() {
  await db
    .update(join_settings)
    .set({ value: "yes", updated_at: new Date() })
    .where(and(eq(join_settings.kind, "student"), eq(join_settings.key, "registration_open")));
}

async function mumbaiCentre(): Promise<{ id: string; city_id: string; code: string }> {
  const [city] = await db.select().from(cities).where(eq(cities.code, "MUM")).limit(1);
  if (!city) throw new Error("MUM city missing");
  const [centre] = await db
    .select({ id: centres.id, city_id: centres.city_id, code: centres.code })
    .from(centres)
    .where(and(eq(centres.city_id, city.id), eq(centres.status, "active")))
    .limit(1);
  if (!centre?.code) throw new Error("MUM centre missing");
  return { id: centre.id, city_id: centre.city_id, code: centre.code };
}

function uniqueMobile(): string {
  // Always 10 digits — Zod rejects anything else.
  return `98${String(Date.now() + Math.floor(Math.random() * 1000)).slice(-8)}`;
}

/** Poll a fire-and-forget side effect until it lands, or give up. */
async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error("timed out waiting for side effect");
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** ISO date of birth for someone who turned `age` today, offset by `dayShift`. */
function dobForAge(age: number, dayShift = 0): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate() + dayShift),
  );
  return d.toISOString().slice(0, 10);
}

beforeAll(async () => {
  await ensureStudentOpen();
  // Approval enqueues idcard.generation. With no REDIS_URL, enqueueJob runs the
  // registered handler inline — the API entry does the same under
  // RUN_WORKERS_INLINE=1 — so register it to exercise the real path.
  registerIdCardJobs();
});

describe("join approval + provisioning", () => {
  it("creates student pending with centre and shikshak can approve", async () => {
    const centre = await mumbaiCentre();
    const parentMobile = uniqueMobile();

    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Join Approve Child",
      parent_mobile: parentMobile,
      father_name: "Join Approve Parent",
      date_of_birth: dobForAge(12),
      sex: "Male",
    });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe("pending");
    expect(create.body.data.centre_id).toBe(centre.id);
    expect(create.body.data.parent_mobile).toBe(parentMobile);
    const regId = create.body.data.id as string;

    const shikshak = await loginAs("shikshak");
    // Ensure shikshak is assigned to this centre for scope.
    const [existing] = await db
      .select({ id: shikshak_centre_assignments.id })
      .from(shikshak_centre_assignments)
      .where(
        and(
          eq(shikshak_centre_assignments.user_id, shikshak.user.id),
          eq(shikshak_centre_assignments.centre_id, centre.id),
        ),
      )
      .limit(1);
    if (!existing) {
      await db.insert(shikshak_centre_assignments).values({
        user_id: shikshak.user.id,
        centre_id: centre.id,
        assigned_by: shikshak.user.id,
        is_active: true,
      });
    } else {
      await db
        .update(shikshak_centre_assignments)
        .set({ is_active: true, deactivated_at: null, updated_at: new Date() })
        .where(eq(shikshak_centre_assignments.id, existing.id));
    }

    const approved = await request(app)
      .post(`/v1/join/registrations/${regId}/approve?kind=student`)
      .set(auth(shikshak.token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");
    expect(approved.body.data.provisioned_user_id).toBeTruthy();
    expect(approved.body.data.provisioned_student_id).toBeTruthy();

    const [parent] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${parentMobile}`), isNull(users.deleted_at)))
      .limit(1);
    expect(parent?.role).toBe("parent");

    const [stu] = await db
      .select()
      .from(students)
      .where(eq(students.id, approved.body.data.provisioned_student_id))
      .limit(1);
    expect(stu?.centre_id).toBe(centre.id);
    expect(stu?.parent_id).toBe(parent!.id);
    expect(stu?.user_id).toBeNull();
    expect(stu?.dob).toBeTruthy();
  });

  it("creates student OTP user when distinct student mobile is provided", async () => {
    const centre = await mumbaiCentre();
    const parentMobile = uniqueMobile();
    const studentMobile = uniqueMobile();
    expect(studentMobile).not.toBe(parentMobile);

    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Child With Login",
      parent_mobile: parentMobile,
      mobile: studentMobile,
      date_of_birth: dobForAge(14),
      sex: "Female",
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const approved = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=student`)
      .set(auth(cityAdmin.token));
    expect(approved.status).toBe(200);

    const [parent] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${parentMobile}`), isNull(users.deleted_at)))
      .limit(1);
    expect(parent?.role).toBe("parent");

    const [studentUser] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${studentMobile}`), isNull(users.deleted_at)))
      .limit(1);
    expect(studentUser?.role).toBe("student");

    const [stu] = await db
      .select()
      .from(students)
      .where(eq(students.id, approved.body.data.provisioned_student_id))
      .limit(1);
    expect(stu?.parent_id).toBe(parent!.id);
    expect(stu?.user_id).toBe(studentUser!.id);
  });

  it("accepts a date of birth at ages 3 and 35, and derives age from it", async () => {
    const centre = await mumbaiCentre();
    for (const age of [3, 35]) {
      const dob = dobForAge(age);
      const res = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Age ${age}`,
        parent_mobile: uniqueMobile(),
        date_of_birth: dob,
      });
      expect(res.status).toBe(201);
      expect(res.body.data.date_of_birth).toBe(dob);
      // `age` is no longer collected — it is derived, so existing readers work.
      expect(res.body.data.age).toBe(age);
    }
  });

  it("rejects a date of birth outside the band, in the future, or impossible", async () => {
    const centre = await mumbaiCentre();
    const bad: [string, string][] = [
      ["one day short of 3", dobForAge(3, 1)],
      ["one day past 35", dobForAge(36, -1)],
      ["in the future", dobForAge(-1)],
      ["31 February", "2014-02-31"],
      ["not a date", "14-03-2014"],
    ];
    for (const [why, dob] of bad) {
      const res = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Bad dob ${why}`,
        parent_mobile: uniqueMobile(),
        date_of_birth: dob,
      });
      expect(res.status, why).toBe(422);
    }
  });

  it("gates the student's own login on the real DOB, not a 1-January guess", async () => {
    // The old flow derived DOB from a whole-year age as 1 January, so a child
    // one day short of 8 read as 8 and was handed their own OTP login.
    const centre = await mumbaiCentre();
    const cityAdmin = await loginAs("city_admin");

    const cases: { dob: string; expectLogin: boolean }[] = [
      { dob: dobForAge(8), expectLogin: true },
      { dob: dobForAge(8, 1), expectLogin: false },
    ];

    for (const { dob, expectLogin } of cases) {
      const studentMobile = uniqueMobile();
      const create = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Login gate ${dob}`,
        parent_mobile: uniqueMobile(),
        mobile: studentMobile,
        date_of_birth: dob,
      });
      expect(create.status).toBe(201);

      const approved = await request(app)
        .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=student`)
        .set(auth(cityAdmin.token));
      expect(approved.status).toBe(200);

      const [stu] = await db
        .select()
        .from(students)
        .where(eq(students.id, approved.body.data.provisioned_student_id))
        .limit(1);
      expect(stu?.dob).toBe(dob);
      if (expectLogin) {
        expect(stu?.user_id).toBeTruthy();
      } else {
        expect(stu?.user_id).toBeNull();
      }
    }
  });

  it("clamps the age group at both ends of the accepted band", async () => {
    // AGE_GROUP_META only spans 5-21, but the form accepts 3-35 — a 4-year-old
    // belongs in bal and a 30-year-old in yuva, not both in the middle band.
    const centre = await mumbaiCentre();
    const cityAdmin = await loginAs("city_admin");
    const cases: [number, string][] = [
      [4, "bal"],
      [10, "kishor"],
      [30, "yuva"],
    ];

    for (const [age, expected] of cases) {
      const create = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Age group ${age}`,
        parent_mobile: uniqueMobile(),
        date_of_birth: dobForAge(age),
      });
      expect(create.status).toBe(201);

      const approved = await request(app)
        .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=student`)
        .set(auth(cityAdmin.token));
      expect(approved.status).toBe(200);

      const [stu] = await db
        .select()
        .from(students)
        .where(eq(students.id, approved.body.data.provisioned_student_id))
        .limit(1);
      expect(stu?.age_group, `age ${age}`).toBe(expected);
    }
  });

  it("issues an ID card and notifies the parent when a student is approved", async () => {
    const centre = await mumbaiCentre();
    const parentMobile = uniqueMobile();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Card On Approval",
      parent_mobile: parentMobile,
      date_of_birth: dobForAge(10),
      sex: "Male",
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const approved = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=student`)
      .set(auth(cityAdmin.token));
    expect(approved.status).toBe(200);

    const studentId = approved.body.data.provisioned_student_id as string;
    const parentId = approved.body.data.provisioned_user_id as string;

    // Card generation and the push are both fire-and-forget off the approval,
    // so give them a moment to land before asserting.
    await waitFor(async () => {
      const [card] = await db
        .select({ id: digital_id_cards.id })
        .from(digital_id_cards)
        .where(eq(digital_id_cards.student_id, studentId))
        .limit(1);
      return !!card;
    });

    await waitFor(async () => {
      const [note] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.user_id, parentId), eq(notifications.kind, "join")))
        .limit(1);
      return !!note;
    });
  });

  it("notifies the centre's sanchalak when a registration is submitted", async () => {
    const centre = await mumbaiCentre();
    const sanchalakIds = await db
      .select({ user_id: sanchalak_centre_assignments.user_id })
      .from(sanchalak_centre_assignments)
      .where(
        and(
          eq(sanchalak_centre_assignments.centre_id, centre.id),
          eq(sanchalak_centre_assignments.is_active, true),
        ),
      );
    // Nothing to assert if the seed left this centre without a head.
    if (sanchalakIds.length === 0) return;

    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Queue Alert Child",
      parent_mobile: uniqueMobile(),
      date_of_birth: dobForAge(9),
    });
    expect(create.status).toBe(201);
    const displayCode = create.body.data.display_code as string;

    await waitFor(async () => {
      const rows = await db
        .select({ body_en: notifications.body_en })
        .from(notifications)
        .where(
          and(
            eq(notifications.user_id, sanchalakIds[0]!.user_id),
            eq(notifications.kind, "join"),
          ),
        );
      return rows.some((r) => r.body_en.includes(displayCode));
    });
  });

  it("tags student to existing parent by parent_mobile", async () => {
    const centre = await mumbaiCentre();
    const parentMobile = uniqueMobile();
    const [existingParent] = await db
      .insert(users)
      .values({
        phone: `+91${parentMobile}`,
        full_name: "Existing Parent",
        role: "parent",
        city_id: centre.city_id,
        is_active: true,
        preferred_language: "hi",
      })
      .returning({ id: users.id });

    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Tagged Child",
      parent_mobile: parentMobile,
      date_of_birth: dobForAge(8),
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const approved = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=student`)
      .set(auth(cityAdmin.token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.provisioned_user_id).toBe(existingParent!.id);

    const [stu] = await db
      .select()
      .from(students)
      .where(eq(students.id, approved.body.data.provisioned_student_id))
      .limit(1);
    expect(stu?.parent_id).toBe(existingParent!.id);
    expect(stu?.user_id).toBeNull();
  });

  it("rejects shikshak approving sanchalak kind", async () => {
    const centre = await mumbaiCentre();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "sanchalak",
      centre_id: centre.id,
      name: "San Pending",
      whatsapp_contact: uniqueMobile(),
      role: "संचालक",
      date_of_birth: dobForAge(40),
    });
    expect(create.status).toBe(201);

    const shikshak = await loginAs("shikshak");
    const res = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=sanchalak`)
      .set(auth(shikshak.token));
    expect(res.status).toBe(403);
  });

  it("city_admin can approve sanchalak and provision assignment", async () => {
    const centre = await mumbaiCentre();
    const wa = uniqueMobile();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "sanchalak",
      centre_id: centre.id,
      name: "New Sanchalak Join",
      whatsapp_contact: wa,
      role: "संचालक",
      sex: "Male",
      date_of_birth: dobForAge(42),
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const approved = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=sanchalak`)
      .set(auth(cityAdmin.token));
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");

    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${wa}`), isNull(users.deleted_at)))
      .limit(1);
    expect(u?.role).toBe("sanchalak");
    // The SAN code minted at intake is carried onto the account, not dropped.
    expect(u?.display_code).toBe(create.body.data.display_code);
    expect(u?.display_code).toContain("-SAN-");
    // Sanchalak has no Guruji/Didi signal, so gender comes from the form field.
    expect(u?.gender).toBe("male");
  });

  it("derives a shikshak's gender from the Guruji / Didi choice", async () => {
    const centre = await mumbaiCentre();
    const cases: [string, "male" | "female"][] = [
      ["गुरुजी", "male"],
      ["दीदी", "female"],
    ];

    for (const [role, expected] of cases) {
      const wa = uniqueMobile();
      const create = await request(app).post("/v1/join/registrations").send({
        kind: "shikshak",
        centre_id: centre.id,
        name: `Staff ${expected}`,
        whatsapp_contact: wa,
        role,
        date_of_birth: dobForAge(30),
      });
      expect(create.status).toBe(201);

      const cityAdmin = await loginAs("city_admin");
      const approved = await request(app)
        .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=shikshak`)
        .set(auth(cityAdmin.token));
      expect(approved.status).toBe(200);

      const [u] = await db
        .select()
        .from(users)
        .where(and(eq(users.phone, `+91${wa}`), isNull(users.deleted_at)))
        .limit(1);
      expect(u?.role).toBe("shikshak");
      expect(u?.gender, role).toBe(expected);
      expect(u?.display_code).toBe(create.body.data.display_code);
      expect(u?.display_code).toContain("-SHK-");
    }
  });

  it("keeps a staff display code that was already issued elsewhere", async () => {
    const centre = await mumbaiCentre();
    const wa = uniqueMobile();
    // A shikshak created through the admin staffing path already holds a code.
    await db.insert(users).values({
      phone: `+91${wa}`,
      full_name: "Already Staffed",
      role: "shikshak",
      display_code: `PRE-EXISTING-${wa}`,
      city_id: centre.city_id,
      is_active: true,
      preferred_language: "hi",
    });

    const create = await request(app).post("/v1/join/registrations").send({
      kind: "shikshak",
      centre_id: centre.id,
      name: "Already Staffed",
      whatsapp_contact: wa,
      role: "गुरुजी",
      date_of_birth: dobForAge(33),
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const approved = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/approve?kind=shikshak`)
      .set(auth(cityAdmin.token));
    expect(approved.status).toBe(200);

    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${wa}`), isNull(users.deleted_at)))
      .limit(1);
    expect(u?.display_code).toBe(`PRE-EXISTING-${wa}`);
  });

  it("reject does not create a user", async () => {
    const centre = await mumbaiCentre();
    const parentMobile = uniqueMobile();
    const create = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "Reject Me",
      parent_mobile: parentMobile,
      date_of_birth: dobForAge(11),
      sex: "Female",
    });
    expect(create.status).toBe(201);

    const cityAdmin = await loginAs("city_admin");
    const rejected = await request(app)
      .post(`/v1/join/registrations/${create.body.data.id}/reject?kind=student`)
      .set(auth(cityAdmin.token))
      .send({ reason: "Incomplete details" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.status).toBe("rejected");

    const [u] = await db
      .select()
      .from(users)
      .where(and(eq(users.phone, `+91${parentMobile}`), isNull(users.deleted_at)))
      .limit(1);
    expect(u).toBeUndefined();

    await db.delete(join_student_registrations).where(eq(join_student_registrations.id, create.body.data.id));
  });

  it("requires centre_id and parent_mobile on student create", async () => {
    const centre = await mumbaiCentre();
    const noCentre = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      name: "No Centre",
      parent_mobile: "9876500999",
    });
    expect(noCentre.status).toBe(422);

    const noParent = await request(app).post("/v1/join/registrations").send({
      kind: "student",
      city_id: centre.city_id,
      centre_id: centre.id,
      name: "No Parent Mobile",
      mobile: "9876500998",
    });
    expect(noParent.status).toBe(422);
  });
});
