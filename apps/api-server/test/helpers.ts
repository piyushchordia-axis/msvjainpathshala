/**
 * Shared test helpers. Module test files import these to authenticate as a
 * seeded persona and hit the API via supertest against the imported app.
 */
import request from "supertest";
import app from "../src/app";

/** Seeded login phones (OTP 123456 for all — see lib/db/src/seed.ts). */
export const SEED_PHONES = {
  super_admin: "+919800000001",
  state_admin: "+919800000002",
  city_admin: "+919800000003",
  sanchalak: "+919800000004",
  shikshak: "+919800000005",
  parent: "+919800000006",
  student: "+919800000007",
} as const;

export type SeedRole = keyof typeof SEED_PHONES;

export interface Session {
  token: string;
  user: { id: string; role: string; full_name?: string; phone?: string };
}

/** Complete the OTP send+verify flow for a seeded phone; return token + user. */
export async function loginAs(role: SeedRole): Promise<Session> {
  const phone = SEED_PHONES[role];
  const send = await request(app).post("/api/auth/login").send({ phase: "send", phone });
  if (send.status !== 200) {
    throw new Error(`login send failed for ${role}: ${send.status} ${JSON.stringify(send.body)}`);
  }
  const otpToken: string = send.body.data.otp_token;
  const code: string = send.body.data.dev_code ?? "123456";
  const verify = await request(app)
    .post("/api/auth/login")
    .send({ phase: "verify", otp_token: otpToken, code, device_id: `test-${role}` });
  if (verify.status !== 200) {
    throw new Error(`login verify failed for ${role}: ${verify.status} ${JSON.stringify(verify.body)}`);
  }
  return { token: verify.body.data.tokens.access_token, user: verify.body.data.user };
}

/** Authorization header for a session token. */
export function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
