/**
 * The one OTP sign-in implementation. Both the pre-login landing
 * (app/guest/home.tsx) and the standalone screen (app/auth/sign-in.tsx) drive
 * `components/OtpSignInForm.tsx`, which drives this — there is no second copy.
 *
 * Pure logic and all the copy live in `lib/otp-signin.ts`; this file only adds
 * the network call, React state, and the clock.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useAuth } from "@/contexts/AuthContext";
import { useLocale } from "@/contexts/LocaleContext";
import { ApiError, apiPost } from "@/lib/api";
import { apiErrorMessage } from "@/lib/api-error-copy";
import { getDeviceId } from "@/lib/device-id";
import { routeForRole } from "@/lib/roles";
import type { OtpSendResponse, OtpVerifyResponse } from "@/lib/auth";
import {
  OTP_CODE_TTL_SECONDS,
  canSend,
  isCodeExpired,
  isOtpComplete,
  isPhoneComplete,
  normaliseOtpDigits,
  normalisePhoneDigits,
  otpSignInErrorCopy,
  registerSend,
  resendNoticeCopy,
  resendSecondsLeft as secondsLeft,
  sendsExhausted,
  shouldPromptResend,
  toE164,
  type OtpPhase,
  type ResendState,
} from "@/lib/otp-signin";

export type OtpStep = "phone" | "code";

interface Failure {
  code: string;
  phase: OtpPhase;
  raw: unknown;
}

export function useOtpSignIn({ returnTo }: { returnTo?: Href | null } = {}) {
  const router = useRouter();
  const { hi } = useLocale();
  const { signIn } = useAuth();

  const [step, setStep] = useState<OtpStep>("phone");
  const [digits, setDigitsRaw] = useState("");
  const [code, setCodeRaw] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState(OTP_CODE_TTL_SECONDS);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [resend, setResend] = useState<ResendState | null>(null);
  const [resendNotice, setResendNotice] = useState(false);

  // A ref, not the `busy` state: setState is async, so two fast taps can both
  // read `busy === false` and spend two of the five sends.
  const inflight = useRef(false);
  // Auto-verify fires once per distinct 6-digit value, so editing the last
  // digit back and forth cannot re-fire and burn attempts.
  const lastAutoVerified = useRef<string | null>(null);

  // Countdowns are read from Date.now() deltas rather than a decremented
  // counter: timers are throttled while backgrounded, and reading the SMS is
  // exactly a background trip. A counter would keep ticking while the real
  // 300s code quietly died.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Also ticks on the phone step whenever a cooldown is outstanding: after
    // "Change number" the send is still blocked, and without a live clock the
    // Send button would sit enabled and silently do nothing.
    if (step !== "code" && !resend) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setNow(Date.now());
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [step, resend]);

  const e164 = toE164(digits);
  const phoneComplete = isPhoneComplete(digits);
  const codeComplete = isOtpComplete(code);
  const codeExpired = sentAt !== null && isCodeExpired(sentAt, ttlSeconds, now);
  const resendSecondsLeft = secondsLeft(resend, now);
  const resendExhausted = sendsExhausted(resend, e164);
  /** Governs the first send and every resend alike — the budget is one budget. */
  const canSendNow = !busy && canSend(resend, e164, now);

  // The failure is stored, not the sentence — otherwise toggling EN/हिं leaves a
  // stale-language error on screen, which is what both old screens did.
  const error = useMemo(() => {
    if (!failure) return null;
    const ctx = { phase: failure.phase, codeExpiredLocally: codeExpired };
    return otpSignInErrorCopy(failure.code, ctx, hi) ?? apiErrorMessage(failure.raw, hi);
  }, [failure, codeExpired, hi]);

  const notice = resendNotice ? resendNoticeCopy(hi) : null;
  const noAccount = failure?.code === "ERR_NO_ACCOUNT";
  const promptResend = failure
    ? shouldPromptResend(failure.code, {
        phase: failure.phase,
        codeExpiredLocally: codeExpired,
      })
    : false;

  const setDigits = useCallback((raw: string) => {
    setDigitsRaw(normalisePhoneDigits(raw));
    setFailure(null);
  }, []);

  const setCode = useCallback((raw: string) => {
    setCodeRaw(normaliseOtpDigits(raw));
    setFailure(null);
  }, []);

  const runSend = useCallback(
    async (isResend: boolean) => {
      const phone = toE164(digits);
      if (!isPhoneComplete(digits) || inflight.current) return;
      if (!canSend(resend, phone, Date.now())) return;

      inflight.current = true;
      setBusy(true);
      setFailure(null);
      setResendNotice(false);
      try {
        const res = await apiPost<OtpSendResponse>("/api/auth/login", {
          phase: "send",
          phone,
        });
        const at = Date.now();
        setOtpToken(res.otp_token);
        setSentAt(at);
        setTtlSeconds(
          res.expires_in_seconds > 0 ? res.expires_in_seconds : OTP_CODE_TTL_SECONDS,
        );
        setResend((prev) => registerSend(prev, phone, at));
        setNow(at);
        setCodeRaw("");
        lastAutoVerified.current = null;
        setStep("code");
        if (isResend) setResendNotice(true);
      } catch (err) {
        setFailure({
          code: err instanceof ApiError ? err.code : "",
          phase: "send",
          raw: err,
        });
      } finally {
        inflight.current = false;
        setBusy(false);
      }
    },
    [digits, resend],
  );

  const sendCode = useCallback(() => void runSend(false), [runSend]);
  const resendCode = useCallback(() => void runSend(true), [runSend]);

  const verifyCode = useCallback(async () => {
    if (!otpToken || !isOtpComplete(code) || inflight.current) return;
    inflight.current = true;
    setBusy(true);
    setFailure(null);
    setResendNotice(false);
    try {
      const device_id = await getDeviceId();
      const res = await apiPost<OtpVerifyResponse>("/api/auth/login", {
        phase: "verify",
        otp_token: otpToken,
        code,
        device_id,
      });
      await signIn(res.user, res.tokens);
      router.replace(returnTo ?? routeForRole(res.user.role));
    } catch (err) {
      setFailure({
        code: err instanceof ApiError ? err.code : "",
        phase: "verify",
        raw: err,
      });
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }, [otpToken, code, returnTo, router, signIn]);

  // Autofill (`sms-otp` / `oneTimeCode`) delivers all six digits at once;
  // making the user then tap Verify is the step people complain about.
  useEffect(() => {
    if (step !== "code" || !codeComplete || busy || !otpToken) return;
    if (lastAutoVerified.current === code) return;
    lastAutoVerified.current = code;
    void verifyCode();
  }, [step, code, codeComplete, busy, otpToken, verifyCode]);

  const changeNumber = useCallback(() => {
    setStep("phone");
    setCodeRaw("");
    setOtpToken(null);
    setSentAt(null);
    setFailure(null);
    setResendNotice(false);
    lastAutoVerified.current = null;
    // `resend` deliberately survives. The server budget is per phone, so
    // re-entering the same number must not hand out a fresh five sends.
  }, []);

  return {
    step,
    digits,
    setDigits,
    code,
    setCode,
    e164,
    phoneComplete,
    codeComplete,
    busy,
    error,
    notice,
    noAccount,
    promptResend,
    codeExpired,
    resendSecondsLeft,
    canSendNow,
    resendExhausted,
    sendCode,
    resendCode,
    verifyCode,
    changeNumber,
  };
}
