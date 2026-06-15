process.env.NODE_ENV ??= "development";

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
