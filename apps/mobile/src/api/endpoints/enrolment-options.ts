/**
 * Public enrolment-options endpoints — used by the sign-up / add-child flow
 * to populate the city → centre → batch pickers. These are @Public on the
 * backend (guests have no JWT scope), so they work signed-out or signed-in.
 *
 *   GET /v1/enrolments/options/centres?city_id=…
 *   GET /v1/enrolments/options/centres/:centreId/batches
 */

import { api, unwrap } from '../client';

export interface PublicCentre {
  id: string;
  name: string;
  locality: string | null;
  city_id: string;
}

export interface PublicBatch {
  id: string;
  name: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  language_preference: string | null;
}

export const enrolmentOptionsApi = {
  centres(cityId: string): Promise<{ items: PublicCentre[] }> {
    return unwrap<{ items: PublicCentre[] }>(
      api.get('/v1/enrolments/options/centres', { params: { city_id: cityId } }),
    );
  },

  batches(centreId: string): Promise<{ items: PublicBatch[] }> {
    return unwrap<{ items: PublicBatch[] }>(
      api.get(`/v1/enrolments/options/centres/${centreId}/batches`),
    );
  },
};
