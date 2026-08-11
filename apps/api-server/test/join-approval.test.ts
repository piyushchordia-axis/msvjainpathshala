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
  join_settings,
  join_student_registrations,
  shikshak_centre_assignments,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { loginAs, auth } from "./helpers";

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

beforeAll(async () => {
  await ensureStudentOpen();
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
      age: 12,
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
      age: 14,
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

  it("accepts age 3 and 35; rejects 2 and 36", async () => {
    const centre = await mumbaiCentre();
    for (const age of [3, 35]) {
      const res = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Age ${age}`,
        parent_mobile: uniqueMobile(),
        age,
      });
      expect(res.status).toBe(201);
    }
    for (const age of [2, 36]) {
      const res = await request(app).post("/v1/join/registrations").send({
        kind: "student",
        city_id: centre.city_id,
        centre_id: centre.id,
        name: `Bad age ${age}`,
        parent_mobile: uniqueMobile(),
        age,
      });
      expect(res.status).toBe(422);
    }
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
      age: 8,
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
      age: 40,
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
      age: 42,
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
      age: 11,
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
