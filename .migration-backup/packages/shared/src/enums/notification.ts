/** `notification_channel_enum`, `notification_status_enum` (SPEC §5.1). */

export const NOTIFICATION_CHANNELS = ['push', 'sms', 'email', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = ['pending', 'sent', 'delivered', 'failed'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
