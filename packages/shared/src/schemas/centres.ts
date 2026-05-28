/** Centres + centre holidays DTOs (SPEC §5.3, §6.3). */

import { z } from 'zod';

import { bilingualText, isoDate, isoDatetime, latitude, longitude, uuid } from './common.js';

export const centreCreateSchema = bilingualText('name', { max: 200 })
  .merge(bilingualText('address', { max: 500 }))
  .merge(
    z.object({
      city_id: uuid,
      gps_lat: latitude,
      gps_lon: longitude,
      /** Max permissible distance (metres) for GPS check-in (SPEC §8.2). */
      gps_radius_m: z.number().int().min(10).max(2000).default(150),
      contact_phone: z.string().optional(),
      photo_asset_id: uuid.optional(),
    }),
  );
export type CentreCreateDto = z.infer<typeof centreCreateSchema>;

export const centreUpdateSchema = centreCreateSchema.partial();
export type CentreUpdateDto = z.infer<typeof centreUpdateSchema>;

export const centreSchema = centreCreateSchema.merge(
  z.object({
    id: uuid,
    status: z.enum(['active', 'inactive']),
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type CentreDto = z.infer<typeof centreSchema>;

export const centreHolidayCreateSchema = bilingualText('reason', { max: 200 }).merge(
  z.object({
    centre_id: uuid,
    holiday_date: isoDate,
  }),
);
export type CentreHolidayCreateDto = z.infer<typeof centreHolidayCreateSchema>;
