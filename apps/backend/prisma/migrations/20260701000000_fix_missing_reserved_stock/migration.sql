-- Manual fix: Ensure missing inventory and stock columns exist in the database
-- This is necessary to resolve schema drifts from interrupted migrations.

ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
