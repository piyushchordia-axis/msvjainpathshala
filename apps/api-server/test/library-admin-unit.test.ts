import { describe, expect, it } from "vitest";
import { sanitizeLibraryHtml } from "../src/lib/library-sanitize-html";
import { itemCodeFromFilename } from "../src/lib/library-audio";
import { panchangYearSchema, zodDetails } from "../src/lib/panchang-schema";
import { keyFromLibraryUrl } from "../src/lib/library-media";

describe("sanitizeLibraryHtml", () => {
  it("keeps allowlisted tags and text-align on p", () => {
    const out = sanitizeLibraryHtml(
      `<p style="text-align: center"><strong>Om</strong></p><script>x</script>`,
    );
    expect(out).toContain("<strong>Om</strong>");
    expect(out).toContain('style="text-align: center"');
    expect(out).not.toContain("script");
  });

  it("unwraps unknown tags", () => {
    expect(sanitizeLibraryHtml("<div>Hello</div>")).toBe("Hello");
  });
});

describe("itemCodeFromFilename", () => {
  it("parses code from stem", () => {
    expect(itemCodeFromFilename("ST-01.mp3")).toBe("ST-01");
    expect(itemCodeFromFilename("navkar-intro_final.MP3")).toBe("navkar-intro_final");
    expect(itemCodeFromFilename("path/to/Bhaktamar.mp3")).toBe("Bhaktamar");
  });

  it("returns null for empty stem", () => {
    expect(itemCodeFromFilename(".mp3")).toBeNull();
  });
});

describe("panchangYearSchema", () => {
  it("returns per-field details on failure", () => {
    const parsed = panchangYearSchema.safeParse({ schemaVersion: 1 });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const details = zodDetails(parsed.error);
    expect(details.length).toBeGreaterThan(0);
    expect(details.some((d) => d.path.length > 0 || d.message.length > 0)).toBe(true);
  });
});

describe("keyFromLibraryUrl", () => {
  it("extracts library keys for orphan matching", () => {
    expect(
      keyFromLibraryUrl("http://localhost:8080/uploads/library/audio/abc.mp3"),
    ).toBe("library/audio/abc.mp3");
    expect(keyFromLibraryUrl("https://cdn.example/uploads/library%2Ficon.png")).toBe(
      "library/icon.png",
    );
    expect(keyFromLibraryUrl(null)).toBeNull();
  });
});
