import { existsSync, unlinkSync } from "node:fs";

for (const lockfile of ["package-lock.json", "yarn.lock"]) {
  if (existsSync(lockfile)) {
    unlinkSync(lockfile);
  }
}

const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.includes("pnpm/")) {
  console.error("Use pnpm instead");
  process.exit(1);
}
