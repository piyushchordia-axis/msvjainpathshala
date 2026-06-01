/**
 * Print Expo Go URL + ASCII QR, and open a browser page with a scannable QR.
 * Run while Metro is up: pnpm --filter @workspace/jain-pathshala-mobile run qr
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.PORT ?? "8081";

function lanIp() {
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

async function resolveHostUri() {
  try {
    const res = await fetch(`http://localhost:${port}/manifest`, {
      headers: { "expo-platform": "android" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    const json = await res.json();
    const hostUri = json?.extra?.expoClient?.hostUri;
    if (hostUri) return hostUri;
  } catch (err) {
    console.warn(`Could not read Metro manifest (${err.message}); using LAN IP.`);
  }
  const ip = lanIp();
  return ip === "127.0.0.1" ? `localhost:${port}` : `${ip}:${port}`;
}

const hostUri = await resolveHostUri();
const expUrl = `exp://${hostUri}`;

console.log("\n--- Expo Go (Jain Pathshala Mobile) ---\n");
console.log(`Connection URL:\n  ${expUrl}\n`);
console.log("In Expo Go: tap \"Enter URL manually\" and paste the URL above.\n");

const htmlPath = path.join(projectRoot, "dev-qr.html");
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Expo Go — Jain Pathshala</title>
  <script src="https://unpkg.com/qr-code-styling@1.6.0/lib/qr-code-styling.js"></script>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex;
      flex-direction: column; align-items: center; justify-content: center; background: #f8f6f0; }
    h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
    p { color: #444; max-width: 24rem; text-align: center; line-height: 1.5; }
    code { display: block; margin: 1rem; padding: 0.75rem 1rem; background: #fff; border-radius: 8px;
      word-break: break-all; font-size: 0.85rem; border: 1px solid #ddd; }
    #qr { margin: 1rem 0; }
  </style>
</head>
<body>
  <h1>Jain Pathshala Mobile</h1>
  <p>Scan with <strong>Expo Go</strong> (phone on same Wi‑Fi as this PC)</p>
  <div id="qr"></div>
  <code>${expUrl}</code>
  <p>Or in Expo Go: <em>Enter URL manually</em> → paste the URL above.</p>
  <script>
    new QRCodeStyling({
      width: 280,
      height: 280,
      data: ${JSON.stringify(expUrl)},
      dotsOptions: { color: "#1a1a1a", type: "rounded" },
      backgroundOptions: { color: "#ffffff" },
      cornersSquareOptions: { type: "extra-rounded" },
      qrOptions: { errorCorrectionLevel: "H" },
    }).append(document.getElementById("qr"));
  </script>
</body>
</html>`;

fs.writeFileSync(htmlPath, html, "utf-8");
console.log(`QR page written: ${htmlPath}`);

if (process.platform === "win32") {
  spawnSync("cmd", ["/c", "start", "", htmlPath], { stdio: "ignore", shell: true });
} else if (process.platform === "darwin") {
  spawnSync("open", [htmlPath], { stdio: "ignore" });
} else {
  spawnSync("xdg-open", [htmlPath], { stdio: "ignore" });
}

console.log("Opened QR page in your default browser.\n");

spawnSync("npx", ["-y", "qrcode-terminal@0.12.0", expUrl], {
  stdio: "inherit",
  shell: true,
});
