/**
 * Guard: every op_type in the /v1/sync/batch vocabulary must be routed by
 * executeOp — no member may fall through to the `default:` "Unknown op_type."
 *
 * Why this exists: `acknowledgement` was a fully-implemented handler
 * (handleAcknowledgement) that was never wired into the executeOp switch, so it
 * fell to `default:` and returned ERR_VALIDATION_FAILED. On the client,
 * applyDrainResult terminalises any ERR_* code that is not ERR_NETWORK /
 * ERR_INTERNAL — so every parent "mark homework done" op died permanently on its
 * first attempt, with no UI rendering that queue to reveal it.
 *
 * This is deliberately a table over the whole vocabulary rather than a test for
 * that one op: it fails for the NEXT handler someone forgets to wire up.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";
import { loginAs, auth } from "./helpers";
import { ulid } from "../src/lib/ulid";

afterAll(async () => {
  await pool.end();
});

/**
 * Mirrors OP_TYPES in src/services/sync-batch.ts. Kept as a literal (rather than
 * imported) so that deleting a case from the switch AND the vocabulary together
 * still fails this test — the point is that the two stay in agreement.
 */
const OP_TYPES = [
  "checkin",
  "attendance",
  "checkout",
  "shivir_scan",
  "niyam_submission",
  "homework_submission",
  "course_progress",
  "course_certification",
  "acknowledgement",
] as const;

const UNKNOWN_OP_MESSAGE = "Unknown op_type.";

describe("POST /v1/sync/batch — op_type routing coverage", () => {
  it("routes every declared op_type (none falls through to Unknown op_type.)", async () => {
    const { token } = await loginAs("shikshak");

    // One op per type with a deliberately empty payload. Each handler is expected
    // to reject it on its own terms (Zod → ERR_INTERNAL, or a domain error). What
    // must never happen is the dispatcher not recognising the op at all.
    const ops = OP_TYPES.map((op_type) => ({
      submission_op_id: ulid(),
      op_type,
      payload: {},
      client_timestamp: new Date().toISOString(),
    }));

    const res = await request(app).post("/v1/sync/batch").set(auth(token)).send({ ops });

    expect(res.status).toBe(200);
    const results = res.body.data.results as Array<{
      submission_op_id: string;
      status: string;
      error?: { code: string; message: string };
    }>;
    expect(results).toHaveLength(OP_TYPES.length);

    const unroutedOpTypes = results
      .map((r, i) => ({ opType: OP_TYPES[i]!, message: r.error?.message }))
      .filter((r) => r.message === UNKNOWN_OP_MESSAGE)
      .map((r) => r.opType);

    expect(unroutedOpTypes).toEqual([]);
  });

  it("accepts a well-formed homework.mark_done acknowledgement", async () => {
    // The specific regression: this op previously died terminally with
    // ERR_VALIDATION_FAILED "Unknown op_type." before reaching handleAcknowledgement.
    const { token } = await loginAs("parent");

    const res = await request(app)
      .post("/v1/sync/batch")
      .set(auth(token))
      .send({
        ops: [
          {
            submission_op_id: ulid(),
            op_type: "acknowledgement",
            // A syntactically valid but non-existent submission: the handler should
            // reach the homework service and fail on the row, not on the op_type.
            payload: {
              kind: "homework.mark_done",
              entity_id: "00000000-0000-4000-8000-0000000000ff",
            },
            client_timestamp: new Date().toISOString(),
          },
        ],
      });

    expect(res.status).toBe(200);
    const [result] = res.body.data.results as Array<{
      status: string;
      error?: { code: string; message: string };
    }>;
    expect(result!.error?.message).not.toBe(UNKNOWN_OP_MESSAGE);
  });
});
