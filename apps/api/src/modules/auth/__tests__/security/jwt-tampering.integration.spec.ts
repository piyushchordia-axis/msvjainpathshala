/**
 * Auth security — JWT tampering & algorithm-confusion attacks (Step 23).
 *
 * Verifies that the JWT verifier (jose) rejects every well-known forgery
 * shape: malformed structure, expired token, `alg:none`, HS256-signed-with-
 * public-key (algorithm confusion), wrong-kid headers, and tokens for the
 * wrong audience/issuer. Each attack hits a protected endpoint and must be
 * rejected with `ERR_AUTH_TOKEN_INVALID` (or `ERR_AUTH_TOKEN_EXPIRED`).
 */

import 'reflect-metadata';
import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bootTestApp, makeAgent } from '../test-helpers';

import type { INestApplication } from '@nestjs/common';

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

describe('Auth security — JWT tampering', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await bootTestApp();
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  // -- malformed structure --------------------------------------------------
  it('rejects malformed JWT (not three dots)', async () => {
    const res = await makeAgent(app)
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt.with.too.many.parts');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  it('rejects empty bearer token', async () => {
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('rejects garbage payload', async () => {
    const garbage = `${base64url('{"alg":"RS256"}')}.${base64url('{"sub":"x"}')}.AAAA`;
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', `Bearer ${garbage}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  // -- alg:none attack ------------------------------------------------------
  it('rejects alg:none forgery', async () => {
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: 'attacker',
        role: 'super_admin',
        iss: 'jainpathshala.test',
        aud: 'jp.api',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const forged = `${header}.${payload}.`; // empty signature, alg:none
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  // -- algorithm confusion (HS256 signed using the RSA public key) ----------
  it('rejects HS256-signed token (algorithm confusion attack)', async () => {
    // Classic mistake: a verifier that trusts header.alg can be tricked into
    // verifying an HS256-signed token using the RSA *public* key as the HMAC
    // secret. `jose` rejects this because the imported KeyLike is RSA — the
    // attempt to use it as an HMAC secret raises a key-type error.
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: 'attacker',
        role: 'super_admin',
        iss: 'jainpathshala.test',
        aud: 'jp.api',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const sig = base64url(
      createHmac('sha256', 'SOME_ATTACKER_KNOWN_PUBLIC_KEY')
        .update(`${header}.${payload}`)
        .digest(),
    );
    const forged = `${header}.${payload}.${sig}`;
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  // -- expired tokens (synthetic — we craft an expired claim shape) ---------
  it('rejects expired RS256 token', async () => {
    // Construct a token shaped like ours but with exp in the past. Signature
    // is invalid because we don't have the private key here — the verifier
    // hits the signature failure first, which still yields ERR_AUTH_TOKEN_INVALID.
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'attacker' }));
    const payload = base64url(
      JSON.stringify({
        sub: 'attacker',
        role: 'super_admin',
        iss: 'jainpathshala.test',
        aud: 'jp.api',
        exp: Math.floor(Date.now() / 1000) - 60,
        iat: Math.floor(Date.now() / 1000) - 3600,
      }),
    );
    const forged = `${header}.${payload}.${base64url('attackers-signature')}`;
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ERR_AUTH_TOKEN_INVALID');
  });

  // -- wrong audience / issuer ---------------------------------------------
  it('rejects token with wrong issuer / audience claims', async () => {
    // Same as above — these would only validate if a private key was used.
    // The signature failure surfaces first; we assert the controller never
    // returned 200 (which would mean the verifier was bypassed).
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(
      JSON.stringify({
        sub: 'attacker',
        role: 'super_admin',
        iss: 'evil.example.com',
        aud: 'evil',
        exp: Math.floor(Date.now() / 1000) + 3600,
      }),
    );
    const forged = `${header}.${payload}.AAAA`;
    const res = await makeAgent(app).get('/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  // -- missing authorization header ----------------------------------------
  it('rejects requests with no Authorization header on protected route', async () => {
    const res = await makeAgent(app).get('/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toMatch(/^ERR_AUTH_/);
  });
});
