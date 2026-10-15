-- Rollback: drop Payment.sourcePaymentId (traceability only, safe to drop).
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_sourcePaymentId_fkey";
DROP INDEX IF EXISTS "Payment_sourcePaymentId_idx";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "sourcePaymentId";
