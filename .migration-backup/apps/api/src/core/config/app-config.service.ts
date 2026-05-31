/**
 * Typed config accessor — wraps the Zod-validated AppEnv with helpers grouped
 * by subsystem. Modules inject this rather than reading process.env directly.
 */

import { Injectable } from '@nestjs/common';

import type { AppEnv } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly env: AppEnv) {}

  // ----- Runtime --------------------------------------------------------
  get nodeEnv(): AppEnv['NODE_ENV'] {
    return this.env.NODE_ENV;
  }
  get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }
  get isDevelopment(): boolean {
    return this.env.NODE_ENV === 'development';
  }
  get port(): number {
    return this.env.PORT;
  }
  get workerHealthPort(): number {
    return this.env.WORKER_HEALTH_PORT;
  }
  get logLevel(): AppEnv['LOG_LEVEL'] {
    return this.env.LOG_LEVEL;
  }
  get serviceName(): string {
    return this.env.OTEL_SERVICE_NAME;
  }
  get appBaseUrl(): string {
    return this.env.APP_BASE_URL;
  }
  get webBaseUrl(): string {
    return this.env.WEB_BASE_URL;
  }

  // ----- Database -------------------------------------------------------
  get database() {
    return {
      url: this.env.DATABASE_URL,
      urlRead: this.env.DATABASE_URL_READ || this.env.DATABASE_URL, // §17.1 fallback
      poolMax: this.env.DATABASE_POOL_MAX,
      poolMin: this.env.DATABASE_POOL_MIN,
      ssl: this.env.DATABASE_SSL,
    };
  }

  // ----- Redis ----------------------------------------------------------
  get redis() {
    return {
      url: this.env.REDIS_URL,
      tls: this.env.REDIS_TLS,
      keyPrefix: this.env.REDIS_KEY_PREFIX,
    };
  }

  // ----- Storage --------------------------------------------------------
  get storage() {
    return {
      driver: this.env.STORAGE_DRIVER,
      region: this.env.S3_REGION,
      endpoint: this.env.S3_ENDPOINT,
      accessKeyId: this.env.S3_ACCESS_KEY_ID,
      secretAccessKey: this.env.S3_SECRET_ACCESS_KEY,
      buckets: {
        private: this.env.S3_BUCKET_PRIVATE,
        public: this.env.S3_BUCKET_PUBLIC,
        exports: this.env.S3_BUCKET_EXPORTS,
        receipts: this.env.S3_BUCKET_RECEIPTS,
      },
      signedUrlTtlSeconds: this.env.SIGNED_URL_TTL_SECONDS,
    };
  }

  // ----- JWT / OTP ------------------------------------------------------
  get jwt() {
    return {
      privateKeyPem: this.env.JWT_PRIVATE_KEY_PEM,
      publicKeyPem: this.env.JWT_PUBLIC_KEY_PEM,
      previousPublicKeyPem: this.env.JWT_PREV_PUBLIC_KEY_PEM,
      accessTtlSeconds: this.env.JWT_ACCESS_TTL_SECONDS,
      refreshTtlSeconds: this.env.JWT_REFRESH_TTL_SECONDS,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
    };
  }

  get otp() {
    return {
      ttlSeconds: this.env.OTP_TTL_SECONDS,
      requestLimitPerHour: this.env.OTP_REQUEST_LIMIT_PER_HOUR,
      requestLimitPerDay: this.env.OTP_REQUEST_LIMIT_PER_DAY,
      maxVerifyAttempts: this.env.OTP_MAX_VERIFY_ATTEMPTS,
      /**
       * Master OTP that any phone can verify with. Honoured ONLY in
       * `NODE_ENV='development'` — the OtpService re-checks the env so
       * a leaked staging/prod env var can't accidentally enable it.
       */
      devMasterOtp: this.env.JP_DEV_MASTER_OTP,
    };
  }

  // ----- Observability --------------------------------------------------
  get observability() {
    return {
      sentryDsn: this.env.SENTRY_DSN,
      otlpEndpoint: this.env.OTEL_EXPORTER_OTLP_ENDPOINT,
      serviceName: this.env.OTEL_SERVICE_NAME,
    };
  }

  // ----- Misc -----------------------------------------------------------
  get corsAllowedOrigins(): string[] {
    return this.env.CORS_ALLOWED_ORIGINS;
  }
  get metricsInternalKey(): string {
    return this.env.METRICS_INTERNAL_KEY;
  }
  get worker() {
    return {
      kind: this.env.WORKER_KIND,
      concurrencyOverride: this.env.WORKER_CONCURRENCY_OVERRIDE,
    };
  }

  // ----- Notifications --------------------------------------------------
  get notifications() {
    return {
      fcm: {
        projectId: this.env.FCM_PROJECT_ID,
        serviceAccountJson: this.env.FCM_SERVICE_ACCOUNT_JSON,
        batchSize: this.env.FCM_BATCH_SIZE,
      },
      sms: {
        authKey: this.env.MSG91_AUTH_KEY,
        senderId: this.env.MSG91_SENDER_ID,
        otpTemplateId: this.env.MSG91_OTP_TEMPLATE_ID,
        noticeTemplateId: this.env.MSG91_NOTICE_TEMPLATE_ID,
        dltEntityId: this.env.MSG91_DLT_ENTITY_ID,
        monthlyCapInr: this.env.SMS_MONTHLY_CAP_INR,
        costPerSegmentPaise: this.env.SMS_COST_PER_SEGMENT_PAISE,
      },
      email: {
        apiKey: this.env.RESEND_API_KEY,
        from: this.env.RESEND_FROM,
      },
    };
  }

  // ----- Socket.IO ------------------------------------------------------
  get socketio() {
    return {
      enabled: this.env.SOCKETIO_ENABLED,
      corsOrigins: this.env.SOCKETIO_CORS_ORIGINS,
    };
  }

  // ----- AI service (Python FastAPI) -----------------------------------
  get aiService() {
    return {
      baseUrl: this.env.AI_SERVICE_BASE_URL,
      hmacSecret: this.env.AI_SERVICE_HMAC_SECRET,
      timeoutMs: this.env.AI_SERVICE_TIMEOUT_MS,
      ipAllowlist: this.env.AI_SERVICE_IP_ALLOWLIST,
    };
  }

  // ----- Razorpay -----------------------------------------------------
  get razorpay() {
    return {
      keyId: this.env.RAZORPAY_KEY_ID,
      keySecret: this.env.RAZORPAY_KEY_SECRET,
      webhookSecret: this.env.RAZORPAY_WEBHOOK_SECRET,
    };
  }

  // ----- PAN encryption ------------------------------------------------
  /**
   * Hex-encoded AES-256-GCM key. Returns null when unset (dev convenience).
   * The encryption service derives a deterministic dev key in that case so
   * tests don't require KMS, but production refuses to boot without it.
   */
  get panEncryptionKeyHex(): string {
    return this.env.DONATION_PAN_ENCRYPTION_KEY_HEX;
  }

  /** Escape hatch for code that genuinely needs the raw shape. Avoid where possible. */
  get raw(): AppEnv {
    return this.env;
  }
}
