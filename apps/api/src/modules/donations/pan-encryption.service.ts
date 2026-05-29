/**
 * AES-256-GCM PAN encryption (SPEC §16.7 + §16.2 "sensitive exposure").
 *
 * Donor PAN is PII and gets encrypted at the application layer before it
 * touches Postgres. We use AES-256-GCM because it provides authenticated
 * encryption — tampering or wrong-key decrypt fails loudly rather than
 * returning garbage. In production, the 32-byte key is hydrated from
 * AWS KMS via Secrets Manager (CLAUDE.md "Encryption" + "Secrets
 * Management"). In dev / test, a deterministic key is derived from a
 * placeholder so local flows work without KMS.
 *
 * Encrypted ciphertext format (returned as a single string):
 *   "v1:" + base64(iv (12 bytes) | ciphertext | authTag (16 bytes))
 *
 * The "v1:" prefix exists so we can rotate the key / algo in future without
 * breaking already-stored ciphertext (we just add a "v2:" branch).
 *
 * The PAN hash is a separate, deterministic SHA-256 over the uppercased
 * PAN string — used for donor de-dup lookups in `donor_profiles.pan_hash`.
 * Hash is fast and never reverses; the encrypted value is the only way to
 * recover the PAN text for 80G certificates.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../core/config/app-config.service';

const PREFIX = 'v1:';
const IV_LEN = 12; // AES-GCM canonical IV length
const TAG_LEN = 16;

@Injectable()
export class PanEncryptionService {
  private readonly logger = new Logger(PanEncryptionService.name);
  private readonly key: Buffer;

  constructor(cfg: AppConfigService) {
    const hex = cfg.panEncryptionKeyHex;
    if (hex && /^[0-9a-fA-F]{64}$/.test(hex)) {
      this.key = Buffer.from(hex, 'hex');
    } else if (cfg.isProduction) {
      throw new Error(
        '[PanEncryption] DONATION_PAN_ENCRYPTION_KEY_HEX must be a 64-char hex string in production',
      );
    } else {
      // Deterministic dev/test key — scrypt over a fixed label. NEVER use
      // this in production; the env-schema guard prevents that.
      this.key = scryptSync('jp-dev-pan-encryption', 'jp-pan-salt', 32);
      this.logger.warn(
        'Using DEV-only PAN encryption key. Set DONATION_PAN_ENCRYPTION_KEY_HEX before staging/prod.',
      );
    }
  }

  /**
   * Encrypt a PAN. Returns the prefixed base64 ciphertext, or null when
   * the input is empty (we never store an empty ciphertext — PAN is
   * optional on donations).
   */
  encryptPan(pan: string | null | undefined): string | null {
    if (!pan) return null;
    const upper = pan.trim().toUpperCase();
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(upper)) {
      throw new Error(
        '[PanEncryption] Invalid PAN format (must be 5 letters + 4 digits + 1 letter)',
      );
    }
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(upper, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + Buffer.concat([iv, enc, tag]).toString('base64');
  }

  /**
   * Decrypt a stored PAN ciphertext. Returns the plaintext upper-cased.
   * Throws on tampered ciphertext or wrong-key.
   */
  decryptPan(ciphertext: string | null | undefined): string | null {
    if (!ciphertext) return null;
    if (!ciphertext.startsWith(PREFIX)) {
      throw new Error('[PanEncryption] Unknown ciphertext version');
    }
    const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN + 1) {
      throw new Error('[PanEncryption] Ciphertext truncated');
    }
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(buf.length - TAG_LEN);
    const data = buf.subarray(IV_LEN, buf.length - TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(data), decipher.final()]);
    return dec.toString('utf8');
  }

  /**
   * Deterministic PAN hash for donor lookup. The hash is SHA-256 over the
   * uppercased PAN with a project-wide pepper from the encryption key — the
   * pepper means an attacker who steals only the `pan_hash` column still
   * can't brute-force PANs offline without the key.
   */
  hashPan(pan: string): string {
    const upper = pan.trim().toUpperCase();
    return createHash('sha256').update(this.key).update(':pan:').update(upper).digest('hex');
  }

  /**
   * Mask a PAN to "XXXXX####X" for display purposes. Never logs the raw
   * PAN — pair with `decryptPan()` in the receipt-generation worker only.
   */
  maskPan(pan: string): string {
    const upper = pan.trim().toUpperCase();
    if (upper.length !== 10) return 'XXXXXXXXXX';
    return `${'X'.repeat(5)}${upper.slice(5, 9)}${upper.slice(9, 10)}`;
  }
}
