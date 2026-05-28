/**
 * Parent → Notifications tab. Hosts the cursor-paginated in-app feed
 * (Step 12). The host route lives inside `(tabs)/parent` so the tab
 * navigator picks it up automatically.
 */

import React from 'react';

import { NotificationsList } from '@/features/notifications/NotificationsList';

export default function ParentNotifications(): React.JSX.Element {
  return <NotificationsList />;
}
