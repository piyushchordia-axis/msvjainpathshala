import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

/**
 * Staffing model — centre tags, batch assignments, primary uniqueness, scope rules.
 */
let GHATKOPAR: string;
let KOTHRUD: string;
let BAL_BATCH: string;
let KISHOR_BATCH: string;
let SHIKSHAK_ID: string;
let SANCHALAK_ID: string;

const createdUsers: string[] = [];
const createdCentreTags: string[] = [];
const createdBatchAssigns: string[] = [];

beforeAll(async () => {
  GHATKOPAR = (
    await pool.query(`select id from centres where name = 'Ghatkopar Jain Pathshala'`)
  ).rows[0].id;
  KOTHRUD = (await pool.query(`select id from centres where name = 'Kothrud Jain Pathshala'`)).rows[0]
    .id;
  BAL_BATCH = (
    await pool.query(`select id from batches where name = 'Bal Batch - Sunday Morning'`)
  ).rows[0].id;
  KISHOR_BATCH = (
    await pool.query(`select id from batches where name = 'Kishor Batch - Sunday Morning'`)
  ).rows[0].id;
  SHIKSHAK_ID = (await pool.query(`select id from users where phone = '+919800000005'`)).rows[0].id;
  SANCHALAK_ID = (await pool.query(`select id from users where phone = '+919800000004'`)).rows[0].id;
});

afterAll(async () => {
  if (createdBatchAssigns.length) {
    await pool.query(`delete from shikshak_batch_assignments where id = any($1::uuid[])`, [
      createdBatchAssigns,
    ]);
  }
  if (createdCentreTags.length) {
    await pool.query(`delete from shikshak_centre_assignments where id = any($1::uuid[])`, [
      createdCentreTags,
    ]);
  }
  if (createdUsers.length) {
    await pool.query(`delete from users where id = any($1::uuid[])`, [createdUsers]);
  }
});

async function makeShikshak(label: string): Promise<string> {
  const id = randomUUID();
  const phone = `+9199${id.replace(/-/g, "").slice(0, 10)}`;
  await pool.query(
    `insert into users (id, phone, role, full_name, is_active)
     values ($1, $2, 'shikshak', $3, true)`,
    [id, phone, label],
  );
  createdUsers.push(id);
  return id;
}

describe("staffing", () => {
  it("rejects batch assign when shikshak is not centre-tagged (ERR_NOT_CENTRE_TAGGED)", async () => {
    const admin = await loginAs("city_admin");
    const floater = await makeShikshak("Untagged Floater");
    const res = await request(app)
      .post(`/v1/admin/batches/${BAL_BATCH}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: floater });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_NOT_CENTRE_TAGGED");
  });

  it("rejects wrong role for centre tag (ERR_WRONG_ROLE)", async () => {
    const admin = await loginAs("city_admin");
    const res = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: SANCHALAK_ID });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_WRONG_ROLE");
  });

  it("rejects removing the last sanchalak (ERR_LAST_SANCHALAK)", async () => {
    const admin = await loginAs("city_admin");
    // Ghatkopar seed has exactly one sanchalak
    const list = await request(app)
      .get(`/v1/admin/centres/${GHATKOPAR}/sanchalaks`)
      .set(auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);
    const onlyId = list.body.data.items[0].user_id as string;

    // Ensure only one active — if more, remove extras first except last
    for (const row of list.body.data.items.slice(1)) {
      await request(app)
        .post(`/v1/admin/centres/${GHATKOPAR}/sanchalaks/${row.user_id}/remove`)
        .set(auth(admin.token));
    }

    const res = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/sanchalaks/${onlyId}/remove`)
      .set(auth(admin.token));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_LAST_SANCHALAK");
  });

  it("sanchalak cannot assign another sanchalak", async () => {
    const sanch = await loginAs("sanchalak");
    const res = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/sanchalaks`)
      .set(auth(sanch.token))
      .send({ user_id: SANCHALAK_ID });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ERR_FORBIDDEN");
  });

  it("promoting a second primary demotes the first", async () => {
    const admin = await loginAs("city_admin");
    const co = await makeShikshak("Co Shikshak Primary Test");

    const tag = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: co });
    expect(tag.status).toBe(200);
    createdCentreTags.push(tag.body.data.id);

    const assign = await request(app)
      .post(`/v1/admin/batches/${BAL_BATCH}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: co });
    expect(assign.status).toBe(200);
    createdBatchAssigns.push(assign.body.data.id);

    const promote = await request(app)
      .post(`/v1/admin/batches/${BAL_BATCH}/primary`)
      .set(auth(admin.token))
      .send({ user_id: co });
    expect(promote.status).toBe(200);

    const primaries = await pool.query(
      `select user_id from shikshak_batch_assignments
       where batch_id = $1 and is_active and is_primary`,
      [BAL_BATCH],
    );
    expect(primaries.rows).toHaveLength(1);
    expect(primaries.rows[0].user_id).toBe(co);

    // Restore seeded shikshak as primary for other suites
    await request(app)
      .post(`/v1/admin/batches/${BAL_BATCH}/primary`)
      .set(auth(admin.token))
      .send({ user_id: SHIKSHAK_ID });
  });

  it("removing centre tag clears that centre's batches only", async () => {
    const admin = await loginAs("super_admin");
    const multi = await makeShikshak("Multi Centre Shikshak");

    const tagA = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: multi });
    expect(tagA.status).toBe(200);
    createdCentreTags.push(tagA.body.data.id);

    const tagB = await request(app)
      .post(`/v1/admin/centres/${KOTHRUD}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: multi });
    expect(tagB.status).toBe(200);
    createdCentreTags.push(tagB.body.data.id);

    const a1 = await request(app)
      .post(`/v1/admin/batches/${BAL_BATCH}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: multi });
    expect(a1.status).toBe(200);
    createdBatchAssigns.push(a1.body.data.id);

    // Create a temporary batch on Kothrud and assign
    const kothrudBatchId = randomUUID();
    await pool.query(
      `insert into batches (id, centre_id, name, age_groups, start_time, end_time, capacity, status)
       values ($1, $2, $3, ARRAY['tarun']::age_group_enum[], '09:00', '10:00', 10, 'inactive')`,
      [kothrudBatchId, KOTHRUD, `Staffing Test Batch ${kothrudBatchId.slice(0, 6)}`],
    );
    const a2 = await request(app)
      .post(`/v1/admin/batches/${kothrudBatchId}/shikshaks`)
      .set(auth(admin.token))
      .send({ user_id: multi, is_primary: true });
    expect(a2.status).toBe(200);
    createdBatchAssigns.push(a2.body.data.id);

    const remove = await request(app)
      .post(`/v1/admin/centres/${GHATKOPAR}/shikshaks/${multi}/remove`)
      .set(auth(admin.token));
    expect(remove.status).toBe(200);
    expect(remove.body.data.deactivated_batch_ids).toContain(BAL_BATCH);

    const stillActive = await pool.query(
      `select batch_id from shikshak_batch_assignments
       where user_id = $1 and is_active`,
      [multi],
    );
    expect(stillActive.rows.map((r: { batch_id: string }) => r.batch_id)).toEqual([kothrudBatchId]);

    const stillTagged = await pool.query(
      `select centre_id from shikshak_centre_assignments
       where user_id = $1 and is_active`,
      [multi],
    );
    expect(stillTagged.rows.map((r: { centre_id: string }) => r.centre_id)).toEqual([KOTHRUD]);

    await pool.query(`delete from shikshak_batch_assignments where batch_id = $1`, [kothrudBatchId]);
    await pool.query(`delete from batches where id = $1`, [kothrudBatchId]);
  });

  it("DB rejects two active primaries on the same batch", async () => {
    const other = await makeShikshak("Direct Insert Primary");
    await pool.query(
      `insert into shikshak_centre_assignments (user_id, centre_id, is_active)
       values ($1, $2, true)`,
      [other, GHATKOPAR],
    );
    const tagId = (
      await pool.query(
        `select id from shikshak_centre_assignments where user_id = $1 and centre_id = $2 and is_active`,
        [other, GHATKOPAR],
      )
    ).rows[0].id;
    createdCentreTags.push(tagId);

    // Kishor already has a seeded primary — inserting another primary must fail
    await expect(
      pool.query(
        `insert into shikshak_batch_assignments (user_id, batch_id, is_active, is_primary)
         values ($1, $2, true, true)`,
        [other, KISHOR_BATCH],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("activate without primary returns ERR_NO_PRIMARY", async () => {
    const admin = await loginAs("super_admin");
    const batchId = randomUUID();
    await pool.query(
      `insert into batches (id, centre_id, name, age_groups, start_time, end_time, capacity, status)
       values ($1, $2, $3, ARRAY['bal']::age_group_enum[], '08:00', '09:00', 5, 'inactive')`,
      [batchId, GHATKOPAR, `No Primary ${batchId.slice(0, 6)}`],
    );
    const res = await request(app)
      .post(`/v1/admin/batches/${batchId}/activate`)
      .set(auth(admin.token))
      .send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_NO_PRIMARY");
    await pool.query(`delete from batches where id = $1`, [batchId]);
  });
});
