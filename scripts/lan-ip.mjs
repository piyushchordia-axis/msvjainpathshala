import os from "node:os";

/**
 * Best LAN IPv4 for phone → PC dev (prefer Wi‑Fi 192.168.x / 10.x, skip WSL/Hyper-V).
 */
export function lanIp() {
  /** @type {{ address: string; score: number }[]} */
  const candidates = [];

  for (const [iface, nets] of Object.entries(os.networkInterfaces())) {
    const name = iface.toLowerCase();
    let ifaceScore = 5;
    if (name.includes("wi-fi") || name.includes("wlan") || name.includes("wireless")) {
      ifaceScore = 0;
    } else if (name.includes("ethernet") && !name.includes("vethernet")) {
      ifaceScore = 1;
    } else if (name.includes("vethernet") || name.includes("wsl") || name.includes("hyper-v")) {
      ifaceScore = 20;
    } else if (name.includes("bluetooth")) {
      ifaceScore = 30;
    }

    for (const net of nets ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      const { address } = net;
      if (address.startsWith("169.254.")) continue;

      let score = ifaceScore;
      if (address.startsWith("192.168.")) score += 0;
      else if (address.startsWith("10.")) score += 1;
      else score += 10;

      candidates.push({ address, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.address ?? "127.0.0.1";
}
