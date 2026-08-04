-- SPEC 8.9: store exam access codes as argon2id hashes; record verification time.
-- Existing plaintext exam_otp rows cannot be backfilled (argon2 is one-way) —
-- leave exam_otp_hash NULL and accept legacy plaintext for one release.

ALTER TABLE "online_exams" ADD COLUMN IF NOT EXISTS "exam_otp_hash" text;

ALTER TABLE "exam_attempts" ADD COLUMN IF NOT EXISTS "otp_verified_at" timestamptz;
