import { describe, expect, it, vi } from "vitest";
import {
  MAX_UPLOAD_BYTES,
  rejectIfOverUploadLimit,
  fileTooLargeMessage,
} from "../upload-size-guard";

describe("rejectIfOverUploadLimit", () => {
  it("rejects an oversized asset with a message that names the 50 MB limit", () => {
    const msg = rejectIfOverUploadLimit(MAX_UPLOAD_BYTES + 1, false);
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/50 MB/);
    expect(msg).toBe(fileTooLargeMessage(false));
  });

  it("returns Hindi copy when hi=true", () => {
    const msg = rejectIfOverUploadLimit(200 * 1024 * 1024, true);
    expect(msg).toBe(fileTooLargeMessage(true));
    expect(msg).toMatch(/50 MB/);
    expect(msg).toMatch(/वीडियो/);
  });

  it("allows files at or under the cap and unknown sizes", () => {
    expect(rejectIfOverUploadLimit(MAX_UPLOAD_BYTES, false)).toBeNull();
    expect(rejectIfOverUploadLimit(1024, false)).toBeNull();
    expect(rejectIfOverUploadLimit(null, false)).toBeNull();
    expect(rejectIfOverUploadLimit(undefined, false)).toBeNull();
  });

  it("does not call apiUpload when the guard rejects (orchestration contract)", async () => {
    const apiUpload = vi.fn(async () => {
      throw new Error("apiUpload must not be called");
    });

    async function enqueueIfAllowed(sizeBytes: number) {
      const over = rejectIfOverUploadLimit(sizeBytes, false);
      if (over) return { uploaded: false as const, reason: over };
      await apiUpload();
      return { uploaded: true as const };
    }

    const result = await enqueueIfAllowed(MAX_UPLOAD_BYTES + 5_000_000);
    expect(result.uploaded).toBe(false);
    expect(result).toMatchObject({ reason: expect.stringMatching(/50 MB/) });
    expect(apiUpload).not.toHaveBeenCalled();
  });
});
