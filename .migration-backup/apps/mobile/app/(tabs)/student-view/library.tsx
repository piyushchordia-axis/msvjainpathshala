/**
 * Student view → library. Resources visible to the student's account
 * (GET /v1/library — tier-filtered server-side for the active context).
 */

import React from 'react';

import { LibraryList } from '@/components/admin/LibraryList';

export default function StudentViewLibrary() {
  return <LibraryList title="Library" subtitle="Recommended for your age group" />;
}
