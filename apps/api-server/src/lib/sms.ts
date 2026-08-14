/**
 * Pluggable SMS OTP delivery provider.
 * Activates a real HTTP adapter when the relevant env is present; otherwise
 * falls back to a network-free mock that just logs, so the OTP flow stays
 * fully testable in dev/test with no external account.
 *
 * We always mint and verify OTPs locally (argon2id + TTL + attempt caps).
 * Providers only deliver the code we generate — never AUTOGEN/VERIFY sessions.
 *
 * Mirrors the mock-vs-real selector + prod fail-fast pattern in ./payments.ts.
 */
import { logger } from "./logger";

export interface SmsProvider {
  readonly name: "2factor" | "msg91" | "generic" | "mock";
  /** Always false — we own generation and verification. Kept for callers. */
  readonly ownsCode: boolean;
  /**
   * Deliver the one-time code to the given E.164-ish phone number. Resolves on
   * success; rejects on a delivery failure.
   */
  sendOtp(phone: string, code: string): Promise<void>;
  /**
   * Unused — verification is always local. Local-code adapters reject the call.
   */
  verifyOtp(sessionId: string, code: string): Promise<boolean>;
}

/** Shared by adapters that deliver a code we minted ourselves. */
abstract class LocalCodeSmsProvider {
  readonly ownsCode = false as const;
  async verifyOtp(): Promise<boolean> {
    throw new Error("verifyOtp is unused — OTP verification is always local.");
  }
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 4 ? "****" : `****${digits.slice(-4)}`;
}

/** Strip spaces and a leading "+" for 2Factor (10-digit or 91XXXXXXXXXX). */
export function normalizePhoneForSms(phone: string): string {
  return phone.replace(/\s+/g, "").replace(/^\+/, "");
}

// ---------------------------------------------------------------------------
// Mock adapter (dev/test) — never hits the network.
// ---------------------------------------------------------------------------
class MockSmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "mock" as const;

  async sendOtp(phone: string, code: string): Promise<void> {
    // DEV-ONLY: log the code so the flow is observable locally. Never selected
    // in prod. The login API never returns the OTP in the response.
    logger.info({ phone, code, provider: "mock" }, "[sms:mock] OTP send (no network)");
  }
}

type TwoFactorBody = { Status?: string; Details?: string };

// ---------------------------------------------------------------------------
// 2Factor.in adapter (real, India) — delivery only.
//
// We generate the OTP; 2Factor only sends it via a DLT-approved named template
// (TWO_FACTOR_TEMPLATE, e.g. oceanlogin). Do NOT use AUTOGEN/VERIFY — that
// moves expiry and attempt caps outside our control.
//
// GOTCHA: HTTP 200 is returned even on some failures — treat as failed unless
// Status === "Success". If the approved DLT text no longer matches what is
// sent, operator delivery can fail with no useful error from 2Factor.
// ---------------------------------------------------------------------------
export class TwoFactorSmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "2factor" as const;
  private readonly apiKey: string;
  private readonly template: string;

  constructor(apiKey: string, template: string) {
    super();
    this.apiKey = apiKey;
    this.template = template;
  }

  private async call(pathAfterKey: string): Promise<TwoFactorBody> {
    const url = `https://2factor.in/API/V1/${encodeURIComponent(this.apiKey)}/${pathAfterKey}`;
    const res = await fetch(url);
    return (await res.json().catch(() => ({}))) as TwoFactorBody;
  }

  async sendOtp(phone: string, code: string): Promise<void> {
    const to = normalizePhoneForSms(phone);
    const body = await this.call(
      `SMS/${encodeURIComponent(to)}/${encodeURIComponent(code)}/${encodeURIComponent(this.template)}`,
    );
    logger.info(
      {
        provider: "2factor",
        status: body.Status,
        template: this.template,
        phone: maskPhone(phone),
      },
      "[sms:2factor] OTP send",
    );
    if (body.Status !== "Success") {
      throw new Error(`2Factor send failed: ${body.Details ?? "unknown"}`);
    }
  }

  /** Balance check for ops/diagnostics — GET .../BAL/SMS. */
  async checkBalance(): Promise<TwoFactorBody> {
    return this.call("BAL/SMS");
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
class GenericHttpSmsProvider extends LocalCodeSmsProvider implements SmsProvider {
  readonly name = "generic" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;

  constructor(apiUrl: string, apiKey: string | undefined) {
    super();
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
  const twoFactorKey = process.env["TWO_FACTOR_API_KEY"]?.trim();
  const authKey = process.env["MSG91_AUTH_KEY"];
  const templateId = process.env["MSG91_TEMPLATE_ID"];
  const apiUrl = process.env["SMS_API_URL"];

  // 2Factor first: explicit selection, or implicit whenever the API key is present.
  if ((provider === "2factor" || !provider) && twoFactorKey) {
    const template = process.env["TWO_FACTOR_TEMPLATE"]?.trim();
    if (!template) {
      throw new Error(
        "TWO_FACTOR_TEMPLATE is required when TWO_FACTOR_API_KEY is set (DLT-approved template name, e.g. oceanlogin).",
      );
    }
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
      "SMS_PROVIDER (2factor: TWO_FACTOR_API_KEY+TWO_FACTOR_TEMPLATE, msg91: MSG91_AUTH_KEY+MSG91_TEMPLATE_ID, or generic: SMS_API_URL) is required in production; refusing to start with the mock SMS provider.",
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

/**
 * Log 2Factor SMS balance at boot when that provider is active (ops visibility).
 * Never throws — balance check failure must not block startup.
 */
export async function logSmsBalanceIfConfigured(): Promise<void> {
  const provider = getSmsProvider();
  if (provider.name !== "2factor" || !(provider instanceof TwoFactorSmsProvider)) return;
  try {
    const body = await provider.checkBalance();
    logger.info(
      { provider: "2factor", status: body.Status, details: body.Details },
      "[sms:2factor] SMS balance",
    );
  } catch (err) {
    logger.warn({ err, provider: "2factor" }, "[sms:2factor] balance check failed");
  }
}

/** Test-only: drop memo so a changed env is re-read. */
export function _resetSmsProvider(): void {
  _provider = undefined;
}
