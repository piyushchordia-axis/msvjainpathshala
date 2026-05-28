/**
 * Repositories barrel — feature modules (Step 5+) import from here.
 *
 * Additional repositories land per-module as their steps build:
 *   - StudentsRepository, EnrolmentsRepository, MsvEnrolmentsRepository  → Step 7
 *   - AttendanceRepository, SessionsRepository                            → Step 8
 *   - NiyamSubmissionsRepository, NiyamStreaksRepository                  → Step 9
 *   - …
 */

export { BatchesRepository } from './batches.repository';
export { CentreHolidaysRepository } from './centre-holidays.repository';
export { CentresRepository } from './centres.repository';
export { DeviceSessionsRepository } from './device-sessions.repository';
export { EnrolmentsRepository } from './enrolments.repository';
export { FormConfigsRepository } from './form-configs.repository';
export { GeographyRepository } from './geography.repository';
export { MediaAssetsRepository } from './media-assets.repository';
export { MsvEnrolmentsRepository } from './msv-enrolments.repository';
export { PhoneOtpAttemptsRepository } from './phone-otp-attempts.repository';
export { PunyaTransactionsRepository } from './punya-transactions.repository';
export { RefreshTokenFamiliesRepository } from './refresh-token-families.repository';
export { SanchalakAssignmentsRepository } from './sanchalak-assignments.repository';
export { ShikshakAssignmentsRepository } from './shikshak-assignments.repository';
export { StudentsRepository } from './students.repository';
export { SystemConfigRepository } from './system-config.repository';
export { UsersRepository } from './users.repository';
