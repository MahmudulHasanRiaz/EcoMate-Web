-- Hand-written migration 20260821140000 added "fundingType" as TEXT while the
-- datamodel declares the MarketingFundingType enum (used by MarketingFundingEntry).
-- Cast in place (existing values are valid enum labels — no data loss).
ALTER TABLE "MarketingFundingLedger"
  ALTER COLUMN "fundingType" TYPE "MarketingFundingType"
  USING ("fundingType"::"MarketingFundingType");

ALTER TABLE "MarketingFundingLedger"
  ALTER COLUMN "fundingType" SET DEFAULT 'paid'::"MarketingFundingType";
