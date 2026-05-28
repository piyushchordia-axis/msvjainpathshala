/** Shivir (retreat) DTOs (SPEC §5.11, §6.14, §8.6). */

import { z } from 'zod';

import { SHIVIR_ATTENDANCE_MODES, SHIVIR_SCAN_KINDS } from '../enums/shivir.js';

import {
  bilingualText,
  idempotencyKey,
  isoDate,
  isoDatetime,
  latitude,
  longitude,
  uuid,
} from './common.js';

export const shivirCreateSchema = bilingualText('name', { max: 200 })
  .merge(bilingualText('description', { max: 4000 }))
  .merge(
    z.object({
      start_date: isoDate,
      end_date: isoDate,
      venue_name: z.string().min(1).max(300),
      gps_lat: latitude.optional(),
      gps_lon: longitude.optional(),
      attendance_mode: z.enum(SHIVIR_ATTENDANCE_MODES),
      city_id: uuid.nullable().optional(),
      max_participants: z.number().int().min(1).max(100_000).optional(),
    }),
  );
export type ShivirCreateDto = z.infer<typeof shivirCreateSchema>;

export const shivirSchema = shivirCreateSchema.merge(
  z.object({
    id: uuid,
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type ShivirDto = z.infer<typeof shivirSchema>;

export const shivirScanSchema = z.object({
  shivir_id: uuid,
  participant_user_id: uuid,
  kind: z.enum(SHIVIR_SCAN_KINDS),
  scanned_by_user_id: uuid,
  client_op_id: idempotencyKey,
  client_timestamp: isoDatetime,
  gps: z.object({ lat: latitude, lon: longitude }).optional(),
});
export type ShivirScanDto = z.infer<typeof shivirScanSchema>;

export const shivirVolunteerAssignmentSchema = z.object({
  shivir_id: uuid,
  user_id: uuid,
  role_label: z.string().min(1).max(80).optional(),
});
export type ShivirVolunteerAssignmentDto = z.infer<typeof shivirVolunteerAssignmentSchema>;
