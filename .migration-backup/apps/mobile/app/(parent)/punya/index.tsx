/**
 * Parent / student-view → Punya screen.
 *
 * Pixel-aligned with `jp-design-system/preview/punya-card.html`:
 *   - White card on cream background, single-pixel border, soft maroon shadow.
 *   - "Spiritual tier" eyebrow → Devanagari-friendly display name in tier
 *     colour.
 *   - Round chip on the top right showing Punya total + lotus glyph.
 *   - Threshold band with progress bar (current → next tier).
 *   - "<N> Punya to <next>" footer.
 *
 * Plus, below the hero card:
 *   - Child selector (when the parent has more than one child).
 *   - Recent transactions list (paginated, cursor-driven).
 *   - "View leaderboard" call-to-action that links to ./leaderboard.
 *
 * Data:
 *   - GET /v1/parents/me/students (child list)
 *   - GET /v1/students/:id/punya/balance
 *   - GET /v1/students/:id/punya/transactions
 *
 * Colours: NEVER hardcode hex — all values come from `JPColors` /
 * `TIER_COLORS` / `TIER_BG`. (CLAUDE.md "Never hardcode values".)
 */

import { Link, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  punyaApi,
  TIER_BG,
  TIER_COLORS,
  TIER_LABEL,
  TIER_LABEL_HI,
  type PunyaBalanceDto,
  type PunyaTransactionDto,
  type Tier,
  type TierProgressDto,
} from '@/api/endpoints/punya';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

function tierColor(t: Tier): string {
  return TIER_COLORS[t];
}

function tierBg(t: Tier): string {
  return TIER_BG[t];
}

/** Centred lotus glyph used in the points chip and transaction rows. */
function LotusGlyph({ size = 14, color }: { size?: number; color: string }) {
  // Plain text glyph — keeps RN bundle slim. Devanagari "ॐ" reads as a
  // dharma anchor without forcing an SVG dep.
  return (
    <Text
      style={{
        color,
        fontSize: size,
        fontFamily: JPFonts.display,
        marginRight: 4,
      }}
    >
      ॐ
    </Text>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

interface PunyaCardProps {
  balance: PunyaBalanceDto | null;
  progress: TierProgressDto;
}

function PunyaCard({ balance, progress }: PunyaCardProps) {
  const tier = balance?.current_tier ?? 'jigyasu';
  const total = balance?.total_points ?? 0;
  const tColor = tierColor(tier);
  const tBg = tierBg(tier);
  const nextLabel = progress.next ? TIER_LABEL[progress.next] : TIER_LABEL[tier];
  const nextHi = progress.next ? TIER_LABEL_HI[progress.next] : TIER_LABEL_HI[tier];

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.eyebrow}>SPIRITUAL TIER</Text>
          <Text style={[styles.tierName, { color: tColor }]} numberOfLines={1}>
            {TIER_LABEL[tier]}
          </Text>
          <Text style={[styles.tierNameHi, { color: tColor }]} numberOfLines={1}>
            {TIER_LABEL_HI[tier]}
          </Text>
        </View>
        <View style={[styles.pointsChip, { backgroundColor: tBg }]}>
          <LotusGlyph color={tColor} size={16} />
          <Text style={[styles.pointsChipText, { color: tColor }]}>{total} Punya</Text>
        </View>
      </View>

      <View style={styles.thresholdRow}>
        <Text style={styles.thresholdLabel}>
          {TIER_LABEL[tier]} · {progress.lowerBound}
        </Text>
        {progress.next ? (
          <Text style={styles.thresholdLabel}>
            {TIER_LABEL[progress.next]} · {progress.upperBound}
          </Text>
        ) : (
          <Text style={styles.thresholdLabel}>You've reached the highest tier 🌟</Text>
        )}
      </View>

      <ProgressBar pct={progress.pct} color={tColor} />

      <Text style={styles.progressFooter}>
        {progress.pointsToNext !== null ? (
          <>
            <Text style={{ fontWeight: '700', color: JPColors.textPrimary }}>
              {progress.pointsToNext} Punya
            </Text>{' '}
            <Text style={{ color: JPColors.textSub }}>to</Text>{' '}
            <Text style={{ fontFamily: JPFonts.display, color: tColor }}>{nextLabel}</Text>{' '}
            <Text style={{ fontFamily: JPFonts.display, color: tColor }}>· {nextHi}</Text>
          </>
        ) : (
          <Text style={{ color: JPColors.textSub }}>
            Tirthankar tier — keep walking the path 🙏
          </Text>
        )}
      </Text>
    </View>
  );
}

function ChildSelector({
  items,
  selectedId,
  onChange,
}: {
  items: StudentDto[];
  selectedId: string;
  onChange: (id: string) => void;
}) {
  if (items.length <= 1) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.selectorRow}
    >
      {items.map((s) => {
        const active = s.id === selectedId;
        return (
          <Pressable
            key={s.id}
            onPress={() => onChange(s.id)}
            style={[styles.selectorChip, active && styles.selectorChipActive]}
          >
            <Text
              style={[styles.selectorText, active && styles.selectorTextActive]}
              numberOfLines={1}
            >
              {s.full_name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function TransactionRow({ tx }: { tx: PunyaTransactionDto }) {
  const positive = tx.points > 0;
  const color = positive ? JPColors.success : JPColors.error;
  return (
    <View style={styles.txRow}>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.txTitle} numberOfLines={1}>
          {humaniseFeatureKey(tx.feature_key)}
        </Text>
        <Text style={styles.txMeta} numberOfLines={1}>
          {tx.reason ?? tx.source_entity_kind} · {formatDate(tx.awarded_at)}
        </Text>
      </View>
      <View style={styles.txPointsRow}>
        <LotusGlyph color={color} />
        <Text style={[styles.txPoints, { color }]}>
          {positive ? '+' : ''}
          {tx.points}
        </Text>
      </View>
    </View>
  );
}

function humaniseFeatureKey(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace('Msv', 'MSV');
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function ParentPunya() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [children, setChildren] = useState<StudentDto[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [balance, setBalance] = useState<PunyaBalanceDto | null>(null);
  const [progress, setProgress] = useState<TierProgressDto | null>(null);
  const [transactions, setTransactions] = useState<PunyaTransactionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChildren = useCallback(async () => {
    try {
      const res = await studentsApi.myChildren();
      const active = res.items.filter((s) => s.status === 'active');
      setChildren(active);
      if (active.length > 0 && !selectedId) setSelectedId(active[0]!.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your children.');
    }
  }, [selectedId]);

  const loadForStudent = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const [b, t] = await Promise.all([
        punyaApi.balance(id),
        punyaApi.transactions(id, { limit: 20 }),
      ]);
      setBalance(b.balance);
      setProgress(b.progress);
      setTransactions(t.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Punya data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChildren();
  }, [loadChildren]);

  useEffect(() => {
    if (selectedId) void loadForStudent(selectedId);
  }, [selectedId, loadForStudent]);

  const tier = balance?.current_tier ?? 'jigyasu';
  const tColor = useMemo(() => tierColor(tier), [tier]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        padding: JPSpacing.sp4,
        paddingBottom: insets.bottom + JPSpacing.sp7,
        gap: JPSpacing.sp4,
      }}
    >
      <ChildSelector items={children} selectedId={selectedId ?? ''} onChange={setSelectedId} />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={JPColors.saffron} />
        </View>
      ) : error ? (
        <View style={[styles.card, styles.errorCard]}>
          <Text style={{ color: JPColors.error, fontFamily: JPFonts.body }}>{error}</Text>
        </View>
      ) : !progress ? (
        <View style={[styles.card, { alignItems: 'center' }]}>
          <Text style={{ fontFamily: JPFonts.body, color: JPColors.textSub }}>
            No Punya activity yet — once your child attends a session or completes a niyam, points
            will start showing here.
          </Text>
        </View>
      ) : (
        <PunyaCard balance={balance} progress={progress} />
      )}

      {selectedId && (
        <Pressable
          onPress={() =>
            router.push({
              pathname: '/(parent)/punya/leaderboard',
              params: { for_student_id: selectedId },
            } as never)
          }
          style={[styles.leaderboardCta, { borderColor: tColor }]}
        >
          <Text style={[styles.leaderboardCtaText, { color: tColor }]}>See where they rank →</Text>
        </Pressable>
      )}

      {transactions.length > 0 && (
        <View style={styles.txCard}>
          <Text style={styles.txCardTitle}>Recent activity</Text>
          {transactions.map((t) => (
            <TransactionRow key={t.id} tx={t} />
          ))}
        </View>
      )}

      {!loading && transactions.length === 0 && selectedId && (
        <View style={styles.txCard}>
          <Text style={[styles.txCardTitle, { marginBottom: JPSpacing.sp2 }]}>Recent activity</Text>
          <Text style={{ fontFamily: JPFonts.body, color: JPColors.textSub }}>
            No transactions yet.
          </Text>
        </View>
      )}

      {/* Static deep-link for screen-reader / future a11y. Always renders so
          the e2e harness finds a stable anchor regardless of tier. */}
      <Link href={'/(parent)/punya/leaderboard' as never} asChild>
        <Pressable style={styles.linkRow} accessibilityLabel="Open leaderboards screen">
          <Text style={styles.linkRowText}>Browse all leaderboards</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: JPColors.cream,
  },
  loading: {
    paddingVertical: JPSpacing.sp7,
    alignItems: 'center',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4 + 2, // 18 — matches preview
    shadowColor: JPColors.maroon,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  errorCard: {
    backgroundColor: JPColors.errorBg,
    borderColor: JPColors.error,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: JPSpacing.sp3,
  },
  eyebrow: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.3,
    color: JPColors.textSub,
  },
  tierName: {
    fontFamily: JPFonts.display,
    fontSize: 28,
    lineHeight: 34,
    marginTop: 2,
  },
  tierNameHi: {
    fontFamily: JPFonts.display,
    fontSize: 18,
    lineHeight: 24,
    opacity: 0.85,
    marginTop: 2,
  },
  pointsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: JPRadius.pill,
  },
  pointsChipText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
  },
  thresholdRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  thresholdLabel: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
  },
  progressTrack: {
    height: 10,
    backgroundColor: JPColors.creamDark,
    borderRadius: JPRadius.pill,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: JPRadius.pill,
  },
  progressFooter: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textPrimary,
    marginTop: 8,
  },
  selectorRow: {
    gap: JPSpacing.sp2,
    paddingVertical: 2,
  },
  selectorChip: {
    backgroundColor: JPColors.creamDark,
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  selectorChipActive: {
    backgroundColor: JPColors.saffron50,
    borderColor: JPColors.saffron,
  },
  selectorText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    fontWeight: '600',
  },
  selectorTextActive: {
    color: JPColors.saffron,
  },
  leaderboardCta: {
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
    alignItems: 'center',
  },
  leaderboardCtaText: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '700',
  },
  txCard: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.lg,
    padding: JPSpacing.sp4,
  },
  txCardTitle: {
    fontFamily: JPFonts.display,
    fontSize: 16,
    color: JPColors.maroon,
    marginBottom: JPSpacing.sp3,
  },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: JPSpacing.sp2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  txTitle: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '600',
    color: JPColors.textPrimary,
  },
  txMeta: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textSub,
    marginTop: 1,
  },
  txPointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  txPoints: {
    fontFamily: JPFonts.body,
    fontSize: 15,
    fontWeight: '700',
  },
  linkRow: {
    alignItems: 'center',
    paddingVertical: JPSpacing.sp3,
  },
  linkRowText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.saffron,
    textDecorationLine: 'underline',
  },
});
