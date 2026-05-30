/**
 * Service-request endpoint wrappers (SPEC §6.19) used by the parent
 * "Help & support" screens. Mirrors apps/api/src/modules/service-requests/*.
 *
 *   POST /v1/service-requests              create
 *   GET  /v1/service-requests              list own
 *   GET  /v1/service-requests/:id/messages thread
 */

import { api, unwrap } from '../client';

export type ServiceRequestStatus = 'submitted' | 'in_review' | 'resolved';

export interface ServiceRequestRow {
  id: string;
  parent_user_id: string;
  student_id: string | null;
  category: string;
  description: string;
  status: ServiceRequestStatus;
  assigned_to_user_id: string | null;
  centre_id: string;
  city_id: string;
  last_response_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceRequestMessageRow {
  id: string;
  request_id: string;
  author_user_id: string;
  message: string;
  created_at: string;
}

export interface CreateServiceRequestInput {
  category: string;
  description: string;
  student_id?: string;
}

export const serviceRequestsApi = {
  async create(input: CreateServiceRequestInput): Promise<ServiceRequestRow> {
    return unwrap<ServiceRequestRow>(api.post('/v1/service-requests', input));
  },

  async listMine(opts: { limit?: number; offset?: number } = {}): Promise<{
    items: ServiceRequestRow[];
  }> {
    return unwrap<{ items: ServiceRequestRow[] }>(
      api.get('/v1/service-requests', { params: opts }),
    );
  },

  async listMessages(requestId: string): Promise<{ items: ServiceRequestMessageRow[] }> {
    return unwrap<{ items: ServiceRequestMessageRow[] }>(
      api.get(`/v1/service-requests/${requestId}/messages`),
    );
  },
};
