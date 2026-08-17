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



const packagerHost =
  process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? lanIp();



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

  // babel-preset-expo's expo-router plugin skips EXPO_ROUTER_APP_ROOT inlining
  // when NODE_ENV==='test' (vitest/shell leftover). That leaves
  // process.env.EXPO_ROUTER_APP_ROOT in require.context and Metro fails.
  NODE_ENV:
    process.env.NODE_ENV === "production" ? "production" : "development",

  EXPO_PUBLIC_API_BASE_URL: apiBase,

  EXPO_PUBLIC_METRO_PORT: metroPort,

  REACT_NATIVE_PACKAGER_HOSTNAME: packagerHost,

};

// #region agent log
{
  const fs = await import("node:fs");
  const payload = {
    sessionId: "115197",
    runId: "post-fix",
    hypothesisId: "A",
    location: "scripts/dev.mjs:env",
    message: "Expo Metro spawn env — NODE_ENV drives expo-router APP_ROOT inlining",
    data: {
      NODE_ENV: env.NODE_ENV ?? null,
      BABEL_ENV: env.BABEL_ENV ?? null,
      inheritedNODE_ENV: process.env.NODE_ENV ?? null,
      wouldSkipAppRootInline: env.NODE_ENV === "test",
      metroPort,
      projectRoot,
    },
    timestamp: Date.now(),
  };
  try {
    fs.appendFileSync(
      path.resolve(projectRoot, "..", "..", "debug-115197.log"),
      JSON.stringify(payload) + "\n",
    );
  } catch {
    /* ignore */
  }
  fetch("http://127.0.0.1:7744/ingest/33975112-0421-4ef6-a79e-c48c452c7ec5", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Debug-Session-Id": "115197",
    },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
// #endregion

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



// Agent / CI shells have no TTY; Expo then tries to prompt for login and dies
// with "Input is required, but 'npx expo' is in non-interactive mode".
// --offline skips Expo account prompts. It cannot be combined with --lan/--tunnel,
// so we drop --lan and rely on REACT_NATIVE_PACKAGER_HOSTNAME for the LAN URL.
const offline =
  !process.stdin.isTTY || process.env.EXPO_OFFLINE === "1";
const expoArgs = [expoCli, "start", "--port", metroPort, "--clear"];
if (offline) {
  expoArgs.push("--offline");
  console.log("Starting Expo offline (non-interactive shell / EXPO_OFFLINE=1).");
} else if (packagerHost === "localhost" || packagerHost === "127.0.0.1") {
  expoArgs.push("--localhost");
} else {
  expoArgs.push("--lan");
}

const child = spawn(

  process.execPath,

  expoArgs,

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

