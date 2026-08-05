/**
 * Smoke-import every package that the production bundle actually imports
 * and that is listed as external in build.mjs. Used by CI against the
 * runtime image so a newly externalized + imported dep cannot ship without
 * being installed in the Dockerfile.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const buildPath = process.env.SMOKE_BUILD_MJS ?? resolve(here, "../build.mjs");
const distPath = process.env.SMOKE_DIST_MJS ?? resolve(here, "../dist/index.mjs");

const buildSrc = readFileSync(buildPath, "utf8");
const distSrc = readFileSync(distPath, "utf8");

const externalMatch = buildSrc.match(/external:\s*\[([\s\S]*?)\]/);
if (!externalMatch) {
  console.error("Could not parse external array from build.mjs");
  process.exit(2);
}

const patterns = [...externalMatch[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

function matchesExternal(mod) {
  return patterns.some((p) => {
    if (p.endsWith("/*")) return mod === p.slice(0, -2) || mod.startsWith(p.slice(0, -1));
    if (p.startsWith("*.")) return mod.endsWith(p.slice(1));
    return mod === p;
  });
}

const imported = new Set();
for (const m of distSrc.matchAll(/from\s+["']([^"']+)["']/g)) imported.add(m[1]);
for (const m of distSrc.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) imported.add(m[1]);

const needed = [...imported]
  .filter((m) => !m.startsWith(".") && !m.startsWith("node:"))
  .filter(matchesExternal)
  .sort();

if (needed.length === 0) {
  console.log("No externalized imports found in dist — nothing to smoke.");
  process.exit(0);
}

console.log("Smoking externalized imports:", needed.join(", "));
const results = await Promise.allSettled(needed.map((m) => import(m)));
let failed = false;
for (let i = 0; i < needed.length; i++) {
  const r = results[i];
  if (r.status === "fulfilled") {
    console.log("OK", needed[i]);
  } else {
    failed = true;
    const err = r.reason;
    console.error("FAIL", needed[i], err && (err.code || err.message || err));
  }
}
process.exit(failed ? 1 : 0);