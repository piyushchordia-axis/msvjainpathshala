import { spawn, spawnSync } from "node:child_process";

import { createRequire } from "node:module";

import { fileURLToPath } from "node:url";

import path from "node:path";

import { lanIp } from "../../../scripts/lan-ip.mjs";



const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Do not use `PORT` — api-server and shells often set PORT=8080. */
const metroPort =
  process.env.EXPO_METRO_PORT ?? process.env.METRO_PORT ?? "8081";

const apiPort = Number(process.env.API_PORT ?? "8080");



const packagerHost = process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? lanIp();



/**

 * Physical devices can reach Metro (:8081) but often not api-server (:8080)

 * when Windows Wi‑Fi is Public (firewall blocks inbound 8080).

 * Metro proxies /api and /v1 to localhost:8080 — see metro.config.js.

 */

async function tryNgrokApi() {
  try {
    const ngrok = (await import("@expo/ngrok")).default;
    const url = await ngrok.connect({ port: apiPort });
    const base = url.replace(/\/$/, "");
    console.log(`API tunnel (ngrok): ${base}`);
    console.log("  → forwards to http://127.0.0.1:" + apiPort);
    return base;
  } catch (err) {
    console.warn("ngrok unavailable:", err.message);
    return null;
  }
}

async function resolveApiBaseUrl() {
  const fromEnv = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (
    fromEnv &&
    !fromEnv.includes("localhost") &&
    !fromEnv.includes("127.0.0.1")
  ) {
    return fromEnv;
  }

  if (process.env.EXPO_ANDROID_EMULATOR === "1") {
    return `http://10.0.2.2:${apiPort}`;
  }

  if (process.env.EXPO_USE_LAN_API === "1") {
    const ip = lanIp();
    const host = ip !== "127.0.0.1" ? ip : "localhost";
    return `http://${host}:${apiPort}`;
  }

  if (process.env.EXPO_USE_NGROK === "1") {
    const tunneled = await tryNgrokApi();
    if (tunneled) return tunneled;
  }

  const ip = packagerHost !== "127.0.0.1" ? packagerHost : "localhost";
  return `http://${ip}:${metroPort}`;
}

const apiBase = await resolveApiBaseUrl();



const env = {

  ...process.env,

  CI: "false",

  EXPO_PUBLIC_API_BASE_URL: apiBase,

  EXPO_PUBLIC_METRO_PORT: metroPort,

  REACT_NATIVE_PACKAGER_HOSTNAME: packagerHost,

};



console.log(`Metro port: ${metroPort}`);

console.log(`API base: ${apiBase}`);

if (apiBase.includes(String(metroPort)) && !apiBase.startsWith("https://")) {
  console.log(`  → Metro proxies /api and /v1 to http://127.0.0.1:${apiPort}`);
}

console.log(`Packager host: ${packagerHost}`);

console.log(

  "Direct LAN :8080: set EXPO_USE_LAN_API=1 after running scripts/setup-dev-network.ps1 as Administrator.",

);



async function waitForMetro() {

  for (let i = 0; i < 90; i++) {

    try {

      const res = await fetch(`http://localhost:${metroPort}/status`, {

        signal: AbortSignal.timeout(2000),

      });

      if (res.ok) return true;

    } catch {

      /* retry */

    }

    await new Promise((r) => setTimeout(r, 1000));

  }

  return false;

}



async function waitForApiProxy() {

  for (let i = 0; i < 30; i++) {

    try {

      const res = await fetch(`http://localhost:${metroPort}/api/healthz`, {

        signal: AbortSignal.timeout(2000),

      });

      if (res.ok) {

        const body = await res.text();

        console.log(`API proxy OK: ${body}`);

        return true;

      }

    } catch {

      /* api-server may still be starting */

    }

    await new Promise((r) => setTimeout(r, 1000));

  }

  console.warn(

    `Could not reach api-server via Metro proxy. Start api-server on port ${apiPort} first.`,

  );

  return false;

}

async function warnIfDatabaseDown() {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/v1/public/centres`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return;
    console.warn(
      "\n⚠ Database not reachable — guest screens and login will fail.",
    );
    console.warn(
      "  Start Docker Desktop, then: docker start jp-postgres\n",
    );
  } catch {
    /* api not up */
  }
}

const requireFromProject = createRequire(path.join(projectRoot, "package.json"));

const expoCli = requireFromProject.resolve("@expo/cli");



const child = spawn(

  process.execPath,

  [expoCli, "start", "--port", metroPort, "--lan", "--clear"],

  {

    stdio: "inherit",

    cwd: projectRoot,

    env,

  },

);



void (async () => {

  const ready = await waitForMetro();

  if (ready) {

    await waitForApiProxy();
    await warnIfDatabaseDown();

    spawnSync(

      process.execPath,

      [path.join(projectRoot, "scripts", "show-qr.mjs")],

      {

        stdio: "inherit",

        cwd: projectRoot,

        env: { ...env, PORT: metroPort },

      },

    );

  }

})();



child.on("exit", (code) => process.exit(code ?? 0));

