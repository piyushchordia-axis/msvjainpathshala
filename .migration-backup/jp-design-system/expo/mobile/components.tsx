/**
 * mobile/components.tsx — React Native port of `ui_kits/mobile/components.jsx`.
 *
 * Conversion rules applied:
 *   • div   → View
 *   • span/p → Text
 *   • button/onClick → Pressable (with reanimated press feedback)
 *   • All inline styles → StyleSheet.create() referencing `JPColors`
 *   • No className, no CSS strings (no `'1px solid #...'`, no `linear-gradient(…)` strings)
 *   • Animations via `react-native-reanimated` (no CSS transitions, no LayoutAnimation)
 *   • Imports limited to `react-native` and `expo-*` packages
 *
 * Every export name matches the web version so `screens.tsx` (port of
 * `screens.jsx`) can keep referencing them with no changes:
 *   Icon, PrimaryButton, SecondaryButton, GhostButton,
 *   Avatar, AgePill, AttendanceChip, PunyaBadge, TierBadge,
 *   Card, Header, TabBar, ChildSelector, EmptyState.
 *
 * Dependencies (install via Expo's blessed path so versions match the SDK):
 *
 *   npx expo install react-native-reanimated react-native-svg \
 *                    expo-linear-gradient expo-blur
 *
 *   # Reanimated also needs its babel plugin (last in plugins array):
 *   #   plugins: ['react-native-reanimated/plugin']
 *
 * `react-native-svg` is technically a third-party package, but `npx expo install`
 * ships it as a first-class Expo module so SDK-pinned versions stay in sync —
 * it's the standard way to draw vector shapes on RN.
 *
 * Font loading: family names below assume you've registered the Mukta and
 * Tiro Devanagari Sanskrit faces under those literal names via `expo-font`.
 * If you went through `@expo-google-fonts/*` instead, the family will be e.g.
 * `Mukta_600SemiBold` — adjust JPFonts or remap fontFamily + fontWeight pairs.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { JPColors, JPFonts, JPRadius, JPSpacing } from './colors';

// ─────────────────────────────────────────────────────────────────────────────
// Icon — re-implementation of the web Icon with the same names + path data.
// ─────────────────────────────────────────────────────────────────────────────

export type IconName =
  | 'home' | 'check' | 'bell' | 'user' | 'lotus' | 'chevron' | 'back'
  | 'plus' | 'close' | 'checkOnly' | 'pin' | 'clock' | 'mapPin' | 'book'
  | 'trophy' | 'settings' | 'flame' | 'search' | 'sparkles';

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  fill?: 'none' | 'solid';
}

export function Icon({
  name,
  size = 22,
  color = JPColors.textPrimary,
  fill = 'none',
}: IconProps) {
  const stroke = fill === 'none' ? color : 'none';
  const solid = fill === 'none' ? 'none' : color;
  const P = {
    stroke,
    fill: solid,
    strokeWidth: 1.85,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const paths: Record<IconName, React.ReactNode> = {
    home:      <Path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V11Z" {...P} />,
    check:     <Path d="M9 11l3 3 4-4M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2Z" {...P} />,
    bell:      <G {...P}><Path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><Path d="M13.7 21a2 2 0 0 1-3.4 0" /></G>,
    user:      <G {...P}><Circle cx="12" cy="8" r="4" /><Path d="M4 21a8 8 0 0 1 16 0" /></G>,
    lotus:     <Path d="M12 2 9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7Z" {...P} />,
    chevron:   <Path d="m6 9 6 6 6-6" {...P} />,
    back:      <Path d="m15 6-6 6 6 6" {...P} />,
    plus:      <Path d="M12 5v14M5 12h14" {...P} />,
    close:     <Path d="M18 6 6 18M6 6l12 12" {...P} />,
    checkOnly: <Path d="M20 6 9 17l-5-5" {...P} />,
    pin:       <Path d="m12 17 5-5h-3V3h-4v9H7l5 5Zm-7 4h14v-2H5v2Z" {...P} />,
    clock:     <G {...P}><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3 2" /></G>,
    mapPin:    <G {...P}><Circle cx="12" cy="10" r="3" /><Path d="M12 2a8 8 0 0 0-8 8c0 7 8 12 8 12s8-5 8-12a8 8 0 0 0-8-8Z" /></G>,
    book:      <G {...P}><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Path d="M14 2v6h6" /><Path d="M9 13h6M9 17h4" /></G>,
    trophy:    <Path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21 1.18.54 2.03 2.03 2.03 3.79M18 2H6v7a6 6 0 0 0 12 0V2Z" {...P} />,
    settings:  <G {...P}><Circle cx="12" cy="12" r="3" /><Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9 1.7 1.7 0 0 0 4.3 7.2l-.1-.1A2 2 0 1 1 7 4.3l.1.1A1.7 1.7 0 0 0 9 4.7 1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></G>,
    flame:     <Path d="M12 2c2 4 6 6 6 12a6 6 0 1 1-12 0c0-3 2-4 2-7 2 2 4 2 4-5Z" {...P} />,
    search:    <G {...P}><Circle cx="11" cy="11" r="7" /><Path d="m20 20-3.5-3.5" /></G>,
    sparkles:  <G {...P}><Path d="M12 4v3M12 17v3M4 12h3M17 12h3" /><Path d="m6 6 2 2M16 16l2 2M16 8l2-2M6 18l2-2" /></G>,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths[name] ?? null}
    </Svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Buttons
// ─────────────────────────────────────────────────────────────────────────────

function wrapTextChild(node: React.ReactNode, textStyle: StyleProp<any>) {
  if (typeof node === 'string' || typeof node === 'number') {
    return <Text style={textStyle}>{node}</Text>;
  }
  return node;
}

export interface PrimaryButtonProps {
  children: React.ReactNode;
  leftIcon?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function PrimaryButton({
  children,
  leftIcon,
  loading,
  disabled,
  onPress,
  style,
}: PrimaryButtonProps) {
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: disabled
      ? '#EFE6D5'
      : pressed.value === 1
        ? JPColors.saffron700
        : JPColors.saffron,
  }));

  const isInert = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isInert, busy: !!loading }}
      disabled={isInert}
      onPressIn={() => {
        scale.value = withSpring(0.98, { damping: 14, stiffness: 260 });
        pressed.value = 1;
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
        pressed.value = 0;
      }}
      onPress={onPress}
    >
      <Animated.View
        style={[
          styles.btnPrimary,
          disabled && styles.btnPrimaryDisabledShadow,
          animated,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          leftIcon ?? null
        )}
        {wrapTextChild(
          children,
          [styles.btnPrimaryLabel, disabled && { color: JPColors.textDim }],
        )}
      </Animated.View>
    </Pressable>
  );
}

export interface SecondaryButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function SecondaryButton({
  children,
  onPress,
  style,
}: SecondaryButtonProps) {
  const scale = useSharedValue(1);
  const pressed = useSharedValue(0);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: pressed.value === 1 ? JPColors.maroon50 : 'transparent',
    borderColor: pressed.value === 1 ? JPColors.maroon700 : JPColors.maroon,
  }));

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => {
        scale.value = withSpring(0.98, { damping: 14, stiffness: 260 });
        pressed.value = 1;
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 220 });
        pressed.value = 0;
      }}
      onPress={onPress}
    >
      <Animated.View style={[styles.btnSecondary, animated, style]}>
        {wrapTextChild(children, styles.btnSecondaryLabel)}
      </Animated.View>
    </Pressable>
  );
}

export interface GhostButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function GhostButton({ children, onPress, style }: GhostButtonProps) {
  const opacity = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => {
        opacity.value = withTiming(0.6, { duration: 80 });
      }}
      onPressOut={() => {
        opacity.value = withTiming(1, { duration: 140 });
      }}
      onPress={onPress}
    >
      <Animated.View style={[styles.btnGhost, animated, style]}>
        {wrapTextChild(children, styles.btnGhostLabel)}
      </Animated.View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Avatar
// ─────────────────────────────────────────────────────────────────────────────

export interface AvatarProps {
  initials?: string;
  size?: number;
  msv?: boolean;
  gradient?: boolean;
}

export function Avatar({
  initials = 'A',
  size = 40,
  msv = false,
  gradient = true,
}: AvatarProps) {
  const radius = size / 2;
  const fontSize = size * 0.38;

  const base = (
    <View
      style={[
        styles.avatarBase,
        { width: size, height: size, borderRadius: radius },
        msv && styles.avatarMsvRing,
      ]}
    >
      <Text
        style={[
          styles.avatarInitials,
          {
            color: gradient ? '#FFFFFF' : JPColors.maroon,
            fontSize,
          },
        ]}
      >
        {initials}
      </Text>
    </View>
  );

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      {gradient ? (
        <LinearGradient
          colors={[JPColors.saffron300, JPColors.saffron]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.avatarBase,
            { width: size, height: size, borderRadius: radius },
            msv && styles.avatarMsvRing,
          ]}
        >
          <Text
            style={[styles.avatarInitials, { color: '#FFFFFF', fontSize }]}
          >
            {initials}
          </Text>
        </LinearGradient>
      ) : (
        <View
          style={[
            styles.avatarBase,
            {
              width: size,
              height: size,
              borderRadius: radius,
              backgroundColor: JPColors.creamDark,
            },
            msv && styles.avatarMsvRing,
          ]}
        >
          <Text
            style={[styles.avatarInitials, { color: JPColors.maroon, fontSize }]}
          >
            {initials}
          </Text>
        </View>
      )}

      {msv ? (
        <LinearGradient
          colors={[JPColors.gold300, JPColors.gold]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.msvBadge}
        >
          <Text
            style={[
              styles.msvLabel,
              { fontSize: Math.max(8, size * 0.16) },
            ]}
          >
            MSV
          </Text>
        </LinearGradient>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pills, chips, badges
// ─────────────────────────────────────────────────────────────────────────────

export type AgeGroup = 'Bal' | 'Kishor' | 'Tarun' | 'Yuva';

const AGE_FG: Record<AgeGroup, string> = {
  Bal: JPColors.ageBal,
  Kishor: JPColors.ageKishor,
  Tarun: JPColors.ageTarun,
  Yuva: JPColors.ageYuva,
};
const AGE_BG: Record<AgeGroup, string> = {
  Bal: JPColors.ageBalBg,
  Kishor: JPColors.ageKishorBg,
  Tarun: JPColors.ageTarunBg,
  Yuva: JPColors.ageYuvaBg,
};

export function AgePill({ group }: { group: AgeGroup }) {
  const fg = AGE_FG[group];
  const bg = AGE_BG[group];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={group}
      style={[styles.pillBase, { backgroundColor: bg }]}
    >
      <View style={[styles.pillDot, { backgroundColor: fg }]} />
      <Text style={[styles.pillLabel, { color: fg }]}>{group}</Text>
    </View>
  );
}

export type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'Leave';

const ATTENDANCE: Record<
  AttendanceStatus,
  { bg: string; fg: string; icon: IconName }
> = {
  Present: { bg: JPColors.successBg, fg: JPColors.success, icon: 'checkOnly' },
  Absent:  { bg: JPColors.errorBg,   fg: JPColors.error,   icon: 'close' },
  Late:    { bg: JPColors.warningBg, fg: JPColors.warning, icon: 'clock' },
  Leave:   { bg: JPColors.infoBg,    fg: JPColors.info,    icon: 'bell' },
};

export function AttendanceChip({ status }: { status: AttendanceStatus }) {
  const m = ATTENDANCE[status];
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={status}
      style={[
        styles.pillBase,
        {
          backgroundColor: m.bg,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
      ]}
    >
      <Icon name={m.icon} size={12} color={m.fg} />
      <Text style={[styles.chipLabel, { color: m.fg }]}>{status}</Text>
    </View>
  );
}

export interface PunyaBadgeProps {
  value: number | string;
  size?: 'sm' | 'md' | 'lg';
  /** Localized "Punya" word — appears only when size="lg". */
  unitLabel?: string;
}

export function PunyaBadge({ value, size = 'md', unitLabel = 'Punya' }: PunyaBadgeProps) {
  const big = size === 'lg';
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`${value} ${unitLabel}`}
      style={[styles.punyaBadge, big && styles.punyaBadgeLg]}
    >
      <Icon name="lotus" size={big ? 14 : 12} color={JPColors.saffron} fill="solid" />
      <Text style={[styles.punyaLabel, { fontSize: big ? 14 : 12 }]}>
        <Text>{String(value)}</Text>
        {big ? <Text> {unitLabel}</Text> : null}
      </Text>
    </View>
  );
}

export type Tier = 'Jigyasu' | 'Shravak' | 'Sadhak' | 'Shraman' | 'Tirthankar';

const TIER_FG: Record<Tier, string> = {
  Jigyasu: JPColors.tierJigyasu,
  Shravak: JPColors.tierShravak,
  Sadhak: JPColors.tierSadhak,
  Shraman: JPColors.tierShraman,
  Tirthankar: JPColors.tierTirthankar,
};
// Pre-composited tints — readable on cream AND on the dark maroon hero.
const TIER_TINT: Record<Tier, string> = {
  Jigyasu: '#F1EAE0',
  Shravak: '#DCEEDD',
  Sadhak: '#DDE3F4',
  Shraman: '#F4E6E6',
  Tirthankar: '#FAF1DC',
};

export function TierBadge({ tier }: { tier: Tier }) {
  const fg = TIER_FG[tier];

  if (tier === 'Tirthankar') {
    return (
      <LinearGradient
        colors={['#FAF1DC', '#E6C26B']}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={[
          styles.pillBase,
          styles.tierGoldBorder,
          { paddingHorizontal: 10, paddingVertical: 4 },
        ]}
      >
        <View style={[styles.tierDot, { backgroundColor: fg }]} />
        <Text style={[styles.tierLabel, { color: fg }]}>{tier}</Text>
      </LinearGradient>
    );
  }

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={tier}
      style={[
        styles.pillBase,
        {
          backgroundColor: TIER_TINT[tier],
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
      ]}
    >
      <View style={[styles.tierDot, { backgroundColor: fg }]} />
      <Text style={[styles.tierLabel, { color: fg }]}>{tier}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────────────────

export interface CardProps {
  children: React.ReactNode;
  elevated?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({ children, elevated, style }: CardProps) {
  return (
    <View
      style={[styles.cardBase, elevated ? styles.cardElevated : styles.cardFlat, style]}
    >
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

export interface HeaderProps {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
}

export function Header({ title, subtitle, left, right }: HeaderProps) {
  return (
    <LinearGradient
      colors={[JPColors.cream, '#FFFFFF']}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={styles.header}
    >
      {left}
      <View style={styles.headerBody}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </LinearGradient>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TabBar
// ─────────────────────────────────────────────────────────────────────────────

export interface TabBarItemLabel {
  home: string;
  attend: string;
  punya: string;
  notices: string;
  profile: string;
}

export interface TabBarProps {
  active: keyof TabBarItemLabel;
  onChange: (key: keyof TabBarItemLabel) => void;
  /**
   * Localized tab labels. Required so the caller controls i18n.
   * Defaults are English — pass translated copy from i18n in real screens.
   */
  labels?: Partial<TabBarItemLabel>;
}

const DEFAULT_TAB_LABELS: TabBarItemLabel = {
  home: 'Home',
  attend: 'Attend',
  punya: 'Punya',
  notices: 'Notices',
  profile: 'Profile',
};

const TAB_ICON: Record<keyof TabBarItemLabel, IconName> = {
  home: 'home',
  attend: 'check',
  punya: 'lotus',
  notices: 'bell',
  profile: 'user',
};

export function TabBar({ active, onChange, labels }: TabBarProps) {
  const merged: TabBarItemLabel = { ...DEFAULT_TAB_LABELS, ...(labels ?? {}) };
  const keys = Object.keys(TAB_ICON) as Array<keyof TabBarItemLabel>;

  return (
    <BlurView intensity={50} tint="light" style={styles.tabBar}>
      {keys.map(k => {
        const on = k === active;
        const iconName = TAB_ICON[k];
        return (
          <Pressable
            key={k}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={merged[k]}
            onPress={() => onChange(k)}
            style={styles.tabBtn}
          >
            <Icon
              name={iconName}
              size={22}
              color={on ? JPColors.saffron : JPColors.textSub}
              fill={on && iconName === 'lotus' ? 'solid' : 'none'}
            />
            <Text
              style={[
                styles.tabLabel,
                {
                  color: on ? JPColors.saffron : JPColors.textSub,
                  fontWeight: on ? '700' : '500',
                },
              ]}
            >
              {merged[k]}
            </Text>
          </Pressable>
        );
      })}
    </BlurView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ChildSelector
// (Original `children` prop name preserved so screens.jsx imports still work.)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChildItem {
  id: string;
  initials: string;
  name: string;
}

export interface ChildSelectorProps {
  /** Array of children to pick between (NB: prop name kept from web version). */
  children: ChildItem[];
  active: string;
  onChange: (id: string) => void;
}

export function ChildSelector({ children, active, onChange }: ChildSelectorProps) {
  return (
    <View style={styles.childRow}>
      {children.map(c => {
        const on = c.id === active;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={c.name}
            onPress={() => onChange(c.id)}
            style={[
              styles.childPill,
              on ? styles.childPillActive : styles.childPillInactive,
            ]}
          >
            <Avatar initials={c.initials} size={22} gradient={on} />
            <Text
              style={[
                styles.childLabel,
                { color: on ? JPColors.textPrimary : JPColors.textSub },
              ]}
            >
              {c.name}
            </Text>
            {on ? <Icon name="chevron" size={12} color={JPColors.saffron} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  title: string;
  body: string;
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <View style={styles.empty}>
      <Svg width={80} height={80} viewBox="0 0 64 64">
        <Ellipse cx="32" cy="40" rx="20" ry="6" stroke={JPColors.saffron300} strokeWidth={1.6} fill="none" />
        <Path d="M32 40c0-12-8-20-12-22 4 4 6 14 12 22Z" stroke={JPColors.saffron300} strokeWidth={1.6} fill="none" />
        <Path d="M32 40c0-12 8-20 12-22-4 4-6 14-12 22Z" stroke={JPColors.saffron300} strokeWidth={1.6} fill="none" />
        <Path d="M32 40c0-16-4-22-4-22 0 6 2 16 4 22Z" stroke={JPColors.saffron300} strokeWidth={1.6} fill="none" />
        <Path d="M32 40c0-16 4-22 4-22 0 6-2 16-4 22Z" stroke={JPColors.saffron300} strokeWidth={1.6} fill="none" />
        <Circle cx="32" cy="36" r="3" fill={JPColors.saffron} />
      </Svg>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const shadow1 = {
  shadowColor: '#7A1818',
  shadowOpacity: 0.06,
  shadowRadius: 2,
  shadowOffset: { width: 0, height: 1 },
  elevation: 1,
} as const;

const shadow2 = {
  shadowColor: '#7A1818',
  shadowOpacity: 0.10,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

const shadow3 = {
  shadowColor: '#7A1818',
  shadowOpacity: 0.14,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
} as const;

const styles = StyleSheet.create({
  // Buttons ─────────────────────────────────────────────────────────────────
  btnPrimary: {
    height: 50,
    paddingHorizontal: JPSpacing.sp5,
    borderRadius: JPRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: JPSpacing.sp2,
    ...shadow2,
  },
  btnPrimaryDisabledShadow: {
    shadowOpacity: 0,
    elevation: 0,
  },
  btnPrimaryLabel: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '600',
  },

  btnSecondary: {
    height: 48,
    paddingHorizontal: JPSpacing.sp5,
    borderRadius: JPRadius.md,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: JPSpacing.sp2,
  },
  btnSecondaryLabel: {
    color: JPColors.maroon,
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '600',
  },

  btnGhost: {
    height: 44,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostLabel: {
    color: JPColors.saffron,
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '600',
  },

  // Avatar ──────────────────────────────────────────────────────────────────
  avatarBase: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarMsvRing: {
    borderWidth: 3,
    borderColor: JPColors.gold50,
  },
  avatarInitials: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
  },
  msvBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
    ...shadow1,
  },
  msvLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  // Pills / chips ───────────────────────────────────────────────────────────
  pillBase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: JPRadius.pill,
    alignSelf: 'flex-start',
  },
  pillDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  pillLabel: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  chipLabel: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    fontWeight: '600',
  },

  // Punya badge ─────────────────────────────────────────────────────────────
  punyaBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: JPRadius.pill,
    backgroundColor: JPColors.saffron50,
    alignSelf: 'flex-start',
  },
  punyaBadgeLg: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  punyaLabel: {
    color: JPColors.saffron,
    fontFamily: JPFonts.body,
    fontWeight: '700',
  },

  // Tier badge ──────────────────────────────────────────────────────────────
  tierDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tierGoldBorder: {
    borderWidth: 1,
    borderColor: JPColors.gold,
  },
  tierLabel: {
    fontFamily: JPFonts.display,
    fontSize: 13,
    fontWeight: '600',
  },

  // Card ────────────────────────────────────────────────────────────────────
  cardBase: {
    backgroundColor: '#FFFFFF',
    padding: 14,
  },
  cardFlat: {
    borderRadius: JPRadius.md,
    borderWidth: 1,
    borderColor: JPColors.border,
    ...shadow1,
  },
  cardElevated: {
    borderRadius: JPRadius.lg,
    ...shadow3,
  },

  // Header ──────────────────────────────────────────────────────────────────
  header: {
    paddingTop: 10,
    paddingBottom: 12,
    paddingHorizontal: JPSpacing.sp4,
    borderBottomWidth: 1,
    borderBottomColor: JPColors.creamDeeper,
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp3,
  },
  headerBody: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 20,
    lineHeight: 24,
  },
  headerSubtitle: {
    fontSize: 11,
    color: JPColors.textSub,
    marginTop: 2,
  },

  // TabBar ──────────────────────────────────────────────────────────────────
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    height: 80,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: JPColors.creamDeeper,
    // BlurView already paints a translucent layer; this is the iOS/Android
    // fallback when blur isn't supported (Android API < 31 with experimental
    // blur disabled, web target, etc).
    backgroundColor: 'rgba(253,248,242,0.85)',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  tabLabel: {
    fontFamily: JPFonts.body,
    fontSize: 10,
  },

  // ChildSelector ───────────────────────────────────────────────────────────
  childRow: {
    flexDirection: 'row',
    gap: 6,
  },
  childPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: JPRadius.pill,
  },
  childPillActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: JPColors.saffron,
  },
  childPillInactive: {
    backgroundColor: JPColors.cream,
    borderWidth: 1,
    borderColor: JPColors.border,
  },
  childLabel: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 12,
  },

  // EmptyState ──────────────────────────────────────────────────────────────
  empty: {
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp7 - 4,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: JPFonts.display,
    color: JPColors.maroon,
    fontSize: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 13,
    lineHeight: 18,
    color: JPColors.textSub,
    marginTop: 4,
    textAlign: 'center',
  },
});
