/**
 * Shared profile screen rendered by every role's "Profile" tab.
 *
 * Aligned with the design-system reference (`jp-design-system/ui_kits/mobile/
 * screens.jsx` → ProfileScreen): a maroon ID-card hero (avatar, name, role,
 * phone) over a settings list that carries the EN/HI language toggle and the
 * sign-out action. The hero adapts to whichever role is signed in.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Header, Icon } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';
import { LanguageToggle } from '@/features/language/LanguageToggle';

function initialsOf(name: string | undefined | null): string {
  return (
    (name ?? '')
      .trim()
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, view, signOut, switchView } = useAuth();
  const { t } = useTranslation();

  const onLogout = useCallback(() => {
    void signOut();
  }, [signOut]);

  const onBackToParent = useCallback(async () => {
    try {
      await switchView('parent');
      appToast.success('Parent view', 'Switched back to your account.');
      router.replace('/' as never);
    } catch (err) {
      appToast.error('Could not switch', err instanceof Error ? err.message : 'Please try again.');
    }
  }, [switchView, router]);

  const roleLabel = t(`roles.${user?.role ?? 'guest'}`, { defaultValue: user?.role ?? '' });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title={t('profile.title', { defaultValue: 'Profile' })} />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + JPSpacing.sp8 }]}
      >
        {/* ID-card hero */}
        <View style={styles.heroCard}>
          <LinearGradient
            colors={[JPColors.maroon, JPColors.maroon700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.hero}
          >
            <Avatar initials={initialsOf(user?.full_name)} size={64} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.heroName} numberOfLines={1}>
                {user?.full_name || t('profile.no_name', { defaultValue: 'No name set' })}
              </Text>
              <Text style={styles.heroRole}>{roleLabel}</Text>
              <Text style={styles.heroPhone}>{user?.phone ?? ''}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* Language */}
        <Text style={styles.sectionTitle}>
          {t('profile.language', { defaultValue: 'Language' })}
        </Text>
        <View style={styles.settingsCard}>
          <LanguageToggle />
        </View>

        {/* Settings list */}
        <Text style={styles.sectionTitle}>
          {t('profile.settings', { defaultValue: 'Settings' })}
        </Text>
        <View style={styles.listCard}>
          <SettingsRow
            label={t('profile.privacy', { defaultValue: 'Privacy & data' })}
            onPress={() => router.push('/profile/privacy' as never)}
          />
          <SettingsRow
            label={t('profile.notifications', { defaultValue: 'Notifications' })}
            onPress={() => router.push('/profile/notification-preferences' as never)}
          />
          <SettingsRow
            label={t('profile.help_support', { defaultValue: 'Help & support' })}
            onPress={() => router.push('/service-requests' as never)}
          />
          <SettingsRow
            label={t('profile.sync_issues', { defaultValue: 'Sync & offline' })}
            onPress={() => router.push('/profile/sync-issues' as never)}
          />
          {view === 'student' ? (
            <SettingsRow
              label={t('profile.back_to_parent', { defaultValue: 'Switch back to parent view' })}
              onPress={onBackToParent}
            />
          ) : null}
          <SettingsRow
            label={t('profile.logout', { defaultValue: 'Log out' })}
            onPress={onLogout}
            destructive
            last
          />
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsRow({
  label,
  onPress,
  destructive,
  last,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowDivider,
        pressed && styles.rowPressed,
      ]}
    >
      <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>{label}</Text>
      {destructive ? null : <Icon name="chevron" size={16} color={JPColors.textSub} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  heroCard: {
    borderRadius: JPRadius.lg,
    overflow: 'hidden',
    shadowColor: JPColors.maroon,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 4,
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp4,
    padding: JPSpacing.sp5,
  },
  heroName: { fontFamily: JPFonts.display, fontSize: 20, lineHeight: 26, color: '#FFFFFF' },
  heroRole: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.saffron300,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  heroPhone: {
    fontFamily: JPFonts.mono,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    marginTop: 4,
  },

  sectionTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: JPColors.textPrimary,
    marginTop: JPSpacing.sp3,
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    borderWidth: 1,
    borderColor: JPColors.border,
    padding: JPSpacing.sp4,
  },
  listCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    borderWidth: 1,
    borderColor: JPColors.border,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp4,
  },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: JPColors.creamDeeper },
  rowPressed: { backgroundColor: JPColors.cream },
  rowLabel: { fontFamily: JPFonts.body, fontSize: 14, color: JPColors.textPrimary },
  rowLabelDestructive: { color: JPColors.error, fontWeight: '600' },
});
