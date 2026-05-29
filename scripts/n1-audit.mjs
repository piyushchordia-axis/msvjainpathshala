#!/usr/bin/env node
/**
 * scripts/n1-audit.mjs — N+1 query audit.
 *
 * Connects to the configured DATABASE_URL, reads `pg_stat_statements`,
 * groups by `application_name = 'jp-api'`, and flags any normalized
 * query that runs > 5 times per HTTP request on average.
 *
 * Prerequisites:
 *   - Enable extension: CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
 *   - shared_preload_libraries=pg_stat_statements in postgresql.conf
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/n1-audit.mjs --threshold 5
 *
 * Output: scripts/n1-report.json
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import postgres from 'postgres';

const args = new Map(
  process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith('--')) acc.push([arg.slice(2), arr[i + 1] ?? 'true']);
    return acc;
  }, []),
);

const threshold = Number(args.get('threshold') ?? 5);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL not set.');
  process.exit(2);
}

const sql = postgres(url, { max: 1, idle_timeout: 5 });

try {
  const rows = await sql /* sql */ `
    WITH api_requests AS (
      SELECT COALESCE(SUM(calls), 0) AS n
      FROM pg_stat_statements
      WHERE application_name = 'jp-api'
        AND query ILIKE 'SELECT %from%http_request_total%'
    ),
    grouped AS (
      SELECT
        regexp_replace(query, '\\s+', ' ', 'g') AS norm_query,
        SUM(calls) AS calls,
        AVG(mean_exec_time) AS mean_ms,
        SUM(rows) AS rows
      FROM pg_stat_statements
      WHERE application_name = 'jp-api'
        AND query NOT ILIKE 'SET%'
        AND query NOT ILIKE 'COMMIT%'
        AND query NOT ILIKE 'BEGIN%'
      GROUP BY 1
    )
    SELECT g.norm_query, g.calls, g.mean_ms, g.rows,
           (g.calls::float / GREATEST(ar.n, 1)) AS calls_per_request
    FROM grouped g, api_requests ar
    ORDER BY calls_per_request DESC
    LIMIT 50;
  `;

  const flagged = rows.filter((r) => Number(r.calls_per_request) > threshold);
  const report = {
    generated_at: new Date().toISOString(),
    threshold,
    total_groups: rows.length,
    flagged_count: flagged.length,
    flagged,
    sample_groups: rows.slice(0, 10),
  };

  const out = path.resolve(process.cwd(), 'scripts/n1-report.json');
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.info(`Wrote ${out}`);
  if (flagged.length > 0) {
    console.warn(`${flagged.length} query groups exceed ${threshold} calls/request — see report.`);
    process.exit(1);
  }
  console.info('No N+1 patterns above threshold.');
} catch (err) {
  console.error('n1-audit failed:', err.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
