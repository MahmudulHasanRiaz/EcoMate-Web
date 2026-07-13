-- CreateEnum
CREATE TYPE "CostingLotConsumptionType" AS ENUM ('FULFILLMENT', 'ADJUSTMENT', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "Zone" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rack" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shelf" (
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shelf_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLotConsumption" (
    "id" TEXT NOT NULL,
    "costingLotId" TEXT NOT NULL,
    "type" "CostingLotConsumptionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceLotId" TEXT,

    CONSTRAINT "CostingLotConsumption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostingLotRestoration" (
    "id" TEXT NOT NULL,
    "consumptionId" TEXT NOT NULL,
    "returnReferenceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostingLotRestoration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destWarehouseId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- AlterTable: BinLocation - drop text columns, add FK columns
ALTER TABLE "BinLocation" DROP COLUMN "zone";
ALTER TABLE "BinLocation" DROP COLUMN "rack";
ALTER TABLE "BinLocation" DROP COLUMN "shelf";
ALTER TABLE "BinLocation" ADD COLUMN "zoneId" TEXT;
ALTER TABLE "BinLocation" ADD COLUMN "rackId" TEXT;
ALTER TABLE "BinLocation" ADD COLUMN "shelfId" TEXT;

-- AlterTable: CostingLot - add warehouseId, transferId, sourceConsumptionId
ALTER TABLE "CostingLot" ADD COLUMN "warehouseId" TEXT;
ALTER TABLE "CostingLot" ADD COLUMN "transferId" TEXT;
ALTER TABLE "CostingLot" ADD COLUMN "sourceConsumptionId" TEXT;

-- AlterTable: OrderItem - remove costingLotId
ALTER TABLE "OrderItem" DROP COLUMN "costingLotId";

-- CreateIndex
CREATE UNIQUE INDEX "Zone_warehouseId_name_key" ON "Zone"("warehouseId", "name");
CREATE INDEX "Zone_warehouseId_idx" ON "Zone"("warehouseId");

CREATE UNIQUE INDEX "Rack_zoneId_name_key" ON "Rack"("zoneId", "name");
CREATE INDEX "Rack_zoneId_idx" ON "Rack"("zoneId");

CREATE UNIQUE INDEX "Shelf_rackId_name_key" ON "Shelf"("rackId", "name");
CREATE INDEX "Shelf_rackId_idx" ON "Shelf"("rackId");

CREATE INDEX "BinLocation_zoneId_idx" ON "BinLocation"("zoneId");
CREATE INDEX "BinLocation_rackId_idx" ON "BinLocation"("rackId");
CREATE INDEX "BinLocation_shelfId_idx" ON "BinLocation"("shelfId");

-- CreateIndex for CostingLot new fields
CREATE UNIQUE INDEX "CostingLot_sourceConsumptionId_key" ON "CostingLot"("sourceConsumptionId");
CREATE INDEX "CostingLot_warehouseId_idx" ON "CostingLot"("warehouseId");
CREATE INDEX "CostingLot_transferId_idx" ON "CostingLot"("transferId");
CREATE INDEX "CostingLot_productId_variantId_warehouseId_remainingQty_idx" ON "CostingLot"("productId", "variantId", "warehouseId", "remainingQty");

-- CreateIndex for CostingLotConsumption
CREATE UNIQUE INDEX "CostingLotConsumption_referenceType_referenceId_costingLotId_type_key" ON "CostingLotConsumption"("referenceType", "referenceId", "costingLotId", "type");
CREATE INDEX "CostingLotConsumption_costingLotId_idx" ON "CostingLotConsumption"("costingLotId");
CREATE INDEX "CostingLotConsumption_referenceType_referenceId_idx" ON "CostingLotConsumption"("referenceType", "referenceId");
CREATE INDEX "CostingLotConsumption_sourceLotId_idx" ON "CostingLotConsumption"("sourceLotId");

-- CreateIndex for CostingLotRestoration
CREATE UNIQUE INDEX "CostingLotRestoration_consumptionId_returnReferenceId_key" ON "CostingLotRestoration"("consumptionId", "returnReferenceId");
CREATE INDEX "CostingLotRestoration_consumptionId_idx" ON "CostingLotRestoration"("consumptionId");
CREATE INDEX "CostingLotRestoration_returnReferenceId_idx" ON "CostingLotRestoration"("returnReferenceId");

-- CreateIndex for StockTransfer
CREATE UNIQUE INDEX "StockTransfer_idempotencyKey_key" ON "StockTransfer"("idempotencyKey");
CREATE INDEX "StockTransfer_sourceWarehouseId_idx" ON "StockTransfer"("sourceWarehouseId");
CREATE INDEX "StockTransfer_destWarehouseId_idx" ON "StockTransfer"("destWarehouseId");
CREATE INDEX "StockTransfer_status_idx" ON "StockTransfer"("status");

-- AddForeignKey: Zone -> Warehouse
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Rack -> Zone
ALTER TABLE "Rack" ADD CONSTRAINT "Rack_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: Shelf -> Rack
ALTER TABLE "Shelf" ADD CONSTRAINT "Shelf_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: BinLocation -> Zone/Rack/Shelf
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "Zone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "Rack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BinLocation" ADD CONSTRAINT "BinLocation_shelfId_fkey" FOREIGN KEY ("shelfId") REFERENCES "Shelf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CostingLot -> Warehouse
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CostingLot -> StockTransfer
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CostingLot -> CostingLotConsumption (sourceConsumption)
ALTER TABLE "CostingLot" ADD CONSTRAINT "CostingLot_sourceConsumptionId_fkey" FOREIGN KEY ("sourceConsumptionId") REFERENCES "CostingLotConsumption"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CostingLotConsumption -> CostingLot
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_costingLotId_fkey" FOREIGN KEY ("costingLotId") REFERENCES "CostingLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: CostingLotConsumption -> CostingLot (sourceLot)
ALTER TABLE "CostingLotConsumption" ADD CONSTRAINT "CostingLotConsumption_sourceLotId_fkey" FOREIGN KEY ("sourceLotId") REFERENCES "CostingLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CostingLotRestoration -> CostingLotConsumption
ALTER TABLE "CostingLotRestoration" ADD CONSTRAINT "CostingLotRestoration_consumptionId_fkey" FOREIGN KEY ("consumptionId") REFERENCES "CostingLotConsumption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: StockTransfer -> Warehouse (source)
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_sourceWarehouseId_fkey" FOREIGN KEY ("sourceWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: StockTransfer -> Warehouse (dest)
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_destWarehouseId_fkey" FOREIGN KEY ("destWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
