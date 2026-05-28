/**
 * @jp/design-tokens — public surface.
 *
 * Two import styles are supported:
 *
 *   import { JPColors, JPSpacing } from '@jp/design-tokens';   // mobile-friendly
 *   import { colors, spacing, tokens } from '@jp/design-tokens'; // namespaced
 *
 * The `tokens` aggregate re-exports the same shape as `tokens.json`, minus the
 * `$schema` / `$source` metadata keys. A small parity check runs at module
 * load time to catch the most common drift modes (missing keys, mismatched
 * scalar values); deeper structural diffs are covered by tests in Step 7.
 */

import tokensJson from '../tokens.json';

export {
  colors,
  spacing,
  radii,
  shadows,
  typography,
  motion,
  tokens,
  JPColors,
  JPSpacing,
  JPRadius,
  JPFonts,
} from './tokens.js';

export type {
  Tokens,
  BrandColor,
  AgeGroupColor,
  TierColor,
  SemanticColor,
  SpacingKey,
  RadiusKey,
  ShadowKey,
  TypeScaleKey,
} from './tokens.js';

// ---------------------------------------------------------------------------
// Parity check (tokens.ts ↔ tokens.json). Throws on drift so a wrong-edit is
// loud at import time rather than silently shipping bad colours.
// ---------------------------------------------------------------------------

import { tokens } from './tokens.js';

const META_KEYS = new Set(['$schema', '$source', '$translation']);

/** Stable JSON canonicalisation: keys sorted, no whitespace. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonical).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => !META_KEYS.has(k))
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

const tsCanon = canonical(tokens);
const jsonCanon = canonical(tokensJson);

if (tsCanon !== jsonCanon) {
  // We deliberately throw rather than warn — a drift here would silently ship
  // wrong colours / spacings to production, which is far worse than a startup
  // crash in dev.
  throw new Error(
    '[@jp/design-tokens] tokens.ts and tokens.json have drifted. ' +
      'Update one to match the other and re-run the build.',
  );
}
