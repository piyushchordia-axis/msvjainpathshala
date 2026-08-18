/**
 * The Pachchakkhan city, and the rule that a guess is never recorded as a fact.
 *
 * The shipped code called requestForegroundPermissionsAsync() on day-screen
 * mount and, on denial, wrote Ahmedabad to storage. Every later call saw a
 * stored preference and returned early, so location was never asked for again
 * and the reader was pinned — silently and permanently. Against the bundled
 * catalogue that is up to 40 minutes of error at the solstices, and Chovihar is
 * a deadline, so the error runs LATE and the vow breaks.
 *
 * Every case below is planted from that failure.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: async (k: string) => {
      store.delete(k);
    },
  },
}));

const permission = { status: "granted" as string };
const position = { coords: { latitude: 12.9716, longitude: 77.5946 } }; // Bengaluru
let permissionCalls = 0;

vi.mock("expo-location", () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: async () => {
    permissionCalls++;
    return permission;
  },
  getCurrentPositionAsync: async () => position,
}));

const {
  PANCHANG_CITY_LEGACY_KEY,
  PANCHANG_CITY_PREF_KEY,
  dismissPanchangCityPrompt,
  locatePanchangCity,
  resolvePanchangCity,
  writePanchangCityKey,
} = await import("@/lib/panchang/city-prefs");

beforeEach(() => {
  store.clear();
  permissionCalls = 0;
  permission.status = "granted";
});

describe("resolvePanchangCity", () => {
  it("NEVER asks for location", async () => {
    // The bug started here: a GPS dialog nobody can attribute to an action.
    await resolvePanchangCity();
    expect(permissionCalls).toBe(0);
  });

  it("falls back to the default city without writing anything", async () => {
    const resolved = await resolvePanchangCity();
    expect(resolved.city.key).toBe("AMD");
    // The whole defect in one assertion: a guess must leave no trace, or the
    // next call mistakes it for an answer.
    expect(resolved.origin).toBe("fallback");
    expect(store.size).toBe(0);
  });

  it("reports a stored choice as settled", async () => {
    await writePanchangCityKey("MUM");
    const resolved = await resolvePanchangCity();
    expect(resolved.city.key).toBe("MUM");
    expect(resolved.origin).toBe("chosen");
  });

  it("uses a legacy preference but keeps offering to locate", async () => {
    // The old key was written BOTH when a reader picked a city and when the
    // code gave up, and the two are indistinguishable. Show their city, but do
    // not treat it as settled — that is what rescues an already-pinned install.
    store.set(PANCHANG_CITY_LEGACY_KEY, "MUM");
    const resolved = await resolvePanchangCity();
    expect(resolved.city.key).toBe("MUM");
    expect(resolved.origin).toBe("fallback");
  });
});

describe("locatePanchangCity", () => {
  it("persists the nearest city on a successful fix", async () => {
    const resolved = await locatePanchangCity();
    expect(resolved.city.key).toBe("BLR");
    expect(resolved.origin).toBe("located");
    expect(await resolvePanchangCity()).toMatchObject({
      city: { key: "BLR" },
      origin: "located",
    });
  });

  it("writes NOTHING when permission is denied, and asks again next time", async () => {
    permission.status = "denied";

    const first = await locatePanchangCity();
    expect(first.city.key).toBe("AMD");
    expect(first.origin).toBe("fallback");
    // The regression: the denial must not become a preference.
    expect(store.size).toBe(0);

    // …so the reader is not stranded. Granting later still works.
    permission.status = "granted";
    const second = await locatePanchangCity();
    expect(permissionCalls).toBe(2);
    expect(second.city.key).toBe("BLR");
    expect(second.origin).toBe("located");
  });

  it("writes nothing when the fix itself fails", async () => {
    permission.status = "granted";
    const failing = await import("expo-location");
    const spy = vi
      .spyOn(failing, "getCurrentPositionAsync")
      .mockRejectedValueOnce(new Error("no fix"));

    const resolved = await locatePanchangCity();
    expect(resolved.origin).toBe("fallback");
    expect(store.size).toBe(0);
    spy.mockRestore();
  });

  it("does not overwrite a city the reader already chose", async () => {
    await writePanchangCityKey("MUM");
    permission.status = "denied";
    const resolved = await locatePanchangCity();
    expect(resolved.city.key).toBe("MUM");
    expect(resolved.origin).toBe("chosen");
  });
});

describe("dismissPanchangCityPrompt", () => {
  it("settles the shown city so the offer stops returning", async () => {
    const before = await resolvePanchangCity();
    expect(before.origin).toBe("fallback");

    await dismissPanchangCityPrompt(before.city.key);

    const after = await resolvePanchangCity();
    expect(after.city.key).toBe("AMD");
    expect(after.origin).toBe("chosen");
  });

  it("clears the ambiguous legacy key once a real answer exists", async () => {
    store.set(PANCHANG_CITY_LEGACY_KEY, "MUM");
    await dismissPanchangCityPrompt("MUM");
    expect(store.has(PANCHANG_CITY_LEGACY_KEY)).toBe(false);
    expect(store.has(PANCHANG_CITY_PREF_KEY)).toBe(true);
  });
});
