-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "sourceWarehouseId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OrderItem_sourceWarehouseId_idx" ON "OrderItem"("sourceWarehouseId");

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_sourceWarehouseId_fkey"
  FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;