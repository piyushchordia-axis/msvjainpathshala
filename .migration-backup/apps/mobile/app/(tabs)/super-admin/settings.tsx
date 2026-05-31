/**
 * Super admin → settings. Reads the singleton platform-settings row
 * (GET /v1/admin/platform-settings, super_admin only) and surfaces the 80G
 * certificate configuration (CLAUDE.md Q3). Read-only here; the toggle lives
 * in the web admin panel.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ApiError } from '@/api/client';
import { platformSettingsApi, type PlatformSettingsDto } from '@/api/endpoints/platform-settings';
import { DataScreen, Panel, SectionTitle } from '@/components/admin/AdminScreen';
import { JPColors, JPFonts, JPRadius, JPSpacing } from '@/constants/colors';

function Toggle({ on }: { on: boolean }) {
  return (
    <View
      style={[
        styles.toggle,
        {
          backgroundColor: on ? JPColors.successBg : JPColors.creamDark,
          borderColor: on ? JPColors.success : JPColors.border,
        },
      ]}
    >
      <Text style={[styles.toggleText, { color: on ? JPColors.success : JPColors.textSub }]}>
        {on ? 'Enabled' : 'Disabled'}
      </Text>
    </View>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value && value.trim() ? value : '—'}</Text>
    </View>
  );
}

export default function SuperAdminSettings() {
  const [data, setData] = useState<PlatformSettingsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await platformSettingsApi.get());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load platform settings.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <DataScreen
      title="Settings"
      subtitle="Platform configuration"
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
      emptyBody="Platform settings are not configured yet."
    >
      {data ? (
        <Panel>
          <View style={styles.headerRow}>
            <SectionTitle>80G certificates</SectionTitle>
            <Toggle on={data.eighty_g_enabled} />
          </View>
          <Text style={styles.note}>
            When enabled, donation receipts include an 80G certificate. Requires the registration
            number and trust details to be set.
          </Text>
          <Field label="Registration number" value={data.eighty_g_registration_number} />
          <Field label="Trust name" value={data.eighty_g_trust_name} />
          <Field label="Trust address" value={data.eighty_g_trust_address} />
          <Field label="Section" value={data.eighty_g_section} />
          {data.last_updated_at ? (
            <Text style={styles.note}>
              Last updated {new Date(data.last_updated_at).toLocaleString('en-GB')}
            </Text>
          ) : null}
        </Panel>
      ) : null}
    </DataScreen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggle: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: JPRadius.pill,
  },
  toggleText: { fontFamily: JPFonts.body, fontSize: 11, fontWeight: '700' },
  note: { fontFamily: JPFonts.body, fontSize: 12, color: JPColors.textSub },
  field: {
    paddingTop: JPSpacing.sp2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: JPColors.divider,
  },
  fieldLabel: {
    fontFamily: JPFonts.body,
    fontSize: 11,
    color: JPColors.textDim,
    letterSpacing: 0.4,
  },
  fieldValue: { fontFamily: JPFonts.body, fontSize: 15, color: JPColors.textPrimary, marginTop: 1 },
});
