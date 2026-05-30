/**
 * Shikshak → library. Curated audio / video / PDFs visible to the teacher
 * (GET /v1/library — tier-filtered server-side).
 */

import React from 'react';

import { LibraryList } from '@/components/admin/LibraryList';

export default function ShikshakLibrary() {
  return <LibraryList title="Library" subtitle="Resources to share with your students" />;
}
