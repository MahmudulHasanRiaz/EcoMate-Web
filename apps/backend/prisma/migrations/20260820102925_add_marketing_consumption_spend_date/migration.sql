-- AlterTable
ALTER TABLE "MarketingConsumption" ADD COLUMN     "spendDate" DATE;

-- CreateIndex
CREATE INDEX "MarketingConsumption_spendDate_idx" ON "MarketingConsumption"("spendDate");
