/**
 * Parent → home. At-a-glance dashboard, aligned with the design-system
 * reference (`jp-design-system/ui_kits/mobile/screens.jsx` → HomeScreen):
 *   - "Namaste" greeting header with the parent's name + avatar (→ profile)
 *   - Child selector pills (design-system ChildSelector)
 *   - Elevated Punya tier card with progress bar + points-to-next-tier
 *   - "This week's Niyam" card (current niyam for the active child)
 *   - Pinned / latest notice card with the saffron top accent
 *
 * Data:
 *   - GET /v1/parents/me/students            (children)
 *   - GET /v1/students/:id/punya/balance     (tier + progress)
 *   - GET /v1/niyams?student_id=:id          (this week's niyam)
 *   - GET /v1/notices                        (pinned / latest notice)
 *   - GET /v1/notifications/unread-count      (header bell badge)
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { niyamsApi, type NiyamForCaller } from '@/api/endpoints/niyams';
import { noticesApi, type NoticeDto } from '@/api/endpoints/notices';
import { notificationsApi } from '@/api/endpoints/notifications';
import {
  punyaApi,
  TIER_COLORS,
  TIER_LABEL,
  type PunyaBalanceResponse,
  type Tier,
} from '@/api/endpoints/punya';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { Avatar, Card, ChildSelector, EmptyState, Icon, PunyaBadge } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';
import { useLanguage } from '@/features/language/use-language';

interface ChildData {
  student: StudentDto;
  punya: PunyaBalanceResponse | null;
}

function initialsOf(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

export default function ParentHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const lang = useLanguage();
  const { user } = useAuth();

  const [children, setChildren] = useState<ChildData[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [niyam, setNiyam] = useState<NiyamForCaller | null>(null);
  const [notice, setNotice] = useState<NoticeDto | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [childrenRes, noticesRes, unreadCount] = await Promise.all([
        studentsApi.myChildren(),
        noticesApi.listForCaller({ limit: 5 }).catch(() => ({ items: [] as NoticeDto[] })),
        notificationsApi.unreadCount().catch(() => 0),
      ]);
      const active = childrenRes.items.filter((s) => s.status === 'active');
      const withPunya = await Promise.all(
        active.map(async (student) => {
          try {
            return { student, punya: await punyaApi.balance(student.id) };
          } catch {
            return { student, punya: null };
          }
        }),
      );
      setChildren(withPunya);
      const firstId = withPunya[0]?.student.id ?? null;
      setActiveId((prev) => prev ?? firstId);
      // Pinned notice first, else most recent.
      const pinned = noticesRes.items.find((n) => n.pinned);
      setNotice(pinned ?? noticesRes.items[0] ?? null);
      setUnread(unreadCount);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your home.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Load the active child's current niyam whenever the selection changes.
  useEffect(() => {
    if (!activeId) {
      setNiyam(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await niyamsApi.listForCaller(activeId);
        if (cancelled) return;
        const pending = res.items.find((n) => !n.submitted_for_current_period);
        setNiyam(pending ?? res.items[0] ?? null);
      } catch {
        if (!cancelled) setNiyam(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const activeChild = useMemo(
    () => children.find((c) => c.student.id === activeId) ?? children[0] ?? null,
    [children, activeId],
  );

  const selectorItems = useMemo(
    () =>
      children.map((c) => ({
        id: c.student.id,
        initials: initialsOf(c.student.full_name),
        name: c.student.full_name.split(/\s+/)[0] ?? c.student.full_name,
      })),
    [children],
  );

  const noticeText = notice
    ? lang === 'hi' && notice.content_hi
      ? notice.content_hi
      : notice.content_en
    : '';

  return (
    <View style={styles.root}>
      {/* Greeting header */}
      <View style={[styles.header, { paddingTop: insets.top + JPSpacing.sp2 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.eyebrow}>Namaste</Text>
            <Text style={styles.greetingName} numberOfLines={1}>
              {user?.full_name ?? 'Welcome'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            onPress={() => router.push('/(tabs)/parent/profile' as never)}
          >
            <Avatar initials={initialsOf(user?.full_name ?? '')} size={38} gradient={false} />
          </Pressable>
        </View>

        {selectorItems.length > 0 ? (
          <View style={{ marginTop: JPSpacing.sp3 }}>
            <ChildSelector
              children={selectorItems}
              active={activeId ?? selectorItems[0]!.id}
              onChange={setActiveId}
            />
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + JPSpacing.sp9 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={JPColors.saffron}
          />
        }
      >
        {loading ? (
          <View style={styles.centred}>
            <ActivityIndicator color={JPColors.saffron} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              onPress={() => {
                setLoading(true);
                void load();
              }}
            >
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : children.length === 0 ? (
          <EmptyState
            title="No children yet"
            body="Add a child to start tracking attendance, Punya and niyams."
          />
        ) : (
          <>
            {/* Punya tier summary */}
            {activeChild ? (
              <PunyaSummaryCard
                data={activeChild}
                onPress={() =>
                  router.push({
                    pathname: '/(parent)/punya' as never,
                  })
                }
              />
            ) : null}

            {/* Unread notifications quick-jump */}
            {unread > 0 ? (
              <Pressable
                onPress={() => router.push('/(tabs)/parent/notifications' as never)}
                style={styles.unreadRow}
              >
                <Icon name="bell" size={18} color={JPColors.saffron} />
                <Text style={styles.unreadText}>
                  {unread} unread notification{unread === 1 ? '' : 's'}
                </Text>
                <Icon name="chevron" size={16} color={JPColors.textSub} />
              </Pressable>
            ) : null}

            {/* This week's niyam */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>This week&apos;s Niyam</Text>
              <Pressable onPress={() => router.push('/(tabs)/parent/niyams' as never)}>
                <Text style={styles.seeAll}>See all →</Text>
              </Pressable>
            </View>
            {niyam ? (
              <Pressable onPress={() => router.push('/(tabs)/parent/niyams' as never)}>
                <Card>
                  <View style={styles.cardTopRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.miniEyebrow}>
                        Niyam · {niyam.type.charAt(0).toUpperCase() + niyam.type.slice(1)}
                      </Text>
                      <Text style={styles.niyamTitle} numberOfLines={2}>
                        {lang === 'hi' && niyam.title_hi ? niyam.title_hi : niyam.title_en}
                      </Text>
                    </View>
                    <PunyaBadge value={`+${niyam.points_value}`} />
                  </View>
                  <View style={styles.niyamFooter}>
                    <View
                      style={[
                        styles.statusPill,
                        {
                          backgroundColor: niyam.submitted_for_current_period
                            ? JPColors.successBg
                            : JPColors.warningBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.statusPillText,
                          {
                            color: niyam.submitted_for_current_period
                              ? JPColors.success
                              : JPColors.warning,
                          },
                        ]}
                      >
                        {niyam.submitted_for_current_period ? 'Submitted' : 'In progress'}
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ) : (
              <Card>
                <Text style={styles.placeholderText}>
                  No niyam set for this week yet. New niyams will appear here.
                </Text>
              </Card>
            )}

            {/* Pinned / latest notice */}
            {notice ? (
              <Pressable onPress={() => router.push('/notices' as never)}>
                <Card elevated style={styles.noticeCard}>
                  <View style={styles.noticeHead}>
                    <View style={styles.noticeHeadLeft}>
                      <View style={styles.pinChip}>
                        <Icon
                          name="pin"
                          size={12}
                          color={JPColors.saffron}
                          fill={notice.pinned ? 'solid' : 'none'}
                        />
                      </View>
                      <Text style={styles.noticeKicker} numberOfLines={1}>
                        {notice.pinned ? 'Pinned notice' : 'Latest notice'}
                      </Text>
                    </View>
                    {notice.pinned ? <Text style={styles.pinnedTag}>PINNED</Text> : null}
                  </View>
                  <Text style={styles.noticeBody} numberOfLines={3}>
                    {noticeText}
                  </Text>
                  <Text style={styles.noticeLink}>View notice →</Text>
                </Card>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PunyaSummaryCard({ data, onPress }: { data: ChildData; onPress: () => void }) {
  const balance = data.punya?.balance ?? null;
  const progress = data.punya?.progress ?? null;
  const tier: Tier = balance?.current_tier ?? 'jigyasu';
  const tColor = TIER_COLORS[tier];
  const total = balance?.total_points ?? 0;

  return (
    <Pressable onPress={onPress}>
      <Card elevated>
        <View style={styles.cardTopRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.miniEyebrow}>Spiritual tier</Text>
            <Text style={[styles.tierName, { color: tColor }]} numberOfLines={1}>
              {TIER_LABEL[tier]}
            </Text>
          </View>
          <PunyaBadge value={`${total}`} size="lg" />
        </View>

        {progress ? (
          <>
            <View style={styles.thresholdRow}>
              <Text style={styles.thresholdLabel}>
                {TIER_LABEL[tier]} · {progress.lowerBound}
              </Text>
              <Text style={styles.thresholdLabel}>
                {progress.next
                  ? `${TIER_LABEL[progress.next]} · ${progress.upperBound}`
                  : 'Highest tier'}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.max(0, Math.min(1, progress.pct)) * 100}%`,
                    backgroundColor: tColor,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressFooter}>
              {progress.pointsToNext !== null && progress.next ? (
                <>
                  <Text style={styles.progressStrong}>{progress.pointsToNext} Punya</Text>
                  <Text style={{ color: JPColors.textSub }}> to </Text>
                  <Text style={[styles.progressNext, { color: TIER_COLORS[progress.next] }]}>
                    {TIER_LABEL[progress.next]}
                  </Text>
                </>
              ) : (
                <Text style={{ color: JPColors.textSub }}>
                  Highest tier reached — keep walking the path.
                </Text>
              )}
            </Text>
          </>
        ) : (
          <Text style={styles.placeholderText}>
            Punya appears here once {data.student.full_name.split(/\s+/)[0]} attends a session or
            completes a niyam.
          </Text>
        )}
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  header: {
    paddingHorizontal: JPSpacing.sp4,
    paddingBottom: JPSpacing.sp3,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: JPColors.creamDeeper,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: JPSpacing.sp3 },
  eyebrow: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    color: JPColors.textSub,
  },
  greetingName: {
    fontFamily: JPFonts.display,
    fontSize: 22,
    lineHeight: 26,
    color: JPColors.maroon,
    marginTop: 2,
  },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  centred: { paddingVertical: JPSpacing.sp8, alignItems: 'center' },
  errorCard: {
    backgroundColor: JPColors.errorBg,
    borderColor: JPColors.error,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp2,
  },
  errorText: { fontFamily: JPFonts.body, color: JPColors.error, fontSize: 14 },
  retryText: { fontFamily: JPFonts.body, color: JPColors.error, fontWeight: '700', fontSize: 13 },

  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: JPSpacing.sp3,
  },
  miniEyebrow: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: JPColors.textSub,
  },
  tierName: { fontFamily: JPFonts.display, fontSize: 24, lineHeight: 30, marginTop: 2 },

  thresholdRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  thresholdLabel: { fontFamily: JPFonts.body, fontSize: 11, color: JPColors.textSub },
  progressTrack: {
    height: 10,
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.pill,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: JPRadius.pill },
  progressFooter: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textPrimary,
    marginTop: 8,
  },
  progressStrong: { fontWeight: '700', color: JPColors.textPrimary },
  progressNext: { fontFamily: JPFonts.display },
  placeholderText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: JPColors.textSub,
  },

  unreadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp2,
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.md,
    borderWidth: 1,
    borderColor: JPColors.saffron,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: JPSpacing.sp3,
  },
  unreadText: {
    flex: 1,
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: JPColors.maroon,
  },

  sectionHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: JPSpacing.sp1,
  },
  sectionTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: JPColors.textPrimary,
  },
  seeAll: { fontFamily: JPFonts.body, fontSize: 12, fontWeight: '600', color: JPColors.saffron },

  niyamTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: JPColors.textPrimary,
    marginTop: 2,
  },
  niyamFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: JPRadius.pill },
  statusPillText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '600' },

  noticeCard: { borderTopWidth: 3, borderTopColor: JPColors.saffron },
  noticeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  noticeHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp2,
    flex: 1,
    minWidth: 0,
  },
  pinChip: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: JPColors.saffron50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  noticeKicker: {
    fontFamily: JPFonts.display,
    fontSize: 16,
    color: JPColors.maroon,
    flexShrink: 1,
  },
  pinnedTag: {
    fontFamily: JPFonts.body,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: JPColors.saffron,
  },
  noticeBody: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: JPColors.textPrimary,
    marginTop: 6,
  },
  noticeLink: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: JPColors.saffron,
    marginTop: 8,
  },
});
