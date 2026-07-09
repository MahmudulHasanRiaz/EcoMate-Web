-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Set initial sort order based on creation date for existing variants
UPDATE "ProductVariant" SET "sortOrder" = sub.row_num - 1
FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY "productId" ORDER BY "createdAt") AS row_num FROM "ProductVariant") AS sub
WHERE "ProductVariant".id = sub.id;
