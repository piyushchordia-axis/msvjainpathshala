/**
 * Sanchalak → reports. Scoped attendance / engagement / niyam / donations
 * series from /v1/admin/analytics/* (centre-scoped by JWT).
 */

import React from 'react';

import { ReportsScreen } from '@/components/admin/AdminScreen';

export default function SanchalakReports() {
  return <ReportsScreen title="Reports" subtitle="Centre attendance and niyam compliance" />;
}
