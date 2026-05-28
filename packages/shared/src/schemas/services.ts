/** Service-request DTOs (SPEC §5.15, §6.19). */

import { z } from 'zod';

import { SERVICE_REQUEST_STATUSES } from '../enums/service-request.js';

import { isoDatetime, uuid } from './common.js';

export const serviceRequestCreateSchema = z.object({
  category: z.enum(['account', 'enrolment', 'attendance', 'payment', 'other']),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  attachment_asset_ids: z.array(uuid).max(5).default([]),
});
export type ServiceRequestCreateDto = z.infer<typeof serviceRequestCreateSchema>;

export const serviceRequestUpdateSchema = z.object({
  request_id: uuid,
  status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
  resolution_note: z.string().max(2000).optional(),
});
export type ServiceRequestUpdateDto = z.infer<typeof serviceRequestUpdateSchema>;

export const serviceRequestSchema = z.object({
  id: uuid,
  author_user_id: uuid,
  status: z.enum(SERVICE_REQUEST_STATUSES),
  category: z.enum(['account', 'enrolment', 'attendance', 'payment', 'other']),
  subject: z.string(),
  body: z.string(),
  resolution_note: z.string().nullable(),
  created_at: isoDatetime,
  updated_at: isoDatetime,
});
export type ServiceRequestDto = z.infer<typeof serviceRequestSchema>;
