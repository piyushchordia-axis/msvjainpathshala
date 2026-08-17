/**
 * Producers for the two queues that were declared, drain-ordered and handled
 * server-side but had NO client producer: jp.queue.niyam_submissions and
 * jp.queue.shivir_scans. Without them, a niyam submitted out of signal (and the
 * proof recorded with it) and every shivir scan at a venue with no bars were
 * lost outright.
 *
 * Also covers the batch cap and transport-status classification, which are the
 * two guards that make reading ApiError.statusCode safe.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (k: string) => mem.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mem.set(k, v);
    },
    multiRemove: async (keys: string[]) => {
      for (const k of keys) mem.delete(k);
    },
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: () => () => {} },
}));
vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
}));
const apiPost = vi.fn();
vi.mock("@/lib/api", () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }));

import { QUEUE_KEYS } from "../queue-keys";
import { clearAllQueues, readQueue } from "../storage";
import {
  enqueueNiyamSubmission,
  enqueueShivirScan,
  drainQueues,
  classifyTransportStatus,
  MAX_OPS_PER_BATCH,
} from "../sync-engine";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

beforeEach(async () => {
  mem.clear();
  apiPost.mockReset();
  await clearAllQueues();
});

describe("enqueueNiyamSubmission", () => {
  it("writes a queued op carrying every proof, not just the first", async () => {
    const opId = await enqueueNiyamSubmission({
      niyam_id: "11111111-1111-4111-8111-111111111111",
      student_id: "22222222-2222-4222-8222-222222222222",
      media: [
        { url: "https://x/niyam-proof/a.jpg", kind: "photo" },
        { url: "https://x/niyam-proof/b.mp4", kind: "video" },
      ],
      notes: "Completed with family",
    });

    expect(opId).toMatch(ULID_RE);
    const ops = await readQueue(QUEUE_KEYS.niyam_submissions);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.state).toBe("queued");
    expect(ops[0]!.attempts).toBe(0);
    expect(ops[0]!.payload).toMatchObject({
      submission_op_id: opId,
      niyam_id: "11111111-1111-4111-8111-111111111111",
      student_id: "22222222-2222-4222-8222-222222222222",
      notes: "Completed with family",
    });
    // The regression this guards: a single proof_asset_id silently dropped media[1..].
    expect((ops[0]!.payload as { media?: unknown[] }).media).toHaveLength(2);
  });

  it("posts as op_type niyam_submission", async () => {
    apiPost.mockResolvedValue({ results: [] });
    await enqueueNiyamSubmission({
      niyam_id: "11111111-1111-4111-8111-111111111111",
      student_id: "22222222-2222-4222-8222-222222222222",
    });
    await drainQueues();

    const body = apiPost.mock.calls[0]![1] as { ops: Array<{ op_type: string }> };
    expect(body.ops[0]!.op_type).toBe("niyam_submission");
  });

  it("keeps the op queued when the server rejects it — never silently discarded", async () => {
    const opId = await enqueueNiyamSubmission({
      niyam_id: "11111111-1111-4111-8111-111111111111",
      student_id: "22222222-2222-4222-8222-222222222222",
    });
    apiPost.mockResolvedValue({
      results: [
        {
          submission_op_id: opId,
          status: "failed",
          error: { code: "ERR_INTERNAL", message: "boom" },
        },
      ],
    });
    await drainQueues();

    const ops = await readQueue(QUEUE_KEYS.niyam_submissions);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.last_error?.code).toBe("ERR_INTERNAL");
  });
});

describe("enqueueShivirScan", () => {
  it("writes a queued op preserving scan kind and the original scan time", async () => {
    const scannedAt = "2026-08-17T04:30:00.000Z";
    const opId = await enqueueShivirScan({
      shivir_session_id: "33333333-3333-4333-8333-333333333333",
      qr_payload: "JP|STU|abc",
      qr_signature: "sig-abc",
      scan_kind: "check_in",
      scanned_at: scannedAt,
    });

    expect(opId).toMatch(ULID_RE);
    const ops = await readQueue(QUEUE_KEYS.shivir_scans);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.payload).toMatchObject({
      shivir_session_id: "33333333-3333-4333-8333-333333333333",
      qr_payload: "JP|STU|abc",
      qr_signature: "sig-abc",
      scan_kind: "check_in",
      // Must be when the card was scanned, not when it synced.
      scanned_at: scannedAt,
    });
  });

  it("posts as op_type shivir_scan", async () => {
    apiPost.mockResolvedValue({ results: [] });
    await enqueueShivirScan({
      shivir_session_id: "33333333-3333-4333-8333-333333333333",
      qr_payload: "JP|STU|abc",
      qr_signature: "sig-abc",
    });
    await drainQueues();

    const body = apiPost.mock.calls[0]![1] as { ops: Array<{ op_type: string }> };
    expect(body.ops[0]!.op_type).toBe("shivir_scan");
  });
});

describe("batch cap", () => {
  it("never posts more ops than the server will accept", async () => {
    for (let i = 0; i < MAX_OPS_PER_BATCH + 25; i += 1) {
      await enqueueShivirScan({
        shivir_session_id: "33333333-3333-4333-8333-333333333333",
        qr_payload: `JP|STU|${i}`,
        qr_signature: `sig-${i}`,
      });
    }
    apiPost.mockResolvedValue({ results: [] });
    await drainQueues();

    const body = apiPost.mock.calls[0]![1] as { ops: unknown[] };
    // Uncapped, this posted 125 ops; the server caps at 200 and answers an
    // oversized body with a flat 422 — which is terminal, so the whole backlog
    // would have died together.
    expect(body.ops.length).toBeLessThanOrEqual(MAX_OPS_PER_BATCH);
  });
});

describe("classifyTransportStatus", () => {
  it("reads statusCode, which is the property ApiError actually exposes", () => {
    expect(classifyTransportStatus({ statusCode: 422 })).toBe(422);
  });

  it("treats an expired session as transient, not terminal", () => {
    // shouldRetry() makes any 4xx terminal. A 401 here means the access token
    // lapsed while the device was offline — the refresh flow fixes it. Reporting
    // it as terminal would destroy the entire queue on the first reconnect.
    expect(classifyTransportStatus({ statusCode: 401 })).toBeUndefined();
    expect(classifyTransportStatus({ statusCode: 403 })).toBeUndefined();
  });

  it("falls back to `status` for non-ApiError shapes", () => {
    expect(classifyTransportStatus({ status: 500 })).toBe(500);
  });
});
