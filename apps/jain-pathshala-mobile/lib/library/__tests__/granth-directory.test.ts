/**
 * SPEC §17.11.3–17.11.4 — Offline Granth directory shaping.
 *
 * These rules decide what a reader is told about where to physically go, and
 * they run offline against a cached payload with no server-side ordering to
 * fall back on. The ones worth pinning down: the city filter can never offer an
 * empty city, the viewer's own city is only defaulted to when it holds
 * something, and the two browse directions agree about what is where.
 */
import { describe, expect, it } from "vitest";
import type {
  GranthDirectoryDto,
  GranthEntryDto,
  GranthLibraryDto,
} from "@workspace/api-zod";
import {
  cityOptions,
  defaultCityId,
  entriesAtLibrary,
  filterToLibraries,
  groupLibrariesByCity,
  librariesHoldingEntry,
  parseLibraryIds,
  searchEntries,
  sortedEntries,
} from "@/lib/library/granth-directory";
// URL rules are shared with web and dependency-free; the mobile module
// wrapping them reaches react-native, which vitest cannot parse.
import { mapsTarget, mapsWebUrl, normalisePhone, telUrl, whatsappUrl } from "@workspace/api-zod";

const mapsUrl = (lib: { lat: number | null; lng: number | null; name: string; address: string }) =>
  mapsWebUrl(mapsTarget(lib));

const INDORE = "city-indore";
const MUMBAI = "city-mumbai";

function lib(over: Partial<GranthLibraryDto> & { id: string }): GranthLibraryDto {
  return {
    name_en: `Library ${over.id}`,
    name_hi: null,
    address_en: "Main road",
    address_hi: null,
    city_id: INDORE,
    city_name: "Indore",
    contact_name: null,
    contact_phone: null,
    has_whatsapp: false,
    timings_en: null,
    timings_hi: null,
    lat: null,
    lng: null,
    note_en: null,
    note_hi: null,
    order_index: 0,
    content_version: 1,
    ...over,
  };
}

function entry(over: Partial<GranthEntryDto> & { id: string }): GranthEntryDto {
  return {
    title_en: `Granth ${over.id}`,
    title_hi: null,
    author_en: null,
    author_hi: null,
    language: null,
    description_en: null,
    description_hi: null,
    linked_item_id: null,
    order_index: 0,
    content_version: 1,
    ...over,
  };
}

describe("cityOptions", () => {
  it("offers only cities that actually hold a library", () => {
    // §17.11.4 — never an empty city. Deriving the list from the rows rather
    // than from a cities table is the whole guarantee: a city with nothing
    // published simply cannot appear, so the filter cannot lead anywhere blank.
    const options = cityOptions([
      lib({ id: "a" }),
      lib({ id: "b" }),
      lib({ id: "c", city_id: MUMBAI, city_name: "Mumbai" }),
    ]);
    expect(options.map((c) => c.name)).toEqual(["Indore", "Mumbai"]);
    expect(options.map((c) => c.count)).toEqual([2, 1]);
  });

  it("is empty when nothing is published", () => {
    expect(cityOptions([])).toEqual([]);
  });
});

describe("defaultCityId", () => {
  it("defaults to the viewer's city when it holds a library", () => {
    expect(defaultCityId([lib({ id: "a" })], INDORE)).toBe(INDORE);
  });

  it("shows everything when the viewer's city holds nothing", () => {
    // Defaulting a reader in a city with no listed library to an empty screen
    // is worse than showing them the whole directory.
    expect(defaultCityId([lib({ id: "a" })], MUMBAI)).toBeNull();
  });

  it("shows everything for a guest with no city", () => {
    expect(defaultCityId([lib({ id: "a" })], null)).toBeNull();
    expect(defaultCityId([lib({ id: "a" })], undefined)).toBeNull();
  });
});

describe("groupLibrariesByCity", () => {
  it("groups by city alphabetically, libraries in admin order", () => {
    const groups = groupLibrariesByCity(
      [
        lib({ id: "b", order_index: 2 }),
        lib({ id: "z", city_id: MUMBAI, city_name: "Mumbai" }),
        lib({ id: "a", order_index: 1 }),
      ],
      false,
    );
    expect(groups.map((g) => g.cityName)).toEqual(["Indore", "Mumbai"]);
    expect(groups[0]!.libraries.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("narrows to one city when filtered", () => {
    const groups = groupLibrariesByCity(
      [lib({ id: "a" }), lib({ id: "z", city_id: MUMBAI, city_name: "Mumbai" })],
      false,
      MUMBAI,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.libraries.map((l) => l.id)).toEqual(["z"]);
  });
});

describe("sortedEntries / searchEntries", () => {
  const entries = [
    entry({ id: "3", title_en: "Tattvartha Sutra" }),
    entry({ id: "1", title_en: "Kalpasutra", author_en: "Bhadrabahu" }),
    entry({ id: "2", title_en: "Samaysar", title_hi: "समयसार" }),
  ];

  it("is alphabetical, not in the admin's order", () => {
    // "Browse by granth" is how someone finds a title they already have in
    // mind; a hand-curated order defeats that.
    expect(sortedEntries(entries, false).map((e) => e.title_en)).toEqual([
      "Kalpasutra",
      "Samaysar",
      "Tattvartha Sutra",
    ]);
  });

  it("searches title and author across both languages", () => {
    expect(searchEntries(entries, "bhadra", false).map((e) => e.id)).toEqual(["1"]);
    expect(searchEntries(entries, "समय", false).map((e) => e.id)).toEqual(["2"]);
    expect(searchEntries(entries, "", false)).toHaveLength(3);
    expect(searchEntries(entries, "nothing-here", false)).toEqual([]);
  });
});

describe("cross-indexing", () => {
  const directory: GranthDirectoryDto = {
    libraries: [
      lib({ id: "L1" }),
      lib({ id: "L2", city_id: MUMBAI, city_name: "Mumbai" }),
    ],
    entries: [entry({ id: "E1", title_en: "Kalpasutra" }), entry({ id: "E2", title_en: "Aacharang" })],
    availability: [
      { granth_id: "E1", library_id: "L1", note: "reference only, not for issue" },
      { granth_id: "E1", library_id: "L2", note: null },
      { granth_id: "E2", library_id: "L1", note: null },
    ],
  };

  it("lists a library's catalogue alphabetically with its per-row notes", () => {
    const rows = entriesAtLibrary(directory, "L1", false);
    expect(rows.map((r) => r.entry.title_en)).toEqual(["Aacharang", "Kalpasutra"]);
    // The note belongs to THIS shelf copy — it is what stops a wasted trip.
    expect(rows.find((r) => r.entry.id === "E1")!.note).toBe(
      "reference only, not for issue",
    );
  });

  it("lists where one granth can be borrowed, by city", () => {
    const rows = librariesHoldingEntry(directory, "E1", false);
    expect(rows.map((r) => r.library.id)).toEqual(["L1", "L2"]);
    expect(rows[0]!.note).toBe("reference only, not for issue");
    expect(rows[1]!.note).toBeNull();
  });

  it("drops joins whose other side is not in the payload", () => {
    // The server only ships joins where both sides are published; if one ever
    // slipped through, a blank row is worse than a missing one.
    const orphaned: GranthDirectoryDto = {
      ...directory,
      availability: [...directory.availability, { granth_id: "GONE", library_id: "L1", note: null }],
    };
    expect(entriesAtLibrary(orphaned, "L1", false)).toHaveLength(2);
  });
});

describe("cross-link filter", () => {
  it("narrows to the given libraries, and is a no-op when absent", () => {
    const libs = [lib({ id: "L1" }), lib({ id: "L2" })];
    expect(filterToLibraries(libs, ["L2"]).map((l) => l.id)).toEqual(["L2"]);
    expect(filterToLibraries(libs, null)).toHaveLength(2);
    expect(filterToLibraries(libs, [])).toHaveLength(2);
  });

  it("parses the comma-separated ids the cross-link puts in the URL", () => {
    expect(parseLibraryIds("a,b")).toEqual(["a", "b"]);
    expect(parseLibraryIds(["a, b"])).toEqual(["a", "b"]);
    expect(parseLibraryIds("")).toBeNull();
    expect(parseLibraryIds(undefined)).toBeNull();
    expect(parseLibraryIds(",,")).toBeNull();
  });
});

describe("device hand-off links", () => {
  it("strips formatting from a stored phone number", () => {
    expect(normalisePhone("+91 98765-43210")).toBe("+919876543210");
    expect(telUrl("+91 98765 43210")).toBe("tel:+919876543210");
    expect(normalisePhone("123")).toBeNull();
    expect(telUrl(null)).toBeNull();
  });

  it("refuses a WhatsApp link for a number with no country code", () => {
    // wa.me without a country code deep-links to whatever country the reader's
    // account is in — sending them to a stranger is worse than no button.
    expect(whatsappUrl("+919876543210")).toBe("https://wa.me/919876543210");
    expect(whatsappUrl("9876543210")).toBeNull();
  });

  it("prefers coordinates and falls back to an address query", () => {
    const withCoords = mapsUrl({ lat: 22.71, lng: 75.85, name: "Shri Jain", address: "Main road" });
    expect(withCoords).toContain("22.71");
    const withoutCoords = mapsUrl({ lat: null, lng: null, name: "Shri Jain", address: "Main road" });
    expect(withoutCoords).toContain("Shri%20Jain");
  });

  it("treats (0,0) as no fix, not as a location", () => {
    // A real point in the Gulf of Guinea — the same trap AT32 calls out for
    // attendance GPS. Fall back to the address instead of sending someone there.
    const url = mapsUrl({ lat: 0, lng: 0, name: "Shri Jain", address: "Main road" });
    expect(url).toContain("Main%20road");
    expect(url).not.toContain("0,0");
  });

  it("returns null when there is nothing to map at all", () => {
    expect(mapsUrl({ lat: null, lng: null, name: "", address: "" })).toBeNull();
  });
});
