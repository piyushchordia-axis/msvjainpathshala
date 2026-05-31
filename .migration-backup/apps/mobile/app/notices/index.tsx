/**
 * Notices feed — matches jp-design-system/preview/notice-cards.html.
 *
 *   • Pinned notices float to the top with a saffron left border.
 *   • Critical notices use the error-red background with a
 *     "Important — please read and acknowledge" banner.
 *   • Standard notices render as cream cards.
 *
 * Read state: `POST /v1/notices/:id/read` fires on tap of the
 * Acknowledgement button.
 *
 * Colours: only `JPColors.*` — never hardcoded hex.
 */

import { useFocusEffect } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { noticesApi, type NoticeDto } from '@/api/endpoints/notices';
import { Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useLanguage } from '@/features/language/use-language';

function noticeBody(notice: NoticeDto, lang: 'en' | 'hi'): string {
  return lang === 'hi' && notice.content_hi ? notice.content_hi : notice.content_en;
}

interface State {
  loading: boolean;
  error: string | null;
  items: NoticeDto[];
  refreshing: boolean;
}

const INITIAL: State = {
  loading: true,
  error: null,
  items: [],
  refreshing: false,
};

export default function NoticesScreen() {
  const insets = useSafeAreaInsets();
  const lang = useLanguage();
  const [state, setState] = useState<State>(INITIAL);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    setState((prev) => ({
      ...prev,
      ...(mode === 'initial' ? { loading: true } : { refreshing: true }),
      error: null,
    }));
    try {
      const res = await noticesApi.listForCaller({ limit: 50 });
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        items: res.items,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: err instanceof ApiError ? err.message : 'Could not load notices',
      }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load('initial');
    }, [load]),
  );

  const acknowledge = useCallback(async (notice: NoticeDto) => {
    try {
      await noticesApi.markRead(notice.id);
      setState((prev) => ({
        ...prev,
        items: prev.items.map((n) => (n.id === notice.id ? { ...n, is_read: true } : n)),
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof ApiError ? err.message : 'Could not mark as read',
      }));
    }
  }, []);

  if (state.loading) {
    return (
      <View style={[styles.centered, { paddingTop: insets.top }]}>
        <ActivityIndicator color={JPColors.saffron} />
      </View>
    );
  }

  // Group pinned notices first; design-system says "pinned float to top".
  const pinned = state.items.filter((n) => n.pinned);
  const others = state.items.filter((n) => !n.pinned);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <Header title="Notices" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={state.refreshing}
            onRefresh={() => load('refresh')}
            colors={[JPColors.saffron]}
            tintColor={JPColors.saffron}
          />
        }
      >
        {state.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{state.error}</Text>
          </View>
        ) : null}
        {pinned.length === 0 && others.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No notices yet</Text>
            <Text style={styles.emptySub}>You'll see announcements from your centre here.</Text>
          </View>
        ) : null}
        {pinned.map((n) => (
          <NoticeCard key={n.id} notice={n} lang={lang} onAcknowledge={acknowledge} />
        ))}
        {others.map((n) => (
          <NoticeCard key={n.id} notice={n} lang={lang} onAcknowledge={acknowledge} />
        ))}
      </ScrollView>
    </View>
  );
}

interface NoticeCardProps {
  notice: NoticeDto;
  lang: 'en' | 'hi';
  onAcknowledge: (n: NoticeDto) => void;
}

function NoticeCard({ notice, lang, onAcknowledge }: NoticeCardProps) {
  const body = noticeBody(notice, lang);
  if (notice.is_critical) {
    return (
      <View style={[styles.card, styles.cardCritical]}>
        <View style={styles.criticalBanner}>
          <Text style={styles.criticalBannerText}>Important — please read and acknowledge</Text>
        </View>
        <Text style={[styles.bodyText, styles.bodyTextOnCritical]} numberOfLines={6}>
          {body}
        </Text>
        {!notice.is_read ? (
          <Pressable
            onPress={() => onAcknowledge(notice)}
            style={styles.criticalAckButton}
            accessibilityRole="button"
            accessibilityLabel="Acknowledge important notice"
          >
            <Text style={styles.criticalAckText}>Acknowledge</Text>
          </Pressable>
        ) : (
          <View style={styles.readChip}>
            <Text style={styles.readChipText}>Acknowledged</Text>
          </View>
        )}
      </View>
    );
  }
  return (
    <View style={[styles.card, notice.pinned ? styles.cardPinned : styles.cardStandard]}>
      {notice.pinned ? (
        <View style={styles.pinnedRow}>
          <Text style={styles.pinnedLabel}>Pinned</Text>
        </View>
      ) : null}
      <Text style={styles.bodyText} numberOfLines={6}>
        {body}
      </Text>
      {notice.is_read ? (
        <View style={styles.readChip}>
          <Text style={styles.readChipText}>Read</Text>
        </View>
      ) : (
        <Pressable onPress={() => onAcknowledge(notice)} style={styles.readButton}>
          <Text style={styles.readButtonText}>Mark as read</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: JPColors.cream },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: JPColors.cream,
  },
  scroll: { padding: JPSpacing.sp4, gap: JPSpacing.sp3 },
  errorBox: {
    backgroundColor: JPColors.errorBg,
    padding: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    marginBottom: JPSpacing.sp3,
  },
  errorText: { color: JPColors.error, fontFamily: JPFonts.body, fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: JPSpacing.sp6 },
  emptyTitle: {
    color: JPColors.textPrimary,
    fontSize: 18,
    fontFamily: JPFonts.display,
    marginBottom: JPSpacing.sp2,
  },
  emptySub: {
    color: JPColors.textSub,
    fontFamily: JPFonts.body,
    fontSize: 14,
    textAlign: 'center',
  },
  card: {
    padding: JPSpacing.sp4,
    borderRadius: JPRadius.lg,
    gap: JPSpacing.sp3,
  },
  cardStandard: { backgroundColor: JPColors.creamDark },
  cardPinned: {
    backgroundColor: JPColors.creamDark,
    borderLeftWidth: 4,
    borderLeftColor: JPColors.saffron,
  },
  cardCritical: {
    backgroundColor: JPColors.errorBg,
    borderColor: JPColors.error,
    borderWidth: 1,
  },
  pinnedRow: { flexDirection: 'row' },
  pinnedLabel: {
    color: JPColors.saffron,
    fontFamily: JPFonts.body,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: JPColors.saffron50,
    paddingHorizontal: JPSpacing.sp2,
    paddingVertical: 2,
    borderRadius: JPRadius.sm,
  },
  bodyText: { color: JPColors.textPrimary, fontFamily: JPFonts.body, fontSize: 15, lineHeight: 22 },
  bodyTextOnCritical: { color: JPColors.maroon700 },
  criticalBanner: {
    backgroundColor: JPColors.error,
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp3,
    borderRadius: JPRadius.md,
    alignSelf: 'flex-start',
  },
  criticalBannerText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '700',
  },
  criticalAckButton: {
    backgroundColor: JPColors.error,
    paddingVertical: JPSpacing.sp3,
    paddingHorizontal: JPSpacing.sp4,
    borderRadius: JPRadius.md,
    alignSelf: 'flex-start',
  },
  criticalAckText: { color: '#FFFFFF', fontFamily: JPFonts.body, fontSize: 14, fontWeight: '700' },
  readButton: {
    alignSelf: 'flex-start',
    paddingVertical: JPSpacing.sp2,
    paddingHorizontal: JPSpacing.sp3,
    borderWidth: 1,
    borderColor: JPColors.saffron,
    borderRadius: JPRadius.md,
  },
  readButtonText: {
    color: JPColors.saffron,
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '600',
  },
  readChip: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: JPSpacing.sp2,
    backgroundColor: JPColors.successBg,
    borderRadius: JPRadius.sm,
  },
  readChipText: {
    color: JPColors.success,
    fontFamily: JPFonts.body,
    fontSize: 12,
    fontWeight: '600',
  },
});
