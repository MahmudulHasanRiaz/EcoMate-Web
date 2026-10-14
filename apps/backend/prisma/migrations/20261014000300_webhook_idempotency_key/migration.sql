-- Task 4 (courier docs audit): webhook Idempotency-Key claim.
--
-- Couriers resend the same event with the same Idempotency-Key header value.
-- Storing the key with UNIQUE(courier, idempotencyKey) turns a replay into a
-- 2xx no-reprocess (P2002 on claim) instead of double-processing.
-- NULL = sender sent no key; Postgres treats NULLs as distinct, so keyless
-- webhooks keep flowing and stay fully auditable as before.
--
-- Expand-only, no data backfill, safe on redeploy.

-- AlterTable
ALTER TABLE "WebhookAttempt" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAttempt_courier_idempotencyKey_key" ON "WebhookAttempt"("courier", "idempotencyKey");
