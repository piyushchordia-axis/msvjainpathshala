/**
 * Sanchalak → dashboard. Centre roll-up from the analytics overview
 * (GET /v1/admin/analytics/overview, scoped to the sanchalak's centres).
 */

import React from 'react';

import { OverviewDashboard } from '@/components/admin/AdminScreen';

export default function SanchalakDashboard() {
  return (
    <OverviewDashboard
      title="Centre overview"
      subtitle="Across the centres you sanchalak"
      scopeNoun="centre"
    />
  );
}
