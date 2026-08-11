/**
 * Provision platform accounts when a join registration is approved.
 */
import {
  db,
  users,
  students,
  cities,
  centres,
  shikshak_centre_assignments,
  sanchalak_centre_assignments,
  AGE_GROUPS,
  AGE_GROUP_META,
  type AgeGroup,
  type JoinKind,
  type JoinStudentRegistration,
  type JoinShikshakRegistration,
  type JoinSanchalakRegistration,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { allocateParentCode, allocateStudentCode } from "./entity-codes";
import type { ErrorCode } from "@workspace/api-zod";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class JoinProvisionError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function toE164India(digits10: string): string {
  const d = digits10.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.startsWith("91") && d.length === 12) return `+${d}`;
  if (digits10.startsWith("+")) return digits10;
  return `+91${d}`;
}

function mapGender(sex: string | null | undefined): "male" | "female" | "other" | null {
  if (!sex) return null;
  const s = sex.trim().toLowerCase();
  if (s === "male" || s === "m" || s === "पुरुष") return "male";
  if (s === "female" || s === "f" || s === "महिला") return "female";
  return "other";
}

function ageGroupFromAge(age: number | null | undefined): AgeGroup {
  if (age == null || !Number.isFinite(age)) return "kishor";
  for (const g of AGE_GROUPS) {
    const meta = AGE_GROUP_META[g];
    if (age >= meta.min && age <= meta.max) return g;
  }
  if (age < 5) return "bal";
  return "yuva";
}

/** Approximate DOB (1 Jan) from whole-year age — enough for age-gated features. */
function dobFromAge(age: number | null | undefined): string | null {
  if (age == null || !Number.isFinite(age) || age < 0 || age > 120) return null;
  const year = new Date().getFullYear() - Math.floor(age);
  return `${year}-01-01`;
}

async function findUserByPhone(tx: Tx, phone: string) {
  const [row] = await tx
    .select({
      id: users.id,
      role: users.role,
      full_name: users.full_name,
      is_active: users.is_active,
      deleted_at: users.deleted_at,
    })
    .from(users)
    .where(and(eq(users.phone, phone), isNull(users.deleted_at)))
    .limit(1);
  return row ?? null;
}

async function upsertStaffUser(
  tx: Tx,
  opts: {
    phone: string;
    full_name: string;
    role: "shikshak" | "sanchalak";
    city_id: string;
    state_id: string | null;
    centre_id: string;
    gender: "male" | "female" | "other" | null;
  },
): Promise<string> {
  const existing = await findUserByPhone(tx, opts.phone);
  if (existing) {
    if (existing.role !== opts.role) {
      throw new JoinProvisionError(
        409,
        "ERR_CONFLICT",
        `This phone is already registered as ${existing.role} — cannot provision as ${opts.role}.`,
      );
    }
    await tx
      .update(users)
      .set({
        full_name: opts.full_name,
        is_active: true,
        city_id: opts.city_id,
        state_id: opts.state_id,
        centre_id_default: opts.centre_id,
        gender: opts.gender,
        updated_at: new Date(),
      })
      .where(eq(users.id, existing.id));
    return existing.id;
  }

  const [city] = await tx
    .select({ code: cities.code })
    .from(cities)
    .where(eq(cities.id, opts.city_id))
    .limit(1);
  if (!city?.code) {
    throw new JoinProvisionError(422, "ERR_VALIDATION_FAILED", "Could not resolve city for staff ID.");
  }

  // Staff display codes come from Pathshala codes on registration; users.display_code
  // for staff often mirrors that — here we leave display_code null-capable or use phone-derived.
  const [row] = await tx
    .insert(users)
    .values({
      phone: opts.phone,
      full_name: opts.full_name,
      role: opts.role,
      city_id: opts.city_id,
      state_id: opts.state_id,
      centre_id_default: opts.centre_id,
      gender: opts.gender,
      is_active: true,
      preferred_language: "hi",
    })
    .returning({ id: users.id });
  return row!.id;
}

async function ensureCentreAssignment(
  tx: Tx,
  kind: "shikshak" | "sanchalak",
  userId: string,
  centreId: string,
  assignedBy: string,
): Promise<void> {
  const table = kind === "shikshak" ? shikshak_centre_assignments : sanchalak_centre_assignments;
  const [existing] = await tx
    .select({ id: table.id, is_active: table.is_active })
    .from(table)
    .where(and(eq(table.user_id, userId), eq(table.centre_id, centreId)))
    .limit(1);

  if (existing?.is_active) return;
  if (existing) {
    await tx
      .update(table)
      .set({
        is_active: true,
        deactivated_at: null,
        assigned_by: assignedBy,
        updated_at: new Date(),
      })
      .where(eq(table.id, existing.id));
    return;
  }
  await tx.insert(table).values({
    user_id: userId,
    centre_id: centreId,
    assigned_by: assignedBy,
  });
}

export async function provisionStudentRegistration(
  reg: JoinStudentRegistration,
  reviewerId: string,
): Promise<{ userId: string; studentId: string }> {
  return db.transaction(async (tx) => {
    const phone = toE164India(reg.parent_mobile);
    const existing = await findUserByPhone(tx, phone);
    let userId: string;

    if (existing) {
      if (existing.role !== "parent") {
        throw new JoinProvisionError(
          409,
          "ERR_CONFLICT",
          `This phone is already registered as ${existing.role} — cannot create a parent account.`,
        );
      }
      userId = existing.id;
      await tx
        .update(users)
        .set({
          is_active: true,
          city_id: reg.city_id,
          centre_id_default: reg.centre_id,
          updated_at: new Date(),
        })
        .where(eq(users.id, userId));
    } else {
      const [city] = await tx
        .select({ code: cities.code, state_id: cities.state_id })
        .from(cities)
        .where(eq(cities.id, reg.city_id))
        .limit(1);
      if (!city?.code) {
        throw new JoinProvisionError(422, "ERR_VALIDATION_FAILED", "City not found for parent ID.");
      }
      const display_code = await allocateParentCode(tx, city.code);
      const parentName = reg.father_name?.trim() || `Parent of ${reg.name}`;
      const [row] = await tx
        .insert(users)
        .values({
          phone,
          full_name: parentName,
          role: "parent",
          display_code,
          city_id: reg.city_id,
          state_id: city.state_id,
          centre_id_default: reg.centre_id,
          is_active: true,
          preferred_language: "hi",
        })
        .returning({ id: users.id });
      userId = row!.id;
    }

    const [city] = await tx
      .select({ code: cities.code, state_id: cities.state_id })
      .from(cities)
      .where(eq(cities.id, reg.city_id))
      .limit(1);
    if (!city?.code) {
      throw new JoinProvisionError(422, "ERR_VALIDATION_FAILED", "City not found for student ID.");
    }
    const student_code = await allocateStudentCode(tx, city.code);

    // Optional distinct student phone → OTP login (users.role=student) linked via user_id.
    let studentUserId: string | null = null;
    const studentDigits = (reg.mobile ?? "").replace(/\D/g, "");
    if (studentDigits.length === 10 && studentDigits !== reg.parent_mobile) {
      const studentPhone = toE164India(studentDigits);
      const existingStudentUser = await findUserByPhone(tx, studentPhone);
      if (existingStudentUser) {
        if (existingStudentUser.role !== "student") {
          throw new JoinProvisionError(
            409,
            "ERR_CONFLICT",
            `Student phone is already registered as ${existingStudentUser.role} — cannot create a student login.`,
          );
        }
        studentUserId = existingStudentUser.id;
        await tx
          .update(users)
          .set({
            full_name: reg.name,
            is_active: true,
            city_id: reg.city_id,
            state_id: city.state_id,
            centre_id_default: reg.centre_id,
            gender: mapGender(reg.sex),
            updated_at: new Date(),
          })
          .where(eq(users.id, studentUserId));
      } else {
        const [stuUser] = await tx
          .insert(users)
          .values({
            phone: studentPhone,
            full_name: reg.name,
            role: "student",
            display_code: student_code,
            city_id: reg.city_id,
            state_id: city.state_id,
            centre_id_default: reg.centre_id,
            gender: mapGender(reg.sex),
            is_active: true,
            preferred_language: "hi",
          })
          .returning({ id: users.id });
        studentUserId = stuUser!.id;
      }
    }

    const [stu] = await tx
      .insert(students)
      .values({
        parent_id: userId,
        user_id: studentUserId,
        student_code,
        full_name: reg.name,
        gender: mapGender(reg.sex),
        dob: dobFromAge(reg.age),
        age_group: ageGroupFromAge(reg.age),
        centre_id: reg.centre_id,
        photo_url: reg.photo_url,
        guardian_relation: "guardian",
        status: "active",
      })
      .returning({ id: students.id });

    return { userId, studentId: stu!.id };
  });
}

export async function provisionStaffRegistration(
  kind: "shikshak" | "sanchalak",
  reg: JoinShikshakRegistration | JoinSanchalakRegistration,
  reviewerId: string,
): Promise<{ userId: string }> {
  return db.transaction(async (tx) => {
    const [centre] = await tx
      .select({
        id: centres.id,
        city_id: centres.city_id,
        state_id: centres.state_id,
      })
      .from(centres)
      .where(eq(centres.id, reg.centre_id))
      .limit(1);
    if (!centre) {
      throw new JoinProvisionError(404, "ERR_NOT_FOUND", "Centre not found.");
    }

    const phone = toE164India(reg.whatsapp_contact);
    const userId = await upsertStaffUser(tx, {
      phone,
      full_name: reg.name,
      role: kind,
      city_id: centre.city_id,
      state_id: centre.state_id,
      centre_id: centre.id,
      gender: null,
    });
    await ensureCentreAssignment(tx, kind, userId, centre.id, reviewerId);
    return { userId };
  });
}

/** Kinds this role may review. */
export function joinKindsForRole(role: string): JoinKind[] {
  if (role === "shikshak") return ["student"];
  if (role === "sanchalak") return ["student", "shikshak"];
  if (
    role === "city_admin" ||
    role === "state_admin" ||
    role === "super_admin"
  ) {
    return ["student", "shikshak", "sanchalak"];
  }
  return [];
}

export function canReviewJoinKind(role: string, kind: JoinKind): boolean {
  return joinKindsForRole(role).includes(kind);
}
