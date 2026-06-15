/**
 * Pluggable transactional email delivery provider.
 * Activates a real HTTP adapter (SMTP-relay / generic JSON API) when the
 * relevant env is present; otherwise falls back to a network-free mock that just
 * logs, so flows that send email (e.g. 80G donation receipts) stay fully
 * testable in dev/test with no external account.
 *
 * Mirrors the mock-vs-real selector + prod-aware fallback pattern in ./sms.ts.
 * Unlike SMS (which gates login and so fail-fasts in prod on the mock), email is
 * best-effort: a missing-but-needed provider in prod returns the mock and logs a
 * warning rather than crashing, since the rest of the request must still succeed.
 */
import { logger } from "./logger";

export interface EmailAttachment {
  filename: string;
  /** Raw attachment bytes (e.g. a generated PDF). */
  content: Buffer;
  content_type: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  /** Plain-text body. */
  text: string;
  /** Optional HTML body. */
  html?: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  readonly name: "smtp" | "generic" | "mock";
  /**
   * Deliver one transactional email. Resolves on success; rejects on a delivery
   * failure (callers treat sending as best-effort and never block the request on
   * a failure).
   */
  send(message: EmailMessage): Promise<void>;
}

// ---------------------------------------------------------------------------
// Mock adapter (dev/test) — never hits the network.
// ---------------------------------------------------------------------------
class MockEmailProvider implements EmailProvider {
  readonly name = "mock" as const;

  async send(message: EmailMessage): Promise<void> {
    // DEV-ONLY: log that an email would have been sent so the flow is observable
    // locally. Never selected when a real provider's env is configured.
    logger.info(
      {
        to: message.to,
        subject: message.subject,
        attachments: (message.attachments ?? []).map((a) => a.filename),
        provider: "mock",
      },
      "[email:mock] send (no network)",
    );
  }
}

// ---------------------------------------------------------------------------
// Generic HTTP adapter (real) — for any provider behind a simple JSON endpoint
// (Postmark/Resend/SendGrid-style). Posts a JSON message to EMAIL_API_URL with
// an optional bearer token; attachments are base64-encoded.
// ---------------------------------------------------------------------------
class GenericHttpEmailProvider implements EmailProvider {
  readonly name = "generic" as const;
  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly from: string;

  constructor(apiUrl: string, apiKey: string | undefined, from: string) {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.from = from;
  }

  async send(message: EmailMessage): Promise<void> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers["Authorization"] = `Bearer ${this.apiKey}`;
    const res = await fetch(this.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        attachments: (message.attachments ?? []).map((a) => ({
          filename: a.filename,
          content_type: a.content_type,
          content_base64: a.content.toString("base64"),
        })),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Email send failed: ${res.status} ${body.slice(0, 200)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// SMTP adapter (real) — scaffold.
// nodemailer is NOT bundled here on purpose: adding it would change the install
// graph and could break `pnpm install` for other concurrent work. We import it
// dynamically so the dependency is only required when SMTP is actually selected
// (i.e. EMAIL_PROVIDER=smtp + SMTP_* present). If it is not installed, sending
// throws a clear, actionable error rather than crashing at module load.
// MANUAL FOLLOW-UP: add `nodemailer` (+ `@types/nodemailer`) to api-server deps
// to enable this adapter in production.
// ---------------------------------------------------------------------------
type NodemailerTransport = {
  sendMail(opts: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<unknown>;
};
type NodemailerModule = {
  createTransport(opts: {
    host: string;
    port: number;
    secure: boolean;
    auth?: { user: string; pass: string };
  }): NodemailerTransport;
};

class SmtpEmailProvider implements EmailProvider {
  readonly name = "smtp" as const;
  private readonly opts: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    pass: string | undefined;
    from: string;
  };
  private transport: NodemailerTransport | undefined;

  constructor(opts: {
    host: string;
    port: number;
    secure: boolean;
    user: string | undefined;
    pass: string | undefined;
    from: string;
  }) {
    this.opts = opts;
  }

  private async getTransport(): Promise<NodemailerTransport> {
    if (this.transport) return this.transport;
    let mod: NodemailerModule;
    try {
      // Dynamic import via a non-literal specifier: keeps nodemailer out of the
      // install graph until actually used, and avoids a compile-time module
      // resolution error since the dependency is intentionally NOT installed
      // (see MANUAL FOLLOW-UP above). Resolves to the package only at runtime.
      const specifier = "nodemailer";
      mod = (await import(/* @vite-ignore */ specifier)) as unknown as NodemailerModule;
    } catch {
      throw new Error(
        "EMAIL_PROVIDER=smtp requires the optional 'nodemailer' dependency to be installed.",
      );
    }
    this.transport = mod.createTransport({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.secure,
      ...(this.opts.user && this.opts.pass
        ? { auth: { user: this.opts.user, pass: this.opts.pass } }
        : {}),
    });
    return this.transport;
  }

  async send(message: EmailMessage): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({
      from: this.opts.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.attachments && message.attachments.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              content: a.content,
              contentType: a.content_type,
            })),
          }
        : {}),
    });
  }
}

// ---------------------------------------------------------------------------
// Factory (singleton)
// ---------------------------------------------------------------------------
function build(): EmailProvider {
  const provider = process.env["EMAIL_PROVIDER"];
  const from = process.env["EMAIL_FROM"] ?? "no-reply@jainpathshala.org";
  const apiUrl = process.env["EMAIL_API_URL"];
  const smtpHost = process.env["SMTP_HOST"];

  // Explicit SMTP selection, or implicit when its host is present.
  if ((provider === "smtp" || (!provider && smtpHost)) && smtpHost) {
    return new SmtpEmailProvider({
      host: smtpHost,
      port: Number(process.env["SMTP_PORT"] ?? 587),
      secure: process.env["SMTP_SECURE"] === "true" || process.env["SMTP_PORT"] === "465",
      user: process.env["SMTP_USER"],
      pass: process.env["SMTP_PASS"],
      from,
    });
  }
  // Generic HTTP endpoint (Postmark/Resend/SendGrid-style).
  if ((provider === "generic" || (!provider && apiUrl)) && apiUrl) {
    return new GenericHttpEmailProvider(apiUrl, process.env["EMAIL_API_KEY"], from);
  }

  // No real provider configured. Email is best-effort (it never gates a request),
  // so — unlike SMS — we do NOT fail-fast in prod; we return the mock and warn so
  // an unconfigured deployment still serves requests (receipts just aren't mailed).
  if (process.env.NODE_ENV === "production") {
    logger.warn(
      "No EMAIL_PROVIDER configured (smtp: SMTP_HOST, or generic: EMAIL_API_URL); receipt emails will NOT be delivered.",
    );
  }
  return new MockEmailProvider();
}

let _provider: EmailProvider | undefined;

/**
 * Returns the process-wide email provider singleton. Built lazily on first use
 * so tests/dev never construct a real client and the prod warning surfaces at
 * send time, matching the lazy pattern in ./sms.ts.
 */
export function getEmailProvider(): EmailProvider {
  if (!_provider) _provider = build();
  return _provider;
}

/** True when a real (non-mock) email provider is configured. */
export function hasRealEmailProvider(): boolean {
  return getEmailProvider().name !== "mock";
}
