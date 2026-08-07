/**
 * Reviewed Hindi suggestion for notice authoring.
 *
 * Never writes to the database — callers fill an editable field so a Sanchalak
 * can correct Devanagari / Jain terms before publish. Provider is opt-in via
 * TRANSLATION_PROVIDER (default 'none').
 */
import { logger } from "../lib/logger";

export type TranslateContext = "notice";

/** Jain terms that must appear in Devanagari in Hindi output (CLAUDE.md bilingual). */
export const JAIN_TERM_GLOSSARY = [
  { latin: "Pathshala", deavanagari: "पाठशाला" },
  { latin: "Punya", deavanagari: "पुण्य", forbiddenEn: ["Merit"] },
  { latin: "Guruji", deavanagari: "गुरुजी" },
  { latin: "Sanchalak", deavanagari: "संचालक" },
  { latin: "Niyam", deavanagari: "नियम" },
  { latin: "Shivir", deavanagari: "शिविर" },
  { latin: "Abhivaavak", deavanagari: "अभिभावक" },
] as const;

export class TranslationUnavailableError extends Error {
  readonly code = "ERR_TRANSLATION_UNAVAILABLE" as const;
  constructor(message = "Hindi translation is not configured on this server — ask an admin to set TRANSLATION_PROVIDER, or type the Hindi yourself.") {
    super(message);
    this.name = "TranslationUnavailableError";
  }
}

export class TranslationFailedError extends Error {
  readonly code = "ERR_TRANSLATION_FAILED" as const;
  constructor(message = "The translation could not be used — check the English text and try again, or type the Hindi yourself.") {
    super(message);
    this.name = "TranslationFailedError";
  }
}

type ProviderName = "none" | "openai" | "anthropic";

function providerName(): ProviderName {
  const raw = (process.env.TRANSLATION_PROVIDER ?? "none").trim().toLowerCase();
  if (raw === "openai" || raw === "anthropic") return raw;
  return "none";
}

/** True when a real provider is configured (UI may show the translate button). */
export function isTranslationAvailable(): boolean {
  const p = providerName();
  if (p === "none") return false;
  return Boolean(process.env.TRANSLATION_API_KEY?.trim());
}

/** Mirror of apps/api-server/src/lib/pdf.ts hasDevanagari (ऀ–ॿ / U+0900–U+097F). */
export function hasDevanagari(text: string): boolean {
  return /[\u0900-\u097F]/.test(text);
}

function latinWords(text: string): string[] {
  return (text.match(/[A-Za-z]+/g) ?? []).map((w) => w.toLowerCase());
}

/**
 * Reject Hinglish / glossary violations before a suggestion reaches the editor.
 * Latin letter runs are allowed only when they already appear as words in the
 * English source (digits, punctuation, and Devanagari are fine).
 */
export function assertValidHindiTranslation(source: string, output: string): void {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new TranslationFailedError(
      "The translation came back empty — try again, or type the Hindi yourself.",
    );
  }

  if (!hasDevanagari(trimmed)) {
    throw new TranslationFailedError(
      "The translation is not Devanagari — try again, or type the Hindi yourself.",
    );
  }

  // Glossary before Latin allowlist so Punya→Merit (etc.) gets a clear Jain-term error.
  for (const term of JAIN_TERM_GLOSSARY) {
    const re = new RegExp(`\\b${term.latin}\\b`, "i");
    if (!re.test(source)) continue;
    const forbidden = "forbiddenEn" in term ? term.forbiddenEn : undefined;
    if (forbidden) {
      for (const bad of forbidden) {
        if (new RegExp(`\\b${bad}\\b`, "i").test(trimmed)) {
          throw new TranslationFailedError(
            `The translation replaced “${term.latin}” with “${bad}” — Jain terms must stay as ${term.deavanagari}. Try again, or type the Hindi yourself.`,
          );
        }
      }
    }
    if (!trimmed.includes(term.deavanagari)) {
      throw new TranslationFailedError(
        `The translation must keep “${term.latin}” as ${term.deavanagari} — try again, or type the Hindi yourself.`,
      );
    }
  }

  const sourceWords = new Set(latinWords(source));
  for (const word of latinWords(trimmed)) {
    if (!sourceWords.has(word)) {
      throw new TranslationFailedError(
        "The translation mixed in Latin script (Hinglish) — try again, or type the Hindi yourself.",
      );
    }
  }
}

function buildSystemPrompt(): string {
  const glossaryLines = JAIN_TERM_GLOSSARY.map(
    (t) => `- ${t.latin} → ${t.deavanagari} (never translate this term into English)`,
  ).join("\n");

  return [
    "You translate English Pathshala notice text into Hindi.",
    "Output Devanagari script only for Hindi words — never Latin/Hinglish for Hindi vocabulary.",
    "Digits, times, and Latin proper nouns that already appear in the source may stay as-is.",
    "Do not wrap the answer in quotes or add commentary — return only the translated notice text.",
    "Leave these Jain terms in their Devanagari forms untouched:",
    glossaryLines,
  ].join("\n");
}

async function callOpenAi(text: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body: body.slice(0, 400) }, "[translate] openai error");
    throw new TranslationFailedError();
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new TranslationFailedError();
  return content;
}

async function callAnthropic(text: string, model: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.2,
      system: buildSystemPrompt(),
      messages: [{ role: "user", content: text }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logger.error({ status: res.status, body: body.slice(0, 400) }, "[translate] anthropic error");
    throw new TranslationFailedError();
  }
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const content = json.content?.find((c) => c.type === "text")?.text?.trim();
  if (!content) throw new TranslationFailedError();
  return content;
}

/** @internal test-only — stub the provider response without hitting the network. */
export const __translateTestHooks = {
  mockProvider: null as null | ((text: string) => Promise<string>),
};

/**
 * Translate English notice copy to Hindi. Throws TranslationUnavailableError
 * when the provider is unset, or TranslationFailedError on provider/validation failure.
 */
export async function translateToHindi(
  text: string,
  opts: { context: TranslateContext },
): Promise<string> {
  void opts.context; // reserved for future prompt variants

  if (__translateTestHooks.mockProvider) {
    const out = await __translateTestHooks.mockProvider(text);
    assertValidHindiTranslation(text, out);
    return out.trim();
  }

  const provider = providerName();
  if (provider === "none") throw new TranslationUnavailableError();

  const apiKey = process.env.TRANSLATION_API_KEY?.trim();
  if (!apiKey) throw new TranslationUnavailableError();

  const model =
    process.env.TRANSLATION_MODEL?.trim() ||
    (provider === "openai" ? "gpt-4o-mini" : "claude-3-5-haiku-latest");

  let raw: string;
  try {
    raw =
      provider === "openai"
        ? await callOpenAi(text, model, apiKey)
        : await callAnthropic(text, model, apiKey);
  } catch (err) {
    if (err instanceof TranslationFailedError || err instanceof TranslationUnavailableError) {
      throw err;
    }
    logger.error({ err }, "[translate] provider call failed");
    throw new TranslationFailedError();
  }

  assertValidHindiTranslation(text, raw);
  return raw.trim();
}
