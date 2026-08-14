/**
 * Out-of-scope resource → 403 (service layer, per role).
 * Services are imported AFTER harness sets DATABASE_URL (pool is module-scoped).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, stopHarness, type Harness, ulid } from "./harness";
import type { User } from "@workspace/db";

describe("attendance scope RBAC (403)", () => {
  let h: Harness;
  let foreignBatchId: string;
  let foreignSessionId: string;
  let sanchalakId: string;
  let cityAdminOtherId: string;
  let otherCityId: string;
  let markAttendance: typeof import("../../src/services/attendance-mark").markAttendance;
  let checkInSession: typeof import("../../src/services/session-lifecycle").checkInSession;
  let cancelSession: typeof import("../../src/services/session-lifecycle").cancelSession;

  beforeAll(async () => {
    h = await startHarness();
    const client = await h.pool.connect();
    try {
      const centre = await client.query(
        `insert into centres (state_id, city_id, name, status, gps_radius_meters)
         select state_id, city_id, 'Foreign Centre', 'active', 250 from centres where id = $1
         returning id`,
        [h.fixtures.centreId],
      );
      const foreignCentreId = centre.rows[0].id as string;

      const batch = await client.query(
        `insert into batches (centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
         values ($1, 'Foreign Batch', 'bal', '{0}', '10:00', '11:00', 40, 'active') returning id`,
        [foreignCentreId],
      );
      foreignBatchId = batch.rows[0].id as string;

      const session = await client.query(
        `insert into sessions (batch_id, scheduled_date, status)
         values ($1, $2::date, 'scheduled') returning id`,
        [foreignBatchId, h.fixtures.scheduledDate],
      );
      foreignSessionId = session.rows[0].id as string;

      await client.query(
        `insert into shikshak_centre_assignments (user_id, centre_id, is_active)
         values ($1, $2, true)`,
        [h.fixtures.userId, h.fixtures.centreId],
      );
      await client.query(
        `insert into shikshak_batch_assignments (user_id, batch_id, is_active, is_primary)
         values ($1, $2, true, true)`,
        [h.fixtures.userId, h.fixtures.batchId],
      );

      const sanch = await client.query(
        `insert into users (phone, role, full_name, preferred_language, is_active, state_id, city_id)
         select '+919900000010', 'sanchalak', 'Scoped Sanchalak', 'en', true, state_id, city_id
         from centres where id = $1 returning id`,
        [h.fixtures.centreId],
      );
      sanchalakId = sanch.rows[0].id as string;
      await client.query(
        `insert into sanchalak_centre_assignments (user_id, centre_id, is_active)
         values ($1, $2, true)`,
        [sanchalakId, h.fixtures.centreId],
      );

      const otherCity = await client.query(
        `insert into cities (state_id, name, code, slug)
         select state_id, 'Other City', 'OC', 'other-city' from centres where id = $1 returning id`,
        [h.fixtures.centreId],
      );
      otherCityId = otherCity.rows[0].id as string;
      const ca = await client.query(
        `insert into users (phone, role, full_name, preferred_language, is_active, state_id, city_id)
         select '+919900000011', 'city_admin', 'Other City Admin', 'en', true, state_id, $1
         from centres where id = $2 returning id`,
        [otherCityId, h.fixtures.centreId],
      );
      cityAdminOtherId = ca.rows[0].id as string;
    } finally {
      client.release();
    }

    markAttendance = (await import("../../src/services/attendance-mark")).markAttendance;
    const life = await import("../../src/services/session-lifecycle");
    checkInSession = life.checkInSession;
    cancelSession = life.cancelSession;
  }, 180_000);

  afterAll(async () => {
    await stopHarness();
  });

  function actor(partial: Partial<User> & { id: string; role: User["role"] }): User {
    return {
      phone: "+919900000000",
      full_name: "Actor",
      preferred_language: "en",
      is_active: true,
      email: null,
      gender: null,
      state_id: null,
      city_id: null,
      centre_id_default: null,
      last_login_at: null,
      gallery_visibility_opt_in: false,
      notification_preferences: {},
      deleted_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      ...partial,
    } as User;
  }

  it("shikshak → foreign session mark → 403", async () => {
    await expect(
      markAttendance({
        sessionId: foreignSessionId,
        userId: h.fixtures.userId,
        actor: actor({ id: h.fixtures.userId, role: "shikshak" }),
        markedAt: new Date(`${h.fixtures.scheduledDate}T10:00:00.000+05:30`),
        marks: [
          {
            student_id: h.fixtures.studentIds[0]!,
            status: "present",
            client_op_id: ulid(),
          },
        ],
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: "ERR_FORBIDDEN" });
  });

  it("shikshak → foreign check-in → 403", async () => {
    await expect(
      checkInSession({
        sessionId: foreignSessionId,
        actor: actor({ id: h.fixtures.userId, role: "shikshak" }),
        submissionOpId: ulid(),
        lat: 0,
        lng: 0,
        accuracy_m: 10,
        batchId: foreignBatchId,
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: "ERR_FORBIDDEN" });
  });

  it("sanchalak → foreign centre cancel → 403", async () => {
    await expect(
      cancelSession({
        sessionId: foreignSessionId,
        actor: actor({ id: sanchalakId, role: "sanchalak" }),
        reason: "Out of scope cancel attempt for test.",
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: "ERR_FORBIDDEN" });
  });

  it("city_admin (other city) → fixture session mark → 403", async () => {
    await expect(
      markAttendance({
        sessionId: h.fixtures.sessionId,
        userId: cityAdminOtherId,
        actor: actor({
          id: cityAdminOtherId,
          role: "city_admin",
          city_id: otherCityId,
        }),
        markedAt: new Date(`${h.fixtures.scheduledDate}T10:00:00.000+05:30`),
        marks: [
          {
            student_id: h.fixtures.studentIds[0]!,
            status: "present",
            client_op_id: ulid(),
          },
        ],
      }),
    ).rejects.toMatchObject({ httpStatus: 403, code: "ERR_FORBIDDEN" });
  });
});
