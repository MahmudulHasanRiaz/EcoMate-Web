-- Central Commerce P7 — Order status push (§8.6, BR-17).
-- Additive only: ONE nullable column on StoreOrderMapping. Idempotency key
-- for status push — a repeat run with the same canonical target
-- ('cancelled' | 'completed') no-ops without a provider call. NULL = never
-- pushed. Written only by StoreOrderPushService after read-back verification.
-- No drops, no renames, no index changes.

-- AlterTable
ALTER TABLE "StoreOrderMapping" ADD COLUMN "lastPushedStatus" TEXT;
