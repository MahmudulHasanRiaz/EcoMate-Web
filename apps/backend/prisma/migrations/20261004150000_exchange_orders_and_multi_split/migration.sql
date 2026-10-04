-- Exchange Orders + multiple Splits (RTN) per original order.
--
-- Two independent changes:
--   1. OrderKind gains EXCHANGE, plus the lineage/settlement columns an
--      exchange needs, plus payment-credit and refund-traceability columns.
--   2. Order.returnOfOrderId loses its plain UNIQUE constraint so one original
--      may accumulate several RTNs. The invariant that must survive is "at most
--      one OPEN (not yet Returned) RTN per original", which is re-expressed as a
--      PARTIAL unique index below.

-- ── AlterEnum ────────────────────────────────────────────────────────────
-- Additive only. `IF NOT EXISTS` keeps the migration re-runnable, and Postgres
-- allows adding enum values without a table rewrite.
ALTER TYPE "OrderKind" ADD VALUE IF NOT EXISTS 'EXCHANGE';

-- ── Order: exchange lineage + settlement ─────────────────────────────────
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "exchangeOfOrderId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "exchangedCreditAmount" DECIMAL(10,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "settlementStatus" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "settlementDelta" DECIMAL(10,2);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "settlementSettledAt" TIMESTAMP(3);

ALTER TABLE "Order" ADD CONSTRAINT "Order_exchangeOfOrderId_fkey"
  FOREIGN KEY ("exchangeOfOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Order_exchangeOfOrderId_idx" ON "Order"("exchangeOfOrderId");

-- ── Payment: carried-over credit linkage (exchange settlement) ───────────
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "sourceOrderId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "appliedCreditAmount" DECIMAL(10,2);

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourceOrderId_fkey"
  FOREIGN KEY ("sourceOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Payment_sourceOrderId_idx" ON "Payment"("sourceOrderId");

-- ── Refund: traceability back to the exchange + the exact payment ─────────
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "exchangeOrderId" TEXT;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "sourcePaymentId" TEXT;

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_exchangeOrderId_fkey"
  FOREIGN KEY ("exchangeOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Refund" ADD CONSTRAINT "Refund_sourcePaymentId_fkey"
  FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Refund_exchangeOrderId_idx" ON "Refund"("exchangeOrderId");

-- ── Multiple RTNs per original ───────────────────────────────────────────
-- Drop the blanket unique. Safe by construction: any existing order already has
-- at most one RTN, so no row can violate the partial index created below.
DROP INDEX IF EXISTS "Order_returnOfOrderId_key";

-- The real invariant, now expressible: one original may have several RTNs over
-- its life, but only while they are OPEN. `returnedAt IS NULL` means "this RTN
-- has not been received yet", so a closed RTN frees the original for a re-split.
CREATE UNIQUE INDEX IF NOT EXISTS "Order_returnOfOrderId_open_key"
  ON "Order"("returnOfOrderId")
  WHERE "returnOfOrderId" IS NOT NULL AND "returnedAt" IS NULL;

-- ── Rollback ─────────────────────────────────────────────────────────────
-- Reverse order:
--   DROP INDEX "Order_returnOfOrderId_open_key";
--   CREATE UNIQUE INDEX "Order_returnOfOrderId_key" ON "Order"("returnOfOrderId");
--     -- fails if any original has accumulated >1 RTN; collapse those first.
--   DROP INDEX "Refund_exchangeOrderId_idx";
--   ALTER TABLE "Refund" DROP CONSTRAINT "Refund_sourcePaymentId_fkey",
--                          DROP CONSTRAINT "Refund_exchangeOrderId_fkey",
--                          DROP COLUMN "sourcePaymentId",
--                          DROP COLUMN "exchangeOrderId";
--   DROP INDEX "Payment_sourceOrderId_idx";
--   ALTER TABLE "Payment" DROP CONSTRAINT "Payment_sourceOrderId_fkey",
--                          DROP COLUMN "appliedCreditAmount",
--                          DROP COLUMN "sourceOrderId";
--   DROP INDEX "Order_exchangeOfOrderId_idx";
--   ALTER TABLE "Order" DROP CONSTRAINT "Order_exchangeOfOrderId_fkey",
--                        DROP COLUMN "settlementSettledAt",
--                        DROP COLUMN "settlementDelta",
--                        DROP COLUMN "settlementStatus",
--                        DROP COLUMN "exchangedCreditAmount",
--                        DROP COLUMN "exchangeOfOrderId";
--   -- Removing an enum value is not supported in Postgres < 12 and is not
--   -- supported at all by Prisma; keep EXCHANGE in place and stop writing it.