import { describe, expect, it } from "vitest";
import { sanitizeLibraryHtml } from "@/lib/library/sanitize-html";

describe("sanitizeLibraryHtml", () => {
  it("keeps allowed tags", () => {
    const out = sanitizeLibraryHtml(
      "<p>Hello <b>bold</b> <i>italic</i> <strong>s</strong> <em>e</em></p><br/>",
    );
    expect(out).toContain("<p>");
    expect(out).toContain("<b>bold</b>");
    expect(out).toContain("<i>italic</i>");
    expect(out).toContain("<strong>s</strong>");
    expect(out).toContain("<em>e</em>");
    expect(out).toMatch(/<br\s*\/>/);
  });

  it("keeps only text-align on p", () => {
    const out = sanitizeLibraryHtml(
      '<p style="text-align: center; color: red" onclick="x()">Hi</p>',
    );
    expect(out).toBe('<p style="text-align: center">Hi</p>');
  });

  it("strips script, anchors, and div wrappers", () => {
    const out = sanitizeLibraryHtml(
      '<div><script>alert(1)</script><a href="https://evil">x</a><p>ok</p></div>',
    );
    expect(out).not.toContain("script");
    expect(out).not.toContain("href");
    expect(out).not.toContain("<div");
    expect(out).toContain("<p>ok</p>");
    expect(out).toContain("x");
  });

  it("rejects non-align styles and bad align values", () => {
    expect(sanitizeLibraryHtml('<p style="font-size: 40px">A</p>')).toBe("<p>A</p>");
    expect(sanitizeLibraryHtml('<p style="text-align: blink">A</p>')).toBe("<p>A</p>");
  });

  it("escapes raw text", () => {
    expect(sanitizeLibraryHtml("<p>a < b</p>")).toContain("&lt;");
  });
});
