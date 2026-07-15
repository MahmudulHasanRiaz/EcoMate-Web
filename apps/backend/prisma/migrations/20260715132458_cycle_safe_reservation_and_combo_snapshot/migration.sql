-- DropForeignKey
ALTER TABLE "HeldCart" DROP CONSTRAINT "HeldCart_cashierId_fkey";

-- DropForeignKey
ALTER TABLE "HeldCart" DROP CONSTRAINT "HeldCart_sessionId_fkey";

-- DropIndex
DROP INDEX "CostingLot_productId_remainingQty_idx";

-- DropIndex
DROP INDEX "PhysicalInventoryLedger_referenceType_referenceId_idx";

-- DropIndex
DROP INDEX "PhysicalReservation_orderItemId_key";

-- AlterTable
ALTER TABLE "CostingLot" ALTER COLUMN "warehouseId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CostingLotConsumption" ADD COLUMN     "cycleId" TEXT;

-- AlterTable
ALTER TABLE "CostingLotRestoration" ADD COLUMN     "cycleId" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceiptNote" ALTER COLUMN "warehouseId" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PhysicalInventoryLedger" DROP COLUMN "referenceId",
DROP COLUMN "referenceType";

-- AlterTable
ALTER TABLE "PhysicalReservation" ADD COLUMN     "cycleId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- DropTable
DROP TABLE "HeldCart";

-- CreateTable
CREATE TABLE "OrderStockCycle" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderStockCycle_pkey" PRIMARY KEY ("id")
);

-- Seed default OrderStockCycles for legacy physical reservations (needed because column is NOT NULL)
INSERT INTO "OrderStockCycle" ("id", "orderId", "status", "createdAt", "updatedAt")
SELECT DISTINCT 
  md5("orderId")::uuid::text,
  "orderId",
  'TERMINATED',
  NOW(),
  NOW()
FROM "PhysicalReservation" pr
WHERE NOT EXISTS (
  SELECT 1 FROM "OrderStockCycle" osc WHERE osc."orderId" = pr."orderId"
)
ON CONFLICT DO NOTHING;

-- Populate cycleId for legacy physical reservations
UPDATE "PhysicalReservation" pr
SET "cycleId" = COALESCE(
  (
    SELECT id FROM "OrderStockCycle" osc 
    WHERE osc."orderId" = pr."orderId" 
    ORDER BY osc.status ASC, osc."createdAt" DESC 
    LIMIT 1
  ),
  md5("orderId")::uuid::text
)
WHERE pr."cycleId" IS NULL;

-- Alter PhysicalReservation to set cycleId NOT NULL
ALTER TABLE "PhysicalReservation" ALTER COLUMN "cycleId" SET NOT NULL;

-- CreateTable
CREATE TABLE "OrderItemComboComponent" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "comboItemId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "unitQuantity" INTEGER NOT NULL,
    "totalQuantity" INTEGER NOT NULL,
    "managedStockReserved" BOOLEAN NOT NULL DEFAULT false,
    "managedStockDeducted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItemComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentPhysicalReservation" (
    "id" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "warehouseId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComboComponentPhysicalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponentPhysicalReservationAllocation" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "physicalInventoryId" TEXT NOT NULL,
    "binLocationId" TEXT,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "ComboComponentPhysicalReservationAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderStockCycle_orderId_idx" ON "OrderStockCycle"("orderId");

-- CreateIndex
CREATE INDEX "OrderStockCycle_status_idx" ON "OrderStockCycle"("status");

-- CreateIndex
CREATE INDEX "OrderItemComboComponent_orderItemId_idx" ON "OrderItemComboComponent"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderItemComboComponent_orderItemId_comboItemId_key" ON "OrderItemComboComponent"("orderItemId", "comboItemId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservation_orderId_idx" ON "ComboComponentPhysicalReservation"("orderId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservation_status_idx" ON "ComboComponentPhysicalReservation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentPhysicalReservation_componentId_cycleId_key" ON "ComboComponentPhysicalReservation"("componentId", "cycleId");

-- CreateIndex
CREATE INDEX "ComboComponentPhysicalReservationAllocation_reservationId_idx" ON "ComboComponentPhysicalReservationAllocation"("reservationId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponentPhysicalReservationAllocation_reservationId_p_key" ON "ComboComponentPhysicalReservationAllocation"("reservationId", "physicalInventoryId");

-- CreateIndex
CREATE INDEX "CostingLotConsumption_cycleId_idx" ON "CostingLotConsumption"("cycleId");

-- CreateIndex
CREATE INDEX "CostingLotRestoration_cycleId_idx" ON "CostingLotRestoration"("cycleId");

-- CreateIndex
CREATE INDEX "Order_trashedAt_idx" ON "Order"("trashedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalReservation_orderItemId_cycleId_key" ON "PhysicalReservation"("orderItemId", "cycleId");

-- AddForeignKey
ALTER TABLE "PhysicalReservation" ADD CONSTRAINT "PhysicalReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostingLotRestoration" ADD CONSTRAINT "CostingLotRestoration_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStockCycle" ADD CONSTRAINT "OrderStockCycle_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemComboComponent" ADD CONSTRAINT "OrderItemComboComponent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "OrderItemComboComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservation" ADD CONSTRAINT "ComboComponentPhysicalReservation_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "OrderStockCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "ComboComponentPhysicalReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_physicalInvent_fkey" FOREIGN KEY ("physicalInventoryId") REFERENCES "PhysicalInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponentPhysicalReservationAllocation" ADD CONSTRAINT "ComboComponentPhysicalReservationAllocation_binLocationId_fkey" FOREIGN KEY ("binLocationId") REFERENCES "BinLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "CostingLotConsumption_referenceType_referenceId_costingLotId_ty" RENAME TO "CostingLotConsumption_referenceType_referenceId_costingLotI_key";

-- RenameIndex
ALTER INDEX "PhysicalReservationAllocation_reservationId_physicalInventoryId" RENAME TO "PhysicalReservationAllocation_reservationId_physicalInvento_key";
