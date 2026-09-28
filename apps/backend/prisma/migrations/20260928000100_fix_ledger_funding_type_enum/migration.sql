-- Hand-written migration 20260821140000 added "fundingType" as TEXT while the
-- datamodel declares the MarketingFundingType enum (used by MarketingFundingEntry).
-- Cast in place (existing values are valid enum labels — no data loss).
--
-- DROP DEFAULT first: the column carries a TEXT default ('paid') from the
-- original migration. Postgres cannot auto-cast a text default to an enum
-- (42804), so ALTER COLUMN TYPE fails unless the default is dropped first.
ALTER TABLE "MarketingFundingLedger"
  ALTER COLUMN "fundingType" DROP DEFAULT;

ALTER TABLE "MarketingFundingLedger"
  ALTER COLUMN "fundingType" TYPE "MarketingFundingType"
  USING ("fundingType"::"MarketingFundingType");

ALTER TABLE "MarketingFundingLedger"
  ALTER COLUMN "fundingType" SET DEFAULT 'paid'::"MarketingFundingType";
