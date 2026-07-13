-- DropIndex
DROP INDEX IF EXISTS "PhysicalInventory_productId_warehouseId_binLocationId_key";

-- AlterTable
ALTER TABLE "PhysicalInventory" ADD COLUMN IF NOT EXISTS "variantId" TEXT;

-- AlterTable
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN IF NOT EXISTS "variantId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PhysicalInventory_variantId_idx" ON "PhysicalInventory"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PhysicalInventory_productId_variantId_warehouseId_binLocati_key" ON "PhysicalInventory"("productId", "variantId", "warehouseId", "binLocationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PhysicalInventoryLedger_variantId_idx" ON "PhysicalInventoryLedger"("variantId");

-- AddForeignKey
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
