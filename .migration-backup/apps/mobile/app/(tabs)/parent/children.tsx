/**
 * Parent → My children. Renders the parent's children from
 * `GET /v1/parents/me/students`, including inactive (per Step 10 prompt
 * + Q11). Status pills use JPColors semantics from `@/constants/colors`.
 */

import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/client';
import { studentsApi, type StudentDto } from '@/api/endpoints/students';
import { EmptyState, Header, PrimaryButton } from '@/components/ui';
import { appToast } from '@/components/ui/feedback/AppToast';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';
import { useAuth } from '@/features/auth/auth-context';

type StatusVariant = 'success' | 'warning' | 'error' | 'neutral';

function statusVariant(s: StudentDto['status']): StatusVariant {
  return s === 'active' ? 'success' : 'neutral';
}

function statusColor(v: StatusVariant): { fg: string; bg: string; border: string } {
  switch (v) {
    case 'success':
      return { fg: JPColors.success, bg: JPColors.successBg, border: JPColors.success };
    case 'warning':
      return { fg: JPColors.warning, bg: JPColors.warningBg, border: JPColors.warning };
    case 'error':
      return { fg: JPColors.error, bg: JPColors.errorBg, border: JPColors.error };
    default:
      return { fg: JPColors.textSub, bg: JPColors.creamDark, border: JPColors.border };
  }
}

function StatusPill({ status }: { status: StudentDto['status'] }) {
  const c = statusColor(statusVariant(status));
  const label = status === 'active' ? 'Active' : 'Inactive';
  return (
    <View
      style={{
        backgroundColor: c.bg,
        borderColor: c.border,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 3,
        borderRadius: JPRadius.pill,
      }}
    >
      <Text style={{ fontFamily: JPFonts.body, fontSize: 11, color: c.fg, fontWeight: '600' }}>
        {label}
      </Text>
    </View>
  );
}

export default function ParentChildren() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { switchView } = useAuth();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [items, setItems] = useState<StudentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await studentsApi.myChildren();
      setItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your children.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const viewAs = useCallback(
    async (studentId: string, name: string) => {
      setSwitchingId(studentId);
      try {
        await switchView('student', studentId);
        appToast.success('Student view', `You're now viewing as ${name.split(' ')[0]}.`);
        router.replace('/' as never);
      } catch (err) {
        appToast.error(
          'Could not switch view',
          err instanceof ApiError ? err.message : 'This child must be at least 13 years old.',
        );
      } finally {
        setSwitchingId(null);
      }
    },
    [switchView, router],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Header title="My children" subtitle="Including any deactivated profiles" />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {loading ? null : items.length === 0 ? (
          <EmptyState
            title="No children yet"
            body="Add your first child to start enrolling them in a Pathshala."
          />
        ) : (
          items.map((s) => (
            <View key={s.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{s.full_name}</Text>
                  <Text style={styles.code}>{s.student_code}</Text>
                </View>
                <StatusPill status={s.status} />
              </View>
              <View style={styles.cardMeta}>
                <Text style={styles.metaItem}>Age group: {s.age_group}</Text>
                <Text style={styles.metaItem}>
                  MSV: <Text style={styles.metaValue}>{s.msv_status}</Text>
                </Text>
              </View>
              {s.status === 'active' ? (
                <Pressable
                  onPress={() => viewAs(s.id, s.full_name)}
                  disabled={switchingId === s.id}
                  style={styles.viewAsBtn}
                >
                  <Text style={styles.viewAsText}>
                    {switchingId === s.id ? 'Switching…' : `View as ${s.full_name.split(' ')[0]}`}
                  </Text>
                </Pressable>
              ) : null}
              {s.status === 'inactive' && s.deactivated_at ? (
                <Text style={styles.deactivatedNote}>
                  Deactivated {new Date(s.deactivated_at).toLocaleDateString('en-GB')}. Ask your
                  Sanchalak to reactivate.
                </Text>
              ) : null}
            </View>
          ))
        )}

        <View style={styles.cta}>
          <PrimaryButton onPress={() => router.push('/(auth)/sign-up' as never)}>
            Add another child
          </PrimaryButton>
        </View>

        <Pressable onPress={() => void load()} style={styles.refreshLink}>
          <Text style={styles.refreshText}>Refresh</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: JPColors.cream },
  body: { padding: JPSpacing.sp4, gap: JPSpacing.sp4 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: JPSpacing.sp5,
    borderWidth: 1,
    borderColor: JPColors.border,
    gap: JPSpacing.sp3,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: JPSpacing.sp3,
  },
  name: {
    fontFamily: JPFonts.display,
    fontSize: 20,
    color: JPColors.maroon,
  },
  code: {
    fontFamily: JPFonts.mono,
    fontSize: 12,
    color: JPColors.textSub,
    marginTop: 2,
  },
  cardMeta: {
    flexDirection: 'row',
    gap: JPSpacing.sp5,
    flexWrap: 'wrap',
  },
  metaItem: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    color: JPColors.textSub,
  },
  metaValue: {
    color: JPColors.textPrimary,
    fontWeight: '500',
  },
  deactivatedNote: {
    fontFamily: JPFonts.body,
    fontSize: 12,
    color: JPColors.warning,
  },
  viewAsBtn: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: JPColors.saffron,
    backgroundColor: JPColors.saffron50,
    borderRadius: JPRadius.pill,
    paddingHorizontal: JPSpacing.sp4,
    paddingVertical: 8,
  },
  viewAsText: {
    fontFamily: JPFonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: JPColors.saffron,
  },
  errorCard: {
    backgroundColor: JPColors.errorBg,
    borderColor: JPColors.error,
    borderWidth: 1,
    borderRadius: 12,
    padding: JPSpacing.sp4,
  },
  errorText: {
    fontFamily: JPFonts.body,
    color: JPColors.error,
    fontSize: 14,
  },
  cta: {
    marginTop: JPSpacing.sp4,
  },
  refreshLink: {
    marginTop: JPSpacing.sp3,
    alignItems: 'center',
  },
  refreshText: {
    fontFamily: JPFonts.body,
    color: JPColors.saffron,
    fontSize: 14,
  },
});
