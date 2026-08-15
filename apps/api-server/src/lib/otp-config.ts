/**
 * OTP delivery mode from env:
 *   OTP_ENABLED=true  → send via SMS (2Factor / etc.)
 *   OTP_ENABLED=false → use DEFAULT_OTP and skip SMS (local / UAT)
 *   DEFAULT_OTP_FLAG=true  (with SMS on) → send DEFAULT_OTP over SMS
 *   DEFAULT_OTP_FLAG=false (with SMS on) → generate a fresh code for SMS
 *
 * Unset OTP_ENABLED defaults to false (DEFAULT_OTP, no SMS) OUTSIDE production,
 * and to true (live SMS) under NODE_ENV=production. An unset variable must never
 * mean "every registered phone accepts a fixed code" on a public deployment —
 * turning OTP off is a deliberate act and has to be spelled out in the env.
 * Unset DEFAULT_OTP_FLAG defaults to false (random when SMS is on).
 *
 * Soft-compat: if OTP_ENABLED is unset and OTP_FIXED_ENABLED is set, map
 * OTP_FIXED_ENABLED=true → SMS off + OTP_FIXED_CODE as the default code.
 */
import { logger } from "./logger";

const CODE = /^\d{4,8}$/;
const FALLBACK_CODE = "123456";

let _otpEnabled: boolean | undefined;
let _defaultOtpFlag: boolean | undefined;
let _defaultCode: string | undefined;
let _warned = false;
let _deprecatedWarned = false;

function parseTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseCode(raw: string | undefined, label: string): string {
  const v = (raw ?? FALLBACK_CODE).trim();
  if (!CODE.test(v)) {
    logger.error(
      { value: "<invalid>", label },
      `[otp] ${label} must be 4–8 digits; falling back to 123456`,
    );
    return FALLBACK_CODE;
  }
  return v;
}

function envIsSet(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== "";
}

function load(): void {
  if (_otpEnabled !== undefined) return;

  _defaultOtpFlag = parseTruthy(process.env["DEFAULT_OTP_FLAG"]);

  if (envIsSet("OTP_ENABLED")) {
    _otpEnabled = parseTruthy(process.env["OTP_ENABLED"]);
    _defaultCode = parseCode(process.env["DEFAULT_OTP"], "DEFAULT_OTP");
  } else if (envIsSet("OTP_FIXED_ENABLED")) {
    // Deprecated: OTP_FIXED_ENABLED=true meant “fixed code, no SMS”.
    if (!_deprecatedWarned) {
      _deprecatedWarned = true;
      logger.warn(
        "[otp] OTP_FIXED_ENABLED/OTP_FIXED_CODE are deprecated — use OTP_ENABLED + DEFAULT_OTP",
      );
    }
    const fixedOn = parseTruthy(process.env["OTP_FIXED_ENABLED"]);
    _otpEnabled = false;
    _defaultCode = fixedOn
      ? parseCode(
          process.env["OTP_FIXED_CODE"] ?? process.env["DEFAULT_OTP"],
          "OTP_FIXED_CODE",
        )
      : parseCode(process.env["DEFAULT_OTP"], "DEFAULT_OTP");
  } else {
    // Nothing configured. Outside production that means "local/UAT, use
    // DEFAULT_OTP". In production it must mean the opposite: a missing variable
    // cannot be allowed to silently downgrade a public API to a fixed code that
    // signs in every registered phone, super_admin included.
    _otpEnabled = process.env.NODE_ENV === "production";
    _defaultCode = parseCode(process.env["DEFAULT_OTP"], "DEFAULT_OTP");
  }

  if (!_warned) {
    _warned = true;
    const inProd = process.env.NODE_ENV === "production";
    if (!_otpEnabled) {
      logger.warn(
        { codeLength: _defaultCode!.length, production: inProd },
        inProd
          ? "[otp] OTP_ENABLED=false in production — all phones use DEFAULT_OTP and never receive SMS. Set OTP_ENABLED=true before live SMS."
          : "[otp] OTP_ENABLED=false — using DEFAULT_OTP and skipping SMS. Set OTP_ENABLED=true to send via 2Factor.",
      );
    } else if (_defaultOtpFlag) {
      logger.warn(
        { codeLength: _defaultCode!.length, production: inProd },
        "[otp] DEFAULT_OTP_FLAG=true — live SMS will send DEFAULT_OTP (fixed code) instead of a random OTP.",
      );
    } else if (inProd && !envIsSet("OTP_ENABLED")) {
      logger.warn(
        "[otp] OTP_ENABLED is unset; defaulting to live SMS because NODE_ENV=production. Set it explicitly to remove the ambiguity.",
      );
    }
  }
}

/** True when live SMS delivery is on. */
export function isOtpEnabled(): boolean {
  load();
  return _otpEnabled!;
}

/**
 * When SMS is on, true means send DEFAULT_OTP instead of a generated code.
 * Ignored when OTP_ENABLED is false (always DEFAULT_OTP, no SMS).
 */
export function isDefaultOtpFlag(): boolean {
  load();
  return _defaultOtpFlag!;
}

/** Fixed code from DEFAULT_OTP (or compat OTP_FIXED_CODE). */
export function defaultOtpCode(): string {
  load();
  return _defaultCode!;
}

/** Force parse + warning at process boot. */
export function warmOtpConfig(): void {
  load();
}

/** Test-only: drop memo so a changed env is re-read. */
export function _resetOtpConfig(): void {
  _otpEnabled = undefined;
  _defaultOtpFlag = undefined;
  _defaultCode = undefined;
  _warned = false;
  _deprecatedWarned = false;
}
