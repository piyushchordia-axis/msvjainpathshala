/**
 * Generate the 1024x500 Google Play "feature graphic" from the app icon + name.
 * Output: fastlane/metadata/android/en-US/images/featureGraphic.png
 * Run:    node scripts/gen-feature-graphic.cjs   (sharp resolves from the workspace)
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

// sharp is a workspace dependency (api-server), not a mobile one — resolve it from there.
let sharp;
for (const base of [
  path.join(__dirname, "..", "..", "api-server"),
  path.join(__dirname, "..", "..", ".."),
]) {
  try {
    sharp = createRequire(path.join(base, "noop.js"))("sharp");
    break;
  } catch (_) {}
}
if (!sharp) {
  console.error("sharp not found in workspace");
  process.exit(1);
}

const W = 1024;
const H = 500;
const iconPath = path.join(__dirname, "..", "assets", "images", "icon.png");
const iconB64 = fs.readFileSync(iconPath).toString("base64");
const out = path.join(
  __dirname,
  "..",
  "fastlane",
  "metadata",
  "android",
  "en-US",
  "images",
  "featureGraphic.png",
);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FDF6EC"/>
      <stop offset="1" stop-color="#F6E1C8"/>
    </linearGradient>
    <clipPath id="iconClip"><rect x="72" y="100" width="300" height="300" rx="66"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="980" cy="-30" r="230" fill="#E8541A" opacity="0.10"/>
  <circle cx="40" cy="540" r="200" fill="#7B1E3E" opacity="0.10"/>
  <image xlink:href="data:image/png;base64,${iconB64}" x="72" y="100" width="300" height="300" clip-path="url(#iconClip)"/>
  <rect x="72" y="100" width="300" height="300" rx="66" fill="none" stroke="#00000014" stroke-width="2"/>
  <text x="424" y="222" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="78" font-weight="700" fill="#2A1A12">Jain Pathshala</text>
  <text x="426" y="288" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="34" font-weight="500" fill="#7A4A2E">Your Pathshala, in one app</text>
  <text x="426" y="346" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="25" font-weight="400" fill="#9A6A4E">Attendance • Homework • Exams • Progress</text>
</svg>`;

sharp(Buffer.from(svg))
  .flatten({ background: "#FDF6EC" })
  .png()
  .toFile(out)
  .then(() => sharp(out).metadata())
  .then((m) => console.log(`feature graphic written: ${m.width}x${m.height}, alpha=${m.hasAlpha} -> ${out}`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
