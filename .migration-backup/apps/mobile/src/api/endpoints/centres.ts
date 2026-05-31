/**
 * Centres + batches endpoint wrappers.
 *
 * Reads are scope-bound server-side by the caller's JWT:
 *   GET /v1/centres                       — centres in the actor's scope
 *   GET /v1/centres/:centreId             — one centre
 *   GET /v1/centres/:centreId/batches     — batches for a centre
 *   GET /v1/batches/:batchId              — one batch
 *   GET /v1/batches/:batchId/timetable    — derived session slots
 */

import { api, unwrap } from '../client';

export interface CentreDto {
  id: string;
  city_id: string;
  name: string;
  address_line: string | null;
  locality: string | null;
  pincode: string | null;
  lat: string | null;
  lng: string | null;
  gps_radius_m: number;
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
  academic_year: string | null;
  created_at: string;
}

export interface BatchDto {
  id: string;
  centre_id: string;
  name: string;
  day_of_week: number[];
  start_time: string;
  end_time: string;
  age_group: 'bal' | 'kishor' | 'tarun' | 'yuva';
  shikshak_id: string | null;
  academic_year: string | null;
  status: string;
  capacity: number;
  language_preference: string | null;
  created_at: string;
}

export interface TimetableSlot {
  date: string;
  start_time: string;
  end_time: string;
  is_holiday?: boolean;
  holiday_name?: string;
}

export const centresApi = {
  async list(): Promise<{ items: CentreDto[] }> {
    return unwrap<{ items: CentreDto[] }>(api.get('/v1/centres'));
  },

  async getById(centreId: string): Promise<CentreDto> {
    return unwrap<CentreDto>(api.get(`/v1/centres/${centreId}`));
  },

  async batches(centreId: string): Promise<{ items: BatchDto[] }> {
    return unwrap<{ items: BatchDto[] }>(api.get(`/v1/centres/${centreId}/batches`));
  },
};

export const batchesApi = {
  async getById(batchId: string): Promise<BatchDto> {
    return unwrap<BatchDto>(api.get(`/v1/batches/${batchId}`));
  },

  async timetable(batchId: string, weeks = 8): Promise<{ weeks: number; slots: TimetableSlot[] }> {
    return unwrap<{ weeks: number; slots: TimetableSlot[] }>(
      api.get(`/v1/batches/${batchId}/timetable`, { params: { weeks } }),
    );
  },
};
