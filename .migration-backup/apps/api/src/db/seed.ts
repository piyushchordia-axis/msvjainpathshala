/**
 * Local dev seed — `pnpm --filter @jp/api db:seed:dev`.
 *
 * Idempotent via SELECT-then-INSERT (states / cities have no unique-on-name
 * constraint in SPEC §5.2 so ON CONFLICT DO NOTHING wouldn't dedupe). On
 * re-run no new rows are added.
 *
 *   1 state         (Gujarat, GJ)
 *   1 city          (Ahmedabad, AHM)
 *   3 centres       (Maninagar, Vastrapur, Naranpura)
 *   12 batches      (4 per centre — bal / kishor / tarun / yuva)
 *
 * Centre coordinates are real-ish Ahmedabad lat/lng so geo features make
 * sense in dev.
 */

import postgres from 'postgres';

interface SeedCentre {
  name: string;
  locality: string;
  lat: string;
  lng: string;
}

const STATE = { name: 'Gujarat', code: 'GJ' };
const CITY = { name: 'Ahmedabad', code: 'AHM' };
const CENTRES: SeedCentre[] = [
  { name: 'Maninagar Pathshala', locality: 'Maninagar', lat: '22.9968', lng: '72.6038' },
  { name: 'Vastrapur Pathshala', locality: 'Vastrapur', lat: '23.0399', lng: '72.5266' },
  { name: 'Naranpura Pathshala', locality: 'Naranpura', lat: '23.0666', lng: '72.5610' },
];
const AGE_GROUPS = ['bal', 'kishor', 'tarun', 'yuva'] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    // 1. State — find-or-insert by (name).
    let stateRow = (
      await sql<{ id: string }[]>`SELECT id FROM states WHERE name = ${STATE.name} LIMIT 1`
    )[0];
    if (!stateRow) {
      stateRow = (
        await sql<{ id: string }[]>`
          INSERT INTO states (name, code) VALUES (${STATE.name}, ${STATE.code}) RETURNING id
        `
      )[0];
    }
    if (!stateRow) throw new Error('failed to upsert state');
    const stateId = stateRow.id;
    console.info(`[seed] state '${STATE.name}' = ${stateId}`);

    // 2. City — find-or-insert by (state_id, name).
    let cityRow = (
      await sql<{ id: string }[]>`
        SELECT id FROM cities WHERE state_id = ${stateId} AND name = ${CITY.name} LIMIT 1
      `
    )[0];
    if (!cityRow) {
      cityRow = (
        await sql<{ id: string }[]>`
          INSERT INTO cities (state_id, name, code)
          VALUES (${stateId}, ${CITY.name}, ${CITY.code}) RETURNING id
        `
      )[0];
    }
    if (!cityRow) throw new Error('failed to upsert city');
    const cityId = cityRow.id;
    console.info(`[seed] city  '${CITY.name}' = ${cityId}`);

    // 3. Centres — find-or-insert by (city_id, name) ignoring soft-deletes.
    const centreIds: string[] = [];
    let createdCentres = 0;
    for (const c of CENTRES) {
      let row = (
        await sql<{ id: string }[]>`
          SELECT id FROM centres
          WHERE city_id = ${cityId} AND name = ${c.name} AND deleted_at IS NULL
          LIMIT 1
        `
      )[0];
      if (!row) {
        row = (
          await sql<{ id: string }[]>`
            INSERT INTO centres (city_id, name, locality, lat, lng, status, gps_radius_m)
            VALUES (${cityId}, ${c.name}, ${c.locality}, ${c.lat}::numeric, ${c.lng}::numeric,
                    'active', 500)
            RETURNING id
          `
        )[0];
        createdCentres++;
      }
      if (!row) throw new Error(`failed to upsert centre ${c.name}`);
      centreIds.push(row.id);
    }
    console.info(`[seed] centres: ${centreIds.length} total (${createdCentres} newly inserted)`);

    // 4. Batches — 4 per centre, one per age group, find-or-insert.
    let createdBatches = 0;
    for (const centreId of centreIds) {
      for (const [i, ageGroup] of AGE_GROUPS.entries()) {
        const name = `${ageGroup} batch`;
        const existing = await sql<{ id: string }[]>`
          SELECT id FROM batches
          WHERE centre_id = ${centreId} AND name = ${name} AND deleted_at IS NULL
          LIMIT 1
        `;
        if (existing.length > 0) continue;
        const startHour = 16 + i;
        const startTime = `${startHour.toString().padStart(2, '0')}:00:00`;
        const endTime = `${(startHour + 1).toString().padStart(2, '0')}:30:00`;
        await sql`
          INSERT INTO batches (centre_id, name, day_of_week, start_time, end_time,
                               age_group, status, capacity)
          VALUES (${centreId}, ${name}, ARRAY[1,3,5]::int[], ${startTime}::time, ${endTime}::time,
                  ${ageGroup}, 'active', 40)
        `;
        createdBatches++;
      }
    }
    console.info(`[seed] batches: 12 total (${createdBatches} newly inserted)`);

    console.info('[seed] done.');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error('[seed] FAILED', err);
  process.exit(1);
});
