/**
 * H11 — a published competition result could never be corrected.
 *
 * POST /:id/results returned a flat 409 once status='results_published', and
 * publish-results was award-only with no reversal anywhere. A rank typed wrong
 * was therefore permanent: the wrong child kept the winner bonus, the real
 * winner could never be paid, and the only workaround — a manual award — left
 * the ledger telling a false story about who won.
 *
 * Correcting ranks now requires an explicit force_resync (the AT25 force_cancel
 * discipline) and re-settles the awards in the same transaction as the ranks.
 */
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { auth, loginAs } from "./helpers";

afterAll(async () => {
  await pool.end();
});

const WINNER_POINTS = 40;
const PARTICIPANT_POINTS = 10;

async function netCompetitionPoints(studentId: string): Promise<number> {
  const { rows } = await pool.query<{ total: string }>(
    `select coalesce(sum(points), 0)::text as total from punya_transactions
      where student_id = $1 and feature_key = 'competition'`,
    [studentId],
  );
  return Number(rows[0]!.total);
}

async function mumbaiCityId(token: string): Promise<string> {
  const geo = await request(app).get("/v1/admin/geography").set(auth(token));
  expect(geo.status).toBe(200);
  const cities: Array<{ id: string; name: string }> = geo.body.data.cities;
  const mumbai = cities.find((c) => c.name === "Mumbai");
  expect(mumbai).toBeDefined();
  return mumbai!.id;
}

describe("H11 — a published competition result can be corrected", () => {
  it("force_resync moves the winner bonus to the real winner", async () => {
    const admin = await loginAs("super_admin");
    const parent = await loginAs("parent");
    const cityId = await mumbaiCityId(admin.token);

    const children = await request(app).get("/v1/me/children").set(auth(parent.token));
    expect(children.status).toBe(200);
    const kids: Array<{ id: string; full_name: string }> = children.body.data.items;
    expect(kids.length).toBeGreaterThanOrEqual(2);
    const [alice, bob] = kids as [{ id: string }, { id: string }];

    const aliceBefore = await netCompetitionPoints(alice.id);
    const bobBefore = await netCompetitionPoints(bob.id);

    const start = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const eventDate = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const create = await request(app)
      .post("/v1/competitions")
      .set(auth(admin.token))
      .send({
        city_id: cityId,
        name_en: `H11 Contest ${Date.now()}`,
        name_hi: "एच11 प्रतियोगिता",
        category: "essay",
        eligible_age_groups: [],
        msv_only: false,
        registration_window_start: start,
        registration_window_end: end,
        event_date: eventDate,
        winner_points: WINNER_POINTS,
        participant_points: PARTICIPANT_POINTS,
      });
    expect(create.status).toBe(200);
    const compId: string = create.body.data.id;

    await request(app)
      .post(`/v1/competitions/${compId}/status`)
      .set(auth(admin.token))
      .send({ status: "open" });

    const reg = async (studentId: string): Promise<string> => {
      const r = await request(app)
        .post(`/v1/competitions/${compId}/register`)
        .set(auth(parent.token))
        .send({ student_id: studentId });
      expect(r.status).toBe(200);
      return r.body.data.id as string;
    };
    const aliceReg = await reg(alice.id);
    const bobReg = await reg(bob.id);

    await request(app)
      .post(`/v1/competitions/${compId}/status`)
      .set(auth(admin.token))
      .send({ status: "closed" });

    // Ranks entered wrong: the first child is recorded as the winner.
    const first = await request(app)
      .post(`/v1/competitions/${compId}/results`)
      .set(auth(admin.token))
      .send({
        results: [
          { registration_id: aliceReg, rank: 1 },
          { registration_id: bobReg, rank: 2 },
        ],
      });
    expect(first.status).toBe(200);

    const published = await request(app)
      .post(`/v1/competitions/${compId}/publish-results`)
      .set(auth(admin.token));
    expect(published.status).toBe(200);

    expect(await netCompetitionPoints(alice.id)).toBe(aliceBefore + WINNER_POINTS);
    expect(await netCompetitionPoints(bob.id)).toBe(bobBefore + PARTICIPANT_POINTS);

    // Without force_resync the correction is still refused — the guard stays.
    const refused = await request(app)
      .post(`/v1/competitions/${compId}/results`)
      .set(auth(admin.token))
      .send({ results: [{ registration_id: bobReg, rank: 1 }] });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("ERR_RESULTS_PUBLISHED");

    // With it, the ranks AND the ledger both move.
    const corrected = await request(app)
      .post(`/v1/competitions/${compId}/results`)
      .set(auth(admin.token))
      .send({
        force_resync: true,
        results: [
          { registration_id: bobReg, rank: 1 },
          { registration_id: aliceReg, rank: 2 },
        ],
      });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.reversed).toBe(2);
    expect(corrected.body.data.re_awarded).toBe(2);

    // The winner bonus has moved; the loser drops to participation.
    expect(await netCompetitionPoints(bob.id)).toBe(bobBefore + WINNER_POINTS);
    expect(await netCompetitionPoints(alice.id)).toBe(aliceBefore + PARTICIPANT_POINTS);

    // Re-saving identical ranks is a no-op — the synchroniser is idempotent.
    const again = await request(app)
      .post(`/v1/competitions/${compId}/results`)
      .set(auth(admin.token))
      .send({
        force_resync: true,
        results: [
          { registration_id: bobReg, rank: 1 },
          { registration_id: aliceReg, rank: 2 },
        ],
      });
    expect(again.status).toBe(200);
    expect(again.body.data.reversed).toBe(0);
    expect(again.body.data.re_awarded).toBe(0);
    expect(await netCompetitionPoints(bob.id)).toBe(bobBefore + WINNER_POINTS);
    expect(await netCompetitionPoints(alice.id)).toBe(aliceBefore + PARTICIPANT_POINTS);
  });
});
