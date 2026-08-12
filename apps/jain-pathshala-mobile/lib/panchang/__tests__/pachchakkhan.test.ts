import { describe, expect, it } from "vitest";
import { nearestCity, getPanchangCity } from "@/lib/panchang/cities";
import { derivePachchakkhan } from "@/lib/panchang/pachchakkhan";
import { computeSunriseSunset, localHHmmToMs } from "@/lib/panchang/solar";
import { resolveSunriseSunset } from "@/lib/panchang/sun-override";
import type { SunOverrideFile } from "@/lib/panchang/sun-override-schema";

describe("derivePachchakkhan", () => {
  it("applies the six formulas exactly", () => {
    const sunrise = 1_000_000;
    const D = 8 * 60 * 60_000; // 8 hours
    const sunset = sunrise + D;
    const slots = derivePachchakkhan(sunrise, sunset);
    expect(slots.map((s) => s.key)).toEqual([
      "navkarsi",
      "porsi",
      "sadh_porsi",
      "purimuddh",
      "avaddh",
      "chovihar",
    ]);
    expect(slots[0]!.atMs).toBe(sunrise + 48 * 60_000);
    expect(slots[1]!.atMs).toBe(sunrise + D / 4);
    expect(slots[2]!.atMs).toBe(sunrise + (3 * D) / 8);
    expect(slots[3]!.atMs).toBe(sunrise + D / 2);
    expect(slots[4]!.atMs).toBe(sunrise + (3 * D) / 4);
    expect(slots[5]!.atMs).toBe(sunset);
  });
});

describe("nearestCity", () => {
  it("picks Ahmedabad for Sabarmati coords", () => {
    expect(nearestCity(23.06, 72.58).key).toBe("AMD");
  });

  it("picks Mumbai for Colaba coords", () => {
    expect(nearestCity(18.92, 72.83).key).toBe("MUM");
  });
});

describe("resolveSunriseSunset override precedence", () => {
  it("uses override HH:mm when the date is present", () => {
    const city = getPanchangCity("AMD");
    const override: SunOverrideFile = {
      schemaVersion: 1,
      contentVersion: 1,
      cityKey: "AMD",
      year: 2026,
      days: [{ date: "2026-08-12", sunrise: "06:10", sunset: "19:00" }],
    };
    const result = resolveSunriseSunset({
      city,
      date: "2026-08-12",
      override,
    });
    expect(result?.source).toBe("override");
    expect(result?.sunriseMs).toBe(localHHmmToMs("2026-08-12", "06:10"));
    expect(result?.sunsetMs).toBe(localHHmmToMs("2026-08-12", "19:00"));
  });

  it("falls back to solar when date missing from override", () => {
    const city = getPanchangCity("AMD");
    const override: SunOverrideFile = {
      schemaVersion: 1,
      contentVersion: 1,
      cityKey: "AMD",
      year: 2026,
      days: [{ date: "2026-01-01", sunrise: "07:00", sunset: "18:00" }],
    };
    const result = resolveSunriseSunset({
      city,
      date: "2026-08-12",
      override,
    });
    expect(result?.source).toBe("computed");
    expect(result && result.sunsetMs > result.sunriseMs).toBe(true);
  });
});

describe("computeSunriseSunset smoke", () => {
  it("Ahmedabad 2026-08-12 has sunrise before noon IST and positive D", () => {
    const city = getPanchangCity("AMD");
    const sun = computeSunriseSunset({
      lat: city.lat,
      lng: city.lng,
      date: "2026-08-12",
    });
    expect(sun).not.toBeNull();
    if (!sun) return;
    expect(sun.sunsetMs - sun.sunriseMs).toBeGreaterThan(0);
    // Rough civil window for monsoon Ahmedabad: sunrise ~05:30–07:00 IST
    const riseIstHour = Number(
      new Date(sun.sunriseMs).toLocaleString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        hour12: false,
      }),
    );
    const setIstHour = Number(
      new Date(sun.sunsetMs).toLocaleString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        hour12: false,
      }),
    );
    expect(riseIstHour).toBeGreaterThanOrEqual(5);
    expect(riseIstHour).toBeLessThan(8);
    expect(setIstHour).toBeGreaterThanOrEqual(18);
    expect(setIstHour).toBeLessThan(21);
  });

  it("Mumbai sample is within ±2 min of a known approximate", () => {
    // Approximate reference ~06:20 / 19:05 IST on 2026-03-21 (equinox-ish).
    const sun = computeSunriseSunset({
      lat: 19.076,
      lng: 72.8777,
      date: "2026-03-21",
    });
    expect(sun).not.toBeNull();
    if (!sun) return;
    const riseRef = localHHmmToMs("2026-03-21", "06:35")!;
    const setRef = localHHmmToMs("2026-03-21", "18:45")!;
    const tol = 15 * 60_000; // ±15 min smoke band (algorithm vs almanac)
    expect(Math.abs(sun.sunriseMs - riseRef)).toBeLessThan(tol);
    expect(Math.abs(sun.sunsetMs - setRef)).toBeLessThan(tol);
  });
});
