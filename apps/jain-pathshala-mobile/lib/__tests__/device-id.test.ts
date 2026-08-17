/**
 * Device id stability.
 *
 * The old sign-in screen minted a fresh id on every verify, so the server's
 * same-device replace path never ran and each sign-in burned one of the five
 * session slots — six sign-ins from one handset evicted five genuine other
 * devices. These tests pin the two properties that prevent that: the id is
 * stable across calls and across process restarts, and a broken keystore
 * degrades instead of failing sign-in.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();
let failRead = false;
let failWrite = false;

vi.mock("@/lib/secure-storage", () => ({
  secureStorage: {
    getItem: async (k: string) => {
      if (failRead) throw new Error("keystore unavailable");
      return store.get(k) ?? null;
    },
    setItem: async (k: string, v: string) => {
      if (failWrite) throw new Error("keystore unavailable");
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

/** Crockford Base32 — no I, L, O or U. */
const DEVICE_ID = /^mobile-[0-9A-HJKMNP-TV-Z]{26}$/;

async function freshModule() {
  vi.resetModules();
  return import("../device-id");
}

beforeEach(() => {
  store.clear();
  failRead = false;
  failWrite = false;
});

describe("getDeviceId", () => {
  it("mints once and returns the same id thereafter", async () => {
    const { getDeviceId } = await freshModule();
    const a = await getDeviceId();
    const b = await getDeviceId();
    expect(a).toBe(b);
    expect(store.get("jp.mobile.device_id")).toBe(a);
  });

  it("survives a process restart by reading the persisted value back", async () => {
    const first = await (await freshModule()).getDeviceId();
    // A fresh module graph is what a cold app start looks like.
    const second = await (await freshModule()).getDeviceId();
    expect(second).toBe(first);
  });

  it("hands concurrent callers one id, not two", async () => {
    const { getDeviceId } = await freshModule();
    const [a, b, c] = await Promise.all([getDeviceId(), getDeviceId(), getDeviceId()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(store.size).toBe(1);
  });

  it("matches the format the server will accept", async () => {
    const id = await (await freshModule()).getDeviceId();
    expect(id).toMatch(DEVICE_ID);
    // Server bound is device_id: z.string().min(1).max(128).
    expect(id.length).toBeGreaterThanOrEqual(1);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it("stays stable in-process when the keystore is unusable, and never throws", async () => {
    failRead = true;
    failWrite = true;
    const { getDeviceId } = await freshModule();
    const a = await getDeviceId();
    const b = await getDeviceId();
    expect(a).toMatch(DEVICE_ID);
    // Losing the id across restarts is bad; failing sign-in outright is worse.
    expect(b).toBe(a);
  });

  it("still persists when only the read side fails", async () => {
    failRead = true;
    const { getDeviceId } = await freshModule();
    const id = await getDeviceId();
    expect(store.get("jp.mobile.device_id")).toBe(id);
  });
});
