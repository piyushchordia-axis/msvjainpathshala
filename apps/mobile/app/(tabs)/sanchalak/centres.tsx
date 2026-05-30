/**
 * Sanchalak → my centres. Lists the centres assigned to this sanchalak
 * (GET /v1/centres — scoped by JWT), with expandable batch lists.
 */

import React from 'react';

import { CentresList } from '@/components/admin/CentresList';

export default function SanchalakCentres() {
  return <CentresList title="My centres" subtitle="Centres you sanchalak" />;
}
