import { useEffect, useState } from "react";
import { Copy, Minus, Plus, Share2, Maximize2, Minimize2 } from "lucide-react";
import type { LibraryItemDto } from "@workspace/api-zod";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLocale } from "@/lib/locale-context";
import {
  availableTextLangs,
  clampTextFontSize,
  readTextFontSize,
  sanitizeLibraryHtml,
  stripHtml,
  textContentForLang,
  TEXT_FONT_SIZE_MAX,
  TEXT_FONT_SIZE_MIN,
  TEXT_FONT_SIZE_STEP,
  writeTextFontSize,
  type LibraryTextLang,
} from "@/lib/library-sanitize-html";
import { cn } from "@/lib/utils";
import { LibraryTarjLine } from "@/components/library/LibraryTarjLine";

function pickDefaultLang(item: LibraryItemDto, preferHi: boolean): LibraryTextLang {
  const langs = availableTextLangs(item);
  if (preferHi && langs.includes("hi")) return "hi";
  if (langs.includes("en")) return "en";
  return langs[0] ?? "en";
}

const LANG_LABEL: Record<LibraryTextLang, { en: string; hi: string }> = {
  en: { en: "EN", hi: "EN" },
  hi: { en: "HI", hi: "हि" },
  gu: { en: "GU", hi: "ગુ" },
};

export type LibraryTextSheetProps = {
  item: LibraryItemDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Bottom sheet library text reader — ~50vh default, expandable to ~92vh.
 */
export function LibraryTextSheet({ item, open, onOpenChange }: LibraryTextSheetProps) {
  const locale = useLocale();
  const hi = locale === "hi";
  const [fontSize, setFontSize] = useState(16);
  const [lang, setLang] = useState<LibraryTextLang>("en");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setFontSize(readTextFontSize());
  }, []);

  useEffect(() => {
    if (item && open) {
      setLang(pickDefaultLang(item, hi));
      setCopied(false);
      setExpanded(false);
    }
  }, [item, open, hi]);

  const langs = item ? availableTextLangs(item) : [];
  const title = item
    ? hi
      ? item.title_hi || item.title_en || item.title_gu || ""
      : item.title_en || item.title_hi || item.title_gu || ""
    : "";
  const rawHtml = item ? textContentForLang(item, lang) : "";
  const safeHtml = sanitizeLibraryHtml(rawHtml);
  const plain = stripHtml(rawHtml);
  const lineHeight = Math.round(fontSize * 1.6);

  const bumpFont = (delta: number) => {
    const next = clampTextFontSize(fontSize + delta);
    setFontSize(next);
    writeTextFontSize(next);
  };

  const onCopy = async () => {
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const onShare = async () => {
    if (!plain) return;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: title || undefined, text: plain });
        return;
      } catch {
        /* fall through to copy */
      }
    }
    await onCopy();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className={cn(
          "flex flex-col gap-0 overflow-hidden rounded-t-2xl p-0",
          expanded ? "h-[92vh] max-h-[92vh]" : "h-[50vh] max-h-[50vh]",
        )}
      >
        <SheetHeader className="space-y-3 border-b border-border px-6 pb-4 pt-6 pr-12 text-left">
          <SheetTitle className="font-display text-lg text-secondary line-clamp-2">
            {title}
          </SheetTitle>
          {/* §17.1.3 — melody first, controls after: a reader who opened this
              to sing needs the Tarj before the font buttons. */}
          {item ? <LibraryTarjLine item={item} hi={hi} className="text-sm leading-6 text-muted-foreground" /> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fontSize <= TEXT_FONT_SIZE_MIN}
              onClick={() => bumpFont(-TEXT_FONT_SIZE_STEP)}
              aria-label={hi ? "छोटा" : "Smaller"}
            >
              <Minus className="h-4 w-4" />
              <span className="ml-1">{hi ? "छोटा" : "Smaller"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={fontSize >= TEXT_FONT_SIZE_MAX}
              onClick={() => bumpFont(TEXT_FONT_SIZE_STEP)}
              aria-label={hi ? "बड़ा" : "Larger"}
            >
              <Plus className="h-4 w-4" />
              <span className="ml-1">{hi ? "बड़ा" : "Larger"}</span>
            </Button>
            {langs.map((l) => (
              <Button
                key={l}
                type="button"
                variant={lang === l ? "default" : "outline"}
                size="sm"
                onClick={() => setLang(l)}
              >
                {hi ? LANG_LABEL[l].hi : LANG_LABEL[l].en}
              </Button>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => void onCopy()}>
              <Copy className="h-4 w-4" />
              <span className="ml-1">
                {copied ? (hi ? "कॉपी" : "Copied") : hi ? "कॉपी" : "Copy"}
              </span>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void onShare()}>
              <Share2 className="h-4 w-4" />
              <span className="ml-1">{hi ? "शेयर" : "Share"}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? (hi ? "छोटा करें" : "Collapse") : hi ? "बड़ा करें" : "Expand"}
            >
              {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              <span className="ml-1">
                {expanded ? (hi ? "छोटा" : "Collapse") : hi ? "बड़ा" : "Expand"}
              </span>
            </Button>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {safeHtml ? (
            <div
              className="library-text-body text-foreground [&_p]:mb-3 [&_p:last-child]:mb-0"
              style={{ fontSize, lineHeight: `${lineHeight}px` }}
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <p className="text-muted-foreground">
              {hi ? "इस पाठ में सामग्री नहीं है।" : "This text has no content yet."}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
