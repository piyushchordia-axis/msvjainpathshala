/**
 * Re-exports of the design-system constants.
 *
 * The prompt asked to "copy" `jp-design-system/colors.ts` into the mobile
 * app — but that file already lives canonically in `@jp/design-tokens`
 * (sourced from `tokens.json` with a runtime parity check). Re-exporting
 * keeps a single source of truth and the same import path the design
 * system documentation references.
 *
 * Usage:
 *   import { JPColors, JPSpacing, JPRadius, JPFonts } from '@/constants/colors';
 */

export { JPColors, JPSpacing, JPRadius, JPFonts } from '@jp/design-tokens';
