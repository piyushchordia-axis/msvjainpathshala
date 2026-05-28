/**
 * Repositories barrel — feature modules (Step 5+) import from here.
 *
 * Additional repositories land per-module:
 *   - CentresRepository, StudentsRepository, EnrolmentsRepository  → Step 6
 *   - AttendanceRepository, SessionsRepository                       → Step 8
 *   - NiyamSubmissionsRepository, NiyamStreaksRepository             → Step 9
 *   - …
 */

export { BatchesRepository } from './batches.repository';
export { PunyaTransactionsRepository } from './punya-transactions.repository';
export { UsersRepository } from './users.repository';
