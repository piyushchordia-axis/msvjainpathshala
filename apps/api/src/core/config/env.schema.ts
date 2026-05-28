/**
 * Zod env schema for apps/api.
 *
 * The schema is the single source of truth for what config the backend needs.
 * Required vars without a `default()` cause the bootstrap to FAIL FAST — no
 * silent fallbacks for security-sensitive fields (CLAUDE.md "Environment
 * variables → fails fast"; SPEC §14.1; Step 3 prompt).
 *
 * Field naming mirrors SPEC §14.1 exactly so a copy-paste from secrets
 * manager works without renaming.
 */

import { z } from 'zod';

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : v.toLowerCase() === 'true'));

const numberFromString = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === 'number' ? v : Number(v)))
  .pipe(z.number());

const csvFromString = z
  .union([z.string(), z.array(z.string())])
  .transform((v) =>
    Array.isArray(v)
      ? v
      : v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
  )
  .pipe(z.array(z.string()));

export const envSchema = z
  .object({
    // ----- Runtime -------------------------------------------------------
    NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: numberFromString.default(3000),
    WORKER_HEALTH_PORT: numberFromString.default(3100),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    TZ: z.string().default('Asia/Kolkata'),
    APP_BASE_URL: z.string().url().default('http://localhost:3000'),
    WEB_BASE_URL: z.string().url().default('http://localhost:3001'),

    // ----- Database -----------------------------------------------------
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_URL_READ: z.string().optional().default(''),
    DATABASE_POOL_MAX: numberFromString.default(20),
    DATABASE_POOL_MIN: numberFromString.default(2),
    DATABASE_SSL: booleanFromString.default(false),

    // ----- Redis --------------------------------------------------------
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    REDIS_TLS: booleanFromString.default(false),
    REDIS_KEY_PREFIX: z.string().default('jp:dev:'),

    // ----- JWT ----------------------------------------------------------
    JWT_PRIVATE_KEY_PEM: z.string().default(''),
    JWT_PUBLIC_KEY_PEM: z.string().default(''),
    JWT_PREV_PUBLIC_KEY_PEM: z.string().default(''),
    JWT_ACCESS_TTL_SECONDS: numberFromString.default(900),
    JWT_REFRESH_TTL_SECONDS: numberFromString.default(2_592_000),
    JWT_ISSUER: z.string().default('jainpathshala.local'),
    JWT_AUDIENCE: z.string().default('jp.api'),

    // ----- OTP ----------------------------------------------------------
    OTP_TTL_SECONDS: numberFromString.default(300),
    OTP_REQUEST_LIMIT_PER_HOUR: numberFromString.default(10),
    OTP_REQUEST_LIMIT_PER_DAY: numberFromString.default(30),
    OTP_MAX_VERIFY_ATTEMPTS: numberFromString.default(5),
    /**
     * Dev-only master OTP. When set AND `NODE_ENV='development'`, any
     * phone can verify with this code. The OtpService ignores it in
     * staging / production. Useful for local QA so you don't have to
     * scrape OTPs from the API log on every test login.
     *
     * Must be 6 digits when set. Empty string disables the feature.
     */
    JP_DEV_MASTER_OTP: z
      .string()
      .regex(/^\d{6}$|^$/, 'JP_DEV_MASTER_OTP must be 6 digits or empty')
      .default(''),

    // ----- Storage ------------------------------------------------------
    STORAGE_DRIVER: z.enum(['noop', 'minio', 'r2', 's3']).default('noop'),
    S3_REGION: z.string().default('us-east-1'),
    S3_ENDPOINT: z.string().default(''),
    S3_ACCESS_KEY_ID: z.string().default(''),
    S3_SECRET_ACCESS_KEY: z.string().default(''),
    S3_BUCKET_PRIVATE: z.string().default(''),
    S3_BUCKET_PUBLIC: z.string().default(''),
    S3_BUCKET_EXPORTS: z.string().default(''),
    S3_BUCKET_RECEIPTS: z.string().default(''),
    S3_CDN_PRIVATE: z.string().default(''),
    S3_CDN_PUBLIC: z.string().default(''),
    SIGNED_URL_TTL_SECONDS: numberFromString.default(3600),

    // ----- Razorpay -----------------------------------------------------
    RAZORPAY_KEY_ID: z.string().default(''),
    RAZORPAY_KEY_SECRET: z.string().default(''),
    RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

    // ----- FCM ----------------------------------------------------------
    FCM_PROJECT_ID: z.string().default(''),
    FCM_SERVICE_ACCOUNT_JSON: z.string().default(''),
    FCM_BATCH_SIZE: numberFromString.default(500),

    // ----- MSG91 --------------------------------------------------------
    MSG91_AUTH_KEY: z.string().default(''),
    MSG91_SENDER_ID: z.string().default('JPMSV'),
    MSG91_OTP_TEMPLATE_ID: z.string().default(''),
    MSG91_NOTICE_TEMPLATE_ID: z.string().default(''),
    MSG91_DLT_ENTITY_ID: z.string().default(''),

    // ----- Resend -------------------------------------------------------
    RESEND_API_KEY: z.string().default(''),
    RESEND_FROM: z.string().default('Jain Pathshala <noreply@jainpathshala.local>'),

    // ----- AI service ---------------------------------------------------
    AI_SERVICE_BASE_URL: z.string().default('http://localhost:8000'),
    AI_SERVICE_HMAC_SECRET: z.string().default(''),
    AI_SERVICE_TIMEOUT_MS: numberFromString.default(30_000),

    // ----- Observability ------------------------------------------------
    SENTRY_DSN: z.string().default(''),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
    OTEL_SERVICE_NAME: z.string().default('jp-api'),

    // ----- Rate limiting ------------------------------------------------
    RATE_LIMIT_ANON_PER_MIN: numberFromString.default(60),
    RATE_LIMIT_AUTH_READ_PER_MIN: numberFromString.default(300),
    RATE_LIMIT_AUTH_WRITE_PER_MIN: numberFromString.default(60),

    // ----- Feature flags ------------------------------------------------
    FEATURE_AI_QUIZ_GENERATION: booleanFromString.default(true),
    FEATURE_VIRUS_SCANNING: booleanFromString.default(false),
    FEATURE_LIVE_SHIVIR_WS: booleanFromString.default(true),
    FEATURE_SCHEDULED_EXAMS: booleanFromString.default(true),

    // ----- CORS / metrics -----------------------------------------------
    CORS_ALLOWED_ORIGINS: csvFromString.default(''),
    METRICS_INTERNAL_KEY: z.string().default(''),

    // ----- Worker -------------------------------------------------------
    WORKER_KIND: z.enum(['all', 'notifications', 'media', 'reports', 'analytics']).default('all'),
    WORKER_CONCURRENCY_OVERRIDE: z.string().default(''),
  })
  // Production-only invariants. Dev / test stay lenient so the app boots
  // without secrets configured (Step 3 is bootstrap-only).
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      const missing: string[] = [];
      if (!env.JWT_PRIVATE_KEY_PEM) missing.push('JWT_PRIVATE_KEY_PEM');
      if (!env.JWT_PUBLIC_KEY_PEM) missing.push('JWT_PUBLIC_KEY_PEM');
      if (env.STORAGE_DRIVER === 'noop')
        missing.push("STORAGE_DRIVER (must not be 'noop' in production)");
      if (!env.SENTRY_DSN) missing.push('SENTRY_DSN');
      for (const m of missing) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [m.split(' ')[0] ?? m],
          message: `${m} is required in production`,
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Parse + validate `process.env`. Throws a single combined error listing every
 * invalid / missing var — so misconfigured deployments fail loudly at boot.
 */
export function loadAndValidateEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '<env>'}: ${i.message}`,
    );
    throw new Error(
      `[apps/api] Environment validation failed:\n${lines.join('\n')}\n\n` +
        'See apps/api/.env.example for the full list of variables.',
    );
  }
  return parsed.data;
}
