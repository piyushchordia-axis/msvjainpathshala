/**
 * City admin → reports. Scoped attendance / engagement / niyam / donations
 * series from /v1/admin/analytics/* (city-scoped by JWT).
 */

import React from 'react';

import { ReportsScreen } from '@/components/admin/AdminScreen';

export default function CityAdminReports() {
  return <ReportsScreen title="Reports" subtitle="City attendance, niyams and donations" />;
}
