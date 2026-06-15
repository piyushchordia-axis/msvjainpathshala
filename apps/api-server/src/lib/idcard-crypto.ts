/**
 * Shared digital ID-card QR signing/verification. Used by the id-cards module
 * (generate/verify) and the shivir scanner. The QR key is domain-separated from
 * the auth-token secret so a leak of one context can't forge the other.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = (() => {
  const fromEnv = process.env.JP_AUTH_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JP_AUTH_SECRET is required in production.");
  }
  return "jp-dev-secret-do-not-use-in-production";
})();
// Domain-separate the QR key from the raw auth secret so a leak of one context
// can't forge the other.
const QR_SECRET = createHmac("sha256", SECRET).update("id-card-qr-v1").digest();

export interface CardQrPayload {
  student_id: string;
  card_number: string;
  v: number;
}

/** Build the canonical signed payload string for a card. */
export function buildCardPayload(p: CardQrPayload): string {
  return JSON.stringify({ student_id: p.student_id, card_number: p.card_number, v: p.v });
}

/** Hex HMAC of a payload string. */
export function signCardPayload(payload: string): string {
  return createHmac("sha256", QR_SECRET).update(payload).digest("hex");
}

/** Constant-time, canonical-hex verification of a payload signature. */
export function verifyCardSignature(payload: string, signature: string): boolean {
  if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = signCardPayload(payload);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

/** Parse a card payload JSON; returns null on any malformation. */
export function parseCardPayload(payload: string): CardQrPayload | null {
  try {
    const obj = JSON.parse(payload) as Record<string, unknown>;
    if (typeof obj.student_id !== "string" || typeof obj.v !== "number") return null;
    return { student_id: obj.student_id, card_number: String(obj.card_number ?? ""), v: obj.v };
  } catch {
    return null;
  }
}
