/**
 * Super admin → operations. National operational signals: open service
 * requests, the MSV approval pipeline, and recent notices.
 */

import React from 'react';

import { OperationsScreen } from '@/components/admin/AdminScreen';

export default function SuperAdminOperations() {
  return <OperationsScreen title="Operations" subtitle="Cross-state operational signals" />;
}
