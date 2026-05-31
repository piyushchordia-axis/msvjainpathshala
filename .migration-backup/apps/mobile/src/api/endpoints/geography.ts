/**
 * Geography endpoint wrappers — states + cities (SPEC §6.28).
 *
 * All reads are public; used by the state-admin "cities" tab, the
 * super-admin dashboard, and the guest about screen.
 *
 *   GET /v1/geography/states
 *   GET /v1/geography/states/:stateId/cities
 *   GET /v1/geography/cities/:cityId
 */

import { api, unwrap } from '../client';

export interface StateDto {
  id: string;
  name: string;
  code: string;
  created_at?: string;
}

export interface CityDto {
  id: string;
  state_id: string;
  name: string;
  code: string;
  created_at?: string;
}

export const geographyApi = {
  async states(): Promise<{ items: StateDto[] }> {
    return unwrap<{ items: StateDto[] }>(api.get('/v1/geography/states'));
  },

  async cities(stateId: string): Promise<{ items: CityDto[] }> {
    return unwrap<{ items: CityDto[] }>(api.get(`/v1/geography/states/${stateId}/cities`));
  },

  async getCity(cityId: string): Promise<CityDto> {
    return unwrap<CityDto>(api.get(`/v1/geography/cities/${cityId}`));
  },
};
