-- Discount V2 (2026-10-24): scoped conditions + campaign controls.
-- DDL-only: all new columns are nullable or defaulted, so existing rules
-- behave exactly as before (minQuantity NULL, excludeSaleItems false,
-- maxDiscountAmount NULL, combineWithCoupon true, caps NULL,
-- firstOrderOnly false, priority 0, variantIds empty).
ALTER TABLE "Discount" ADD COLUMN "minQuantity" INTEGER;
ALTER TABLE "Discount" ADD COLUMN "excludeSaleItems" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Discount" ADD COLUMN "maxDiscountAmount" DECIMAL(10, 2);
ALTER TABLE "Discount" ADD COLUMN "combineWithCoupon" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Discount" ADD COLUMN "maxUses" INTEGER;
ALTER TABLE "Discount" ADD COLUMN "maxUsesPerCustomer" INTEGER;
ALTER TABLE "Discount" ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Discount" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Discount" ADD COLUMN "variantIds" TEXT[] NOT NULL DEFAULT '{}';
