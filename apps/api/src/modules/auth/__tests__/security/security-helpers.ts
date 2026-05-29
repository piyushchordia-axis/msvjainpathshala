/**
 * Shared helpers for Step 23 auth security specs.
 *
 * mintAccessToken — uses the live JwtService + a freshly-inserted user +
 *   device_session row so the resulting token passes every guard. We bypass
 *   the OTP flow to keep these tests focused on what they assert (RBAC, IDOR,
 *   token tampering) rather than re-asserting the OTP plumbing.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { DrizzleService } from '../../../../core/database/drizzle.service';
import { SystemConfigService } from '../../../../core/system-config/system-config.service';
import { JwtService } from '../../services/jwt.service';

import type { Role, ScopeContext } from '@jp/shared';
import type { INestApplication } from '@nestjs/common';

export interface MintedActor {
  userId: string;
  deviceSessionId: string;
  accessToken: string;
  bearer: string;
}

const nextSuffix = (() => {
  let n = 0;
  return () => `${Date.now()}${n++}`;
})();

/** Insert a user with the given role and mint an access token. Returns the bearer-ready string. */
export async function mintAccessToken(
  app: INestApplication,
  opts: {
    role: Role;
    scope?: ScopeContext;
    phone?: string;
    fullName?: string;
  },
): Promise<MintedActor> {
  const drizzle = app.get(DrizzleService);
  const config = app.get(SystemConfigService);
  const jwt = app.get(JwtService);

  const phone = opts.phone ?? `+9199${nextSuffix().slice(-9).padStart(9, '0')}`.slice(0, 13);
  const fullName = opts.fullName ?? `Security Test ${nextSuffix()}`;

  const rows = await drizzle.db.execute(sql`
    INSERT INTO users(phone, role, full_name, preferred_language, is_active)
    VALUES (${phone}, ${opts.role}::role_enum, ${fullName}, 'en', true)
    ON CONFLICT (phone) DO UPDATE SET role = EXCLUDED.role
    RETURNING id
  `);
  const userId = (rows as unknown as Array<{ id: string }>)[0]!.id;

  const sessionRows = await drizzle.db.execute(sql`
    INSERT INTO device_sessions(user_id, device_id, platform, refresh_token_hash, expires_at, last_used_at)
    VALUES (${userId}, ${'sec-' + nextSuffix()}, 'ios', 'security-test-placeholder',
            now() + interval '30 days', now())
    RETURNING id
  `);
  const deviceSessionId = (sessionRows as unknown as Array<{ id: string }>)[0]!.id;

  const accessTtl = await config.getNumber('jwt.access_ttl_seconds');
  const access = await jwt.signAccess(
    {
      sub: userId,
      role: opts.role,
      scope: opts.scope ?? {},
      view_context: 'parent',
      device_session_id: deviceSessionId,
      jti: randomUUID(),
    },
    accessTtl,
  );

  return { userId, deviceSessionId, accessToken: access, bearer: `Bearer ${access}` };
}

/** Generate a synthetic state + city + centre + batch for tests that need them. */
export async function seedGeography(app: INestApplication): Promise<{
  cityId: string;
  centreId: string;
  batchId: string;
}> {
  const drizzle = app.get(DrizzleService);
  const suffix = nextSuffix();
  const stateRows = await drizzle.db.execute(sql`
    INSERT INTO states(name, code) VALUES (${'Sec State ' + suffix}, ${'SS' + suffix.slice(-2)})
    RETURNING id
  `);
  const stateId = (stateRows as unknown as Array<{ id: string }>)[0]!.id;
  const cityRows = await drizzle.db.execute(sql`
    INSERT INTO cities(state_id, name, code) VALUES (${stateId}, ${'Sec City ' + suffix}, ${'SC' + suffix.slice(-2)})
    RETURNING id
  `);
  const cityId = (cityRows as unknown as Array<{ id: string }>)[0]!.id;
  const centreRows = await drizzle.db.execute(sql`
    INSERT INTO centres(city_id, name, status) VALUES (${cityId}, ${'Sec Centre ' + suffix}, 'active')
    RETURNING id
  `);
  const centreId = (centreRows as unknown as Array<{ id: string }>)[0]!.id;
  const batchRows = await drizzle.db.execute(sql`
    INSERT INTO batches(centre_id, name, age_group, day_of_week, start_time, end_time, capacity, status)
    VALUES (${centreId}, ${'Sec Batch ' + suffix}, 'bal'::age_group_enum, ARRAY[7]::integer[],
            '09:00', '11:00', 30, 'active')
    RETURNING id
  `);
  const batchId = (batchRows as unknown as Array<{ id: string }>)[0]!.id;
  return { cityId, centreId, batchId };
}

/** Insert a student owned by a given parent user. Returns student id. */
export async function seedStudent(
  app: INestApplication,
  opts: { parentUserId: string; centreId: string },
): Promise<string> {
  const drizzle = app.get(DrizzleService);
  const dob = new Date();
  dob.setFullYear(dob.getFullYear() - 10);
  const dobStr = dob.toISOString().slice(0, 10);
  const rows = await drizzle.db.execute(sql`
    INSERT INTO students(parent_user_id, full_name, dob, age_group, centre_id,
                         student_code, enrolled_at)
    VALUES (${opts.parentUserId}, ${'Sec Child ' + nextSuffix()}, ${dobStr}, 'bal'::age_group_enum,
            ${opts.centreId}, ${'STU-SEC-' + nextSuffix()}, now())
    RETURNING id
  `);
  return (rows as unknown as Array<{ id: string }>)[0]!.id;
}
