/**
 * /v1/public catalogue routes — pagination signals, search, MSV exclusion.
 * The clamps used to truncate silently (guest re-review finding 2); every
 * list now reports { count, has_more, next_offset }.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";

const SUFFIX = Date.now().toString(36);

afterAll(async () => {
  await pool.query(`delete from courses where name_en like $1`, [`Public Test %${SUFFIX}`]);
  await pool.end();
});

describe("public catalogues", () => {
  it("centres: q narrows, limit clamps, has_more/next_offset signal truncation", async () => {
    const first = await request(app).get("/v1/public/centres?limit=1");
    expect(first.status).toBe(200);
    expect(first.body.data.items).toHaveLength(1);
    expect(first.body.meta.count).toBe(1);
    // The seed has more than one centre, so a one-row page must say so.
    expect(first.body.meta.has_more).toBe(true);
    expect(first.body.meta.next_offset).toBe(1);

    const second = await request(app).get("/v1/public/centres?limit=1&offset=1");
    expect(second.status).toBe(200);
    expect(second.body.data.items).toHaveLength(1);
    // Offset pages must not overlap.
    expect(second.body.data.items[0].id).not.toBe(first.body.data.items[0].id);

    const name = first.body.data.items[0].name as string;
    const q = await request(app).get(
      `/v1/public/centres?q=${encodeURIComponent(name.slice(0, 6))}`,
    );
    expect(q.status).toBe(200);
    expect(q.body.data.items.some((c: { id: string }) => c.id === first.body.data.items[0].id)).toBe(
      true,
    );
  });

  it("cities: paged with the same meta shape", async () => {
    const res = await request(app).get("/v1/public/cities?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(typeof res.body.meta.has_more).toBe("boolean");
    if (res.body.meta.has_more) {
      expect(res.body.meta.next_offset).toBe(1);
    }
  });

  it("shivirs: now clamped and paged (was entirely unbounded)", async () => {
    const res = await request(app).get("/v1/public/shivirs?limit=1");
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(1);
    expect(typeof res.body.meta.has_more).toBe("boolean");
  });

  it("courses: MSV curricula are excluded from the list AND unreadable by id (Q2)", async () => {
    const std = await pool.query<{ id: string }>(
      `insert into courses (name_en, name_hi, kind, status)
       values ($1, 'मानक', 'standard', 'active') returning id`,
      [`Public Test Standard ${SUFFIX}`],
    );
    const msv = await pool.query<{ id: string }>(
      `insert into courses (name_en, name_hi, kind, status)
       values ($1, 'एमएसवी', 'msv', 'active') returning id`,
      [`Public Test MSV ${SUFFIX}`],
    );
    const stdId = std.rows[0]!.id;
    const msvId = msv.rows[0]!.id;

    const list = await request(app).get("/v1/public/courses?limit=200");
    expect(list.status).toBe(200);
    const ids = (list.body.data.items as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(stdId);
    expect(ids).not.toContain(msvId);
    expect(typeof list.body.meta.has_more).toBe("boolean");

    // Hidden from the list, an MSV course must not remain readable by id.
    const tree = await request(app).get(`/v1/public/courses/${msvId}/tree`);
    expect(tree.status).toBe(404);

    const stdTree = await request(app).get(`/v1/public/courses/${stdId}/tree`);
    expect(stdTree.status).toBe(200);
  });
});
