/**
 * UAT / staging fixed OTP — global on/off for “everyone uses one known code,
 * no SMS”, distinct from per-phone OTP_TEST_NUMBERS (store review).
 *
 * When OTP_FIXED_ENABLED is truthy (1 / true / yes), every send uses
 * OTP_FIXED_CODE (default 123456) and skips the SMS provider. Verify is
 * unchanged: it only matches the hash stored at send time.
 *
 * Works under NODE_ENV=production so UAT hosts can enable it without flipping
 * NODE_ENV. Leave unset (or false) for real SMS. Loud boot warning so a flag
 * left on in production is visible in logs.
 */
import { logger } from "./logger";

const CODE = /^\d{4,8}$/;
const DEFAULT_CODE = "123456";

let _enabled: boolean | undefined;
let _code: string | undefined;
let _warned = false;

function parseEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseCode(raw: string | undefined): string {
  const v = (raw ?? DEFAULT_CODE).trim();
  if (!CODE.test(v)) {
    logger.error(
      { value: "<invalid>" },
      "[otp:fixed] OTP_FIXED_CODE must be 4–8 digits; falling back to 123456",
    );
    return DEFAULT_CODE;
  }
  return v;
}

function load(): void {
  if (_enabled !== undefined) return;
  _enabled = parseEnabled(process.env["OTP_FIXED_ENABLED"]);
  _code = parseCode(process.env["OTP_FIXED_CODE"]);
  if (_enabled && !_warned) {
    _warned = true;
    logger.warn(
      { codeLength: _code.length },
      "[otp:fixed] ACTIVE — all phones accept a fixed OTP and never receive an SMS. Unset OTP_FIXED_ENABLED before real production SMS.",
    );
  }
}

/** Whether the global fixed-OTP UAT flag is on. */
export function isFixedOtpEnabled(): boolean {
  load();
  return _enabled!;
}

/** Fixed code when the flag is on (always defined; only used when enabled). */
export function fixedOtpCode(): string {
  load();
  return _code!;
}

/** Force parse + warning at process boot. */
export function warmFixedOtp(): void {
  load();
}

/** Test-only: drop memo so a changed env is re-read. */
export function _resetFixedOtp(): void {
  _enabled = undefined;
  _code = undefined;
  _warned = false;
}
