/**
 * Panchang publication and delivery.
 *
 * Two things had to be true and were not. First, a Panchang year could be
 * published without anyone having checked it — the shipped 2026 file put
 * Samvatsari on Shravan Vad 14, three weeks before Bhadarvo Sud 4, and nothing
 * between "someone generated it" and "a family read it" objected. Second, once
 * published it went nowhere: there was no public GET, so published_payload sat
 * in a column no client could read.
 *
 * These tests hold both ends: publish REFUSES an unverified or contradictory
 * year, and a published one is actually served — to a guest, since the Panchang
 * is reachable before sign-in.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import app from "../src/app";
import { pool } from "@workspace/db";
import { loginAs, auth } from "./helpers";

const TEST_YEARS = [9001, 9002, 9003];

afterAll(async () => {
  await pool.query(`delete from panchang_years where year = any($1::int[])`, [TEST_YEARS]);
  await pool.end();
});

const PROVENANCE = {
  source_publication: "TEST FIXTURE — not a Panchang",
  source_year: "0000",
  transcribed_by: "test",
  verified_by: "test",
  verified_at: "2026-01-01",
};

const MONTHS = [
  "kartak",
  "magsar",
  "posh",
  "maha",
  "fagan",
  "chaitra",
  "vaishakh",
  "jeth",
  "ashadh",
  "shravan",
  "bhadarvo",
  "aso",
].map((key) => ({ key, name_en: key, name_hi: key, name_gu: null, isAdhik: false }));

function day(
  date: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  const tithi = (over.tithi as number) ?? 1;
  const paksha = (over.paksha as string) ?? "sud";
  return {
    date,
    vaar: "Monday",
    month: "bhadarvo",
    isAdhikMaas: false,
    paksha,
    tithi,
    tithiKey: `${paksha}-${tithi}`,
    tithiStatus: "normal",
    nakshatra: "Ashwini",
    parvTithi: [2, 5, 8, 11, 14, 15].includes(tithi),
    events: [],
    ...over,
  };
}

function event(id: string, title: string, type = "festival") {
  return {
    id,
    type,
    title_en: title,
    title_hi: title,
    title_gu: null,
    note_en: null,
    note_hi: null,
    note_gu: null,
    highlight: false,
    linkedItemId: null,
  };
}

/** A year that satisfies every anchor rule. */
function goodYear(year: number): Record<string, unknown> {
  const days: Array<Record<string, unknown>> = [
    day("9000-08-05", {
      month: "shravan",
      paksha: "vad",
      tithi: 12,
      events: [event("p1", "Paryushan starts")],
    }),
    ...Array.from({ length: 6 }, (_, i) =>
      day(`9000-08-${String(6 + i).padStart(2, "0")}`, { paksha: "sud", tithi: i + 1 }),
    ),
    day("9000-08-12", { paksha: "sud", tithi: 4, events: [event("s1", "Samvatsari")] }),
    ...Array.from({ length: 16 }, (_, i) =>
      day(`9000-06-${String(i + 1).padStart(2, "0")}`, {
        month: "jeth",
        paksha: "sud",
        tithi: ((i + 1) % 15) + 1,
        events: [event(`k${i}`, `Kalyanak ${i}`, "kalyanak")],
      }),
    ),
  ];
  return {
    schemaVersion: 1,
    contentVersion: 1,
    sect: "shwetambar",
    vikramSamvat: 2082,
    veerSamvat: 2552,
    year,
    provenance: PROVENANCE,
    months: MONTHS,
    days,
  };
}

async function superAdmin(): Promise<string> {
  return (await loginAs("super_admin")).token;
}

describe("POST /v1/admin/library/panchang/years", () => {
  it("refuses a year with no provenance at all", async () => {
    const token = await superAdmin();
    const payload = goodYear(TEST_YEARS[0]!) as Record<string, unknown>;
    delete payload.provenance;

    const res = await request(app)
      .post("/v1/admin/library/panchang/years")
      .set(auth(token))
      .send(payload);

    // §17.6.1 — a year nobody has put their name to is not a year.
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    expect(JSON.stringify(res.body.error.details)).toContain("provenance");
  });

  it("accepts a valid draft and reports its anchor issues without blocking", async () => {
    const token = await superAdmin();
    const payload = goodYear(TEST_YEARS[1]!) as Record<string, unknown>;
    // Move Samvatsari off its tithi — a draft may be saved in this state.
    payload.days = (payload.days as Array<Record<string, unknown>>).map((d) =>
      Array.isArray(d.events) && d.events.some((e: { title_en: string }) => e.title_en === "Samvatsari")
        ? { ...d, month: "shravan", paksha: "vad", tithi: 14 }
        : d,
    );

    const res = await request(app)
      .post("/v1/admin/library/panchang/years")
      .set(auth(token))
      .send(payload);

    // Saved, because refusing would leave no way to get a part-transcribed year
    // into the tool and repair it day by day.
    expect(res.status).toBe(200);
    // But the problem is named, on the way in.
    const issues = JSON.stringify(res.body.data.anchor_issues);
    expect(issues).toContain("PV1");
    expect(issues).toContain("bhadarvo sud 4");
  });
});

describe("POST /v1/admin/library/panchang/years/:year/publish", () => {
  it("REFUSES to publish a year whose Samvatsari is on the wrong tithi", async () => {
    const token = await superAdmin();
    // TEST_YEARS[1] was saved above with the bad Samvatsari.
    const res = await request(app)
      .post(`/v1/admin/library/panchang/years/${TEST_YEARS[1]}/publish`)
      .set(auth(token))
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("ERR_VALIDATION_FAILED");
    // The reviewer is told WHICH rule, so they know what to check against the
    // printed Panchang.
    expect(res.body.error.details.some((d: { path: string }) => d.path === "PV1")).toBe(true);

    // And nothing was written — a refused publish must not half-publish.
    const row = await pool.query<{ is_published: boolean; published_payload: unknown }>(
      `select is_published, published_payload from panchang_years where year = $1`,
      [TEST_YEARS[1]],
    );
    expect(row.rows[0]!.is_published).toBe(false);
    expect(row.rows[0]!.published_payload).toBeNull();
  });

  it("publishes a year that contradicts nothing", async () => {
    const token = await superAdmin();
    const created = await request(app)
      .post("/v1/admin/library/panchang/years")
      .set(auth(token))
      .send(goodYear(TEST_YEARS[2]!));
    expect(created.status).toBe(200);

    const res = await request(app)
      .post(`/v1/admin/library/panchang/years/${TEST_YEARS[2]}/publish`)
      .set(auth(token))
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.is_published).toBe(true);
  });
});

describe("GET /v1/panchang — the public delivery path", () => {
  it("serves a published year to a GUEST, with no token", async () => {
    // The whole point: a family checking Samvatsari has no account, and behind
    // requireAuth a corrected year could never reach them.
    const res = await request(app).get(`/v1/panchang/years/${TEST_YEARS[2]}`);
    expect(res.status).toBe(200);
    expect(res.body.data.year).toBe(TEST_YEARS[2]);
    expect(res.body.data.payload.provenance.verified_by).toBe("test");
  });

  it("lists published years so a client can discover a new one", async () => {
    const res = await request(app).get("/v1/panchang/years");
    expect(res.status).toBe(200);
    const years = res.body.data.items.map((i: { year: number }) => i.year);
    expect(years).toContain(TEST_YEARS[2]);
    // The draft-only year must not appear.
    expect(years).not.toContain(TEST_YEARS[1]);
  });

  it("404s an unpublished year rather than serving its draft", async () => {
    // The draft is unverified by definition; serving it is the original bug.
    const res = await request(app).get(`/v1/panchang/years/${TEST_YEARS[1]}`);
    expect(res.status).toBe(404);
  });

  it("404s a year that does not exist", async () => {
    const res = await request(app).get("/v1/panchang/years/9999");
    expect(res.status).toBe(404);
  });
});
