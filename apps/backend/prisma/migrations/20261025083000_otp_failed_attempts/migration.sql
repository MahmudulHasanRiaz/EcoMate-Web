-- OTP failed-attempt cap (security 2026-10-25, F23)
ALTER TABLE "VerificationToken" ADD COLUMN "failedAttempts" INTEGER NOT NULL DEFAULT 0;
