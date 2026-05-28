/**
 * Parent / student-view → Leaderboards screen.
 *
 * Pixel-aligned with `jp-design-system/preview/leaderboard.html`:
 *   - Card with rounded corners + 1px border.
 *   - Each row: rank chip · 40x40 avatar · name + sub · point count.
 *   - Rank-1 row uses a soft gold gradient background; rank-2/3 use
 *     `cream-dark` chip; remaining rows use a plain cream chip.
 *   - Current user's row (matched on `student_id`) has a `saffron-50`
 *     background so it stands out wherever it is in the list.
 *
 * Scope tabs (top of screen): Batch · Centre · City · National · MSV.
 *   - MSV is hidden unless the selected child has an approved MSV
 *     enrolment (detected via the `msv_status === 'approved'` field on
 *     `StudentDto`).
 *   - Switching tabs hits `GET /v1/leaderboards/:scope`.
 *
 * The screen accepts `?for_student_id=` to anchor the highlight row and
 * pre-resolve scope ids (batch_id / centre_id from the student record).
 */

import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import {
  punyaApi,
  type LeaderboardEntryDto,
  type LeaderboardResponse,
  type LeaderboardScope,
} from '@/api/endpoints/punya';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

const SCOPE_LABELS: Record<LeaderboardScope, string> = {
  batch: 'My Batch',
  centre: 'Centre',
  city: 'City',
  national: 'National',
  msv: 'MSV',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials(name)}</Text>
    </View>
  );
}

function RankChip({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <View style={[styles.rankChip, { backgroundColor: JPColors.gold }]}>
        <Text style={[styles.rankChipText, { color: '#FFFFFF' }]}>1</Text>
      </View>
    );
  }
  if (rank === 2) {
    return (
      <View style={[styles.rankChip, { backgroundColor: JPColors.creamDark }]}>
        <Text style={[styles.rankChipText, { color: JPColors.maroon }]}>2</Text>
      </View>
    );
  }
  if (rank === 3) {
    return (
      <View style={[styles.rankChip, { backgroundColor: JPColors.creamDark }]}>
        <Text style={[styles.rankChipText, { color: JPColors.maroon }]}>3</Text>
      </View>
    );
  }
  return (
    <View style={[styles.rankChip, { backgroundColor: JPColors.creamDark }]}>
      <Text style={[styles.rankChipText, { color: JPColors.textSub }]}>{rank}</Text>
    </View>
  );
}

function LeaderboardRow({ entry, isSelf }: { entry: LeaderboardEntryDto; isSelf: boolean }) {
  const rank1Background = entry.rank === 1;
  const pointsColor = entry.rank === 1 ? JPColors.gold : JPColors.saffron;
  return (
    <View
      style={[
        styles.row,
        rank1Background && {
          // Soft gold gradient — RN doesn't ship a gradient primitive, so we
          // approximate with a tinted card background. Matches the preview's
          // `linear-gradient(90deg, #FAF1DC 0%, #FFFFFF 60%)` close enough
          // for visual hierarchy.
          backgroundColor: '#FAF1DC',
        },
        isSelf && styles.rowSelf,
      ]}
    >
      <RankChip rank={entry.rank} />
      <Avatar name={entry.full_name} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowName} numberOfLines={1}>
          {entry.full_name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {capitalise(entry.age_group)}
          {entry.centre_name ? ` · ${entry.centre_name}` : ''}
        </Text>
      </View>
      <View style={styles.pointsCol}>
        <Text style={[styles.pointsText, { color: pointsColor }]}>{entry.total_points}</Text>
      </View>
    </View>
  );
}

function capitalise(s: string): string {
  return s.length === 0 ? '' : s[0]!.toUpperCase() + s.slice(1);
}

export default function ParentLeaderboard() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ for_student_id?: string }>();

  const [children, setChildren] = useState<StudentDto[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<StudentDto | null>(null);
  const [scope, setScope] = useState<LeaderboardScope>('batch');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await studentsApi.myChildren();
        const active = res.items.filter((s) => s.status === 'active');
        setChildren(active);
        const targetId = params.for_student_id ?? active[0]?.id ?? null;
        const target = active.find((s) => s.id === targetId) ?? active[0] ?? null;
        setSelectedStudent(target);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load your children.');
      }
    })();
  }, [params.for_student_id]);

  const visibleScopes = useMemo<LeaderboardScope[]>(() => {
    const base: LeaderboardScope[] = ['batch', 'centre', 'city', 'national'];
    if (selectedStudent?.msv_status === 'approved') base.push('msv');
    return base;
  }, [selectedStudent?.msv_status]);

  // Reset to "batch" when the child changes if "msv" was selected but the
  // new child isn't MSV-approved.
  useEffect(() => {
    if (!visibleScopes.includes(scope)) setScope('batch');
  }, [visibleScopes, scope]);

  const load = useCallback(async (s: LeaderboardScope, student: StudentDto | null) => {
    if (!student) return;
    setLoading(true);
    setError(null);
    try {
      const opts: { scope_id?: string; for_student_id: string } = {
        for_student_id: student.id,
      };
      // Resolve scope_id from the student record.
      if (s === 'batch') {
        if (!student.batch_id) {
          setData(null);
          setLoading(false);
          return;
        }
        opts.scope_id = student.batch_id;
      }
      if (s === 'centre') opts.scope_id = student.centre_id;
      // city / national / msv resolved server-side from the JWT/route —
      // for city + msv we still need the city_id; we don't have it on
      // StudentDto, so the API allows omitting and falls back via the
      // calling user's scope.city_id. (For Step 16 we accept that the
      // city / msv tabs may return a "scope_id required" 422 for parents
      // without a city in their JWT; the empty-state UI handles it.)
      const res = await punyaApi.leaderboard(s, opts);
      setData(res);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not load leaderboard. Try another scope.',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedStudent) void load(scope, selectedStudent);
  }, [scope, selectedStudent, load]);

  const selectedId = selectedStudent?.id ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={{
        padding: JPSpacing.sp4,
        paddingBottom: insets.bottom + JPSpacing.sp7,
        gap: JPSpacing.sp4,
      }}
    >
      {children.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.selectorRow}
        >
          {children.map((c) => {
            const active = c.id === selectedStudent?.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setSelectedStudent(c)}
                style={[styles.selectorChip, active && styles.selectorChipActive]}
              >
                <Text
                  style={[styles.selectorText, active && styles.selectorTextActive]}
                  numberOfLines={1}
                >
                  {c.full_name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scopeRow}
      >
        {visibleScopes.map((s) => {
          const active = s === scope;
          return (
            <Pressable
              key={s}
              onPress={() => setScope(s)}
              style={[styles.scopeTab, active && styles.scopeTabActive]}
            >
              <Text style={[styles.scopeTabText, active && styles.scopeTabTextActive]}>
                {SCOPE_LABELS[s]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.card}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={JPColors.saffron} />
          </View>
        ) : error ? (
          <Text style={{ color: JPColors.error, fontFamily: JPFonts.body }}>{error}</Text>
        ) : !data || data.entries.length === 0 ? (
          <Text
            style={{
              color: JPColors.textSub,
              fontFamily: JPFonts.body,
              padding: JPSpacing.sp4,
              textAlign: 'center',
            }}
          >
            Leaderboard for this scope is empty. Once Punya is awarded this month, the ranks will
            fill in.
          </Text>
        ) : (
          <>
            {data.entries.map((e, i) => (
              <React.Fragment key={e.student_id}>
                {i > 0 && <View style={styles.divider} />}
                <LeaderboardRow entry={e} isSelf={e.student_id === selectedId} />
              </React.Fragment>
            ))}
          </>
        )}
      </View>

      {data?.self_rank && data.entries.length > 0 ? (
        <View style={styles.selfRankCard}>
          <Text style={styles.selfRankCardText}>
            {selectedStudent?.full_name} is at rank{' '}
            <Text style={{ fontWeight: '700', color: JPColors.saffron }}>#{data.self_rank}</Text>{' '}
            this {scope === 'national' ? 'month' : 'period'}.
          </Text>
        </View>
      ) : null}
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
  scopeRow: {
    gap: JPSpacing.sp2,
    paddingVertical: 2,
  },
  scopeTab: {
    paddingHorizontal: JPSpacing.sp3,
    paddingVertical: JPSpacing.sp2,
    borderRadius: JPRadius.pill,
    borderWidth: 1,
    borderColor: JPColors.border,
    backgroundColor: '#FFFFFF',
  },
  scopeTabActive: {
    backgroundColor: JPColors.saffron,
    borderColor: JPColors.saffron,
  },
  scopeTabText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
    fontWeight: '600',
  },
  scopeTabTextActive: {
    color: '#FFFFFF',
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderColor: JPColors.border,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: JPSpacing.sp3,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowSelf: {
    backgroundColor: JPColors.saffron50,
  },
  divider: {
    height: 1,
    backgroundColor: JPColors.divider,
  },
  rankChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankChipText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 13,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: JPColors.saffron,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
  },
  rowName: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    color: JPColors.textPrimary,
    fontSize: 14,
  },
  rowMeta: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textSub,
    marginTop: 1,
  },
  pointsCol: {
    minWidth: 50,
    alignItems: 'flex-end',
  },
  pointsText: {
    fontFamily: JPFonts.body,
    fontWeight: '700',
    fontSize: 15,
  },
  selfRankCard: {
    backgroundColor: JPColors.saffron50,
    borderColor: JPColors.saffron,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp3,
  },
  selfRankCardText: {
    fontFamily: JPFonts.body,
    color: JPColors.textPrimary,
    fontSize: 13,
  },
});
