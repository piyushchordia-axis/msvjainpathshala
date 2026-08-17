/**
 * Pure half of OTP sign-in.
 *
 * The vitest env here is `node` with no react-native testing library, so the
 * screen itself is not renderable in a test — which is exactly why all the
 * logic and copy were pushed down into lib/otp-signin.ts. Everything that can
 * silently go wrong (the resend budget, the overloaded ERR_OTP_INVALID, the
 * Hindi copy) is covered here.
 */
import { describe, expect, it } from "vitest";
import { ERROR_MESSAGES } from "@workspace/api-zod";
import {
  MAX_SENDS_PER_WINDOW,
  OTP_CODE_TTL_SECONDS,
  OTP_LENGTH,
  PHONE_DIGITS,
  RESEND_STEPS_SECONDS,
  SEND_WINDOW_SECONDS,
  canSend,
  isCodeExpired,
  isOtpComplete,
  isPhoneComplete,
  noCodeHintCopy,
  normaliseOtpDigits,
  normalisePhoneDigits,
  otpSignInErrorCopy,
  registerSend,
  resendNoticeCopy,
  resendSecondsLeft,
  sendsExhausted,
  sendsExhaustedCopy,
  shouldPromptResend,
  toE164,
  type ResendState,
} from "../otp-signin";

/** Verbatim from lib/api-zod/src/contracts.ts — the server normalises nothing. */
const SERVER_E164 = /^\+[1-9]\d{6,14}$/;

const PHONE = "+919876543210";
const OTHER = "+919000000001";
const T0 = 1_760_000_000_000;

describe("normalisePhoneDigits", () => {
  it("keeps the ten local digits out of anything a user types or pastes", () => {
    expect(normalisePhoneDigits("98765 43210")).toBe("9876543210");
    expect(normalisePhoneDigits("+91 98765-43210")).toBe("9876543210");
    expect(normalisePhoneDigits("919876543210")).toBe("9876543210");
    expect(normalisePhoneDigits("09876543210")).toBe("9876543210");
    expect(normalisePhoneDigits("0919876543210")).toBe("9876543210");
    expect(normalisePhoneDigits("abc")).toBe("");
  });

  it("does not eat a real number that merely starts 91", () => {
    // "9198765432" is a valid 10-digit handset, not a +91-prefixed one. Only
    // strip a prefix while what remains would still be too long.
    expect(normalisePhoneDigits("9198765432")).toBe("9198765432");
  });

  it("is incomplete below ten digits", () => {
    expect(isPhoneComplete(normalisePhoneDigits("987654321"))).toBe(false);
    expect(isPhoneComplete(normalisePhoneDigits("9876543210"))).toBe(true);
    expect(normalisePhoneDigits("98765432100000")).toHaveLength(PHONE_DIGITS);
  });
});

describe("toE164", () => {
  it("produces exactly what the server regex accepts", () => {
    expect(toE164("9876543210")).toBe(PHONE);
    expect(SERVER_E164.test(toE164("9876543210"))).toBe(true);
  });
});

describe("normaliseOtpDigits", () => {
  it("holds the contract's six digits, digits only", () => {
    expect(normaliseOtpDigits("12a34b56")).toBe("123456");
    expect(normaliseOtpDigits("1234567890")).toHaveLength(OTP_LENGTH);
    expect(isOtpComplete("12345")).toBe(false);
    expect(isOtpComplete("123456")).toBe(true);
  });
});

describe("isCodeExpired", () => {
  it("flips exactly at the TTL", () => {
    expect(isCodeExpired(T0, 300, T0 + 299_000)).toBe(false);
    expect(isCodeExpired(T0, 300, T0 + 300_000)).toBe(true);
    expect(isCodeExpired(T0, 300, T0 + 301_000)).toBe(true);
  });
});

describe("resend budget", () => {
  it("arms a cooldown on the FIRST send, not only on resends", () => {
    // The `busy` flag is async state; a double tap crosses that boundary and
    // would spend two of the five sends.
    const s = registerSend(null, PHONE, T0);
    expect(s.sendsUsed).toBe(1);
    expect(resendSecondsLeft(s, T0)).toBe(RESEND_STEPS_SECONDS[0]);
    expect(canSend(s, PHONE, T0)).toBe(false);
  });

  it("counts down and clamps at zero", () => {
    const s = registerSend(null, PHONE, T0);
    expect(resendSecondsLeft(s, T0 + 10_000)).toBe(20);
    expect(resendSecondsLeft(s, T0 + 30_000)).toBe(0);
    expect(resendSecondsLeft(s, T0 + 90_000)).toBe(0);
    expect(canSend(s, PHONE, T0 + 30_000)).toBe(true);
  });

  it("escalates 30 / 60 / 120 / 180", () => {
    let s: ResendState | null = null;
    const seen: number[] = [];
    for (let i = 0; i < RESEND_STEPS_SECONDS.length; i += 1) {
      s = registerSend(s, PHONE, T0);
      seen.push(resendSecondsLeft(s, T0));
    }
    expect(seen).toEqual([...RESEND_STEPS_SECONDS]);
  });

  it("stops dead once all five sends are spent, whatever the clock says", () => {
    let s: ResendState | null = null;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i += 1) s = registerSend(s, PHONE, T0);
    expect(s!.sendsUsed).toBe(MAX_SENDS_PER_WINDOW);
    expect(sendsExhausted(s, PHONE)).toBe(true);
    // A silent 429 with no Retry-After is the worst outcome — refuse locally.
    expect(canSend(s, PHONE, T0 + 60 * 60_000)).toBe(false);
  });

  it("is keyed on the phone, because the server budget is", () => {
    let s: ResendState | null = registerSend(null, PHONE, T0);
    s = registerSend(s, PHONE, T0);
    expect(s.sendsUsed).toBe(2);

    // "Change number" then re-entering the SAME number must not hand out a
    // fresh five sends.
    expect(registerSend(s, PHONE, T0).sendsUsed).toBe(3);
    // A genuinely different number has its own server-side budget.
    const other = registerSend(s, OTHER, T0);
    expect(other.sendsUsed).toBe(1);
    expect(sendsExhausted(s, OTHER)).toBe(false);
    expect(canSend(s, OTHER, T0)).toBe(true);
  });

  it("keeps the whole budget inside one server window", () => {
    // Why these numbers: all five sends must fit in the 15-minute window, or
    // the last one lands in a 429 we cannot time for the user.
    const total = RESEND_STEPS_SECONDS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(SEND_WINDOW_SECONDS);
  });

  it("guarantees resend is available before a code can expire", () => {
    // Otherwise "that code has expired — tap Resend" is a dead end.
    expect(Math.max(...RESEND_STEPS_SECONDS)).toBeLessThan(OTP_CODE_TTL_SECONDS);
  });
});

describe("otpSignInErrorCopy", () => {
  const CODES = [
    "ERR_VALIDATION_FAILED",
    "ERR_RATE_LIMITED",
    "ERR_OTP_INVALID",
    "ERR_OTP_LOCKED",
    "ERR_NO_ACCOUNT",
  ] as const;

  it("splits the overloaded ERR_OTP_INVALID on local expiry", () => {
    // The server answers 401 ERR_OTP_INVALID for BOTH a wrong code and an
    // expired/consumed token, distinguishable only by an English sentence we
    // must not parse. We minted the token, so we time it ourselves.
    const wrong = otpSignInErrorCopy(
      "ERR_OTP_INVALID",
      { phase: "verify", codeExpiredLocally: false },
      false,
    );
    const expired = otpSignInErrorCopy(
      "ERR_OTP_INVALID",
      { phase: "verify", codeExpiredLocally: true },
      false,
    );
    expect(wrong).not.toBe(expired);
    expect(expired).toMatch(/expired/i);
    expect(wrong).toMatch(/incorrect/i);
  });

  it("differs by phase where the fix differs", () => {
    const send = otpSignInErrorCopy(
      "ERR_VALIDATION_FAILED",
      { phase: "send", codeExpiredLocally: false },
      false,
    );
    const verify = otpSignInErrorCopy(
      "ERR_VALIDATION_FAILED",
      { phase: "verify", codeExpiredLocally: false },
      false,
    );
    expect(send).not.toBe(verify);
  });

  it("returns null for codes it does not own, so the generic map handles them", () => {
    for (const code of ["ERR_NETWORK", "ERR_INTERNAL", "", "ERR_NOT_FOUND"]) {
      expect(
        otpSignInErrorCopy(code, { phase: "verify", codeExpiredLocally: false }, false),
      ).toBeNull();
    }
  });

  it("states the problem and the fix, in both languages, for every code", () => {
    for (const code of CODES) {
      for (const phase of ["send", "verify"] as const) {
        for (const expired of [false, true]) {
          const en = otpSignInErrorCopy(code, { phase, codeExpiredLocally: expired }, false);
          const hi = otpSignInErrorCopy(code, { phase, codeExpiredLocally: expired }, true);
          expect(en, `${code}/${phase} en`).toBeTruthy();
          expect(hi, `${code}/${phase} hi`).toBeTruthy();
          // Every message carries an em-dash clause: problem — fix.
          expect(en).toContain("—");
          expect(hi).toContain("—");
        }
      }
    }
  });

  it("writes Hindi in Devanagari, never Hinglish", () => {
    const hindi = [
      ...CODES.flatMap((code) =>
        (["send", "verify"] as const).flatMap((phase) =>
          [false, true].map(
            (expired) =>
              otpSignInErrorCopy(code, { phase, codeExpiredLocally: expired }, true)!,
          ),
        ),
      ),
      resendNoticeCopy(true),
      sendsExhaustedCopy(true),
      noCodeHintCopy(true),
    ];
    for (const s of hindi) {
      expect(s, s).toMatch(/[ऀ-ॿ]/);
      // Latin letters would mean transliteration crept in. Digits are fine.
      expect(s, s).not.toMatch(/[A-Za-z]/);
    }
  });

  it("does not reuse the shared map's ERR_OTP_INVALID, which is exam copy", () => {
    // lib/api-zod defines ERR_OTP_INVALID for EXAM ACCESS CODES ("check with
    // your Guruji"). Same code, different domain — routing login through it
    // would tell a parent signing in to ask their Guruji about an exam.
    const login = otpSignInErrorCopy(
      "ERR_OTP_INVALID",
      { phase: "verify", codeExpiredLocally: false },
      false,
    );
    expect(login).not.toBe(ERROR_MESSAGES.ERR_OTP_INVALID.en);
    expect(login).not.toMatch(/guruji/i);
  });
});

describe("shouldPromptResend", () => {
  it("points at resend only when a new code is what actually fixes it", () => {
    const verify = (code: string, expired: boolean) =>
      shouldPromptResend(code, { phase: "verify", codeExpiredLocally: expired });

    expect(verify("ERR_OTP_LOCKED", false)).toBe(true);
    expect(verify("ERR_OTP_INVALID", true)).toBe(true);
    // A mistyped code is fixed by retyping, not by burning a send.
    expect(verify("ERR_OTP_INVALID", false)).toBe(false);
    expect(verify("ERR_RATE_LIMITED", true)).toBe(false);
    expect(
      shouldPromptResend("ERR_OTP_LOCKED", { phase: "send", codeExpiredLocally: true }),
    ).toBe(false);
  });
});
