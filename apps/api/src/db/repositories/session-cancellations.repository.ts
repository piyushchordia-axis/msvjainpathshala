/**
 * SessionCancellationsRepository — append-only audit trail of cancellations.
 *
 * The cancellation reason ALSO lives on `sessions.cancellation_reason` for
 * fast retrieval; this table keeps the full history if a session is
 * cancelled and reopened (rare, but possible via super_admin).
 */

import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DrizzleService } from '../../core/database/drizzle.service';
import { session_cancellations } from '../schema';

import type { NewSessionCancellation, SessionCancellation } from '../schema';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

type Tx = Pick<PostgresJsDatabase, 'select' | 'insert' | 'update' | 'delete'>;

@Injectable()
export class SessionCancellationsRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  async insert(input: NewSessionCancellation, tx?: Tx): Promise<SessionCancellation> {
    const runner = (tx ?? this.drizzle.db) as Tx;
    const [row] = await runner.insert(session_cancellations).values(input).returning();
    if (!row) throw new Error('[SessionCancellations.insert] insert returned no row');
    return row;
  }

  async listForSession(sessionId: string): Promise<SessionCancellation[]> {
    return this.drizzle.dbRead
      .select()
      .from(session_cancellations)
      .where(eq(session_cancellations.session_id, sessionId));
  }
}
