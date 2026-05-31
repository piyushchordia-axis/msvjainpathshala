/**
 * City admin → operations. Open service requests, MSV approval pipeline, and
 * recent notices — all city-scoped via the caller's JWT.
 */

import React from 'react';

import { OperationsScreen } from '@/components/admin/AdminScreen';

export default function CityAdminOperations() {
  return <OperationsScreen title="Operations" subtitle="Requests, MSV pipeline and notices" />;
}
