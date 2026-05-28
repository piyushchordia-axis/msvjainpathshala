/**
 * SyncModule — registers `/v1/sync/*` (Step 14).
 *
 * The op-handler registry is provided as a multi-class array bound to the
 * `SYNC_OP_HANDLERS` token. `SyncService` consumes the array in its
 * constructor and builds a `Map<op_kind, handler>` from it. Adding a new
 * handler in a future step is a two-line change here (register the class as
 * a provider + add to the `useFactory` deps).
 *
 * Today only `attendance.mark` is registered. Future steps add
 * `shivir.scan`, `niyam.submission`, `homework.submission`,
 * `notice.acknowledge`, `notification.read`.
 */

import { Module } from '@nestjs/common';

import {
  BatchesRepository,
  CentresRepository,
  EnrolmentsRepository,
  NotificationsRepository,
  SessionsRepository,
  StudentsRepository,
  SyncOperationsRepository,
  UsersRepository,
} from '../../db/repositories';
import { AttendanceModule } from '../attendance/attendance.module';

import { AttendanceMarkSyncHandler } from './handlers/attendance-mark.handler';
import { SYNC_OP_HANDLERS, type SyncOpHandler } from './handlers/op-handler';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({
  imports: [AttendanceModule],
  controllers: [SyncController],
  providers: [
    SyncService,
    SyncOperationsRepository,
    // Repositories used by bootstrap / delta. These modules already export
    // their *services*; we still want the raw repos for cross-cutting reads.
    UsersRepository,
    StudentsRepository,
    EnrolmentsRepository,
    BatchesRepository,
    CentresRepository,
    SessionsRepository,
    NotificationsRepository,

    // Handler classes
    AttendanceMarkSyncHandler,

    // The registry — collect every concrete handler into a single array.
    {
      provide: SYNC_OP_HANDLERS,
      useFactory: (attendanceMark: AttendanceMarkSyncHandler): SyncOpHandler[] => [attendanceMark],
      inject: [AttendanceMarkSyncHandler],
    },
  ],
  exports: [SyncService],
})
export class SyncModule {}
