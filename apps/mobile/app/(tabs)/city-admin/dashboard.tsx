/**
 * City admin → dashboard. City-wide roll-up from the analytics overview
 * (GET /v1/admin/analytics/overview, scoped to the admin's city by JWT).
 */

import React from 'react';

import { OverviewDashboard } from '@/components/admin/AdminScreen';

export default function CityAdminDashboard() {
  return (
    <OverviewDashboard
      title="City overview"
      subtitle="Roll-ups across your centres"
      scopeNoun="city"
    />
  );
}
