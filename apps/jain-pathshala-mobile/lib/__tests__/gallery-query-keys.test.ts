import { describe, expect, it } from "vitest";
import { galleryHomeKey, galleryWallKey } from "../gallery-query-keys";

/**
 * Home carousel and Punya Wall must never share a react-query cache key —
 * otherwise a wall fetch with limit 12 could poison the home carousel (or
 * vice versa when limits collide).
 */
describe("gallery query keys (surfaces)", () => {
  it("home and wall keys differ even at the same limit", () => {
    expect(galleryHomeKey(12)).not.toEqual(galleryWallKey(12));
    expect(galleryHomeKey(60)).not.toEqual(galleryWallKey(60));
  });

  it("includes the surface segment so caches cannot collide", () => {
    expect(galleryHomeKey(12)).toEqual(["public", "gallery", "home", 12]);
    expect(galleryWallKey(60)).toEqual(["public", "gallery", "wall", 60]);
  });

  it("keys change with limit within a surface", () => {
    expect(galleryHomeKey(12)).not.toEqual(galleryHomeKey(60));
    expect(galleryWallKey(12)).not.toEqual(galleryWallKey(60));
  });
});
