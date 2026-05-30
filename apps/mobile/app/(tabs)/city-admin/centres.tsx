/**
 * City admin → centres. Lists centres in the admin's city (GET /v1/centres),
 * with expandable batch lists per centre.
 */

import React from 'react';

import { CentresList } from '@/components/admin/CentresList';

export default function CityAdminCentres() {
  return <CentresList title="Centres" subtitle="Centres across your city" />;
}
