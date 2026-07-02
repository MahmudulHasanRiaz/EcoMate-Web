-- Manual fix: Ensure missing inventory and stock columns exist in the database
-- This is necessary to resolve schema drifts from interrupted migrations.

ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brandId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- Safe foreign key additions (only if they don't exist)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_brandId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
