/**
 * CI gate (PERF #20): fail if the HTML entry JS chunk exceeds 150KB gzip.
 * Public visitors load this chunk first; admin/page chunks are separate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPublic = path.resolve(__dirname, "../dist/public");
const LIMIT_GZIP = 150 * 1024;

const html = readFileSync(path.join(distPublic, "index.html"), "utf8");
const match = html.match(/assets\/(index-[^"']+\.js)/);
if (!match) {
  console.error("PERF #20 gate: could not find entry script in index.html");
  process.exit(1);
}

const entryName = match[1];
const entryPath = path.join(distPublic, "assets", entryName);
const raw = readFileSync(entryPath);
const gzip = gzipSync(raw, { level: 9 });

console.log(`Entry chunk: ${entryName}`);
console.log(`  raw:  ${(raw.length / 1024).toFixed(2)} KB`);
console.log(`  gzip: ${(gzip.length / 1024).toFixed(2)} KB (limit ${(LIMIT_GZIP / 1024).toFixed(0)} KB)`);

// Also list sibling JS assets for the AFTER report.
const assets = readdirSync(path.join(distPublic, "assets"))
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .map((f) => {
    const buf = readFileSync(path.join(distPublic, "assets", f));
    return {
      f,
      raw: buf.length,
      gzip: gzipSync(buf, { level: 9 }).length,
    };
  })
  .sort((a, b) => b.gzip - a.gzip);

console.log("\nAll assets (by gzip desc):");
for (const a of assets.slice(0, 25)) {
  console.log(
    `  ${a.f.padEnd(42)} raw ${String(a.raw).padStart(9)}  gzip ${String(a.gzip).padStart(8)}`,
  );
}

if (gzip.length > LIMIT_GZIP) {
  console.error(
    `\nPERF #20 CI GATE FAILED: entry gzip ${gzip.length} > ${LIMIT_GZIP}`,
  );
  process.exit(1);
}

console.log("\nPERF #20 CI gate OK");
