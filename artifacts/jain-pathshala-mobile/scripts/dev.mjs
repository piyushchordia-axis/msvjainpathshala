import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

const packagerHost = process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? lanIp();
const apiBase =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  `http://${packagerHost === "127.0.0.1" ? "localhost" : packagerHost}:8080`;

const env = {
  ...process.env,
  CI: "false",
  EXPO_PUBLIC_API_BASE_URL: apiBase,
  REACT_NATIVE_PACKAGER_HOSTNAME: packagerHost,
};

console.log(`Metro port: ${port}`);
console.log(`API base: ${apiBase}`);
console.log(`Packager host: ${packagerHost}`);

async function waitForMetro() {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/status`, {
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

const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
const expoCli = requireFromProject.resolve("@expo/cli");

const child = spawn(
  process.execPath,
  [expoCli, "start", "--port", port, "--lan"],
  {
    stdio: "inherit",
    cwd: projectRoot,
    env,
  },
);

void (async () => {
  const ready = await waitForMetro();
  if (ready) {
    spawnSync(
      process.execPath,
      [path.join(projectRoot, "scripts", "show-qr.mjs")],
      {
        stdio: "inherit",
        cwd: projectRoot,
        env: { ...env, PORT: port },
      },
    );
  }
})();

child.on("exit", (code) => process.exit(code ?? 0));
