/**
 * Store-review test numbers — the same mechanism Firebase Auth exposes as
 * "phone numbers for testing" and Twilio Verify as test credentials.
 *
 * App Store and Play reviewers must be able to sign in unattended, but a
 * phone-OTP app cannot deliver an SMS to a reviewer's own handset. The standard
 * answer is a small operator-configured allow-list: for these exact numbers the
 * server accepts a fixed code and never contacts the SMS provider. Every other
 * number always gets a real SMS.
 *
 * Deliberate properties:
 *  - Configuration, not code. Nothing is compiled in; an empty/unset
 *    OTP_TEST_NUMBERS disables the mechanism entirely.
 *  - Works under NODE_ENV=production. That is the entire point — review happens
 *    against production. It is therefore gated on an explicit allow-list rather
 *    than on the environment.
 *  - Exact-match only. A number not listed can never take this path, so the
 *    blast radius is exactly the accounts the operator nominated.
 *  - Every other control still applies: send/verify rate limits, the 5-attempt
 *    cap, the 5-minute TTL, single-use consumption, and the login audit entry
 *    (tagged so test-number logins are distinguishable in the audit trail).
 *  - Loud startup warning, so an allow-list left behind after review is visible
 *    in the logs rather than forgotten.
 *
 * Format: OTP_TEST_NUMBERS="+919800000007:246813,+919800000003:135790"
 *
 * Operational guidance: nominate a low-privilege demo account (not super_admin),
 * and remove the variable once the app is live and no longer under review.
 */
import { logger } from "./logger";

const E164 = /^\+[1-9]\d{6,14}$/;
const CODE = /^\d{4,8}$/;

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
}

function parse(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    // Split on the LAST colon so a phone containing one is still parsed sanely.
    const idx = trimmed.lastIndexOf(":");
    const phone = idx > 0 ? trimmed.slice(0, idx).trim() : "";
    const code = idx > 0 ? trimmed.slice(idx + 1).trim() : "";
    if (!E164.test(phone) || !CODE.test(code)) {
      logger.error(
        { entry: idx > 0 ? `${maskPhone(phone)}:<redacted>` : "<malformed>" },
        "[otp:test-numbers] ignoring malformed OTP_TEST_NUMBERS entry (expected +E164:code)",
      );
      continue;
    }
    map.set(phone, code);
  }
  return map;
}

let _numbers: Map<string, string> | undefined;

function numbers(): Map<string, string> {
  if (_numbers) return _numbers;
  _numbers = parse(process.env["OTP_TEST_NUMBERS"] ?? "");
  if (_numbers.size > 0) {
    logger.warn(
      { count: _numbers.size, phones: [..._numbers.keys()].map(maskPhone) },
      "[otp:test-numbers] ACTIVE — these numbers accept a fixed code and never receive an SMS. Remove OTP_TEST_NUMBERS once store review is complete.",
    );
  }
  return _numbers;
}

/**
 * The fixed code for a nominated test number, or null for every other number
 * (which must go through the real SMS provider).
 */
export function testOtpCodeFor(phone: string): string | null {
  return numbers().get(phone) ?? null;
}

/**
 * Force the allow-list to parse now, so its startup warning appears in the boot
 * logs rather than on whichever login request happens to be first.
 */
export function warmTestOtpNumbers(): void {
  numbers();
}

/** Test-only: drop the memoised allow-list so a changed env is re-read. */
export function _resetTestOtpNumbers(): void {
  _numbers = undefined;
}
