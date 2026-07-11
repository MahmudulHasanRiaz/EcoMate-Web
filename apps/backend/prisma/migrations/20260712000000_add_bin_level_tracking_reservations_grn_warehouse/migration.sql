-- AlterTable: Add binLocationId to PhysicalInventory
ALTER TABLE "PhysicalInventory" ADD COLUMN "binLocationId" TEXT;

-- AlterTable: Add referenceType, referenceId to PhysicalInventoryLedger
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceType" "ReferenceEntity";
ALTER TABLE "PhysicalInventoryLedger" ADD COLUMN "referenceId" TEXT;

-- AlterTable: Add warehouseId to GoodsReceiptNote
ALTER TABLE "GoodsReceiptNote" ADD COLUMN "warehouseId" TEXT NOT NULL DEFAULT '';

-- AlterTable: Add defaultBinLocationId relation fields (already exist as columns, add FK)
-- Product.defaultBinLocationId and ProductVariant.binLocationId already exist as columns
-- Just need the FK constraints

-- CreateTable: PhysicalReservation
CREATE TABLE "PhysicalReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ALLOCATING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhysicalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PhysicalReservationAllocation
CREATE TABLE "PhysicalReservationAllocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "PhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: PhysicalReservation
CREATE UNIQUE INDEX "PhysicalReservation_orderItemId_key" ON "PhysicalReservation"("orderItemId");
CREATE INDEX "PhysicalReservation_orderId_idx" ON "PhysicalReservation"("orderId");
CREATE INDEX "PhysicalReservation_status_idx" ON "PhysicalReservation"("status");

-- CreateIndex: PhysicalReservationAllocation
CREATE UNIQUE INDEX "PhysicalReservationAllocation_reservationId_physicalInventoryId_key" ON "PhysicalReservationAllocation"("reservationId", "physicalInventoryId");
CREATE INDEX "PhysicalReservationAllocation_reservationId_idx" ON "PhysicalReservationAllocation"("reservationId");
CREATE INDEX "PhysicalReservationAllocation_physicalInventoryId_idx" ON "PhysicalReservationAllocation"("physicalInventoryId");
CREATE INDEX "PhysicalReservationAllocation_binLocationId_idx" ON "PhysicalReservationAllocation"("binLocationId");

-- CreateIndex: PhysicalInventory binLocationId
CREATE INDEX "PhysicalInventory_binLocationId_idx" ON "PhysicalInventory"("binLocationId");

-- CreateIndex: PhysicalInventoryLedger
CREATE INDEX "PhysicalInventoryLedger_binLocationId_idx" ON "PhysicalInventoryLedger"("binLocationId");
CREATE INDEX "PhysicalInventoryLedger_referenceType_referenceId_idx" ON "PhysicalInventoryLedger"("referenceType", "referenceId");

-- AddForeignKey: PhysicalInventory binLocation
ALTER TABLE "PhysicalInventory" ADD CONSTRAINT "PhysicalInventory_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PhysicalInventoryLedger binLocation
ALTER TABLE "PhysicalInventoryLedger" ADD CONSTRAINT "PhysicalInventoryLedger_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: GoodsReceiptNote warehouse
ALTER TABLE "GoodsReceiptNote" ADD CONSTRAINT "GoodsReceiptNote_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Product defaultBinLocation
ALTER TABLE "Product" ADD CONSTRAINT "Product_defaultBinLocationId_fkey" FOREIGN KEY ("defaultBinLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProductVariant binLocation
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: PhysicalReservation product
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PhysicalReservation warehouse
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PhysicalReservationAllocation reservation
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "PhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: PhysicalReservationAllocation physicalInventory
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_physicalInventoryId_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: PhysicalReservationAllocation binLocation
ALTER TABLE "PhysicalReservationAllocation" ADD CONSTRAINT "PhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
