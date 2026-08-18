/**
 * Q7 — video items render as embeds, and only from hosts we trust.
 */
import { describe, expect, it } from "vitest";
import { videoEmbedSrc } from "@/lib/video-embed";

describe("videoEmbedSrc", () => {
  it("converts the shapes an admin actually pastes", () => {
    const embed = "https://www.youtube.com/embed/dQw4w9WgXcQ";
    expect(videoEmbedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://youtu.be/dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(embed);
    expect(videoEmbedSrc(embed)).toBe(embed);
  });

  it("keeps extra query parameters out of the player URL", () => {
    // A pasted link usually carries a playlist or a tracking tag; only the id
    // is ours to interpolate.
    expect(
      videoEmbedSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&si=abc"),
    ).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("converts Vimeo", () => {
    expect(videoEmbedSrc("https://vimeo.com/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    expect(videoEmbedSrc("https://player.vimeo.com/video/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
  });

  it("REFUSES a look-alike host", () => {
    // The reason the check is an exact hostname match and not endsWith: this
    // page also renders sanitised HTML, and an iframe is the one element we
    // must never point at an attacker's origin.
    expect(videoEmbedSrc("https://youtube.com.evil.tld/watch?v=abc")).toBeNull();
    expect(videoEmbedSrc("https://notyoutube.com/watch?v=abc")).toBeNull();
    expect(videoEmbedSrc("https://evil.tld/embed/abc")).toBeNull();
  });

  it("REFUSES anything not https", () => {
    expect(videoEmbedSrc("http://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoEmbedSrc("javascript:alert(1)")).toBeNull();
  });

  it("returns null rather than a broken player for an unusable link", () => {
    // Null means "keep the plain link" — an iframe with no id is worse than the
    // anchor it replaced.
    expect(videoEmbedSrc("https://www.youtube.com/")).toBeNull();
    expect(videoEmbedSrc("https://www.youtube.com/watch")).toBeNull();
    expect(videoEmbedSrc("https://vimeo.com/")).toBeNull();
    expect(videoEmbedSrc(null)).toBeNull();
    expect(videoEmbedSrc("not a url")).toBeNull();
  });

  it("rejects an id carrying path traversal", () => {
    expect(videoEmbedSrc("https://vimeo.com/..%2F..%2Fetc")).toBeNull();
  });
});
