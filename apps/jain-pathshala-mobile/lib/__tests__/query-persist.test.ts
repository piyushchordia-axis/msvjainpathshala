import { describe, expect, it } from "vitest";
import { shouldPersistQueryKey } from "@/lib/query-persist-keys";

describe("query persist allow-list", () => {
  it("persists shikshak roster and today session keys", () => {
    expect(shouldPersistQueryKey(["shikshak", "today"])).toBe(true);
    expect(shouldPersistQueryKey(["shikshak", "attendance-session", "sess-1"])).toBe(true);
  });

  it("persists student attendance keys", () => {
    expect(shouldPersistQueryKey(["me", "attendance", "student-1"])).toBe(true);
    expect(
      shouldPersistQueryKey(["me", "attendance", "student-1", { limit: 5 }]),
    ).toBe(true);
  });

  it("persists library tree keys (public + member)", () => {
    expect(shouldPersistQueryKey(["library", "public"])).toBe(true);
    expect(shouldPersistQueryKey(["library", "member"])).toBe(true);
  });

  it("persists public browse keys for offline relaunch (GST-ERR-03)", () => {
    expect(shouldPersistQueryKey(["public", "centres"])).toBe(true);
    expect(shouldPersistQueryKey(["public", "shivirs"])).toBe(true);
    expect(shouldPersistQueryKey(["public", "notices"])).toBe(true);
    expect(shouldPersistQueryKey(["public", "centre-holidays", "c-1"])).toBe(true);
    expect(shouldPersistQueryKey(["team", "national"])).toBe(true);
  });

  it("keeps the public gallery memory-only (Q6 consent is query-time)", () => {
    expect(shouldPersistQueryKey(["public", "gallery", "wall", 60])).toBe(false);
    expect(shouldPersistQueryKey(["public", "gallery", "home", 10])).toBe(false);
  });

  it("does not persist unrelated queries", () => {
    expect(shouldPersistQueryKey(["me", "punya", "student-1"])).toBe(false);
    expect(shouldPersistQueryKey(["me", "notifications"])).toBe(false);
  });

  it("never persists the admin gallery key (opted-out family photos)", () => {
    expect(shouldPersistQueryKey(["admin", "gallery"])).toBe(false);
    expect(
      shouldPersistQueryKey(["admin", "gallery", { filter: "needs_attention" }]),
    ).toBe(false);
  });
});

/**
 * Roster offline-from-cache acceptance test requires React Native runtime
 * (PersistQueryClientProvider + NetInfo + AppState). Not runnable in vitest/node.
 */
