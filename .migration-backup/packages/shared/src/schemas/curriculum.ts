/** Curriculum DTOs (SPEC §5.13, §6.16, CLAUDE.md Q2 — super_admin only for MSV). */

import { z } from 'zod';

import { CURRICULUM_LEVELS } from '../enums/curriculum.js';

import { bilingualText, isoDatetime, uuid } from './common.js';

export const curriculumCreateSchema = bilingualText('title', { max: 200 })
  .merge(bilingualText('description', { max: 4000 }))
  .merge(
    z.object({
      /** Standard vs MSV — MSV editing is restricted to super_admin (CLAUDE.md Q2). */
      kind: z.enum(['standard', 'msv']),
      city_id: uuid.nullable().optional(),
      age_group: z.enum(['bal', 'kishor', 'tarun', 'yuva']).nullable().optional(),
    }),
  );
export type CurriculumCreateDto = z.infer<typeof curriculumCreateSchema>;

export const curriculumSchema = curriculumCreateSchema.merge(
  z.object({
    id: uuid,
    created_at: isoDatetime,
    updated_at: isoDatetime,
  }),
);
export type CurriculumDto = z.infer<typeof curriculumSchema>;

export const curriculumProgressUpdateSchema = z.object({
  student_id: uuid,
  curriculum_topic_id: uuid,
  level: z.enum(CURRICULUM_LEVELS),
  comment: z.string().max(1000).optional(),
});
export type CurriculumProgressUpdateDto = z.infer<typeof curriculumProgressUpdateSchema>;
