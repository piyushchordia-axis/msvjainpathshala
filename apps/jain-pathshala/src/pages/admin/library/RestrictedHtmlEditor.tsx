import { useEffect, useRef } from "react";
import { sanitizeLibraryHtml } from "@/lib/library-sanitize-html";
import { Button } from "@/components/ui/button";
import { Bold, Italic, AlignCenter } from "lucide-react";

interface RestrictedHtmlEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Closed-set editor: bold, italic, paragraph, br, centre-align.
 * Serializes through library-sanitize-html on change/blur.
 */
export function RestrictedHtmlEditor({
  value,
  onChange,
  placeholder,
  className,
}: RestrictedHtmlEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (value !== lastEmitted.current && el.innerHTML !== value) {
      el.innerHTML = value || "";
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const cleaned = sanitizeLibraryHtml(el.innerHTML);
    lastEmitted.current = cleaned;
    if (cleaned !== value) onChange(cleaned);
  }

  function cmd(command: string, arg?: string) {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  }

  return (
    <div className={className}>
      <div className="mb-1 flex flex-wrap gap-1">
        <Button type="button" variant="outline" size="sm" onClick={() => cmd("bold")}>
          <Bold className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => cmd("italic")}>
          <Italic className="h-3.5 w-3.5" />
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => cmd("formatBlock", "p")}>
          P
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => cmd("justifyCenter")}
          title="Centre align"
        >
          <AlignCenter className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div
        ref={ref}
        role="textbox"
        aria-multiline
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        className="min-h-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
}
