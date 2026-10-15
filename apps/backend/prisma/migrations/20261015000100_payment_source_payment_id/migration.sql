-- MED transfer leg: Payment.sourcePaymentId (largest PAID row of the original, null when none).
--
-- ADD ONLY — new nullable column + self-FK (SET NULL) + index. No existing
-- column, constraint, or index is touched, so old rows + old code keep working
-- and the migration is safe on redeploy. Schema wiring (Payment.sourcePaymentId
-- + PaymentSourcePayment self-relation) ships in the SAME worktree.

ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "sourcePaymentId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Payment_sourcePaymentId_fkey'
  ) THEN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_sourcePaymentId_fkey"
      FOREIGN KEY ("sourcePaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Payment_sourcePaymentId_idx" ON "Payment"("sourcePaymentId");
