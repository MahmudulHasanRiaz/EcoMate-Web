-- Migration: add_provider_payment_id
-- Adds providerPaymentId column and composite unique constraint for atomic idempotency

-- Add nullable unique providerPaymentId column for bKash paymentID binding
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerPaymentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_providerPaymentId_key" ON "Payment"("providerPaymentId");

-- Add composite unique constraint for gateway transaction idempotency
-- Null transactionIds are excluded from uniqueness (pg treats NULLs as distinct)
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_transactionId_gatewayCode_key" ON "Payment"("transactionId", "gatewayCode");
