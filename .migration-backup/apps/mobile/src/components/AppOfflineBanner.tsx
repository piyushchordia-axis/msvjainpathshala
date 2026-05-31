/**
 * AppOfflineBanner — thin wrapper around the design-system OfflineBanner
 * that reads `useNetworkStore` and renders the localized "you're offline"
 * copy from DESIGN_GUIDE.md.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { OfflineBanner } from '@/components/ui/feedback';
import { useNetworkStore } from '@/stores/network.store';

export function AppOfflineBanner() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const { t } = useTranslation();
  return (
    <OfflineBanner
      open={!isOnline}
      severity="hard"
      label={t('offline.banner', {
        defaultValue: "You're offline — actions will sync when reconnected",
      })}
    />
  );
}
