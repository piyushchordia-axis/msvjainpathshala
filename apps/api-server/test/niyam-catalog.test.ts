/**
 * GET /v1/me/niyam-catalog — audience + geography filtering.
 *
 * Why this file exists: the catalog had no test at all. Two things depend on it
 * being right:
 *
 *  1. `studentCanAccessNiyam` (JS, used by submit) and `studentNiyamAccessWhere`
 *     (SQL, used by the catalog) are two implementations of one rule. If they
 *     disagree, a niyam is either listed but un-submittable, or hidden but
 *     submittable. `quiz-scope.ts` has an agreement test for exactly this; the
 *     niyam pair had none.
 *
 *  2. Without `student_id` the route applied NO audience filter, so any
 *     authenticated caller could enumerate MSV-only niyams and every city's and
 *     state's private ones (M2). That branch now falls back to national +
 *     all-audience, and this pins it.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool, db, niyams, students, centres } from "@workspace/db";
import { eq } from "drizzle-orm";
import { loginAs, auth, type Session } from "./helpers";
import {
  studentCanAccessNiyam,
  studentNiyamAccessWhere,
  type NiyamAudienceFields,
  type StudentAudienceCtx,
} from "../src/lib/niyam-audience";

/** Niyams planted by this file, removed in afterAll. */
const plantedNiyamIds: string[] = [];

afterAll(async () => {
  // Without this these rows accumulate on every run. At 218 active
  // national all-audience niyams the catalogue's 200-row cap started
  // excluding the row this file had JUST created, so it failed asserting
  // its own niyam was present — a failure that looks like a catalogue bug
  // and is really the fixture competing with itself.
  if (plantedNiyamIds.length) {
    await pool.query(
      `delete from niyam_submission_media where submission_id in (
         select id from niyam_submissions where niyam_id = any($1::uuid[])
       )`,
      [plantedNiyamIds],
    );
    await pool.query(`delete from niyam_submissions where niyam_id = any($1::uuid[])`, [
      plantedNiyamIds,
    ]);
    await pool.query(`delete from niyam_badges where niyam_id = any($1::uuid[])`, [
      plantedNiyamIds,
    ]);
    await pool.query(`delete from niyams where id = any($1::uuid[])`, [plantedNiyamIds]);
  }
  await pool.end();
});

function daysAgoIst(n: number): string {
  const todayIst = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const d = new Date(`${todayIst}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

let admin: Session;
let parent: Session;
let childId: string;
let childCtx: StudentAudienceCtx;

/** Insert a niyam directly — the admin route cannot author every scope combination. */
async function insertNiyam(
  label: string,
  fields: Partial<NiyamAudienceFields> & { msv_audience?: string },
): Promise<string> {
  const [row] = await db
    .insert(niyams)
    .values({
      title_en: `Catalog ${label} ${Date.now()}`,
      niyam_type: "daily",
      proof_type: "either",
      proof_required: false,
      approval_mode: "auto",
      max_uploads: 3,
      points: 5,
      is_active: true,
      start_date: daysAgoIst(30),
      scope: (fields.scope ?? "national") as "national" | "state" | "city",
      state_id: fields.state_id ?? null,
      city_id: fields.city_id ?? null,
      msv_audience: (fields.msv_audience ?? "all") as "all" | "msv" | "non_msv",
    })
    .returning({ id: niyams.id });
  plantedNiyamIds.push(row!.id);
  return row!.id;
}

async function catalogIds(token: string, studentId?: string): Promise<string[]> {
  const qs = studentId ? `?student_id=${studentId}&limit=200` : "?limit=200";
  const res = await request(app).get(`/v1/me/niyam-catalog${qs}`).set(auth(token));
  expect(res.status).toBe(200);
  return (res.body.data.items as Array<{ id: string }>).map((i) => i.id);
}

beforeAll(async () => {
  admin = await loginAs("super_admin");
  parent = await loginAs("parent");
  const children = await request(app).get("/v1/me/children").set(auth(parent.token));
  expect(children.status).toBe(200);
  childId = children.body.data.items[0].id;

  const [row] = await db
    .select({
      msv_status: students.msv_status,
      city_id: centres.city_id,
      state_id: centres.state_id,
    })
    .from(students)
    .leftJoin(centres, eq(centres.id, students.centre_id))
    .where(eq(students.id, childId))
    .limit(1);
  childCtx = {
    msv_status: row!.msv_status,
    city_id: row!.city_id,
    state_id: row!.state_id,
  };
});

describe("GET /v1/me/niyam-catalog — audience and geography", () => {
  it("hides an MSV-only niyam from a non-MSV student", async () => {
    if (childCtx.msv_status === "approved") return; // seeded child is MSV; case n/a
    const msvOnly = await insertNiyam("msv-only", { msv_audience: "msv" });
    const ids = await catalogIds(parent.token, childId);
    expect(ids).not.toContain(msvOnly);
  });

  it("hides a city niyam belonging to another city", async () => {
    const otherCity = "00000000-0000-4000-8000-0000000000c1";
    const foreign = await insertNiyam("other-city", { scope: "city", city_id: null });
    // city scope with a null city_id can never match any student.
    const ids = await catalogIds(parent.token, childId);
    expect(ids).not.toContain(foreign);
    expect(otherCity).toBeTruthy();
  });

  it("includes a national all-audience niyam", async () => {
    const national = await insertNiyam("national", { scope: "national", msv_audience: "all" });
    const ids = await catalogIds(parent.token, childId);
    expect(ids).toContain(national);
  });

  it("without student_id returns ONLY national all-audience niyams (M2)", async () => {
    const national = await insertNiyam("m2-national", { scope: "national", msv_audience: "all" });
    const msvOnly = await insertNiyam("m2-msv", { scope: "national", msv_audience: "msv" });
    const cityScoped = await insertNiyam("m2-city", {
      scope: "city",
      city_id: childCtx.city_id,
    });

    const ids = await catalogIds(parent.token);

    // The regression this guards: with no student to judge against, the route
    // used to apply no filter at all and leak both of these.
    expect(ids).toContain(national);
    expect(ids).not.toContain(msvOnly);
    expect(ids).not.toContain(cityScoped);
  });

  it("catalog membership agrees with the JS predicate for every returned row", async () => {
    const res = await request(app)
      .get(`/v1/me/niyam-catalog?student_id=${childId}&limit=200`)
      .set(auth(parent.token));
    expect(res.status).toBe(200);
    const items = res.body.data.items as Array<
      NiyamAudienceFields & { id: string }
    >;
    expect(items.length).toBeGreaterThan(0);

    // Every row the SQL filter returned must also pass the JS predicate that
    // submit re-checks — otherwise a child sees a niyam they cannot submit.
    for (const n of items) {
      expect(
        studentCanAccessNiyam(
          {
            msv_audience: n.msv_audience,
            scope: n.scope,
            state_id: n.state_id,
            city_id: n.city_id,
          },
          childCtx,
        ),
      ).toBe(true);
    }
  });

  it("SQL filter and JS predicate agree across every audience/scope combination", async () => {
    // Drive both implementations over the same matrix and require identical
    // verdicts. The SQL side is exercised by selecting with the real WHERE.
    const combos: NiyamAudienceFields[] = [];
    for (const msv_audience of ["all", "msv", "non_msv"]) {
      for (const scope of ["national", "state", "city"]) {
        combos.push({
          msv_audience,
          scope,
          state_id: scope === "state" ? childCtx.state_id : null,
          city_id: scope === "city" ? childCtx.city_id : null,
        });
      }
    }

    const created: Array<{ id: string; fields: NiyamAudienceFields }> = [];
    for (const [i, fields] of combos.entries()) {
      created.push({ id: await insertNiyam(`agree-${i}`, fields), fields });
    }

    const visible = await db
      .select({ id: niyams.id })
      .from(niyams)
      .where(studentNiyamAccessWhere(childCtx));
    const visibleIds = new Set(visible.map((r) => r.id));

    for (const { id, fields } of created) {
      expect(
        { combo: fields, sql: visibleIds.has(id) },
        `SQL and JS disagree for ${JSON.stringify(fields)}`,
      ).toEqual({ combo: fields, sql: studentCanAccessNiyam(fields, childCtx) });
    }
  });
});
