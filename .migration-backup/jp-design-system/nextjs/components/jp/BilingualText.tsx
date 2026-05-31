import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * BilingualText — display the same content in two scripts/languages.
 *
 * (Filename note: in the spec this was listed as `BillingualText` — that's a
 * typo. Both spellings re-export the same component below. Prefer the
 * `BilingualText` import going forward.)
 */

export type BilingualLayout = 'stacked' | 'inline';
export type BilingualSize = 'sm' | 'md' | 'lg' | 'xl';
export type BilingualPrimaryFont = 'display' | 'body';

export interface BilingualTextProps
  extends React.HTMLAttributes<HTMLElement> {
  /** Primary script content (e.g. Devanagari). */
  primary: string;
  /** Secondary / transliteration / translation. Omit to render a single line. */
  secondary?: string;
  /** Stack vertically (default) or place inline with a separator. */
  layout?: BilingualLayout;
  /** Size token; secondary is rendered one step smaller. */
  size?: BilingualSize;
  /** Typeface for the primary line. */
  primaryFont?: BilingualPrimaryFont;
  /** Mute the secondary line in ink-sub instead of ink. */
  muteSecondary?: boolean;
  /** `lang` attr for the primary span — important for screen readers. */
  primaryLang?: string;
  secondaryLang?: string;
  /** Separator glyph for inline layout. Defaults to a bullet. */
  inlineSeparator?: string;
  /** Override the wrapping element. */
  as?: 'span' | 'div' | 'p' | 'h1' | 'h2' | 'h3' | 'h4';
}

const sizeMap: Record<
  BilingualSize,
  { primary: string; secondary: string }
> = {
  sm: { primary: 'text-sm leading-snug',   secondary: 'text-[11px]' },
  md: { primary: 'text-base leading-snug', secondary: 'text-xs' },
  lg: { primary: 'text-lg leading-tight',  secondary: 'text-sm' },
  xl: { primary: 'text-2xl leading-tight', secondary: 'text-base' },
};

export function BilingualText({
  primary,
  secondary,
  layout = 'stacked',
  size = 'md',
  primaryFont = 'body',
  muteSecondary = true,
  primaryLang,
  secondaryLang,
  inlineSeparator = '·',
  as,
  className,
  ...rest
}: BilingualTextProps) {
  const sizes = sizeMap[size];
  const Wrapper = (as ?? (layout === 'stacked' ? 'div' : 'span')) as React.ElementType;

  return (
    <Wrapper
      className={cn(
        layout === 'stacked'
          ? 'flex flex-col gap-0.5'
          : 'inline-flex items-baseline gap-1.5',
        className,
      )}
      {...rest}
    >
      <span
        lang={primaryLang}
        className={cn(
          sizes.primary,
          primaryFont === 'display'
            ? 'font-display text-secondary'
            : 'font-body text-foreground',
        )}
      >
        {primary}
      </span>
      {secondary && (
        <span
          lang={secondaryLang}
          className={cn(
            sizes.secondary,
            muteSecondary ? 'text-ink-sub' : 'text-foreground',
          )}
        >
          {layout === 'inline' ? `${inlineSeparator} ${secondary}` : secondary}
        </span>
      )}
    </Wrapper>
  );
}

/** Backwards-compatible alias for the typo'd spec name. */
export { BilingualText as BillingualText };
