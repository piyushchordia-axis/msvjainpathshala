/**
 * Super admin → dashboard. National roll-up from the analytics overview
 * (GET /v1/admin/analytics/overview). The super_admin scope is national, so
 * the same overview component renders the platform-wide slice.
 */

import React from 'react';

import { OverviewDashboard } from '@/components/admin/AdminScreen';

export default function SuperAdminDashboard() {
  return (
    <OverviewDashboard
      title="National overview"
      subtitle="Platform-wide KPIs"
      scopeNoun="network"
    />
  );
}
