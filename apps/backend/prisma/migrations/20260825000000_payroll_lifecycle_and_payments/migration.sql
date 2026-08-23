-- Phase 4: payroll lifecycle (periodKey unique + backfill) and payroll payments ledger.
-- Requires migration 20260824000000_add_hr_ledgers to be applied first.

-- 1. PayrollPayment table (actual-payment ledger; partial payments allowed).
CREATE TABLE IF NOT EXISTS "PayrollPayment" (
  "id"          TEXT NOT NULL,
  "payslipId"   TEXT NOT NULL,
  "amount"      DECIMAL(10, 2) NOT NULL,
  "paidAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method"      TEXT,
  "referenceNo" TEXT,
  "note"        TEXT,
  "recordedById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PayrollPayment_payslipId_idx" ON "PayrollPayment"("payslipId");

ALTER TABLE "PayrollPayment"
  ADD CONSTRAINT "PayrollPayment_payslipId_fkey"
  FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. Backfill periodKey for any existing rows that predate the lifecycle groundwork.
UPDATE "Payslip" SET "periodKey" = to_char("periodStart", 'YYYY-MM')
  WHERE "periodKey" IS NULL;

-- 3. Unique index per employee per period. Postgres treats NULLs as distinct,
--    so the backfill above guarantees no collisions before this index is built.
CREATE UNIQUE INDEX IF NOT EXISTS "Payslip_employeeId_periodKey_key"
  ON "Payslip"("employeeId", "periodKey");
