/**
 * Mobile UI component re-exports.
 *
 * Two layers:
 *   - `./jp-components.tsx` (this file's barrel) — the core RN component
 *     pack from `jp-design-system/expo/mobile/components.tsx`: buttons,
 *     avatar, header, tab bar, child selector, etc.
 *   - `./feedback/*` — Reanimated overlays / badges / banners.
 *
 * Import sites typically use `import { PrimaryButton, OfflineBanner } from
 * '@/components/ui'` — no need to know which subfile a component lives in.
 */

export {
  Icon,
  PrimaryButton,
  SecondaryButton,
  GhostButton,
  Avatar,
  AgePill,
  AttendanceChip,
  PunyaBadge,
  TierBadge,
  Card,
  Header,
  TabBar,
  ChildSelector,
  EmptyState,
} from './jp-components';
export type {
  IconName,
  IconProps,
  PrimaryButtonProps,
  SecondaryButtonProps,
  GhostButtonProps,
  AvatarProps,
  AgeGroup,
  AttendanceStatus,
  PunyaBadgeProps,
  Tier,
  CardProps,
  HeaderProps,
  TabBarItemLabel,
  TabBarProps,
  ChildItem,
  ChildSelectorProps,
  EmptyStateProps,
} from './jp-components';

export * from './feedback';
