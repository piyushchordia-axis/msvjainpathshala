process.env.NODE_ENV ??= "development";
// PERF #15 — local `pnpm run dev` stays single-process; production uses
// compose api + worker (or set RUN_WORKERS_INLINE=0 and run start:worker).
process.env.RUN_WORKERS_INLINE ??= "1";

// Local convenience: pick up apps/api-server/.env so `pnpm run dev` works
// without exporting DATABASE_URL/PORT by hand. Already-set env wins.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* no .env — env must come from the shell */
}

import { spawnSync } from "node:child_process";

function run(script) {
  const result = spawnSync("pnpm", ["run", script], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("build");
run("start");
