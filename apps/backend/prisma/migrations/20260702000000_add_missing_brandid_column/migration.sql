-- Migration: Add missing brandId column to Product table and fix any remaining schema drifts
-- This is a SEPARATE migration to ensure it runs fresh on servers where 20260701000000 already ran.
-- All statements are idempotent (IF NOT EXISTS).

-- Add brandId to Product (the critical missing column causing prisma.product.update() failures)
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brandId" TEXT;

-- Ensure all other inventory columns exist too
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChartId" TEXT;

ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- Foreign keys (safe: only if they don't already exist)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_brandId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey"
            FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_warehouseId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_warehouseId_fkey') THEN
        ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_warehouseId_fkey"
            FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_sizeChartId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_sizeChartId_fkey"
            FOREIGN KEY ("sizeChartId") REFERENCES "SizeChart"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
