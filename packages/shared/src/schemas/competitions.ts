/** Competition DTOs (SPEC §5.12, §6.15). */

import { z } from 'zod';

import { bilingualText, isoDate, isoDatetime, uuid } from './common.js';

export const competitionCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('description', { max: 4000 }))
  .merge(
    z.object({
      scope: z.enum(['national', 'state', 'city', 'centre', 'batch']),
      scope_id: uuid.nullable().optional(),
      start_date: isoDate,
      end_date: isoDate,
      /** Punya awarded to participants on completion. */
      punya_reward: z.number().int().min(0).max(2000).default(0),
    }),
  );
export type CompetitionCreateDto = z.infer<typeof competitionCreateSchema>;

export const competitionSchema = competitionCreateSchema.merge(
  z.object({
    id: uuid,
    status: z.enum(['draft', 'open', 'closed']),
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type CompetitionDto = z.infer<typeof competitionSchema>;

export const competitionEntrySchema = z.object({
  competition_id: uuid,
  student_id: uuid,
  attachment_asset_ids: z.array(uuid).max(10).default([]),
  note: z.string().max(2000).optional(),
});
export type CompetitionEntryDto = z.infer<typeof competitionEntrySchema>;
