/**
 * Bilingual, actionable copy for API errors (web mirror of the mobile helper).
 *
 * Guest pages rendered `error.message` verbatim and never branched on
 * `error.code` — server copy is English-only, so a Hindi visitor got an English
 * sentence inside a Devanagari page precisely when something went wrong
 * (GST-API-05). CLAUDE.md's error voice rule also asks that a message state the
 * problem AND the fix, which a bare server string usually does not.
 */
import { ApiError } from '@/lib/api-client';

type Copy = { en: string; hi: string };

const BY_CODE: Record<string, Copy> = {
  ERR_NETWORK: {
    en: "Can't reach the server — check your connection and try again.",
    hi: 'सर्वर से संपर्क नहीं हो सका — अपना कनेक्शन जाँचें और पुनः प्रयास करें।',
  },
  ERR_RATE_LIMITED: {
    en: 'Too many attempts just now — wait a minute and try again.',
    hi: 'अभी बहुत अधिक प्रयास हो गए — एक मिनट रुककर पुनः प्रयास करें।',
  },
  ERR_VALIDATION_FAILED: {
    en: 'Some details look wrong — check the form and try again.',
    hi: 'कुछ जानकारी सही नहीं लग रही — फ़ॉर्म जाँचें और पुनः प्रयास करें।',
  },
  // A .heic reaching the join form from an iPhone photo library or a desktop
  // drag-and-drop. The server cannot decode HEVC-coded HEIC, so say which
  // setting fixes it rather than "check the form".
  ERR_UPLOAD_FORMAT_UNSUPPORTED: {
    en: "This photo is in a format we can't read (HEIC). On iPhone, open Settings › Camera › Formats and choose Most Compatible, then take the photo again — or pick a JPEG.",
    hi: 'यह फोटो ऐसे फ़ॉर्मैट (HEIC) में है जिसे हम पढ़ नहीं सकते। iPhone पर Settings › Camera › Formats में जाकर Most Compatible चुनें और फोटो दोबारा लें — या कोई JPEG चुनें।',
  },
  ERR_NOT_FOUND: {
    en: "We couldn't find that — refresh the page and try again.",
    hi: 'यह नहीं मिला — पृष्ठ रीफ़्रेश करें और पुनः प्रयास करें।',
  },
  // Library content requests (§17.10.6). Both caps are ordinary outcomes of
  // using the form, not faults — say what happened and what to do next.
  ERR_LIBRARY_REQUEST_RATE_LIMITED: {
    en: 'You have sent all the requests allowed for today — try again tomorrow, or add detail to a request you already sent.',
    hi: 'आज के लिए अनुमत सभी अनुरोध भेजे जा चुके हैं — कल फिर भेजें, या पहले भेजे अनुरोध में विवरण जोड़ें।',
  },
  ERR_LIBRARY_REQUEST_PENDING_LIMIT: {
    en: 'Your earlier requests are still waiting for review — wait for one to be answered before sending another.',
    hi: 'आपके पिछले अनुरोध अभी समीक्षा की प्रतीक्षा में हैं — नया भेजने से पहले किसी एक का उत्तर आने दें।',
  },
};

const FALLBACK: Copy = {
  en: 'Something went wrong — please try again.',
  hi: 'कुछ ग़लत हो गया — कृपया पुनः प्रयास करें।',
};

/**
 * @param err  anything thrown by the api layer (or a raw fetch)
 * @param hi   current locale is Hindi
 * @param override  per-page copy for codes the page understands better.
 */
export function apiErrorMessage(
  err: unknown,
  hi: boolean,
  override?: Record<string, Copy>,
): string {
  const code = err instanceof ApiError ? err.code : '';
  const serverMessage = err instanceof ApiError ? err.message : undefined;
  return messageForCode(code, hi, serverMessage, override);
}

/**
 * Same mapping for pages that use raw fetch and hold `error.code` /
 * `error.message` from the envelope rather than an ApiError instance.
 */
export function messageForCode(
  code: string | null | undefined,
  hi: boolean,
  serverMessage?: string | null,
  override?: Record<string, Copy>,
): string {
  const mapped = (code && override?.[code]) || (code && BY_CODE[code]) || null;
  if (mapped) return hi ? mapped.hi : mapped.en;

  // No mapping: in English the server sentence beats a generic one; in Hindi it
  // would be an English string on a Devanagari page, so prefer the translation.
  if (!hi && serverMessage) return serverMessage;
  return hi ? FALLBACK.hi : FALLBACK.en;
}
