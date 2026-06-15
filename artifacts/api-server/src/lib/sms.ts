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
  readonly name: "msg91" | "generic" | "mock";
  /**
   * Deliver the one-time code to the given E.164-ish phone number. Resolves on
   * success; rejects on a delivery failure (the caller treats sending as
   * best-effort and never leaks the code on failure).
   */
  sendOtp(phone: string, code: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock adapter (dev/test) — never hits the network.
// ---------------------------------------------------------------------------
class MockSmsProvider implements SmsProvider {
  readonly name = "mock" as const;

  async sendOtp(phone: string, code: string): Promise<void> {
    // DEV-ONLY: log the code so the flow is observable locally. The real code
    // is also surfaced via the login response's dev_code in non-prod, so this
    // leaks nothing beyond what dev already exposes. Never selected in prod.
    logger.info({ phone, code, provider: "mock" }, "[sms:mock] OTP send (no network)");
  }
}

// ---------------------------------------------------------------------------
// MSG91 adapter (real, India) — scaffold over the transactional OTP API.
// ---------------------------------------------------------------------------
class Msg91SmsProvider implements SmsProvider {
  readonly name = "msg91" as const;
  private readonly authKey: string;
  private readonly templateId: string;
  private readonly senderId: string | undefined;

  constructor(authKey: string, templateId: string, senderId: string | undefined) {
    this.authKey = authKey;
    this.templateId = templateId;
    this.senderId = senderId;
  }

  async sendOtp(phone: string, code: string): Promise<void> {
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
  }
}

// ---------------------------------------------------------------------------
// Generic HTTP adapter (real) — for any provider behind a simple JSON endpoint.
// Posts { phone, code } to SMS_API_URL with an optional bearer token.
// ---------------------------------------------------------------------------
class GenericHttpSmsProvider implements SmsProvider {
  readonly name = "generic" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;

  constructor(apiUrl: string, apiKey: string | undefined) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
  }

  async sendOtp(phone: string, code: string): Promise<void> {
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
  }
}

// ---------------------------------------------------------------------------
// Factory (singleton)
// ---------------------------------------------------------------------------
function build(): SmsProvider {
  const provider = process.env["SMS_PROVIDER"];
  const authKey = process.env["MSG91_AUTH_KEY"];
  const templateId = process.env["MSG91_TEMPLATE_ID"];
  const apiUrl = process.env["SMS_API_URL"];

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
      "SMS_PROVIDER (msg91: MSG91_AUTH_KEY+MSG91_TEMPLATE_ID, or generic: SMS_API_URL) is required in production; refusing to start with the mock SMS provider.",
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
