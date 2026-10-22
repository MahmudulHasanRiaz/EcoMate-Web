-- Rollback for 20261022100000_gateway_account_identity.
-- Drops only the additive bridge columns + constraints; legacy strings stay.

ALTER TABLE "PayrollPayment" DROP CONSTRAINT IF EXISTS "PayrollPayment_accountId_fkey";
ALTER TABLE "SupplierPayment" DROP CONSTRAINT IF EXISTS "SupplierPayment_accountId_fkey";
ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_accountId_fkey";
ALTER TABLE "PaymentGateway" DROP CONSTRAINT IF EXISTS "PaymentGateway_accountId_fkey";

DROP INDEX IF EXISTS "PayrollPayment_accountId_idx";
DROP INDEX IF EXISTS "SupplierPayment_accountId_idx";
DROP INDEX IF EXISTS "Payment_accountId_idx";
DROP INDEX IF EXISTS "PaymentGateway_accountId_idx";

ALTER TABLE "PayrollPayment" DROP COLUMN IF EXISTS "accountId";
ALTER TABLE "SupplierPayment" DROP COLUMN IF EXISTS "accountId";
ALTER TABLE "Payment" DROP COLUMN IF EXISTS "accountId";
ALTER TABLE "PaymentGateway" DROP COLUMN IF EXISTS "accountId";
