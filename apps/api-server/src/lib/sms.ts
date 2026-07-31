/**
 * Pluggable SMS OTP delivery provider.
 * Activates a real HTTP adapter (MSG91-style, India) when the relevant env is
 * present; otherwise falls back to a network-free mock that just logs, so the
 * OTP flow stays fully testable in dev/test with no external account.
 *
 * Mirrors the mock-vs-real selector + prod fail-fast pattern in ./payments.ts.
 */
import { logger } from "./logger";

export interface SmsProvider {
  readonly name: "2factor" | "msg91" | "generic" | "mock";
  /**
   * True when the provider mints AND verifies the code itself (2Factor AUTOGEN).
   * For those, `sendOtp` ignores the `code` argument and returns a session id
   * the caller must persist, and verification goes through `verifyOtp` instead
   * of a local hash comparison — we never learn the code.
   */
  readonly ownsCode: boolean;
  /**
   * Deliver the one-time code to the given E.164-ish phone number. Resolves on
   * success; rejects on a delivery failure (the caller treats sending as
   * best-effort and never leaks the code on failure).
   *
   * Returns the provider session id when `ownsCode`, otherwise null.
   */
  sendOtp(phone: string, code: string): Promise<string | null>;
  /**
   * Verify a user-supplied code against a provider session id. Only meaningful
   * when `ownsCode`; the local-code adapters reject the call.
   */
  verifyOtp(sessionId: string, code: string): Promise<boolean>;
}

/** Shared by adapters that hand us a code to deliver ourselves. */
abstract class LocalCodeSmsProvider {
  readonly ownsCode = false as const;
  async verifyOtp(): Promise<boolean> {
    throw new Error("verifyOtp is only supported by provider-generated OTP adapters.");
  }
}

// ---------------------------------------------------------------------------
// Mock adapter (dev/test) — never hits the network.
// ---------------------------------------------------------------------------
class MockSmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "mock" as const;

  async sendOtp(phone: string, code: string): Promise<null> {
    // DEV-ONLY: log the code so the flow is observable locally. The real code
    // is also surfaced via the login response's dev_code in non-prod, so this
    // leaks nothing beyond what dev already exposes. Never selected in prod.
    logger.info({ phone, code, provider: "mock" }, "[sms:mock] OTP send (no network)");
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2Factor.in adapter (real, India) — AUTOGEN flow.
//
// 2Factor generates the OTP and delivers it over SMS with its own DLT-approved
// template, then verifies the user's input against the session id it returns.
// This is the flow that reliably lands as an SMS: the alternative "send your own
// code against a named template" endpoint silently falls back to a VOICE CALL
// when the template is not an approved SMS template on the account.
//
// A useful consequence: the code never exists in our process or our database,
// so there is nothing to leak and no local RNG in the authentication path.
// ---------------------------------------------------------------------------
class TwoFactorSmsProvider implements SmsProvider {
  readonly name = "2factor" as const;
  readonly ownsCode = true as const;
  private readonly apiKey: string;
  private readonly template: string | undefined;

  constructor(apiKey: string, template: string | undefined) {
    this.apiKey = apiKey;
    this.template = template;
  }

  private async call(pathAfterKey: string): Promise<{ Status?: string; Details?: string }> {
    const url = `https://2factor.in/API/V1/${encodeURIComponent(this.apiKey)}/${pathAfterKey}`;
    const res = await fetch(url);
    return (await res.json().catch(() => ({}))) as { Status?: string; Details?: string };
  }

  /** Returns the 2Factor session id used to verify the code later. */
  async sendOtp(phone: string): Promise<string> {
    const to = phone.replace(/\s+/g, "");
    const tail = this.template ? `AUTOGEN/${encodeURIComponent(this.template)}` : "AUTOGEN";
    const body = await this.call(`SMS/${encodeURIComponent(to)}/${tail}`);
    // Log the outcome (never the phone or the code) so SMS-vs-voice delivery
    // stays diagnosable. Status "Success" only means the request was accepted —
    // cross-check the delivery channel in the 2Factor dashboard → Reports.
    logger.info(
      { provider: "2factor", status: body.Status, template: this.template ?? "(default)" },
      "[sms:2factor] AUTOGEN send",
    );
    if (body.Status !== "Success" || !body.Details) {
      throw new Error(`2Factor send failed: ${body.Details ?? "unknown"}`);
    }
    return body.Details;
  }

  async verifyOtp(sessionId: string, code: string): Promise<boolean> {
    const body = await this.call(
      `SMS/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(code)}`,
    );
    // Success => Details "OTP Matched"; failures => "OTP Mismatch" / "OTP Expired".
    return body.Status === "Success";
  }
}

// ---------------------------------------------------------------------------
// MSG91 adapter (real, India) — scaffold over the transactional OTP API.
// ---------------------------------------------------------------------------
class Msg91SmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "msg91" as const;
  private readonly authKey: string;
  private readonly templateId: string;
  private readonly senderId: string | undefined;

  constructor(authKey: string, templateId: string, senderId: string | undefined) {
    super();
    this.authKey = authKey;
    this.templateId = templateId;
    this.senderId = senderId;
  }

  async sendOtp(phone: string, code: string): Promise<null> {
    // MSG91 expects the mobile number without a leading "+".
    const mobile = phone.replace(/^\+/, "");
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("template_id", this.templateId);
    url.searchParams.set("mobile", mobile);
    url.searchParams.set("otp", code);
    if (this.senderId) url.searchParams.set("sender", this.senderId);

    const res = await fetch(url, {
      method: "POST",
      headers: {
        authkey: this.authKey,
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`MSG91 send failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic HTTP adapter (real) — for any provider behind a simple JSON endpoint.
// Posts { phone, code } to SMS_API_URL with an optional bearer token.
// ---------------------------------------------------------------------------
class GenericHttpSmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "generic" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;

  constructor(apiUrl: string, apiKey: string | undefined) {
    super();
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async sendOtp(phone: string, code: string): Promise<null> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ phone, code }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SMS send failed: ${res.status} ${body.slice(0, 200)}`);
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Factory (singleton)
// ---------------------------------------------------------------------------
function build(): SmsProvider {
  const provider = process.env["SMS_PROVIDER"];
  const twoFactorKey = process.env["TWO_FACTOR_API_KEY"];
  const authKey = process.env["MSG91_AUTH_KEY"];
  const templateId = process.env["MSG91_TEMPLATE_ID"];
  const apiUrl = process.env["SMS_API_URL"];

  // 2Factor first: it is the provider in production use. Explicit selection, or
  // implicit whenever the API key is present.
  if ((provider === "2factor" || !provider) && twoFactorKey) {
    // An empty TWO_FACTOR_TEMPLATE means "use 2Factor's built-in DLT-approved
    // OTP template", which is the reliable default — only set it when you have
    // your own approved SMS template name.
    const template = process.env["TWO_FACTOR_TEMPLATE"]?.trim() || undefined;
    return new TwoFactorSmsProvider(twoFactorKey, template);
  }
  // Explicit MSG91 selection, or implicit when its credentials are present.
  if ((provider === "msg91" || (!provider && authKey)) && authKey && templateId) {
    return new Msg91SmsProvider(authKey, templateId, process.env["MSG91_SENDER_ID"]);
  }
  // Generic HTTP endpoint.
  if ((provider === "generic" || (!provider && apiUrl)) && apiUrl) {
    return new GenericHttpSmsProvider(apiUrl, process.env["SMS_API_KEY"]);
  }

  // The mock provider never delivers a real SMS — in production that silently
  // breaks login for every user. Fail fast at first use instead of shipping a
  // deployment where no one can receive a code.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SMS_PROVIDER (2factor: TWO_FACTOR_API_KEY, msg91: MSG91_AUTH_KEY+MSG91_TEMPLATE_ID, or generic: SMS_API_URL) is required in production; refusing to start with the mock SMS provider.",
    );
  }
  return new MockSmsProvider();
}

let _provider: SmsProvider | undefined;

/**
 * Returns the process-wide SMS provider singleton. Built lazily on first use so
 * the prod fail-fast surfaces at send time (matching the never-import-in-prod
 * intent), not at module load — and so tests/dev never construct a real client.
 */
export function getSmsProvider(): SmsProvider {
  if (!_provider) _provider = build();
  return _provider;
}
