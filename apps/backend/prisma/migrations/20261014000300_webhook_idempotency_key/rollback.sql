-- Rollback for 20261014000300_webhook_idempotency_key.
-- Drops the idempotency claim (dupes would process twice again); audit rows stay.

DROP INDEX IF EXISTS "WebhookAttempt_courier_idempotencyKey_key";
ALTER TABLE "WebhookAttempt" DROP COLUMN IF EXISTS "idempotencyKey";
