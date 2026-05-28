/**
 * Reusable profile placeholder — every role's "Profile" tab in Step 8
 * renders this so the bilingual toggle is reachable from any login path.
 *
 * Future feature steps replace this with a role-specific profile (parent
 * adds Switch-View CTA, sanchalak adds centre membership, etc).
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostButton, Header } from '@/components/ui';
import { JPColors, JPFonts, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';
import { LanguageToggle } from '@/features/language/LanguageToggle';

export function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, signOut } = useAuth();
  const { t } = useTranslation();

  const onLogout = useCallback(() => {
    void signOut();
  }, [signOut]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title={t('profile.title', { defaultValue: 'Profile' })} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.label}>
            {t('profile.signed_in_as', { defaultValue: 'Signed in as' })}
          </Text>
          <Text style={styles.identity}>
            {user?.full_name || t('profile.no_name', { defaultValue: 'No name set' })}
          </Text>
          <Text style={styles.phone}>{user?.phone ?? ''}</Text>
          <Text style={styles.role}>
            {t(`roles.${user?.role ?? 'guest'}`, { defaultValue: user?.role ?? '' })}
          </Text>
        </View>

        <View style={styles.section}>
          <LanguageToggle />
        </View>

        <View style={styles.section}>
          <GhostButton onPress={onLogout}>
            {t('profile.logout', { defaultValue: 'Log out' })}
          </GhostButton>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: JPColors.cream,
  },
  body: {
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp5,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: JPSpacing.sp5,
    borderWidth: 1,
    borderColor: JPColors.border,
  },
  section: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: JPSpacing.sp5,
    borderWidth: 1,
    borderColor: JPColors.border,
  },
  label: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: JPSpacing.sp2,
  },
  identity: {
    fontFamily: JPFonts.display,
    fontSize: 20,
    color: JPColors.maroon,
  },
  phone: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.textPrimary,
    marginTop: 2,
  },
  role: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    marginTop: 2,
  },
});
