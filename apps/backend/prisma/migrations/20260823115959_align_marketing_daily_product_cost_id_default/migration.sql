-- Drift repair (pre-existing, discovered 2026-08-23 during HR Phase 0 migration
-- prep): the live database and prisma/schema.prisma declare
-- @default(uuid()) -> gen_random_uuid() on MarketingDailyProductCost.id, but the
-- creating migration 20260820153000_add_marketing_daily_product_cost omitted the
-- default. Additive; brings migration history in line with both schema and DB so
-- prisma migrate dev drift detection passes.
ALTER TABLE "MarketingDailyProductCost" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();