-- Add salePrice column to ProductVariant table
ALTER TABLE "ProductVariant" ADD COLUMN IF NOT EXISTS "salePrice" DECIMAL(10,2);
