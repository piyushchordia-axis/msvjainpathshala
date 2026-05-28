/**
 * Centralised PII redaction for Pino logs (SPEC §18.12, CLAUDE.md "Security
 * rules → PII redaction in logs").
 *
 * Banned field names (case-insensitive) are replaced with `[REDACTED]` BEFORE
 * any transport / serialiser sees them. The redactor walks objects deeply so
 * a sensitive field tucked under `req.body.user.phone` is still scrubbed.
 *
 * We deliberately use a hand-rolled walker rather than Pino's built-in
 * `redact` option because Pino's redact uses dot-path globs and trips over
 * arrays + dynamic keys. The deep walker here is unconditional and cheaper to
 * reason about at audit time.
 */

const BANNED_FIELDS: ReadonlySet<string> = new Set([
  'phone',
  'phone_number',
  'phonenumber',
  'mobile',
  'email',
  'email_address',
  'pan',
  'aadhaar',
  'aadhar',
  'password',
  'passwd',
  'pwd',
  'otp',
  'otp_token',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'auth',
  'cookie',
  'set-cookie',
  'session',
  'private_key',
  'secret',
  'api_key',
]);

export const REDACTED = '[REDACTED]';

const MAX_DEPTH = 8;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Walk `value`, returning a new structure where any property whose KEY
 * (lower-cased) is in `BANNED_FIELDS` has its value replaced with [REDACTED].
 * Returns the input unchanged for primitives.
 */
export function redactPii<T = unknown>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactPii(v, depth + 1)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = BANNED_FIELDS.has(k.toLowerCase()) ? REDACTED : redactPii(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/**
 * Pino `formatters.log` hook signature. Pino calls this once per log line with
 * the merged object (request bindings + mixin + arg). Return value replaces
 * the log payload — that's our redaction point.
 */
export function pinoRedactionFormatter(obj: Record<string, unknown>): Record<string, unknown> {
  return redactPii(obj);
}
