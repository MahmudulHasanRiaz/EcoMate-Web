ALTER TABLE "PayrollPayment" ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidedById" TEXT,
ADD COLUMN "voidReason" TEXT;
