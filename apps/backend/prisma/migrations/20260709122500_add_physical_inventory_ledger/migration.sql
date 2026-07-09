-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "images" JSONB;

-- CreateTable
CREATE TABLE "PhysicalInventoryLedger" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "direction" "MovementDirection" NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reason" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhysicalInventoryLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhysicalInventoryLedger_productId_warehouseId_createdAt_idx" ON "PhysicalInventoryLedger"("productId", "warehouseId", "createdAt");

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
