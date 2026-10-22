-- Strategy A (Phase 1): identity-only gateway → accounting-account bridge.
--
-- Adds four nullable FK columns. No data reads or writes happen here (the
-- backfill is a separate, idempotent migration). `Payment.account` and every
-- method/paymentMethod string stay untouched — they remain legacy display
-- snapshots and are not rewritten in this branch.
--
-- DDL-only, additive and self-healing: IF NOT EXISTS + constraint guards make
-- a re-run a no-op (a previous local attempt can leave some objects behind).

ALTER TABLE "PaymentGateway" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "SupplierPayment" ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "PayrollPayment" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

CREATE INDEX IF NOT EXISTS "PaymentGateway_accountId_idx" ON "PaymentGateway"("accountId");
CREATE INDEX IF NOT EXISTS "Payment_accountId_idx" ON "Payment"("accountId");
CREATE INDEX IF NOT EXISTS "SupplierPayment_accountId_idx" ON "SupplierPayment"("accountId");
CREATE INDEX IF NOT EXISTS "PayrollPayment_accountId_idx" ON "PayrollPayment"("accountId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PaymentGateway_accountId_fkey') THEN
    ALTER TABLE "PaymentGateway"
      ADD CONSTRAINT "PaymentGateway_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Payment_accountId_fkey') THEN
    ALTER TABLE "Payment"
      ADD CONSTRAINT "Payment_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupplierPayment_accountId_fkey') THEN
    ALTER TABLE "SupplierPayment"
      ADD CONSTRAINT "SupplierPayment_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PayrollPayment_accountId_fkey') THEN
    ALTER TABLE "PayrollPayment"
      ADD CONSTRAINT "PayrollPayment_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "Account"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
