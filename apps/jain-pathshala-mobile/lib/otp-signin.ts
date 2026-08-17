/**
 * OTP sign-in — the pure half.
 *
 * No React, no react-native, no `@/lib/api` (that module pulls expo-constants,
 * which does not load under vitest's `environment: "node"`). Everything worth a
 * test lives here; `hooks/useOtpSignIn.ts` is the thin wrapper that adds the
 * network call and React state.
 *
 * Numbers below mirror `apps/api-server/src/routes/auth.ts` — they are the
 * server's real limits, not guesses. Keep them in sync if the route changes.
 */

/** Server `OTP_TTL_SECONDS` (auth.ts). Fallback only — prefer the send response. */
export const OTP_CODE_TTL_SECONDS = 300;
/** Server allows 5 sends per phone per window (auth.ts). */
export const MAX_SENDS_PER_WINDOW = 5;
/** Server `RL_WINDOW_SECONDS` (auth.ts). */
export const SEND_WINDOW_SECONDS = 900;

/**
 * Escalating resend cooldown, in seconds, indexed by sends already spent.
 *
 * A flat 30s would burn all five sends in about two minutes and then strand the
 * user in a silent 13-minute 429 — the server sends no `Retry-After`, so we
 * could not even tell them how long to wait. A flat 180s punishes the common
 * case, where the SMS is merely twenty seconds late. Escalating gives the
 * ordinary user a quick first resend and paces the struggling one INTO the
 * budget rather than into the wall.
 *
 * Two invariants make these particular numbers correct, both pinned by tests:
 *   sum(steps) = 390 < SEND_WINDOW_SECONDS  — all five fit inside one window
 *   max(step)  = 180 < OTP_CODE_TTL_SECONDS — resend is always already
 *     available by the time a code expires, so the expiry state never
 *     dead-ends the user.
 */
export const RESEND_STEPS_SECONDS = [30, 60, 120, 180] as const;

export const PHONE_DIGITS = 10;
export const OTP_LENGTH = 6;
export const COUNTRY_CODE = "+91";

/**
 * Reduce anything a user can type or paste to the 10 local digits.
 *
 * Only strips a country/trunk prefix while what remains is still too long:
 * "9198765432" is itself a valid 10-digit number, not a prefixed one.
 */
export function normalisePhoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, "");
  while (d.length > PHONE_DIGITS) {
    if (d.startsWith("0")) d = d.slice(1);
    else if (d.startsWith("91")) d = d.slice(2);
    else break;
  }
  return d.slice(0, PHONE_DIGITS);
}

export function isPhoneComplete(digits: string): boolean {
  return digits.length === PHONE_DIGITS;
}

/** The server takes E.164 and normalises nothing — it must match exactly. */
export function toE164(digits: string): string {
  return `${COUNTRY_CODE}${digits}`;
}

export function normaliseOtpDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

export function isOtpComplete(code: string): boolean {
  return code.length === OTP_LENGTH;
}

/**
 * Whether the code we hold has aged past its TTL.
 *
 * This is what lets us tell "wrong code" from "expired code": the server
 * collapses both into 401 `ERR_OTP_INVALID` and they differ only by an English
 * sentence we must not parse. We minted the token, so we can time it ourselves.
 */
export function isCodeExpired(sentAt: number, ttlSeconds: number, now: number): boolean {
  return now - sentAt >= ttlSeconds * 1000;
}

export interface ResendState {
  /** E.164 the budget belongs to — the server counts per phone, so we must too. */
  readonly phone: string;
  readonly sendsUsed: number;
  readonly nextSendAt: number;
}

/**
 * Record a send and arm the next cooldown.
 *
 * Called on the FIRST send too, not only on resends: a double tap crosses an
 * async boundary that a `busy` flag alone races, and would spend two of five.
 */
export function registerSend(
  prev: ResendState | null,
  phone: string,
  now: number,
): ResendState {
  const sendsUsed = prev && prev.phone === phone ? prev.sendsUsed + 1 : 1;
  const step =
    RESEND_STEPS_SECONDS[Math.min(sendsUsed, RESEND_STEPS_SECONDS.length) - 1]!;
  return { phone, sendsUsed, nextSendAt: now + step * 1000 };
}

export function resendSecondsLeft(state: ResendState | null, now: number): number {
  if (!state) return 0;
  return Math.max(0, Math.ceil((state.nextSendAt - now) / 1000));
}

export function sendsExhausted(state: ResendState | null, phone: string): boolean {
  return !!state && state.phone === phone && state.sendsUsed >= MAX_SENDS_PER_WINDOW;
}

export function canSend(state: ResendState | null, phone: string, now: number): boolean {
  if (sendsExhausted(state, phone)) return false;
  // A different number has its own server-side budget, so it starts clean.
  if (!state || state.phone !== phone) return true;
  return resendSecondsLeft(state, now) === 0;
}

export type OtpPhase = "send" | "verify";

export interface OtpErrorContext {
  phase: OtpPhase;
  /** From `isCodeExpired` — splits the overloaded `ERR_OTP_INVALID`. */
  codeExpiredLocally: boolean;
}

type Copy = { en: string; hi: string };

const pick = (c: Copy, hi: boolean): string => (hi ? c.hi : c.en);

/**
 * Sign-in error copy, owned locally on purpose.
 *
 * `@workspace/api-zod` already maps `ERR_OTP_INVALID` — to EXAM ACCESS CODE
 * copy ("check with your Guruji"). Same code, different domain. Routing login
 * through the shared map would tell a parent signing in to ask their Guruji
 * about an exam, so this table must never be replaced by that one.
 *
 * Returns null for codes we do not own, so the caller falls through to
 * `apiErrorMessage` and inherits ERR_NETWORK / 5xx handling for free.
 */
export function otpSignInErrorCopy(
  code: string,
  ctx: OtpErrorContext,
  hi: boolean,
): string | null {
  switch (code) {
    case "ERR_VALIDATION_FAILED":
      return ctx.phase === "send"
        ? pick(
            {
              en: "That number doesn't look right — enter the 10 digits after +91.",
              hi: "यह नंबर सही नहीं लग रहा — +91 के बाद के 10 अंक दर्ज करें।",
            },
            hi,
          )
        : pick(
            {
              en: "That code is incomplete — enter all 6 digits from your SMS.",
              hi: "यह कोड अधूरा है — एसएमएस में मिले छहों अंक दर्ज करें।",
            },
            hi,
          );

    case "ERR_RATE_LIMITED":
      // Names the server's real 15-minute window. The generic map in
      // api-error-copy says "wait a minute", which would be a lie here.
      return ctx.phase === "send"
        ? pick(
            {
              en: "You've asked for too many codes — wait 15 minutes, then try again.",
              hi: "आपने बहुत बार कोड माँगा — 15 मिनट रुककर फिर कोशिश करें।",
            },
            hi,
          )
        : pick(
            {
              en: "Too many attempts — wait 15 minutes, then try again.",
              hi: "बहुत अधिक प्रयास — 15 मिनट रुककर फिर कोशिश करें।",
            },
            hi,
          );

    case "ERR_OTP_INVALID":
      return ctx.codeExpiredLocally
        ? pick(
            {
              en: "That code has expired — tap Resend code to get a new one.",
              hi: "यह कोड समाप्त हो चुका है — नया कोड पाने के लिए ‘कोड फिर भेजें’ दबाएँ।",
            },
            hi,
          )
        : pick(
            {
              en: "That code is incorrect — check your SMS and enter the 6 digits again.",
              hi: "यह कोड ग़लत है — अपना एसएमएस जाँचकर छहों अंक फिर दर्ज करें।",
            },
            hi,
          );

    case "ERR_OTP_LOCKED":
      return pick(
        {
          en: "Too many wrong codes — tap Resend code and use the newest SMS.",
          hi: "बहुत बार ग़लत कोड — ‘कोड फिर भेजें’ दबाकर सबसे नया एसएमएस उपयोग करें।",
        },
        hi,
      );

    case "ERR_NO_ACCOUNT":
      return pick(
        {
          en: "This number isn't registered yet — complete the registration journey first, or check with your Sanchalak.",
          hi: "यह नंबर अभी पंजीकृत नहीं है — पहले पंजीकरण यात्रा पूरी करें, या अपने संचालक से पूछें।",
        },
        hi,
      );

    default:
      return null;
  }
}

/** Whether this failure is fixed by fetching a new code rather than retyping. */
export function shouldPromptResend(code: string, ctx: OtpErrorContext): boolean {
  if (ctx.phase !== "verify") return false;
  if (code === "ERR_OTP_LOCKED") return true;
  return code === "ERR_OTP_INVALID" && ctx.codeExpiredLocally;
}

/**
 * Shown after a resend. The server does NOT revoke the previous code — it just
 * inserts another row — so a user who resends and then types the first SMS gets
 * "incorrect", which is true but baffling without this line.
 */
export function resendNoticeCopy(hi: boolean): string {
  return pick(
    {
      en: "A new code has been sent — use the newest SMS.",
      hi: "नया कोड भेज दिया गया है — सबसे नया एसएमएस उपयोग करें।",
    },
    hi,
  );
}

/** Shown once all five sends are spent, naming the real window. */
export function sendsExhaustedCopy(hi: boolean): string {
  return pick(
    {
      en: "You've asked for the maximum number of codes — wait 15 minutes, then try again.",
      hi: "आप अधिकतम बार कोड माँग चुके हैं — 15 मिनट रुककर फिर कोशिश करें।",
    },
    hi,
  );
}

/**
 * Standing hint under the code field.
 *
 * The send endpoint answers 200 for an unregistered number and deliberately
 * sends no SMS, so enumeration cannot leak. The cost is that such a person sits
 * on the code box forever and only learns the truth if they somehow guess a
 * correct code. This line is the only thing that reaches them, so it is
 * persistent rather than part of an error state.
 */
export function noCodeHintCopy(hi: boolean): string {
  return pick(
    {
      en: "Didn't get a code? Check that this number is the one registered with your centre, or start the registration journey.",
      hi: "कोड नहीं मिला? देखें कि यह वही नंबर है जो आपके केंद्र में पंजीकृत है, या पंजीकरण यात्रा शुरू करें।",
    },
    hi,
  );
}
