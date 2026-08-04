import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: async (k: string) => {
      mem.delete(k);
    },
    multiRemove: async (keys: string[]) => {
      for (const k of keys) mem.delete(k);
    },
  },
}));

import {
  clearMediaUploadQueue,
  drainMediaUploads,
  enqueueHomeworkProofUpload,
  listMediaUploads,
} from "../offline/media-upload-queue";
import { MAX_UPLOAD_BYTES } from "../upload-size-guard";

const assignment_id = "11111111-1111-1111-1111-111111111111";
const student_id = "22222222-2222-2222-2222-222222222222";

describe("homework proof upload queue", () => {
  beforeEach(async () => {
    mem.clear();
    await clearMediaUploadQueue();
  });

  it("picking an image enqueues an upload and attaches the resulting asset", async () => {
    const upload = vi.fn(async () => ({
      key: "k",
      url: "https://cdn.example.com/homework/navkar.jpg",
      content_type: "image/jpeg",
      size: 12_000,
    }));
    const enqueueHomework = vi.fn(async () => "01HWOPID000000000000000000");
    const drainSync = vi.fn(async () => undefined);

    const result = await enqueueHomeworkProofUpload(
      {
        uri: "file:///tmp/navkar.jpg",
        name: "navkar.jpg",
        mime: "image/jpeg",
        sizeBytes: 12_000,
        assignment_id,
        student_id,
        submission_id: "33333333-3333-3333-3333-333333333333",
      },
      { upload, enqueueHomework, drainSync },
    );

    expect(result.status).toBe("queued");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "file:///tmp/navkar.jpg",
        name: "navkar.jpg",
        type: "image/jpeg",
      }),
      "homework-proof",
    );
    expect(enqueueHomework).toHaveBeenCalledWith({
      assignment_id,
      student_id,
      submission_id: "33333333-3333-3333-3333-333333333333",
      proof_asset_id: "https://cdn.example.com/homework/navkar.jpg",
    });
    expect(drainSync).toHaveBeenCalled();
    if (result.status === "queued") {
      expect(result.remote_url).toBe("https://cdn.example.com/homework/navkar.jpg");
    }
    expect(await listMediaUploads()).toHaveLength(0);
  });

  it("an oversized file is rejected with a helpful message before upload starts", async () => {
    const upload = vi.fn(async () => {
      throw new Error("apiUpload must not be called");
    });
    const enqueueHomework = vi.fn(async () => "x");

    const result = await enqueueHomeworkProofUpload(
      {
        uri: "file:///tmp/huge.mp4",
        name: "huge.mp4",
        mime: "video/mp4",
        sizeBytes: MAX_UPLOAD_BYTES + 1,
        hi: false,
        assignment_id,
        student_id,
      },
      { upload, enqueueHomework },
    );

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.message).toMatch(/50 MB/);
    }
    expect(upload).not.toHaveBeenCalled();
    expect(enqueueHomework).not.toHaveBeenCalled();
    expect(await listMediaUploads()).toHaveLength(0);
  });

  it("an upload started offline resumes on reconnect", async () => {
    const upload = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network request failed"))
      .mockResolvedValueOnce({
        key: "k2",
        url: "https://cdn.example.com/homework/retry.jpg",
        content_type: "image/jpeg",
        size: 800,
      });
    const enqueueHomework = vi.fn(async () => "01RETRY0000000000000000000");

    const first = await enqueueHomeworkProofUpload(
      {
        uri: "file:///tmp/offline.jpg",
        name: "offline.jpg",
        mime: "image/jpeg",
        sizeBytes: 800,
        assignment_id,
        student_id,
      },
      { upload, enqueueHomework },
    );

    expect(first.status).toBe("queued");
    expect(enqueueHomework).not.toHaveBeenCalled();
    const pending = await listMediaUploads();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("failed");
    expect(pending[0]!.uri).toBe("file:///tmp/offline.jpg");

    // Reconnect — drain again without re-picking.
    const drained = await drainMediaUploads({ upload, enqueueHomework });
    expect(drained.uploaded).toBe(1);
    expect(drained.attached).toBe(1);
    expect(enqueueHomework).toHaveBeenCalledWith(
      expect.objectContaining({
        proof_asset_id: "https://cdn.example.com/homework/retry.jpg",
      }),
    );
    expect(await listMediaUploads()).toHaveLength(0);
  });
});
