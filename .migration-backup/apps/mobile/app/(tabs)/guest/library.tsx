/**
 * Guest → library. Publicly available resources only
 * (GET /v1/public/library — unauthenticated, public-tier items).
 */

import React from 'react';

import { LibraryList } from '@/components/admin/LibraryList';

export default function GuestLibrary() {
  return <LibraryList title="Library" subtitle="Free resources, open to everyone" publicOnly />;
}
