-- Manual fix: Ensure all columns for Product, ProductVariant, and Combo tables exist in the database
-- This is necessary to resolve schema drifts from interrupted migrations.

-- Combo table
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Combo" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- Product table
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'simple';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shortDesc" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "basePrice" DECIMAL(10,2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10,2);
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "lowStockQty" INTEGER;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "categoryId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "tags" JSONB DEFAULT '[]';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "images" JSONB DEFAULT '[]';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "seoMeta" JSONB DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "manageStock" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "brandId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "defaultBinLocationId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "sizeChartId" TEXT;

-- ProductVariant table
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "id" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "productId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "sku" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "price" DECIMAL(10,2);
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "stock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "reservedStock" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "binLocationId" TEXT;
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- Safe foreign key additions (only if they don't exist)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_brandId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Product_warehouseId_fkey') THEN
        ALTER TABLE "Product" ADD CONSTRAINT "Product_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductVariant_warehouseId_fkey') THEN
        ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
