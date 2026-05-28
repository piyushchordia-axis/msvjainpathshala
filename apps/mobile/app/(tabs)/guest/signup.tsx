import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Header, PrimaryButton } from '@/components/ui';
import { JPColors, JPFonts, JPSpacing } from '@/constants/colors';

export default function GuestSignup() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title={t('signup.title', { defaultValue: 'Sign up' })} />
      <View style={styles.body}>
        <Text style={styles.heading}>
          {t('signup.heading', { defaultValue: 'Join your local Pathshala' })}
        </Text>
        <Text style={styles.body_text}>
          {t('signup.body', {
            defaultValue:
              'Enrolment is via your Sanchalak. Sign in with the phone number registered with your centre to view your children, mark Punya, and submit niyams.',
          })}
        </Text>
        <View style={styles.cta}>
          <PrimaryButton onPress={() => router.push('/(auth)/phone')}>
            {t('signup.cta', { defaultValue: 'Sign in with your phone' })}
          </PrimaryButton>
        </View>
        <Pressable
          accessibilityRole="link"
          hitSlop={12}
          onPress={() => router.push('/(tabs)/guest/centres')}
        >
          <Text style={styles.link}>
            {t('signup.find_centre', { defaultValue: 'Find a centre first →' })}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { flex: 1, padding: JPSpacing.sp5 },
  heading: {
    fontFamily: JPFonts.display,
    fontSize: 24,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp4,
  },
  body_text: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: JPColors.textSub,
    marginBottom: JPSpacing.sp6,
  },
  cta: { marginBottom: JPSpacing.sp5 },
  link: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    color: JPColors.saffron,
    textAlign: 'center',
  },
});
