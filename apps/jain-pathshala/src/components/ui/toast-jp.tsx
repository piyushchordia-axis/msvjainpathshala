import { CheckCircle2, X, AlertTriangle, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l([...items]);
}

function push(tone: ToastTone, title: string, description?: string) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  items = [...items, { id, tone, title, ...(description ? { description } : {}) }];
  emit();
  setTimeout(() => dismiss(id), 4000);
}

function dismiss(id: string) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
  info: (title: string, description?: string) => push('info', title, description),
};

const TONE_STYLES: Record<ToastTone, { border: string; icon: React.ReactNode }> = {
  success: {
    border: 'border-l-4 border-l-emerald-500',
    icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />,
  },
  error: {
    border: 'border-l-4 border-l-destructive',
    icon: <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />,
  },
  warning: {
    border: 'border-l-4 border-l-amber-500',
    icon: <TriangleAlert className="h-5 w-5 text-amber-600" aria-hidden />,
  },
  info: {
    border: 'border-l-4 border-l-primary',
    icon: <Info className="h-5 w-5 text-primary" aria-hidden />,
  },
};

export function ToasterJP() {
  const [stack, setStack] = useState<ToastItem[]>([]);

  useEffect(() => {
    const listener: Listener = (next) => setStack(next);
    listeners.add(listener);
    setStack([...items]);
    return () => { listeners.delete(listener); };
  }, []);

  if (stack.length === 0) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-3"
      role="region"
      aria-label="Notifications"
    >
      {stack.map((t) => {
        const tone = TONE_STYLES[t.tone];
        return (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg ${tone.border}`}
          >
            <div className="mt-0.5 shrink-0">{tone.icon}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{t.title}</p>
              {t.description ? (
                <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
