/**
 * UsersRepository — thin typed query helpers around the `users` table.
 *
 * Service-layer auth code (Step 5) consumes these methods directly; business
 * logic (rate limiting, role transitions) lives in the auth module, not here.
 *
 * Reads go through `dbRead` (the read replica when one exists per §17.1);
 * writes always go through `db` (the write pool).
 */

import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { type DrizzleService } from '../../core/database/drizzle.service';
import { users } from '../schema';

import type { NewUser, User } from '../schema';

@Injectable()
export class UsersRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /** Lookup by id (excludes soft-deleted). */
  async findById(id: string): Promise<User | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Lookup by phone — primary lookup for OTP auth (excludes soft-deleted). */
  async findByPhone(phone: string): Promise<User | null> {
    const rows = await this.drizzle.dbRead
      .select()
      .from(users)
      .where(and(eq(users.phone, phone), isNull(users.deleted_at)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Insert returning the created row. */
  async create(input: NewUser): Promise<User> {
    const [row] = await this.drizzle.db.insert(users).values(input).returning();
    if (!row) {
      throw new Error('[UsersRepository.create] INSERT … RETURNING produced no row');
    }
    return row;
  }

  /** Record a successful login (used by the JWT-issuance step in Step 5). */
  async updateLastLoginAt(id: string, when: Date): Promise<void> {
    await this.drizzle.db
      .update(users)
      .set({ last_login_at: when, updated_at: when })
      .where(eq(users.id, id));
  }
}
