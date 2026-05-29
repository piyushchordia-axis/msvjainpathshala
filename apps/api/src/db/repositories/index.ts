/**
 * Repositories barrel — feature modules (Step 5+) import from here.
 *
 * Additional repositories land per-module as their steps build:
 *   - StudentsRepository, EnrolmentsRepository, MsvEnrolmentsRepository  → Step 7
 *   - AttendanceRepository, SessionsRepository                            → Step 8
 *   - NiyamSubmissionsRepository, NiyamStreaksRepository                  → Step 9
 *   - …
 */

export { AbsenceNotificationsRepository } from './absence-notifications.repository';
export { AnalyticsRepository } from './analytics.repository';
export { AttendanceRepository } from './attendance.repository';
export { BatchesRepository } from './batches.repository';
export { CentreHolidaysRepository } from './centre-holidays.repository';
export { CentresRepository } from './centres.repository';
export { CompetitionRegistrationsRepository } from './competition-registrations.repository';
export { CompetitionsRepository } from './competitions.repository';
export { CurriculumRepository } from './curriculum.repository';
export { DeviceSessionsRepository } from './device-sessions.repository';
export { DeviceTokensRepository } from './device-tokens.repository';
export { DonationsRepository } from './donations.repository';
export { EnrolmentsRepository } from './enrolments.repository';
export { ExamsRepository } from './exams.repository';
export { ExportJobsRepository } from './export-jobs.repository';
export { FormConfigsRepository } from './form-configs.repository';
export { GalleryItemsRepository } from './gallery-items.repository';
export { GeographyRepository } from './geography.repository';
export { HomeworkAssignmentsRepository } from './homework-assignments.repository';
export { HomeworkSubmissionsRepository } from './homework-submissions.repository';
export { LibraryRepository } from './library.repository';
export { MediaAssetsRepository } from './media-assets.repository';
export { MsvEnrolmentsRepository } from './msv-enrolments.repository';
export { NiyamsRepository } from './niyams.repository';
export { NiyamStreaksRepository } from './niyam-streaks.repository';
export { NiyamSubmissionsRepository } from './niyam-submissions.repository';
export { NoticeReadsRepository } from './notice-reads.repository';
export { NoticesRepository } from './notices.repository';
export { NotificationsRepository } from './notifications.repository';
export { PhoneOtpAttemptsRepository } from './phone-otp-attempts.repository';
export { PlatformSettingsRepository } from './platform-settings.repository';
export { ProgressReportsRepository } from './progress-reports.repository';
export { PunyaFeaturesRepository } from './punya-features.repository';
export { PunyaTransactionsRepository } from './punya-transactions.repository';
export { PushQuizzesRepository } from './push-quizzes.repository';
export type { PushQuizAnswerRecord } from './push-quizzes.repository';
export { QuestionsRepository, type AiJobStatus, type AiReviewStatus } from './questions.repository';
export { QuizEventsRepository } from './quiz-events.repository';
export { RefreshTokenFamiliesRepository } from './refresh-token-families.repository';
export { SanchalakAssignmentsRepository } from './sanchalak-assignments.repository';
export { ServiceRequestsRepository } from './service-requests.repository';
export { SessionCancellationsRepository } from './session-cancellations.repository';
export { SessionsRepository } from './sessions.repository';
export { ShikshakAssignmentsRepository } from './shikshak-assignments.repository';
export { ShivirsRepository } from './shivirs.repository';
export { SmsLogsRepository } from './sms-logs.repository';
export { StudentNotesRepository } from './student-notes.repository';
export { StudentsRepository } from './students.repository';
export { SyncOperationsRepository } from './sync-operations.repository';
export { SystemConfigRepository } from './system-config.repository';
export { UsersRepository } from './users.repository';
