/**
 * Bilingual, actionable copy for API errors.
 *
 * Screens were written as:
 *     err instanceof ApiError ? err.message : (hi ? "…" : "…")
 * which makes the Hindi branch dead code for every REAL server error, because
 * server copy is English-only. A Hindi-speaking parent got an English sentence
 * inside a Devanagari screen precisely when something had gone wrong.
 *
 * CLAUDE.md's error voice rule also asks that a message state the problem AND
 * the fix, which a bare server string usually does not.
 */
import { ApiError } from "@/lib/api";

type Copy = { en: string; hi: string };

const BY_CODE: Record<string, Copy> = {
  ERR_NETWORK: {
    en: "Can't reach the server — check your connection and try again.",
    hi: "सर्वर से संपर्क नहीं हो सका — अपना कनेक्शन जाँचें और पुनः प्रयास करें।",
  },
  ERR_RATE_LIMITED: {
    en: "Too many attempts just now — wait a minute and try again.",
    hi: "अभी बहुत अधिक प्रयास हो गए — एक मिनट रुककर पुनः प्रयास करें।",
  },
  ERR_VALIDATION_FAILED: {
    en: "Some details look wrong — check the highlighted fields and try again.",
    hi: "कुछ जानकारी सही नहीं लग रही — चिह्नित विवरण जाँचें और पुनः प्रयास करें।",
  },
  ERR_NOT_FOUND: {
    en: "We couldn't find that any more — pull down to refresh and try again.",
    hi: "यह अब उपलब्ध नहीं है — नई जानकारी के लिए नीचे खींचें और पुनः प्रयास करें।",
  },
  ERR_FORBIDDEN: {
    en: "You don't have access to this. Ask your Sanchalak if you think this is wrong.",
    hi: "आपके पास इसकी अनुमति नहीं है। यदि यह ग़लत लगे तो अपने संचालक से बात करें।",
  },
  ERR_SESSION_CANCELLED: {
    en: "This class was cancelled, so attendance can't be recorded. Speak to your Sanchalak.",
    hi: "यह कक्षा रद्द कर दी गई है, इसलिए उपस्थिति दर्ज नहीं हो सकती। संचालक से बात करें।",
  },
  ERR_ATTENDANCE_EDIT_WINDOW_EXPIRED: {
    en: "Attendance for this date can no longer be changed. Ask your Sanchalak to correct it.",
    hi: "इस तिथि की उपस्थिति अब बदली नहीं जा सकती। सुधार के लिए संचालक से कहें।",
  },
  ERR_ALREADY_SUBMITTED: {
    en: "This was already submitted — pull down to refresh and see the latest.",
    hi: "यह पहले ही जमा हो चुका है — ताज़ा जानकारी के लिए नीचे खींचें।",
  },
  ERR_NIYAM_REVERSAL_WINDOW_EXPIRED: {
    en: "This niyam is older than 30 days and can no longer be changed.",
    hi: "यह नियम 30 दिनों से पुराना है और अब बदला नहीं जा सकता।",
  },
  // Library content requests (§17.10.6). Both caps are ordinary outcomes of
  // using the form, not faults — say what happened and what to do next.
  ERR_LIBRARY_REQUEST_RATE_LIMITED: {
    en: "You have sent all the requests allowed for today — try again tomorrow, or add detail to a request you already sent.",
    hi: "आज के लिए अनुमत सभी अनुरोध भेजे जा चुके हैं — कल फिर भेजें, या पहले भेजे अनुरोध में विवरण जोड़ें।",
  },
  ERR_LIBRARY_REQUEST_PENDING_LIMIT: {
    en: "Your earlier requests are still waiting for review — wait for one to be answered before sending another.",
    hi: "आपके पिछले अनुरोध अभी समीक्षा की प्रतीक्षा में हैं — नया भेजने से पहले किसी एक का उत्तर आने दें।",
  },
};

const FALLBACK: Copy = {
  en: "Something went wrong — please try again.",
  hi: "कुछ ग़लत हो गया — कृपया पुनः प्रयास करें।",
};

/**
 * @param err  anything thrown by the api layer
 * @param hi   current locale is Hindi
 * @param override  per-screen copy for codes this screen understands better
 *                  than the generic map (e.g. "that OTP is incorrect").
 */
export function apiErrorMessage(
  err: unknown,
  hi: boolean,
  override?: Record<string, Copy>,
): string {
  const code = err instanceof ApiError ? err.code : "";
  const mapped = (code && override?.[code]) || (code && BY_CODE[code]) || null;
  if (mapped) return hi ? mapped.hi : mapped.en;

  // No mapping: in English, the server sentence is better than a generic one.
  // In Hindi it would be an English string in a Devanagari screen, so prefer
  // the translated fallback.
  if (!hi && err instanceof ApiError && err.message) return err.message;
  return hi ? FALLBACK.hi : FALLBACK.en;
}
