-- AlterEnum
ALTER TYPE "OrderAttributionMethod" ADD VALUE IF NOT EXISTS 'click_id';

-- AlterEnum
CREATE TYPE "MarketingPaymentStatus" AS ENUM ('pending', 'reconciled', 'needs_review', 'failed');

-- AlterEnum
CREATE TYPE "MarketingFundingType" AS ENUM ('paid', 'promotional');

-- CreateTable: MarketingPayment
CREATE TABLE "MarketingPayment" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "providerPaymentId" TEXT,
    "platformAmount" DECIMAL(14,4) NOT NULL,
    "platformCurrency" TEXT NOT NULL DEFAULT 'USD',
    "actualCost" DECIMAL(14,2),
    "baseCurrency" TEXT NOT NULL DEFAULT 'BDT',
    "effectiveRate" DECIMAL(14,4),
    "feeAmount" DECIMAL(14,4),
    "taxAmount" DECIMAL(14,4),
    "processingFee" DECIMAL(14,4),
    "sourceAccountId" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "status" "MarketingPaymentStatus" NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPayment_providerPaymentId_key" ON "MarketingPayment"("providerPaymentId");
CREATE UNIQUE INDEX "MarketingPayment_journalEntryId_key" ON "MarketingPayment"("journalEntryId");
CREATE INDEX "MarketingPayment_adAccountId_idx" ON "MarketingPayment"("adAccountId");
CREATE INDEX "MarketingPayment_paymentDate_idx" ON "MarketingPayment"("paymentDate");
CREATE INDEX "MarketingPayment_status_idx" ON "MarketingPayment"("status");
CREATE INDEX "MarketingPayment_providerPaymentId_idx" ON "MarketingPayment"("providerPaymentId");

-- Add foreign keys
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingPayment" ADD CONSTRAINT "MarketingPayment_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: AdAccount
ALTER TABLE "AdAccount" ADD COLUMN "defaultPaymentAccountId" TEXT;

-- AlterTable: MarketingFundingEntry
ALTER TABLE "MarketingFundingEntry" ADD COLUMN "paymentId" TEXT;
ALTER TABLE "MarketingFundingEntry" ADD COLUMN "fundingType" "MarketingFundingType" NOT NULL DEFAULT 'paid';
ALTER TABLE "MarketingFundingEntry" ADD COLUMN "feeAmount" DECIMAL(14,4);
ALTER TABLE "MarketingFundingEntry" ADD COLUMN "taxAmount" DECIMAL(14,4);
ALTER TABLE "MarketingFundingEntry" ALTER COLUMN "platform" SET DEFAULT '';

-- Add foreign key for funding → payment
ALTER TABLE "MarketingFundingEntry" ADD CONSTRAINT "MarketingFundingEntry_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "MarketingPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "MarketingFundingEntry_paymentId_idx" ON "MarketingFundingEntry"("paymentId");

-- AlterTable: MarketingSession
ALTER TABLE "MarketingSession" ADD COLUMN "clickId" TEXT;
CREATE INDEX "MarketingSession_clickId_idx" ON "MarketingSession"("clickId");

-- AlterTable: MarketingCostAllocation
ALTER TABLE "MarketingCostAllocation" ALTER COLUMN "allocatedCurrency" SET DEFAULT '';

-- AlterTable: MarketingSyncStatus
ALTER TABLE "MarketingSyncStatus" ALTER COLUMN "provider" SET DEFAULT '';

-- AlterTable: MarketingRawPayload
ALTER TABLE "MarketingRawPayload" ALTER COLUMN "provider" SET DEFAULT '';

-- Add back-relation fields
ALTER TABLE "JournalEntry" ADD COLUMN "marketingPaymentId" TEXT;
CREATE UNIQUE INDEX "JournalEntry_marketingPaymentId_key" ON "JournalEntry"("marketingPaymentId");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_marketingPaymentId_fkey" FOREIGN KEY ("marketingPaymentId") REFERENCES "MarketingPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add index on AdAccount.defaultPaymentAccountId
CREATE INDEX "AdAccount_defaultPaymentAccountId_idx" ON "AdAccount"("defaultPaymentAccountId");
