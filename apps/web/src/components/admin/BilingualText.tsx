/**
 * BilingualText — renders the locale-appropriate variant of a `{ en, hi }`
 * pair, falling back to English when Hindi is empty.
 *
 * Used everywhere user-generated content has _en / _hi variants (notice
 * titles, niyam descriptions, gallery captions, …) per CLAUDE.md
 * "Bilingual requirements".
 */

import { useLocale } from 'next-intl';

export interface BilingualTextProps {
  value: { en: string; hi?: string | null };
  as?: 'span' | 'div' | 'p';
  className?: string;
}

export function BilingualText({ value, as: Tag = 'span', className }: BilingualTextProps) {
  const locale = useLocale();
  const text = locale === 'hi' && value.hi ? value.hi : value.en;
  return (
    <Tag className={className} lang={locale === 'hi' && value.hi ? 'hi' : 'en'}>
      {text}
    </Tag>
  );
}
