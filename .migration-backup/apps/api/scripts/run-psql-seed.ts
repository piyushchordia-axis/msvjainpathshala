/**
 * Run a SQL seed file via psql using DATABASE_URL from the environment.
 * Invoked as: tsx --env-file=.env.development scripts/run-psql-seed.ts <filename.sql>
 */

import { execSync } from 'node:child_process';
import path from 'node:path';

const file = process.argv[2];
if (!file) {
  throw new Error('Usage: run-psql-seed.ts <file.sql> (relative to apps/api/scripts/)');
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required');
}

const sqlPath = path.resolve(__dirname, file);
execSync(`psql "${url}" -v ON_ERROR_STOP=1 -f "${sqlPath}"`, { stdio: 'inherit' });
