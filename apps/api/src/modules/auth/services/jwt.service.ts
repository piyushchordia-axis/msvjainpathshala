/**
 * JwtService — RS256 sign + verify with key rotation grace window.
 *
 *   • Loads PRIVATE_KEY + PUBLIC_KEY (and optional PREV_PUBLIC_KEY) from env.
 *   • If running NODE_ENV=development and the env keys are empty, generates
 *     an ephemeral RSA-2048 keypair at module init (dev-only convenience —
 *     logs a clear warning). Production fails-fast via the Zod schema.
 *   • Signs with `kid` derived from the public-key thumbprint.
 *   • Verifies against current + previous public keys (24h rotation grace
 *     per SPEC §7.2).
 */

import { generateKeyPairSync, createHash } from 'node:crypto';

import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type JWTPayload, type KeyLike } from 'jose';

import { AppConfigService } from '../../../core/config/app-config.service';

import type { Role, ScopeContext } from '@jp/shared';

export type ViewContext = 'parent' | { kind: 'student'; student_id: string };

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  role: Role;
  scope: { city_id?: string; centre_ids?: string[]; batch_ids?: string[] };
  view_context: 'parent' | 'student';
  view_student_id?: string;
  device_session_id: string;
  impersonator_id?: string;
  is_impersonation?: boolean;
}

export interface RefreshTokenClaims extends JWTPayload {
  sub: string;
  device_session_id: string;
  family_id: string;
  jti: string;
  /** Tag distinguishes refresh tokens from access tokens during verify. */
  tkn: 'refresh';
}

@Injectable()
export class JwtService implements OnModuleInit {
  private readonly logger = new Logger(JwtService.name);

  private privateKey!: KeyLike;
  private currentPublicKey!: KeyLike;
  private previousPublicKey: KeyLike | null = null;
  /** Stable identifier (SHA-256 over the SPKI DER) of the current public key. */
  private currentKid!: string;
  private previousKid: string | null = null;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly config: AppConfigService) {
    this.issuer = config.jwt.issuer;
    this.audience = config.jwt.audience;
  }

  async onModuleInit(): Promise<void> {
    const { privateKeyPem, publicKeyPem, previousPublicKeyPem } = this.config.jwt;

    if (privateKeyPem && publicKeyPem) {
      this.privateKey = await importPKCS8(privateKeyPem, 'RS256');
      this.currentPublicKey = await importSPKI(publicKeyPem, 'RS256');
      this.currentKid = this.kidFromPem(publicKeyPem);

      if (previousPublicKeyPem) {
        this.previousPublicKey = await importSPKI(previousPublicKeyPem, 'RS256');
        this.previousKid = this.kidFromPem(previousPublicKeyPem);
      }
      return;
    }

    // Production has already failed at the Zod superRefine — we only reach
    // this branch in dev/test with empty PEM env vars.
    if (this.config.isProduction) {
      throw new Error(
        '[JwtService] JWT_PRIVATE_KEY_PEM and JWT_PUBLIC_KEY_PEM are required in production',
      );
    }

    this.logger.warn(
      'dev-only: generating an ephemeral RSA-2048 keypair for JWTs. ' +
        'A restart invalidates every issued token. Set JWT_PRIVATE_KEY_PEM + ' +
        'JWT_PUBLIC_KEY_PEM to a stable pair to persist tokens across reboots.',
    );

    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    this.privateKey = await importPKCS8(privateKey, 'RS256');
    this.currentPublicKey = await importSPKI(publicKey, 'RS256');
    this.currentKid = this.kidFromPem(publicKey);
  }

  // -------------------------------------------------------------------------
  // Signing
  // -------------------------------------------------------------------------

  async signAccess(
    payload: Omit<AccessTokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>,
    ttlSeconds: number,
  ): Promise<string> {
    return new SignJWT(payload as JWTPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.currentKid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.privateKey);
  }

  async signRefresh(
    payload: Omit<RefreshTokenClaims, 'iat' | 'exp' | 'iss' | 'aud'>,
    ttlSeconds: number,
  ): Promise<string> {
    return new SignJWT(payload as JWTPayload)
      .setProtectedHeader({ alg: 'RS256', kid: this.currentKid, typ: 'JWT' })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.privateKey);
  }

  // -------------------------------------------------------------------------
  // Verification (tries current key, then previous during rotation window)
  // -------------------------------------------------------------------------

  async verifyAccess(token: string): Promise<AccessTokenClaims> {
    return this.verify<AccessTokenClaims>(token);
  }

  async verifyRefresh(token: string): Promise<RefreshTokenClaims> {
    const claims = await this.verify<RefreshTokenClaims>(token);
    if (claims.tkn !== 'refresh') {
      throw new Error('Token is not a refresh token');
    }
    return claims;
  }

  private async verify<T extends JWTPayload>(token: string): Promise<T> {
    try {
      const { payload } = await jwtVerify(token, this.currentPublicKey, {
        issuer: this.issuer,
        audience: this.audience,
      });
      return payload as T;
    } catch (err) {
      if (this.previousPublicKey) {
        const { payload } = await jwtVerify(token, this.previousPublicKey, {
          issuer: this.issuer,
          audience: this.audience,
        });
        return payload as T;
      }
      throw err;
    }
  }

  /** Build the scope claim from a ScopeContext (used by AuthController). */
  scopeClaim(
    ctx: Pick<ScopeContext, 'city_id' | 'centre_ids' | 'batch_ids'>,
  ): AccessTokenClaims['scope'] {
    const scope: AccessTokenClaims['scope'] = {};
    if (ctx.city_id) scope.city_id = ctx.city_id;
    if (ctx.centre_ids && ctx.centre_ids.length > 0) scope.centre_ids = ctx.centre_ids;
    if (ctx.batch_ids && ctx.batch_ids.length > 0) scope.batch_ids = ctx.batch_ids;
    return scope;
  }

  private kidFromPem(pem: string): string {
    return createHash('sha256').update(pem).digest('hex').slice(0, 16);
  }
}
