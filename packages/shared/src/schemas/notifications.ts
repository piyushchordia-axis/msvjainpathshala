/** Notification DTOs (SPEC §5.18, §6.22). */

import { z } from 'zod';

import { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from '../enums/notification.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

export const registerDeviceTokenSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  token: z.string().min(8).max(4096),
  /** Device id from the auth flow — used to attach this token to that session. */
  device_id: z.string().min(1).max(128).optional(),
});
export type RegisterDeviceTokenDto = z.infer<typeof registerDeviceTokenSchema>;

export const notificationPreferencesSchema = z.object({
  push: z.boolean(),
  sms: z.boolean(),
  email: z.boolean(),
  in_app: z.boolean().default(true),
});
export type NotificationPreferencesDto = z.infer<typeof notificationPreferencesSchema>;

export const notificationSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('body', { max: 2000 }))
  .merge(
    z.object({
      id: uuid,
      channel: z.enum(NOTIFICATION_CHANNELS),
      status: z.enum(NOTIFICATION_STATUSES),
      deep_link: z.string().nullable(),
      created_at: isoDatetime,
      read_at: isoDatetime.nullable(),
    }),
  );
export type NotificationDto = z.infer<typeof notificationSchema>;
