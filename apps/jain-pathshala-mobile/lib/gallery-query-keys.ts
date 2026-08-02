/**
 * React Query keys for public gallery surfaces.
 * Kept free of RN / react-query imports so unit tests can assert cache isolation.
 */
export const galleryHomeKey = (limit: number) =>
  ["public", "gallery", "home", limit] as const;

export const galleryWallKey = (limit: number) =>
  ["public", "gallery", "wall", limit] as const;
