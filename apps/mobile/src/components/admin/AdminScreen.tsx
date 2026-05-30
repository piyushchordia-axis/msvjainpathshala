/**
 * Shared admin/data-screen scaffolding used by the role tab screens
 * (city-admin, state-admin, super-admin, sanchalak, shikshak, etc).
 *
 * Provides:
 *   - `<DataScreen>` — header + scroll body that renders loading / error /
 *     empty / data states consistently with `parent/children.tsx`.
 *   - `<StatGrid>` / `<StatCard>` — KPI tiles for dashboards.
 *   - `<SectionTitle>` — section header text.
 *
 * Colours come exclusively from `JPColors` (CLAUDE.md "Never hardcode").
 */

import React from 'react';
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
import {
  analyticsApi,
  type AnalyticsOverview,
  type AttendanceTrendRow,
  type CentreEngagementRow,
  type DonationsSummaryRow,
  type MsvPipelineRow,
  type NiyamCompletionRow,
} from '@/api/endpoints/analytics';
import { noticesApi, type NoticeDto } from '@/api/endpoints/notices';
import { EmptyState, Header } from '@/components/ui';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

export interface DataScreenProps {
  title: string;
  subtitle?: string;
  loading: boolean;
  error: string | null;
  /** When true, renders the empty state instead of `children`. */
  empty?: boolean;
  emptyTitle?: string;
  emptyBody?: string;
  onRetry?: () => void;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}

export function DataScreen({
  title,
  subtitle,
  loading,
  error,
  empty,
  emptyTitle,
  emptyBody,
  onRetry,
  refreshing,
  onRefresh,
  children,
}: DataScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title={title} subtitle={subtitle} />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + JPSpacing.sp8 }]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              tintColor={JPColors.saffron}
            />
          ) : undefined
        }
      >
        {loading ? (
          <View style={styles.centred}>
            <ActivityIndicator color={JPColors.saffron} />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            {onRetry ? (
              <Pressable onPress={onRetry} style={styles.retry}>
                <Text style={styles.retryText}>Try again</Text>
              </Pressable>
            ) : null}
          </View>
        ) : empty ? (
          <EmptyState
            title={emptyTitle ?? 'Nothing here yet'}
            body={emptyBody ?? 'Data will appear here once activity starts in your scope.'}
          />
        ) : (
          children
        )}
      </ScrollView>
    </View>
  );
}

/** Compact rupee formatting from a paise integer (₹1.2L / ₹3.4k / ₹500). */
export function formatPaise(paise: number): string {
  const rupees = Math.round(paise / 100);
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(1)}L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${rupees}`;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  accent?: string;
}

export function StatCard({ label, value, hint, accent }: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

/** A plain white content card with a single-pixel border. */
export function Panel({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.panel, style]}>{children}</View>;
}

/**
 * Shared analytics-overview dashboard used by the city/state/super/sanchalak
 * dashboard tabs. The overview is scoped server-side by the caller's JWT, so
 * the same component renders the right slice for each role.
 */
export function OverviewDashboard({
  title,
  subtitle,
  scopeNoun,
}: {
  title: string;
  subtitle: string;
  scopeNoun: string;
}) {
  const [data, setData] = React.useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      setData(await analyticsApi.overview());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not load the ${scopeNoun} overview.`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scopeNoun]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        void load();
      }}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      empty={!data}
      emptyBody={`No activity to summarise yet for your ${scopeNoun}.`}
    >
      {data ? (
        <>
          <StatGrid>
            <StatCard
              label="Active students"
              value={data.active_students}
              accent={JPColors.saffron}
            />
            <StatCard label="Centres" value={data.centres} />
            <StatCard
              label="Attendance (30d)"
              value={`${data.attendance_rate_30d}%`}
              accent={JPColors.success}
            />
            <StatCard label="Active MSV" value={data.msv_active} accent={JPColors.gold} />
            <StatCard label="Punya awarded (30d)" value={data.punya_awarded_30d} />
            <StatCard label="Open requests" value={data.open_service_requests} />
          </StatGrid>

          <Panel>
            <SectionTitle>Donations year to date</SectionTitle>
            <Text style={styles.dashBig}>{formatPaise(data.donations_total_paise_ytd)}</Text>
            <Text style={styles.dashCaption}>Total receipted this financial year.</Text>
          </Panel>

          {data.tier_distribution && data.tier_distribution.length > 0 ? (
            <Panel>
              <SectionTitle>Spiritual tiers</SectionTitle>
              {data.tier_distribution.map((t) => (
                <View key={t.tier} style={styles.dashRow}>
                  <Text style={styles.dashRowLabel}>{t.tier}</Text>
                  <Text style={styles.dashRowValue}>{t.student_count}</Text>
                </View>
              ))}
            </Panel>
          ) : null}
        </>
      ) : null}
    </DataScreen>
  );
}

interface ReportsState {
  attendance: AttendanceTrendRow[];
  engagement: CentreEngagementRow[];
  niyam: NiyamCompletionRow[];
  donations: DonationsSummaryRow[];
}

/**
 * Shared reports surface (city/state/sanchalak). Pulls four scoped analytics
 * series and renders compact summary panels. All series are scoped to the
 * caller via the JWT.
 */
export function ReportsScreen({ title, subtitle }: { title: string; subtitle: string }) {
  const [state, setState] = React.useState<ReportsState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [attendance, engagement, niyam, donations] = await Promise.all([
        analyticsApi.attendance(30),
        analyticsApi.engagement(6),
        analyticsApi.niyamCompletion(),
        analyticsApi.donations(),
      ]);
      setState({
        attendance: attendance.items,
        engagement: engagement.items,
        niyam: niyam.items,
        donations: donations.items,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load reports.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const empty =
    !!state &&
    state.attendance.length === 0 &&
    state.engagement.length === 0 &&
    state.niyam.length === 0 &&
    state.donations.length === 0;

  const avgAttendance =
    state && state.attendance.length > 0
      ? Math.round(
          (state.attendance.reduce((a, r) => a + r.attendance_rate, 0) / state.attendance.length) *
            10,
        ) / 10
      : 0;
  const totalDonations = state ? state.donations.reduce((a, r) => a + Number(r.total_paise), 0) : 0;
  const niyamApproved = state ? state.niyam.reduce((a, r) => a + r.approved_count, 0) : 0;
  const niyamSubmitted = state ? state.niyam.reduce((a, r) => a + r.submission_count, 0) : 0;
  const niyamRate = niyamSubmitted > 0 ? Math.round((niyamApproved / niyamSubmitted) * 100) : 0;

  return (
    <DataScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        void load();
      }}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      empty={empty}
      emptyBody="No report data yet. Once attendance and niyams are recorded in your scope, summaries appear here."
    >
      {state && !empty ? (
        <>
          <StatGrid>
            <StatCard
              label="Avg attendance (30d)"
              value={`${avgAttendance}%`}
              accent={JPColors.success}
            />
            <StatCard label="Niyam approval" value={`${niyamRate}%`} accent={JPColors.saffron} />
            <StatCard
              label="Donations (FY)"
              value={formatPaise(totalDonations)}
              accent={JPColors.gold}
            />
            <StatCard label="Niyam submissions" value={niyamSubmitted} />
          </StatGrid>

          {state.engagement.length > 0 ? (
            <Panel>
              <SectionTitle>Centre engagement (recent months)</SectionTitle>
              {state.engagement.slice(0, 8).map((r, i) => (
                <View key={`${r.centre_id}-${r.academic_month}-${i}`} style={styles.dashRow}>
                  <Text style={styles.dashRowLabel}>{r.academic_month}</Text>
                  <Text style={styles.reportMeta}>
                    {Math.round(r.attendance_rate)}% att · {r.active_students} students
                  </Text>
                </View>
              ))}
            </Panel>
          ) : null}

          {state.attendance.length > 0 ? (
            <Panel>
              <SectionTitle>Attendance trend (last days)</SectionTitle>
              {state.attendance.slice(-7).map((r, i) => (
                <View key={`${r.day}-${i}`} style={styles.dashRow}>
                  <Text style={styles.dashRowLabel}>{r.day}</Text>
                  <Text style={styles.reportMeta}>
                    {Math.round(r.attendance_rate)}% ({r.present_count}/{r.total_marks})
                  </Text>
                </View>
              ))}
            </Panel>
          ) : null}
        </>
      ) : null}
    </DataScreen>
  );
}

interface OpsState {
  overview: AnalyticsOverview;
  msv: MsvPipelineRow[];
  notices: NoticeDto[];
}

/**
 * Shared operations surface (city-admin / super-admin). Surfaces the
 * actionable operational signals: open service requests, the MSV approval
 * pipeline, and recent broadcast notices. All scoped server-side by JWT.
 */
export function OperationsScreen({ title, subtitle }: { title: string; subtitle: string }) {
  const [state, setState] = React.useState<OpsState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const [overview, msv, notices] = await Promise.all([
        analyticsApi.overview(),
        analyticsApi.msvPipeline(),
        noticesApi.listForCaller({ limit: 10 }).catch(() => ({ items: [] as NoticeDto[] })),
      ]);
      setState({ overview, msv: msv.items, notices: notices.items });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load operations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Aggregate MSV pipeline by status (rows are per-city).
  const msvByStatus = new Map<string, number>();
  if (state) {
    for (const r of state.msv) {
      msvByStatus.set(r.msv_status, (msvByStatus.get(r.msv_status) ?? 0) + r.student_count);
    }
  }
  const applied = msvByStatus.get('applied') ?? 0;
  const waitlisted = msvByStatus.get('waitlisted') ?? 0;

  return (
    <DataScreen
      title={title}
      subtitle={subtitle}
      loading={loading}
      error={error}
      onRetry={() => {
        setLoading(true);
        void load();
      }}
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        void load();
      }}
      empty={!state}
      emptyBody="No operational data in your scope yet."
    >
      {state ? (
        <>
          <StatGrid>
            <StatCard
              label="Open service requests"
              value={state.overview.open_service_requests}
              accent={JPColors.saffron}
            />
            <StatCard label="MSV awaiting decision" value={applied} accent={JPColors.gold} />
            <StatCard label="MSV waitlisted" value={waitlisted} />
            <StatCard label="Active MSV" value={state.overview.msv_active} />
          </StatGrid>

          {msvByStatus.size > 0 ? (
            <Panel>
              <SectionTitle>MSV pipeline</SectionTitle>
              {Array.from(msvByStatus.entries()).map(([status, count]) => (
                <View key={status} style={styles.dashRow}>
                  <Text style={styles.dashRowLabel}>{status.replace(/_/g, ' ')}</Text>
                  <Text style={styles.dashRowValue}>{count}</Text>
                </View>
              ))}
            </Panel>
          ) : null}

          {state.notices.length > 0 ? (
            <Panel>
              <SectionTitle>Recent notices</SectionTitle>
              {state.notices.slice(0, 6).map((n) => (
                <View key={n.id} style={styles.noticeRow}>
                  <Text style={styles.noticeText} numberOfLines={2}>
                    {n.content_en}
                  </Text>
                  <Text style={styles.reportMeta}>
                    {n.scope}
                    {n.pinned ? ' · pinned' : ''}
                  </Text>
                </View>
              ))}
            </Panel>
          ) : null}
        </>
      ) : null}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  reportMeta: { fontFamily: JPFonts.body, fontSize: 13, color: JPColors.textSub },
  noticeRow: {
    paddingVertical: JPSpacing.sp2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
    gap: 2,
  },
  noticeText: { fontFamily: JPFonts.body, fontSize: 14, color: JPColors.textPrimary },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  centred: { paddingVertical: JPSpacing.sp8, alignItems: 'center' },
  errorCard: {
    backgroundColor: JPColors.errorBg,
    borderColor: JPColors.error,
    borderWidth: 1,
    borderRadius: JPRadius.md,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  errorText: { fontFamily: JPFonts.body, color: JPColors.error, fontSize: 14 },
  retry: { alignSelf: 'flex-start' },
  retryText: { fontFamily: JPFonts.body, color: JPColors.error, fontWeight: '700', fontSize: 13 },
  sectionTitle: {
    fontFamily: JPFonts.body,
    fontWeight: '600',
    fontSize: 15,
    color: JPColors.textPrimary,
    marginBottom: -JPSpacing.sp1,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: JPSpacing.sp3,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    borderWidth: 1,
    borderColor: JPColors.border,
    padding: JPSpacing.sp4,
    gap: 2,
  },
  statValue: {
    fontFamily: JPFonts.display,
    fontSize: 26,
    color: JPColors.maroon,
    lineHeight: 32,
  },
  statLabel: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.textSub,
  },
  statHint: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textDim,
    marginTop: 2,
  },
  panel: {
    backgroundColor: '#FFFFFF',
    borderRadius: JPRadius.lg,
    borderWidth: 1,
    borderColor: JPColors.border,
    padding: JPSpacing.sp4,
    gap: JPSpacing.sp3,
  },
  dashBig: { fontFamily: JPFonts.display, fontSize: 32, color: JPColors.maroon },
  dashCaption: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub },
  dashRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  dashRowLabel: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    color: JPColors.textPrimary,
    textTransform: 'capitalize',
  },
  dashRowValue: {
    fontFamily: JPFonts.body,
    fontSize: 14,
    fontWeight: '700',
    color: JPColors.textPrimary,
  },
});
