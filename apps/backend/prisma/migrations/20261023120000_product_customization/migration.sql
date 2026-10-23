-- Product customization (owner Q14–Q20, 2026-10-23; license feature
-- 'product-customization'). Additive + nullable everywhere: no definition
-- or answer exists until the feature is used, and every pre-existing row
-- keeps behaving exactly as before. DDL-only, no backfill.
ALTER TABLE "Product" ADD COLUMN "customizations" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "customization" JSONB;
ALTER TABLE "OrderItem" ADD COLUMN "addonAmount" DECIMAL(10,2);
ALTER TABLE "OrderItem" ADD COLUMN "addonCostAmount" DECIMAL(10,2);
