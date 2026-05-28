/** `service_request_status_enum` (SPEC §5.1). */
export const SERVICE_REQUEST_STATUSES = ['submitted', 'in_review', 'resolved'] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];
