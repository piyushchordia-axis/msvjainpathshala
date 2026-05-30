/**
 * State admin → dashboard. State-wide roll-up from the analytics overview
 * (GET /v1/admin/analytics/overview, scoped to the admin's state by JWT).
 */

import React from 'react';

import { OverviewDashboard } from '@/components/admin/AdminScreen';

export default function StateAdminDashboard() {
  return (
    <OverviewDashboard
      title="State overview"
      subtitle="Roll-ups across your cities"
      scopeNoun="state"
    />
  );
}
