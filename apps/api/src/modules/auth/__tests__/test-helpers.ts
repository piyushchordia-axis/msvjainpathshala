/**
 * Test helpers — boot a real NestJS app + supertest agent + utilities that
 * cooperate with the production code paths (no mocks, no shortcuts).
 *
 * Each test grabs a unique phone number from `nextTestPhone()` so concurrent
 * (or rerun) tests don't collide on Redis keys / unique users.
 */

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { Logger as PinoNestLogger } from 'nestjs-pino';
import request from 'supertest';

import { AppModule } from '../../../app.module';
import { startTelemetry } from '../../../core/telemetry/telemetry';

export async function bootTestApp() {
  startTelemetry({ serviceName: 'jp-api-test', nodeEnv: 'development' });
  const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false });
  app.useLogger(app.get(PinoNestLogger));
  await app.init();
  return app;
}

let counter = 0;
/** Returns a unique +91 phone like +91900xxxxxxx — disjoint across tests. */
export function nextTestPhone(): string {
  counter++;
  const suffix = (Date.now() % 100000).toString().padStart(5, '0');
  return `+91900${suffix}${counter.toString().padStart(2, '0')}`.slice(0, 13);
}

export function makeAgent(app: Awaited<ReturnType<typeof bootTestApp>>) {
  return request(app.getHttpServer());
}

/**
 * Scrape the OTP for a given phone from the most recent `[OTP]` log line.
 * The ConsoleSmsProvider logs `[OTP] <phone> → <code>` synchronously, so we
 * can intercept the Nest Logger output stream rather than parse a file.
 */
const otpStore = new Map<string, string>();
let _otpHookInstalled = false;

/** Install once — replaces the SMS provider's `sendOtp` with a capture stub. */
export async function captureOtps(_app: Awaited<ReturnType<typeof bootTestApp>>): Promise<void> {
  if (_otpHookInstalled) return;
  // Dynamic import keeps the spec file ESM-clean under unplugin-swc.
  const mod = await import('../providers/console-sms-provider');
  const ConsoleSmsProvider = mod.ConsoleSmsProvider;
  const orig = ConsoleSmsProvider.prototype.sendOtp;
  ConsoleSmsProvider.prototype.sendOtp = async function (phone: string, code: string) {
    otpStore.set(phone, code);
    return orig.call(this, phone, code);
  };
  _otpHookInstalled = true;
}

export function lastOtpFor(phone: string): string | undefined {
  return otpStore.get(phone);
}

export function clearOtpFor(phone: string): void {
  otpStore.delete(phone);
}

/** Helper to scrub Redis keys for a phone — used in beforeEach for OTP tests. */
export async function resetRedisForPhone(redis: Redis, phone: string): Promise<void> {
  const keys = [
    `jp:test:otp:${phone}`,
    `jp:test:otp:attempts:${phone}`,
    `jp:test:otp:rl:phone:m1:${phone}`,
    `jp:test:otp:rl:phone:h1:${phone}`,
  ];
  if (keys.length > 0) {
    // Use raw keys (with prefix already included). The Redis client itself is
    // prefixed but we're constructing the full key here for clarity.
    await Promise.all(keys.map((k) => redis.del(k.replace('jp:test:', ''))));
  }
}
