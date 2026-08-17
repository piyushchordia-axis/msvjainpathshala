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

/** Shape the real API returns for folder=homework uploads. */
const UPLOADED_URL = "https://api.example.com/uploads/homework/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg";
const RETRY_URL = "https://api.example.com/uploads/homework/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jpg";

describe("homework proof upload queue", () => {
  beforeEach(async () => {
    mem.clear();
    await clearMediaUploadQueue();
  });

  it("picking an image enqueues an upload and attaches the resulting asset", async () => {
    const upload = vi.fn(async () => ({
      key: "homework/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      url: UPLOADED_URL,
      content_type: "image/jpeg",
      size: 12_000,
    }));
    const enqueueHomework = vi.fn(async () => "01HWOPID000000000000000000");
    const drainSync = vi.fn(async () => [
      { submission_op_id: "01HWOPID000000000000000000", status: "success" as const },
    ]);

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
      "homework",
    );
    expect(enqueueHomework).toHaveBeenCalledWith({
      assignment_id,
      student_id,
      submission_id: "33333333-3333-3333-3333-333333333333",
      proof_asset_id: UPLOADED_URL,
    });
    expect(drainSync).toHaveBeenCalled();
    if (result.status === "queued") {
      expect(result.remote_url).toBe(UPLOADED_URL);
      expect(result.sync_state).toBe("synced");
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
        key: "homework/bbbbbbbb-cccc-dddd-eeee-ffffffffffff.jpg",
        url: RETRY_URL,
        content_type: "image/jpeg",
        size: 800,
      });
    const enqueueHomework = vi.fn(async () => "01RETRY0000000000000000000");
    const drainSync = vi.fn(async () => [
      { submission_op_id: "01RETRY0000000000000000000", status: "success" as const },
    ]);

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
    if (first.status === "queued") {
      expect(first.sync_state).toBe("queued");
    }
    expect(enqueueHomework).not.toHaveBeenCalled();
    const pending = await listMediaUploads();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("failed");
    expect(pending[0]!.uri).toBe("file:///tmp/offline.jpg");

    // Reconnect — drain again without re-picking. The failed attempt set
    // next_attempt_at (NEW-4 backoff: 5s ± jitter on attempt 1), and the drain
    // honours it exactly like drainQueues does, so step past it first.
    vi.useFakeTimers();
    let drained: Awaited<ReturnType<typeof drainMediaUploads>>;
    try {
      vi.advanceTimersByTime(10_000);
      drained = await drainMediaUploads({ upload, enqueueHomework, drainSync });
    } finally {
      vi.useRealTimers();
    }
    expect(drained.uploaded).toBe(1);
    expect(drained.attached).toBe(1);
    expect(enqueueHomework).toHaveBeenCalledWith(
      expect.objectContaining({
        proof_asset_id: RETRY_URL,
      }),
    );
    expect(await listMediaUploads()).toHaveLength(0);
  });

  it("upload success but homework attach failed keeps the media op and surfaces failed", async () => {
    const upload = vi.fn(async () => ({
      key: "homework/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      url: UPLOADED_URL,
      content_type: "image/jpeg",
      size: 12_000,
    }));
    const enqueueHomework = vi.fn(async () => "01FAILOP000000000000000000");
    const drainSync = vi.fn(async () => [
      {
        submission_op_id: "01FAILOP000000000000000000",
        status: "failed" as const,
        error: {
          code: "ERR_VALIDATION_FAILED",
          message: "That file is not a homework upload you own — upload it again.",
        },
      },
    ]);

    const result = await enqueueHomeworkProofUpload(
      {
        uri: "file:///tmp/navkar.jpg",
        name: "navkar.jpg",
        mime: "image/jpeg",
        sizeBytes: 12_000,
        assignment_id,
        student_id,
      },
      { upload, enqueueHomework, drainSync },
    );

    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.sync_state).toBe("failed");
      expect(result.error_message).toMatch(/homework upload/i);
    }
    const pending = await listMediaUploads();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.state).toBe("failed");
    expect(pending[0]!.remote_url).toBe(UPLOADED_URL);
  });

  it("attach conflict surfaces conflict and dequeues the media op", async () => {
    const upload = vi.fn(async () => ({
      key: "homework/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg",
      url: UPLOADED_URL,
      content_type: "image/jpeg",
      size: 12_000,
    }));
    const enqueueHomework = vi.fn(async () => "01CONFOP000000000000000000");
    const drainSync = vi.fn(async () => [
      {
        submission_op_id: "01CONFOP000000000000000000",
        status: "conflict" as const,
        error: { code: "ERR_CONFLICT", message: "Already submitted with a newer mark." },
      },
    ]);

    const result = await enqueueHomeworkProofUpload(
      {
        uri: "file:///tmp/navkar.jpg",
        name: "navkar.jpg",
        mime: "image/jpeg",
        sizeBytes: 12_000,
        assignment_id,
        student_id,
      },
      { upload, enqueueHomework, drainSync },
    );

    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.sync_state).toBe("conflict");
      expect(result.error_message).toMatch(/newer/i);
    }
    expect(await listMediaUploads()).toHaveLength(0);
  });
});
