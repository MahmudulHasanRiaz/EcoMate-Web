-- Per-order technical + attribution context, frozen at creation.
--
-- Two gaps this closes:
--   1. The customer IP was read on every order-create request but only ever used
--      transiently for block checks and Redis rate limiting — nothing durable.
--      Same for the user-agent. Both are now recorded on the order itself (the
--      customer row only ever held a mutable "last seen" IP).
--   2. Raw landing signals (utm_*, platform click ids, referrer, landing url)
--      lived only in the journey session, so they were lost whenever a session
--      was never captured, was later overwritten, or produced no campaign match.
--      `attribution` is the order's own immutable copy, written once at creation.
--
-- Additive only: three nullable columns + one index. Existing rows stay NULL,
-- which reads as "this order predates the capture" — no backfill possible, the
-- data was never stored anywhere else.
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "attribution" JSONB;

-- Duplicate/fraud review looks orders up by IP.
CREATE INDEX IF NOT EXISTS "Order_ipAddress_idx" ON "Order"("ipAddress");
