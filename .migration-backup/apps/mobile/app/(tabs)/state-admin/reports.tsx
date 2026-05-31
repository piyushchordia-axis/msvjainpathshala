/**
 * State admin → reports. Scoped attendance / engagement / niyam / donations
 * series from /v1/admin/analytics/* (state-scoped by JWT).
 */

import React from 'react';

import { ReportsScreen } from '@/components/admin/AdminScreen';

export default function StateAdminReports() {
  return <ReportsScreen title="Reports" subtitle="State-wide attendance and donations" />;
}
